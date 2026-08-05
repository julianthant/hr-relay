/**
 * `extraction/extract-spreadsheet` — the implementation.
 *
 * ## Why these two parsers (2026-08-05)
 *
 * - **`read-excel-file`** for `.xlsx`. Actively maintained (9.3.5, published
 *   2026-07-28), MIT, four small modern dependencies, and it returns rows as
 *   arrays of NATIVELY TYPED cells — a date-formatted cell arrives as a `Date`,
 *   which is the property this whole module depends on.
 * - **`csv-parse`** for `.csv`. MIT, **zero** runtime dependencies, actively
 *   maintained (7.0.2, 2026-08-02), and strict by default: a row whose field
 *   count disagrees with the header THROWS rather than padding or truncating.
 *
 * Rejected, with reasons, because a parser choice is a safety decision here:
 *
 * - **`xlsx` (SheetJS CE)** — the npm package is abandoned at 0.18.5 with two
 *   unfixed high-severity advisories, including prototype pollution when
 *   reading a crafted file (CVE-2023-30533). This process drives real UCPath
 *   and Kuali transactions and parses files an operator downloaded from
 *   elsewhere; that is not a risk to accept for convenience.
 * - **`node-xlsx`** — resolves SheetJS through an `https://cdn.sheetjs.com`
 *   tarball URL written into its `package.json`, so the dependency is invisible
 *   to `npm audit` and its integrity rests on a third-party CDN.
 * - **`exceljs`** — what legacy uses, and unmaintained since 2023 (no
 *   meaningful release since October 2023; the maintainers say so). Nine
 *   runtime dependencies including old `unzipper`/`archiver`. Legacy keeps it
 *   because legacy is frozen; a zero-debt tree should not adopt it.
 * - **`@office-kit/xlsx`** — technically the nicest option (TypeScript-first,
 *   three modern dependencies, consumes openpyxl's fixture corpus) but pre-1.0
 *   alpha with an API its authors say will shift. Worth revisiting at 1.0.
 *
 * ## Cells are canonicalized to strings AT THIS EDGE
 *
 * A `Date` becomes ISO `YYYY-MM-DD`; a number becomes its decimal text; `null`
 * becomes `""`. This is the one place that knows a cell was date-FORMATTED, so
 * it is the only place that may say so. Everything downstream sees text, and
 * `parseUsOrIsoDate` refuses a bare Excel serial — so a date the spreadsheet
 * never marked as one is a loud rejection naming the cell, not a silent
 * 1900-epoch guess.
 */
import { Buffer } from "node:buffer";
import { parse as parseCsvSync } from "csv-parse/sync";
import readXlsxFile from "read-excel-file/node";
import { defineTask } from "../../../base/task.js";
import {
  ExtractSpreadsheet,
  ExtractSpreadsheetOutputSchema,
} from "../../../domain/contracts/extraction/extract-spreadsheet.js";
import { CANONICAL_FIELDS, CANONICAL_FIELD_IDS } from "../../../domain/fields/registry.js";
import {
  canonicalAliasIndex,
  rankHeaderRows,
} from "../../../domain/intake/header-discovery.js";
import { detectColumns } from "../../../domain/intake/mapping.js";

/** How many values per column the mapping grid previews. */
const SAMPLE_LIMIT = 3;
const CSV_SHEET_NAME = "default";
const XLSX_MEDIA_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

const ALIAS_INDEX = canonicalAliasIndex(CANONICAL_FIELD_IDS.map((id) => CANONICAL_FIELDS[id]));

/**
 * One typed cell → its canonical text.
 *
 * A `Date` is emitted as ISO calendar text in UTC. `read-excel-file` builds a
 * date cell at UTC midnight, so taking the UTC components is reading back what
 * it wrote; using local components would shift the day west of Greenwich and
 * silently move an effective date by one.
 */
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
  // Both parsers' documented cell domains are exhausted above
  // (string | number | boolean | Date | null). Anything else means a parser
  // changed under us, and `String(value)` would put "[object Object]" into a
  // cell an operator could then bind a column to.
  throw new Error(`spreadsheet cell has an unexpected ${typeof value} value the parser did not document`);
}

async function readArtifactBytes(open: () => Promise<NodeJS.ReadableStream>): Promise<Buffer> {
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

export const extractSpreadsheetTask = defineTask(ExtractSpreadsheet, {
  sessions: [],
  async run({ input, ctx }) {
    const bytes = await readArtifactBytes(() => ctx.artifacts.open(input.artifact));
    if (bytes.byteLength === 0) {
      return ctx.fail("unreadable-file", `artifact ${input.artifact.id} is empty`);
    }

    const isXlsx = XLSX_MEDIA_TYPES.has(input.artifact.mediaType)
      // The zip local-file-header magic. A media type is a claim; the bytes are
      // the fact, and an .xlsx renamed to .csv must not be parsed as text.
      || (bytes[0] === 0x50 && bytes[1] === 0x4b);

    let sheets: string[];
    let sheet: string;
    let grid: string[][];

    if (isXlsx) {
      // v9 returns every worksheet from one parse, so choosing a sheet costs no
      // second read of the same immutable bytes.
      const workbook = await readXlsxFile(bytes);
      sheets = workbook.map((entry) => entry.sheet);
      if (sheets.length === 0) return ctx.fail("unreadable-file", "workbook declares no worksheets");
      const requested = input.sheet;
      const selected = requested === undefined
        ? workbook[0]
        : workbook.find((entry) => entry.sheet === requested);
      if (selected === undefined) {
        return ctx.fail(
          "unknown-sheet",
          `worksheet ${JSON.stringify(requested)} is not in this workbook (${sheets.join(", ")})`,
        );
      }
      sheet = selected.sheet;
      grid = padToWidth(selected.data.map((row) => row.map((cell) => cellText(cell))));
    } else {
      sheets = [CSV_SHEET_NAME];
      if (input.sheet !== undefined && input.sheet !== CSV_SHEET_NAME) {
        return ctx.fail("unknown-sheet", `a CSV has one sheet, named ${CSV_SHEET_NAME}`);
      }
      sheet = CSV_SHEET_NAME;
      // `relax_column_count` stays OFF: a row whose field count disagrees with
      // its neighbours is a real defect, and padding it would invent blank
      // cells that the mapping grid would then bind columns to.
      const parsed: unknown = parseCsvSync(bytes, {
        bom: true,
        relax_quotes: false,
        skip_empty_lines: false,
        columns: false,
      });
      if (!Array.isArray(parsed)) return ctx.fail("unreadable-file", "CSV did not parse to rows");
      grid = padToWidth(parsed.map((row) => (Array.isArray(row) ? row.map((cell) => cellText(cell)) : [])));
    }

    if (grid.length === 0 || grid.every((row) => row.every((cell) => cell.trim().length === 0))) {
      return ctx.fail("empty-sheet", `worksheet ${JSON.stringify(sheet)} has no rows`);
    }

    const discovery = rankHeaderRows(grid, ALIAS_INDEX);
    const chosen = input.headerRowIndex ?? discovery.headerRowIndex;
    if (input.headerRowIndex !== undefined) {
      // An explicit selection is honoured exactly or refused. Clamping it would
      // shift every column by a row and report the damage as bad data.
      if (input.headerRowIndex >= grid.length) {
        return ctx.fail(
          "invalid-header-selection",
          `row ${String(input.headerRowIndex)} is beyond the ${String(grid.length)} rows in ${sheet}`,
        );
      }
      if (grid[input.headerRowIndex].every((cell) => cell.trim().length === 0)) {
        return ctx.fail("invalid-header-selection", `row ${String(input.headerRowIndex)} is blank`);
      }
      if (input.headerRowIndex === grid.length - 1) {
        return ctx.fail(
          "invalid-header-selection",
          `row ${String(input.headerRowIndex)} has no data rows beneath it`,
        );
      }
    }

    const headerCandidates = discovery.candidates.map((candidate) => ({
      rowIndex: candidate.rowIndex,
      cells: candidate.cells,
      confidence: candidate.confidence,
    }));

    if (chosen === null) {
      // Not a failure: an operator-resolvable state. Returning empty columns
      // with a null index is what makes "the operator chooses" representable.
      ctx.recordData([
        { direction: "read", field: "sheet", value: sheet },
        { direction: "read", field: "headerRowIndex", value: null },
      ]);
      return ExtractSpreadsheetOutputSchema.parse({
        sheets,
        sheet,
        headerRowIndex: null,
        headerCandidates,
        columns: [],
        rows: [],
        skippedRows: 0,
      });
    }

    const headers = grid[chosen];
    const dataRows = grid.slice(chosen + 1).filter((row) => row.some((cell) => cell.trim().length > 0));
    const samples = headers.map((_header, columnIndex) =>
      dataRows
        .map((row) => row[columnIndex] ?? "")
        .filter((cell) => cell.trim().length > 0)
        .slice(0, SAMPLE_LIMIT));
    const columns = detectColumns(headers, samples);

    ctx.recordData([
      { direction: "read", field: "sheet", value: sheet },
      { direction: "read", field: "headerRowIndex", value: chosen },
      { direction: "read", field: "columnCount", value: columns.length },
      { direction: "read", field: "rowCount", value: dataRows.length },
    ]);

    return ExtractSpreadsheetOutputSchema.parse({
      sheets,
      sheet,
      headerRowIndex: chosen,
      headerCandidates,
      columns,
      rows: dataRows,
      skippedRows: chosen + 1,
    });
  },
});
