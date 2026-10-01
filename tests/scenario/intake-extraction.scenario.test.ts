/**
 * Executable scenarios for `extraction/extract-spreadsheet` (ref data-intake-and-edit-data §3).
 *
 * These run the REAL task implementation against real bytes — a real `.xlsx`
 * built by the same library that reads it, and real CSV text — through a
 * recording artifact seam. They are the parser's behaviour contract:
 *
 * - `happy` — a well-formed sheet with a preamble above the header.
 * - `no-header` — a sheet whose header row cannot be preselected, which must
 *   reach the operator as a CHOICE rather than as a failure or a guess.
 * - `duplicate-headers` — two identically spelled columns stay distinct.
 * - `unreadable` — bytes that are not a spreadsheet fail loud.
 *
 * The `no-header` case is the one ref data-intake-and-edit-data §7 vector #9 is about: a file with
 * zero recognizable headings must still reach header selection and mapping.
 */
import { Readable } from "node:stream";
import assert from "node:assert/strict";
import writeXlsxFile from "write-excel-file/node";
import { describe, it } from "vitest";
import { extractSpreadsheetTask } from "../../src/backend/processing/extraction/store.js";
import { ArtifactRefSchema } from "../../src/domain/artifacts.js";
import { sha256Hex } from "../../src/domain/sha256.js";
import type { ContentAddressedArtifactWriter } from "../../src/base/artifacts.js";

const CSV_MEDIA_TYPE = "text/csv";
const XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

function artifactFor(bytes: Buffer, mediaType: string) {
  return ArtifactRefSchema.parse({
    id: "11111111-2222-4333-8444-555555555555",
    sha256: sha256Hex(bytes.toString("base64")),
    bytes: bytes.byteLength,
    mediaType,
  });
}

/** A reading seam over exactly these bytes; `put` is never reached by a read. */
function artifactReader(bytes: Buffer): ContentAddressedArtifactWriter {
  return {
    put: () => { throw new Error("a parse task must not write an artifact"); },
    open: () => Promise.resolve(Readable.from([bytes])),
  };
}

interface RecordedFact {
  readonly direction: string;
  readonly field: string;
  readonly value: unknown;
}

async function runParse(bytes: Buffer, mediaType: string, options: { sheet?: string; headerRowIndex?: number } = {}) {
  const recorded: RecordedFact[] = [];
  const artifact = artifactFor(bytes, mediaType);
  const ctx = {
    artifacts: artifactReader(bytes),
    recordData: (facts: readonly RecordedFact[]) => { recorded.push(...facts); },
    fail: (code: string, message: string) => { throw new Error(`[extraction/extract-spreadsheet] ${code}: ${message}`); },
  };
  const output = await extractSpreadsheetTask.impl.run({
    input: { artifact, ...options },
    // The scenario drives the real impl through the real contract; only the
    // ambient seams (artifact bytes, provenance sink) are supplied here.
    ctx: ctx as never,
  });
  return { output, recorded };
}

describe("extraction/extract-spreadsheet scenarios", () => {
  it("intake/spreadsheet/happy — a preamble above a real header row", async () => {
    const csv = [
      "Work-Study July Export,,",
      ",,",
      "Employee ID#,Effective Date,Dept",
      "10800000,07/01/2026,Housing Dining Hospitality",
      "10800001,07/01/2026,Housing Dining Hospitality",
    ].join("\n");
    const { output, recorded } = await runParse(Buffer.from(csv, "utf8"), CSV_MEDIA_TYPE);

    assert.deepEqual(output.sheets, ["default"]);
    assert.equal(output.headerRowIndex, 2, "the header sits below two preamble rows");
    assert.equal(output.skippedRows, 3);
    assert.deepEqual(output.columns.map((column) => column.header), ["Employee ID#", "Effective Date", "Dept"]);
    assert.deepEqual(output.columns.map((column) => column.occurrence), [1, 1, 1]);
    assert.deepEqual(output.rows, [
      ["10800000", "07/01/2026", "Housing Dining Hospitality"],
      ["10800001", "07/01/2026", "Housing Dining Hospitality"],
    ]);
    assert.deepEqual(output.columns[0].samples, ["10800000", "10800001"]);
    assert.equal(recorded.some((fact) => fact.field === "rowCount" && fact.value === 2), true);
  });

  it("intake/spreadsheet/no-header — an unrecognizable layout reaches the operator, not a guess", async () => {
    // Zero known aliases and two structurally indistinguishable leading rows.
    // Legacy threw here ("no recognizable header row"); this must instead offer
    // candidates so the operator can say which row names the columns.
    const csv = [
      "Zephyr,Quixote,Marimba",
      "Nimbus,Halcyon,Tessellate",
      "Vellum,Obsidian,Pinnacle",
    ].join("\n");
    const { output } = await runParse(Buffer.from(csv, "utf8"), CSV_MEDIA_TYPE);

    assert.equal(output.headerRowIndex, null);
    assert.deepEqual(output.columns, []);
    assert.deepEqual(output.rows, []);
    assert.equal(output.headerCandidates.length >= 2, true, "the operator needs rows to choose between");
    assert.equal(output.headerCandidates.every((candidate) => candidate.cells.length === 3), true);

    // …and an explicit choice re-parses against exactly that row.
    const chosen = await runParse(Buffer.from(csv, "utf8"), CSV_MEDIA_TYPE, { headerRowIndex: 0 });
    assert.equal(chosen.output.headerRowIndex, 0);
    assert.deepEqual(chosen.output.columns.map((column) => column.header), ["Zephyr", "Quixote", "Marimba"]);
    assert.equal(chosen.output.rows.length, 2);
  });

  it("intake/spreadsheet/duplicate-headers — two Name columns stay distinct", async () => {
    const csv = [
      "Name,Name,EID",
      "Example; Avery,Sample; Jordan,10800000",
      "Fixture; Casey,Demo; Taylor,10800001",
    ].join("\n");
    const { output } = await runParse(Buffer.from(csv, "utf8"), CSV_MEDIA_TYPE);

    assert.equal(output.headerRowIndex, 0);
    assert.deepEqual(output.columns.map((column) => column.occurrence), [1, 2, 1]);
    assert.notEqual(output.columns[0].sourceColumnId, output.columns[1].sourceColumnId);
    assert.deepEqual(output.columns[0].samples, ["Example; Avery", "Fixture; Casey"]);
    assert.deepEqual(output.columns[1].samples, ["Sample; Jordan", "Demo; Taylor"]);
  });

  it("intake/spreadsheet/unreadable — bytes that are not a spreadsheet fail loud", async () => {
    await assert.rejects(
      () => runParse(Buffer.alloc(0), CSV_MEDIA_TYPE),
      /unreadable-file/,
    );
    await assert.rejects(
      // Zip magic without a workbook inside: claimed to be xlsx, is not.
      () => runParse(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]), XLSX_MEDIA_TYPE),
      /read-excel-file|zip|xlsx|Invalid|Error/i,
    );
    await assert.rejects(
      () => runParse(Buffer.from("\n\n\n", "utf8"), CSV_MEDIA_TYPE),
      /empty-sheet/,
    );
  });

  // The fixture is produced by `write-excel-file`, a separate package from the
  // reader. That proves a real OOXML round-trip, and it is deliberately NOT
  // claimed as proof against Excel's own output — that is a live check against
  // a real operator export, recorded as an open item, not something a unit test
  // can assert.
  it("reads a real .xlsx, and a date-formatted cell arrives as ISO text", async () => {
    const written = writeXlsxFile([
      [{ value: "Employee ID#" }, { value: "Effective Date" }],
      [{ value: "10800000" }, { value: new Date(Date.UTC(2026, 6, 1)), type: Date, format: "yyyy-mm-dd" }],
    ]);
    const bytes = await written.toBuffer();
    const { output } = await runParse(bytes, XLSX_MEDIA_TYPE);

    assert.equal(output.headerRowIndex, 0);
    assert.deepEqual(output.columns.map((column) => column.header), ["Employee ID#", "Effective Date"]);
    // The critical property: the parser knew this cell was a date, so the value
    // crosses the boundary as ISO text. A bare serial would be refused by the
    // coercer instead of silently becoming a 1900-epoch offset.
    assert.deepEqual(output.rows, [["10800000", "2026-07-01"]]);
  });

  it("refuses an out-of-range explicit header selection instead of clamping it", async () => {
    const csv = "A,B\n1,2\n";
    await assert.rejects(
      () => runParse(Buffer.from(csv, "utf8"), CSV_MEDIA_TYPE, { headerRowIndex: 9 }),
      /invalid-header-selection/,
    );
    await assert.rejects(
      () => runParse(Buffer.from(csv, "utf8"), CSV_MEDIA_TYPE, { headerRowIndex: 1 }),
      /no data rows beneath it/,
    );
  });
});
