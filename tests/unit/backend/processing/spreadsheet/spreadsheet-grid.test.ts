import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { Buffer } from "node:buffer";
import writeXlsxFile from "write-excel-file/node";
import { parseSpreadsheetGrid } from "../../../../../src/backend/processing/spreadsheet/spreadsheet-grid.js";

const CSV = "text/csv";

async function xlsxBytes() {
  const workbook = writeXlsxFile([
    {
      sheet: "Cover",
      data: [[{ value: "Summary" }], [{ value: "Not the roster" }]],
    },
    {
      sheet: "Roster",
      data: [
        [{ value: "Effective Date" }, { value: "Count" }, { value: "Active" }, { value: "Blank" }],
        [
          { value: new Date(Date.UTC(2026, 6, 1)), type: Date, format: "yyyy-mm-dd" },
          { value: 42 },
          { value: true },
          { value: "" },
        ],
      ],
    },
  ]);
  return Buffer.from(await workbook.toBuffer());
}

describe("spreadsheet grid parser", () => {
  it("uses ZIP bytes to select a named worksheet and canonicalizes typed cells in UTC", async () => {
    const bytes = await xlsxBytes();
    assert.equal(bytes[0], 0x50);
    assert.equal(bytes[1], 0x4b);

    const parsed = await parseSpreadsheetGrid({
      bytes,
      artifactId: "typed-workbook",
      mediaType: CSV,
      sheet: "Roster",
    });

    assert.deepEqual(parsed, {
      state: "parsed",
      sheets: ["Cover", "Roster"],
      sheet: "Roster",
      grid: [
        ["Effective Date", "Count", "Active", "Blank"],
        ["2026-07-01", "42", "true", ""],
      ],
    });
  });

  it("names an empty artifact as unreadable", async () => {
    assert.deepEqual(
      await parseSpreadsheetGrid({
        bytes: Buffer.alloc(0),
        artifactId: "empty",
        mediaType: CSV,
      }),
      { state: "refused", code: "unreadable-file", message: "artifact empty is empty" },
    );

  });

  it("names a parsed worksheet with no rows as empty", async () => {
    assert.deepEqual(
      await parseSpreadsheetGrid({
        bytes: Buffer.from("\n\n", "utf8"),
        artifactId: "blank-csv",
        mediaType: CSV,
      }),
      { state: "refused", code: "empty-sheet", message: "worksheet \"default\" has no rows" },
    );
  });

  it("names unknown worksheet selections instead of choosing another sheet", async () => {
    const bytes = await xlsxBytes();
    const missing = await parseSpreadsheetGrid({
      bytes,
      artifactId: "typed-workbook",
      mediaType: CSV,
      sheet: "Missing",
    });
    assert.equal(missing.state, "refused");
    if (missing.state === "refused") assert.equal(missing.code, "unknown-sheet");

    const wrongCsvSheet = await parseSpreadsheetGrid({
      bytes: Buffer.from("A,B\n1,2\n", "utf8"),
      artifactId: "csv",
      mediaType: CSV,
      sheet: "Roster",
    });
    assert.deepEqual(wrongCsvSheet, {
      state: "refused",
      code: "unknown-sheet",
      message: "a CSV has one sheet, named default",
    });
  });

  it("rejects ragged CSV rows rather than padding a changed file shape", async () => {
    await assert.rejects(() => parseSpreadsheetGrid({
      bytes: Buffer.from("name,eid\nAvery,10800000\nJordan,10800001,extra\n", "utf8"),
      artifactId: "ragged",
      mediaType: CSV,
    }), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { code?: string }).code, "CSV_RECORD_INCONSISTENT_FIELDS_LENGTH");
      return true;
    });
  });
});
