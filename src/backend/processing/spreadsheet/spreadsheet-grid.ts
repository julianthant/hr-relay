import JSZip from "jszip";
import { SaxesParser } from "saxes";

import { Buffer } from "node:buffer";
import { parse as parseCsvSync } from "csv-parse/sync";
import readXlsxFile, { InvalidSpreadsheetError } from "read-excel-file/node";

export const CSV_SHEET_NAME = "default";

const XLSX_MEDIA_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

// Spreadsheet dates are UTC midnight; local getters could shift the calendar day.
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    return `${String(value.getUTCFullYear()).padStart(4, "0")}-`
      + `${String(value.getUTCMonth() + 1).padStart(2, "0")}-`
      + `${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  // Unexpected parser cell types refuse; string coercion would hide a changed parser contract.
  throw new Error(`spreadsheet cell has an unexpected ${typeof value} value the parser did not document`);
}

export async function readArtifactBytes(open: () => Promise<NodeJS.ReadableStream>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of await open()) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function padToWidth(rows: readonly (readonly string[])[]): string[][] {
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  return rows.map((row) => {
    const padded = [...row];
    while (padded.length < width) padded.push("");
    return padded;
  });
}

export type SpreadsheetGridResult =
  | Readonly<{ state: "parsed"; sheets: readonly string[]; sheet: string; grid: readonly (readonly string[])[] }>
  | Readonly<{ state: "refused"; code: "unreadable-file" | "unknown-sheet" | "empty-sheet"; message: string }>;


export async function parseSpreadsheetGrid(input: Readonly<{
  bytes: Buffer;
  artifactId: string;
  mediaType: string;
  sheet?: string | undefined;
}>): Promise<SpreadsheetGridResult> {
  const { bytes } = input;
  if (bytes.byteLength === 0) {
    return { state: "refused", code: "unreadable-file", message: `artifact ${input.artifactId} is empty` };
  }

  const isXlsx = XLSX_MEDIA_TYPES.has(input.mediaType)
    // The zip local-file-header magic. A media type is a claim; the bytes are
    // the fact, and an .xlsx renamed to .csv must not be parsed as text.
    || (bytes[0] === 0x50 && bytes[1] === 0x4b);

  let sheets: string[];
  let sheet: string;
  let grid: string[][];

  if (isXlsx) {
    // v9 returns every worksheet from one parse, so choosing a sheet costs no
    // second read of the same immutable bytes.
    let archive: JSZip;
    try { archive = await JSZip.loadAsync(bytes, { checkCRC32: true }); }
    catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      const invalid = new InvalidSpreadsheetError("The XLSX archive is malformed.");
      invalid.cause = cause;
      throw invalid;
    }
    for (const file of Object.values(archive.files)) {
      if (file.dir || (!file.name.endsWith(".xml") && !file.name.endsWith(".rels"))) continue;
      let malformed = false;
      const parser = new SaxesParser({ xmlns: true });
      parser.on("error", () => { malformed = true; });
      parser.write(await file.async("string")).close();
      if (malformed) throw new InvalidSpreadsheetError("The XLSX contains malformed XML.");
    }
    const workbook = await readXlsxFile(bytes);
    sheets = workbook.map((entry) => entry.sheet);
    if (sheets.length === 0) {
      return { state: "refused", code: "unreadable-file", message: "workbook declares no worksheets" };
    }
    const requested = input.sheet;
    const selected = requested === undefined
      ? workbook[0]
      : workbook.find((entry) => entry.sheet === requested);
    if (selected === undefined) {
      return {
        state: "refused",
        code: "unknown-sheet",
        message: `worksheet ${JSON.stringify(requested)} is not in this workbook (${sheets.join(", ")})`,
      };
    }
    sheet = selected.sheet;
    grid = padToWidth(selected.data.map((row) => row.map((cell) => cellText(cell))));
  } else {
    sheets = [CSV_SHEET_NAME];
    if (input.sheet !== undefined && input.sheet !== CSV_SHEET_NAME) {
      return { state: "refused", code: "unknown-sheet", message: `a CSV has one sheet, named ${CSV_SHEET_NAME}` };
    }
    sheet = CSV_SHEET_NAME;
    // Strict column counts preserve the difference between missing cells and blank cells.
    const parsed: unknown = parseCsvSync(bytes, {
      bom: true,
      relax_quotes: false,
      skip_empty_lines: false,
      columns: false,
    });
    if (!Array.isArray(parsed)) {
      return { state: "refused", code: "unreadable-file", message: "CSV did not parse to rows" };
    }
    grid = padToWidth(parsed.map((row) => (Array.isArray(row) ? row.map((cell) => cellText(cell)) : [])));
  }

  if (grid.length === 0 || grid.every((row) => row.every((cell) => cell.trim().length === 0))) {
    return { state: "refused", code: "empty-sheet", message: `worksheet ${JSON.stringify(sheet)} has no rows` };
  }

  return { state: "parsed", sheets, sheet, grid };
}
