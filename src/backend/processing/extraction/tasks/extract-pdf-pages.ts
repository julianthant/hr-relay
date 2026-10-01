/**
 * `extraction/extract-pdf-pages` — the implementation.
 *
 * ## Why `pdf-to-img` (2026-08-06)
 *
 * It wraps Mozilla's `pdfjs-dist` — the reference PDF implementation, and the
 * one legacy already renders with — behind a Node-shaped API, is MIT, is
 * actively maintained (6.2.0, published 2026-06-12), and carries exactly one
 * runtime dependency. Rejected:
 *
 * - **`pdf-lib`**, what legacy uses for page SPLITTING. Last published
 *   2022-05-12 and it cannot rasterize at all. The rebuild does not need a PDF
 *   *writer* on this path, and adopting an unmaintained one for a need that has
 *   not arrived would be debt taken on speculatively.
 * - **`pdfjs-dist` directly.** Same engine, but rendering in Node needs a
 *   canvas binding and the worker plumbing wired by hand; `pdf-to-img` is
 *   precisely that plumbing, kept current by someone else.
 * - **`mupdf`.** AGPL-3.0. A strong copyleft is not a licence to take on
 *   casually for a university system.
 * - **`pdf-parse` / `unpdf`.** Text extractors. A scanned form has no text
 *   layer; the whole point here is the image.
 *
 * ## Two things real scans taught us, both load-bearing
 *
 * 1. **The JBIG2 wasm decoder must be wired.** Xerox scanners emit JBIG2 for
 *    bilevel pages, and without `wasmUrl` pdfjs announces "Falling back to JS
 *    JBIG2 decoder" and takes ~60% longer (measured on a real 44-page operator
 *    scan: 736 ms vs 462 ms for five pages). The URL is resolved from the
 *    INSTALLED `pdfjs-dist`, so it cannot drift from the version actually
 *    loaded.
 * 2. **pdfjs TRANSFERS the input buffer.** A second render over the same
 *    `Uint8Array` throws `DataCloneError` on a detached buffer. Every call
 *    therefore gets its own copy, which is also what makes a retry safe.
 */
import { Buffer } from "node:buffer";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { pdf } from "pdf-to-img";
import { defineTask } from "../../../../base/task.js";
import {
  ExtractPdfPages,
  ExtractPdfPagesOutputSchema,
} from "../../../../domain/contracts/extraction/extract-pdf-pages.js";

/**
 * Rendered at 2× so small hand-printing survives; the scale is PINNED because
 * it is part of what makes the output deterministic for a given input.
 */
const RENDER_SCALE = 2;
const PAGE_MEDIA_TYPE = "image/png";

/** Resolved from the installed pdfjs-dist so it can never name a stale copy. */
function pdfjsWasmUrl(): string {
  const require = createRequire(import.meta.url);
  return pathToFileURL(`${dirname(require.resolve("pdfjs-dist/package.json"))}/wasm/`).href;
}

async function readArtifactBytes(open: () => Promise<NodeJS.ReadableStream>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await open()) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export const extractPdfPagesTask = defineTask(ExtractPdfPages, {
  sessions: [],
  async run({ input, ctx }) {
    const bytes = await readArtifactBytes(() => ctx.artifacts.open(input.document));
    if (bytes.byteLength === 0) {
      return ctx.fail("unreadable-pdf", `artifact ${input.document.id} is empty`);
    }

    let document;
    try {
      // A fresh copy: pdfjs detaches what it is given.
      document = await pdf(new Uint8Array(bytes), {
        scale: RENDER_SCALE,
        docInitParams: { wasmUrl: pdfjsWasmUrl() },
      });
    } catch (error) {
      return ctx.fail(
        "unreadable-pdf",
        `artifact ${input.document.id} could not be opened as a PDF: `
          + (error instanceof Error ? error.message : String(error)),
      );
    }

    const pageCount = document.length;
    if (pageCount === 0) return ctx.fail("empty-document", `artifact ${input.document.id} has no pages`);

    const from = input.fromPage ?? 1;
    const to = input.toPage ?? pageCount;
    if (from > to) {
      return ctx.fail("page-out-of-range", `page window ${String(from)}–${String(to)} runs backwards`);
    }
    if (to > pageCount) {
      // Refused, never clamped: an operator asking for pages past the end has
      // miscounted, and quietly returning fewer would hide it.
      return ctx.fail(
        "page-out-of-range",
        `pages ${String(from)}–${String(to)} were requested but the document has ${String(pageCount)}`,
      );
    }

    const pages: { sourcePage: number; image: unknown }[] = [];
    let sourcePage = 0;
    for await (const rendered of document) {
      sourcePage += 1;
      if (sourcePage < from) continue;
      if (sourcePage > to) break;
      if (rendered.byteLength === 0) {
        return ctx.fail("unreadable-pdf", `page ${String(sourcePage)} rendered to nothing`);
      }
      const image = await ctx.artifacts.put(rendered, { mediaType: PAGE_MEDIA_TYPE });
      pages.push({ sourcePage, image });
    }

    ctx.recordData([
      { direction: "read", field: "pageCount", value: pageCount },
      { direction: "read", field: "renderedPages", value: pages.length },
    ]);

    return ExtractPdfPagesOutputSchema.parse({ pageCount, pages });
  },
});
