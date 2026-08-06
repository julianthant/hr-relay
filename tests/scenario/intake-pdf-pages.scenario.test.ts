/**
 * Executable scenarios for `extraction/extract-pdf-pages` (doc 06 §3.2).
 *
 * These render a real, hand-built PDF through the real task and the real
 * content-addressed writer seam. The sharp case is the last pair: a window that
 * runs past the end of the document must be REFUSED, not clamped — an operator
 * asking for pages 40–50 of a 44-page scan has miscounted, and quietly
 * returning five pages would hide it and misnumber every downstream
 * `sourcePage`.
 */
import { Readable } from "node:stream";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { extractPdfPagesTask } from "../../src/stores/extraction/index.js";
import { ArtifactRefSchema } from "../../src/domain/artifacts.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import { buildMinimalPdf } from "./helpers/minimal-pdf.js";
import type { ContentAddressedArtifactWriter } from "../../src/base/artifacts.js";

const PAGES = ["Oath Roster Page One", "Oath Roster Page Two", "Oath Roster Page Three"];

function uuidFor(index: number): string {
  return `1111111${index}-2222-4333-8444-555555555555`;
}

/**
 * A writing seam that content-addresses for real: identical bytes get the same
 * id, so the scenario can tell a genuine per-page image from three copies of
 * one render.
 */
function recordingWriter(): ContentAddressedArtifactWriter & { readonly written: Buffer[] } {
  const written: Buffer[] = [];
  const byDigest = new Map<string, string>();
  return {
    written,
    put: (source, metadata) => {
      const bytes = Buffer.from(source as Uint8Array);
      written.push(bytes);
      const digest = sha256Hex(bytes.toString("base64"));
      const id = byDigest.get(digest) ?? uuidFor(byDigest.size);
      byDigest.set(digest, id);
      return Promise.resolve(ArtifactRefSchema.parse({
        id,
        sha256: digest,
        bytes: bytes.byteLength,
        mediaType: metadata.mediaType,
      }));
    },
    open: () => { throw new Error("unused"); },
  };
}

async function runTask(bytes: Buffer, options: { fromPage?: number; toPage?: number } = {}) {
  const artifacts = recordingWriter();
  const document = ArtifactRefSchema.parse({
    id: "99999999-2222-4333-8444-555555555555",
    sha256: sha256Hex(bytes.toString("base64")),
    bytes: bytes.byteLength,
    mediaType: "application/pdf",
  });
  const ctx = {
    artifacts: { ...artifacts, open: () => Promise.resolve(Readable.from([bytes])) },
    recordData: () => undefined,
    fail: (code: string, message: string) => { throw Object.assign(new Error(message), { code }); },
  };
  try {
    const output = await extractPdfPagesTask.impl.run({
      input: { document, ...options },
      ctx: ctx as never,
    });
    return { output, written: artifacts.written };
  } catch (error) {
    const failure = error as Error & { code?: string };
    if (failure.code === undefined) throw error;
    return { failure: { code: failure.code, message: failure.message }, written: artifacts.written };
  }
}

describe("extraction/extract-pdf-pages scenarios", () => {
  it("intake/pdf/every-page — one distinct page artifact per page", async () => {
    const result = await runTask(buildMinimalPdf(PAGES));
    assert.equal(result.failure, undefined);
    const output = result.output as {
      pageCount: number;
      pages: { sourcePage: number; image: { sha256: string; mediaType: string; bytes: number } }[];
    };

    assert.equal(output.pageCount, 3);
    assert.deepEqual(output.pages.map((page) => page.sourcePage), [1, 2, 3]);
    assert.equal(output.pages.every((page) => page.image.mediaType === "image/png"), true);
    assert.equal(output.pages.every((page) => page.image.bytes > 0), true);

    // Three DIFFERENT renders, not one image emitted three times — the failure
    // a page-splitter can have that still looks entirely successful.
    assert.equal(new Set(output.pages.map((page) => page.image.sha256)).size, 3);

    // Real PNGs reached the writer.
    assert.equal(
      result.written.every((bytes) => bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e),
      true,
    );
  });

  it("intake/pdf/page-window — a window renders only its pages and keeps their real numbers", async () => {
    const result = await runTask(buildMinimalPdf(PAGES), { fromPage: 2, toPage: 3 });
    assert.equal(result.failure, undefined);
    const output = result.output as { pageCount: number; pages: { sourcePage: number }[] };

    // `pageCount` is the DOCUMENT's, not the window's — otherwise a reviewer
    // cannot tell a two-page scan from pages 2-3 of a longer one.
    assert.equal(output.pageCount, 3);
    assert.deepEqual(output.pages.map((page) => page.sourcePage), [2, 3]);
    assert.equal(result.written.length, 2, "pages outside the window must not be rendered");
  });

  it("intake/pdf/page-out-of-range — a window past the end is refused, never clamped", async () => {
    const past = await runTask(buildMinimalPdf(PAGES), { fromPage: 3, toPage: 9 });
    assert.equal(past.failure?.code, "page-out-of-range");
    assert.equal(past.failure?.message.includes("the document has 3"), true);
    assert.equal(past.written.length, 0, "nothing may be written for a refused window");

    const backwards = await runTask(buildMinimalPdf(PAGES), { fromPage: 3, toPage: 1 });
    assert.equal(backwards.failure?.code, "page-out-of-range");
  });

  it("intake/pdf/unreadable — bytes that are not a PDF fail loud", async () => {
    const empty = await runTask(Buffer.alloc(0));
    assert.equal(empty.failure?.code, "unreadable-pdf");

    const notAPdf = await runTask(Buffer.from("Employee ID#,Effective Date\n10456712,07/01/2026\n", "utf8"));
    assert.equal(notAPdf.failure?.code, "unreadable-pdf");
    assert.equal(notAPdf.written.length, 0);
  });
});
