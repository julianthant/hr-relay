import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { describe, it } from "vitest";
import type { ContentAddressedArtifactWriter } from "../../../../../src/base/artifacts.js";
import { ArtifactRefSchema } from "../../../../../src/domain/artifacts.js";
import { ExtractPdfPagesOutputSchema } from "../../../../../src/domain/contracts/extraction/extract-pdf-pages.js";
import type { ExtractSpreadsheetOutput } from "../../../../../src/domain/contracts/extraction/extract-spreadsheet.js";
import { sha256Hex } from "../../../../../src/domain/sha256.js";
import { extractPdfPagesTask, extractSpreadsheetTask } from "../../../../../src/stores/extraction/index.js";

const CSV = "text/csv";
type ArtifactReference = ReturnType<typeof ArtifactRefSchema.parse>;
type ExtractPdfPagesOutput = ReturnType<typeof ExtractPdfPagesOutputSchema.parse>;
type TaskResult<Output, Metadata extends object> =
  | (Readonly<{ outcome: "success"; output: Output }> & Metadata)
  | (Readonly<{ outcome: "failure"; failure: Readonly<{ code: string; message: string }> }> & Metadata);

function artifactFor(bytes: Buffer, mediaType: string) {
  return ArtifactRefSchema.parse({
    id: "11111111-2222-4333-8444-555555555555",
    sha256: sha256Hex(bytes.toString("base64")),
    bytes: bytes.byteLength,
    mediaType,
  });
}

function fail(code: string, message: string): never {
  throw Object.assign(new Error(message), { code });
}

async function runSpreadsheet(
  csv: string,
  options: Readonly<{ sheet?: string; headerRowIndex?: number }> = {},
): Promise<TaskResult<ExtractSpreadsheetOutput, Readonly<{ facts: unknown[]; opened: unknown[]; artifact: ArtifactReference }>>> {
  const bytes = Buffer.from(csv, "utf8");
  const artifact = artifactFor(bytes, CSV);
  const opened: unknown[] = [];
  const facts: unknown[] = [];
  const ctx = {
    artifacts: {
      open: (reference: unknown) => {
        opened.push(reference);
        return Promise.resolve(Readable.from([bytes]));
      },
      put: () => { throw new Error("spreadsheet extraction must not write artifacts"); },
    } satisfies ContentAddressedArtifactWriter,
    fail,
    recordData: (point: unknown) => { facts.push(point); },
  };
  try {
    const output = await extractSpreadsheetTask.impl.run({
      input: { artifact, ...options },
      ctx: ctx as never,
    });
    return { outcome: "success" as const, output, facts, opened, artifact };
  } catch (error) {
    const caught = error as Error & { code?: string };
    if (caught.code === undefined) throw error;
    return { outcome: "failure" as const, failure: { code: caught.code, message: caught.message }, facts, opened, artifact };
  }
}

function buildOnePagePdf(): Buffer {
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = "<< /Type /Pages /Kids [4 0 R] /Count 1 >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  const stream = "BT /F1 24 Tf 72 700 Td (Fixture Page) Tj ET";
  objects[4] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]"
    + " /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>";
  objects[5] = "<< /Length " + String(stream.length) + " >>\nstream\n"
    + stream + "\nendstream";

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let number = 1; number < objects.length; number += 1) {
    offsets[number] = pdf.length;
    pdf += String(number) + " 0 obj\n" + objects[number] + "\nendobj\n";
  }
  const xrefOffset = pdf.length;
  pdf += "xref\n0 " + String(objects.length) + "\n0000000000 65535 f \n";
  for (let number = 1; number < objects.length; number += 1) {
    pdf += String(offsets[number]).padStart(10, "0") + " 00000 n \n";
  }
  pdf += "trailer\n<< /Size " + String(objects.length) + " /Root 1 0 R >>\n"
    + "startxref\n" + String(xrefOffset) + "\n%%EOF\n";
  return Buffer.from(pdf, "latin1");
}

async function runPdf(
  bytes: Buffer,
  toPage?: number,
): Promise<TaskResult<ExtractPdfPagesOutput, Readonly<{
  writes: { bytes: Buffer; mediaType: string }[];
  facts: unknown[];
  opened: unknown[];
  document: ArtifactReference;
}>>> {
  const document = artifactFor(bytes, "application/pdf");
  const writes: { bytes: Buffer; mediaType: string }[] = [];
  const facts: unknown[] = [];
  const outputRef = ArtifactRefSchema.parse({
    id: "22222222-2222-4222-8222-222222222222",
    sha256: "ab".repeat(32),
    bytes: 1,
    mediaType: "image/png",
  });
  const opened: unknown[] = [];
  const ctx = {
    artifacts: {
      open: (reference: unknown) => {
        opened.push(reference);
        return Promise.resolve(Readable.from([bytes]));
      },
      // In-memory observation of the renderer output only; this does not prove persistence.
      put: async (source: Uint8Array | Readable, metadata: { mediaType: string }) => {
        const rendered = Buffer.from(source as Uint8Array);
        writes.push({ bytes: rendered, mediaType: metadata.mediaType });
        return ArtifactRefSchema.parse({ ...outputRef, bytes: rendered.byteLength });
      },
    },
    fail,
    recordData: (point: unknown) => { facts.push(point); },
  };
  try {
    const output = await extractPdfPagesTask.impl.run({
      input: { document, ...(toPage === undefined ? {} : { toPage }) },
      ctx: ctx as never,
    });
    return { outcome: "success" as const, output, writes, facts, opened, document };
  } catch (error) {
    const caught = error as Error & { code?: string };
    if (caught.code === undefined) throw error;
    return { outcome: "failure" as const, failure: { code: caught.code, message: caught.message }, writes, facts, opened, document };
  }
}

describe("extraction task wrappers", () => {
  it("returns selected spreadsheet facts and records the public header/row counts", async () => {
    const result = await runSpreadsheet(
      "Preamble,\nEmployee ID#,Effective Date\n10800000,07/01/2026\n",
    );
    if (result.outcome !== "success") throw new Error(`expected spreadsheet output, received ${result.failure.code}`);

    assert.equal(result.output.sheet, "default");
    assert.equal(result.output.headerRowIndex, 1);
    assert.deepEqual(result.output.rows, [["10800000", "07/01/2026"]]);
    assert.equal(result.output.skippedRows, 2);
    assert.deepEqual(result.opened, [result.artifact]);
    assert.deepEqual(result.facts, [[
      { direction: "read", field: "sheet", value: "default" },
      { direction: "read", field: "headerRowIndex", value: 1 },
      { direction: "read", field: "columnCount", value: 2 },
      { direction: "read", field: "rowCount", value: 1 },
    ]]);
  });

  it("refuses an unknown sheet without recording a successful read", async () => {
    const missing = await runSpreadsheet("Employee ID#,Full Name\n10800000,Avery\n", { sheet: "Missing" });
    if (missing.outcome !== "failure") throw new Error("expected unknown-sheet refusal");
    assert.equal(missing.failure.code, "unknown-sheet");
    assert.equal(missing.failure.message, "a CSV has one sheet, named default");
    assert.deepEqual(missing.facts, []);
  });

  it("refuses an invalid explicit header instead of clamping and recording facts", async () => {
    const row = await runSpreadsheet("Employee ID#,Full Name\n10800000,Avery\n", { headerRowIndex: 9 });
    if (row.outcome !== "failure") throw new Error("expected invalid-header-selection refusal");
    assert.equal(row.failure.code, "invalid-header-selection");
    assert.match(row.failure.message, /row 9 is beyond the 2 rows/u);
    assert.deepEqual(row.facts, []);
  });

  it("returns the selected PDF page and its rendered PNG bytes", async () => {
    const rendered = await runPdf(buildOnePagePdf());
    if (rendered.outcome !== "success") throw new Error(`expected rendered output, received ${rendered.failure.code}`);

    assert.equal(rendered.output.pageCount, 1);
    assert.deepEqual(rendered.output.pages.map((page) => page.sourcePage), [1]);
    assert.equal(rendered.output.pages[0]?.image.mediaType, "image/png");
    assert.deepEqual(rendered.opened, [rendered.document]);
    assert.equal(rendered.writes.length, 1);
    assert.equal(rendered.writes[0]?.mediaType, "image/png");
    const pngBytes = rendered.writes[0]?.bytes;
    assert.ok(pngBytes !== undefined);
    assert.deepEqual([...pngBytes.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.deepEqual(rendered.facts, [[
      { direction: "read", field: "pageCount", value: 1 },
      { direction: "read", field: "renderedPages", value: 1 },
    ]]);
  });

  it("refuses a page range past the PDF without writing bytes or recording facts", async () => {
    const refused = await runPdf(buildOnePagePdf(), 2);
    if (refused.outcome !== "failure") throw new Error("expected page-out-of-range refusal");
    assert.equal(refused.failure.code, "page-out-of-range");
    assert.match(refused.failure.message, /pages 1–2 were requested but the document has 1/u);
    assert.equal(refused.writes.length, 0);
    assert.deepEqual(refused.facts, []);
  });
});
