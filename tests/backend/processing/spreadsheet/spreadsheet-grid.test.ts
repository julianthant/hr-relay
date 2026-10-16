import Excel from "exceljs";
import JSZip from "jszip";
import { InvalidSpreadsheetError } from "read-excel-file/node";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { describe,it } from "vitest";
import writeXlsxFile from "write-excel-file/node";
import { parseSpreadsheetGrid } from "../../../../src/backend/processing/spreadsheet/spreadsheet-grid.js";

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

it.each(["workbook", "relationships"])("refuses well-formed but missing %s sheet structure as malformed input", async part => {
  const workbook = new Excel.Workbook(); workbook.addWorksheet("Roster").addRow(["Employee ID#"]);
  const archive = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  archive.file(part === "workbook" ? "xl/workbook.xml" : "xl/_rels/workbook.xml.rels", part === "workbook"
    ? '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>'
    : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
  const bytes = await archive.generateAsync({ type: "nodebuffer" });
  if (part === "workbook") {
    assert.deepEqual(await parseSpreadsheetGrid({ bytes, artifactId: "no-sheets", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      { state: "refused", code: "unreadable-file", message: "workbook declares no worksheets" });
  } else await assert.rejects(parseSpreadsheetGrid({ bytes, artifactId: "unlinked-sheets", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), InvalidSpreadsheetError);
});
it("preserves no-sheet and empty-sheet refusals for empty ExcelJS workbooks", async () => {
  const workbook = new Excel.Workbook();
  const parse = async () => parseSpreadsheetGrid({ bytes: Buffer.from(await workbook.xlsx.writeBuffer()), artifactId: "empty-xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  assert.deepEqual(await parse(), { state: "refused", code: "unreadable-file", message: "workbook declares no worksheets" });
  workbook.addWorksheet("Empty");
  assert.deepEqual(await parse(), { state: "refused", code: "empty-sheet", message: 'worksheet "Empty" has no rows' });
});
it("keeps prefixed workbook elements, nonsequential sheet IDs and absolute worksheet targets", async () => {
  const workbook = new Excel.Workbook(); workbook.addWorksheet("Roster").addRows([["Employee ID#"], ["10800000"]]);
  const archive = await JSZip.loadAsync(await workbook.xlsx.writeBuffer());
  const info = archive.file("xl/workbook.xml"); assert.ok(info);
  const relationships = archive.file("xl/_rels/workbook.xml.rels"); assert.ok(relationships);
  archive.file("xl/workbook.xml", (await info.async("string")).replace('sheetId="1"', 'sheetId="7"')
    .replace(/(<\/?)(workbook|sheets|sheet)(?=[\s/>])/gu, "$1w:$2")
    .replace("<w:workbook ", '<w:workbook xmlns:w="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '));
  archive.file("xl/_rels/workbook.xml.rels", (await relationships.async("string")).replace(/Target="(?:\/xl\/)?worksheets\/sheet1.xml"/u, 'Target="/xl/worksheets/sheet1.xml"'));
  assert.deepEqual(await parseSpreadsheetGrid({ bytes: await archive.generateAsync({ type: "nodebuffer" }), artifactId: "valid-variant", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    { state: "parsed", sheets: ["Roster"], sheet: "Roster", grid: [["Employee ID#"], ["10800000"]] });
});
