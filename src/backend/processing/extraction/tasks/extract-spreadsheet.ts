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
import { defineTask } from "../../../../base/task.js";
import {
  ExtractSpreadsheet,
  ExtractSpreadsheetOutputSchema,
} from "../../../../domain/contracts/extraction/extract-spreadsheet.js";
import { CANONICAL_FIELDS, CANONICAL_FIELD_IDS } from "../../../../domain/fields/registry.js";
import {
  canonicalAliasIndex,
  rankHeaderRows,
} from "../../../../domain/intake/header-discovery.js";
import { detectColumns } from "../../../../domain/intake/mapping.js";
import {
  parseSpreadsheetGrid,
  readArtifactBytes,
} from "../../spreadsheet/spreadsheet-grid.js";

/** How many values per column the mapping grid previews. */
const SAMPLE_LIMIT = 3;

const ALIAS_INDEX = canonicalAliasIndex(CANONICAL_FIELD_IDS.map((id) => CANONICAL_FIELDS[id]));

/**
 * One typed cell → its canonical text.
 *
 * A `Date` is emitted as ISO calendar text in UTC. `read-excel-file` builds a
 * date cell at UTC midnight, so taking the UTC components is reading back what
 * it wrote; using local components would shift the day west of Greenwich and
 * silently move an effective date by one.
 */
export const extractSpreadsheetTask = defineTask(ExtractSpreadsheet, {
  sessions: [],
  async run({ input, ctx }) {
    const bytes = await readArtifactBytes(() => ctx.artifacts.open(input.artifact));
    const parsed = await parseSpreadsheetGrid({
      bytes,
      artifactId: input.artifact.id,
      mediaType: input.artifact.mediaType,
      sheet: input.sheet,
    });
    // The shared edge reports refusals as data; this contract's codes map
    // one-to-one and the messages are the ones this task always produced.
    if (parsed.state === "refused") return ctx.fail(parsed.code, parsed.message);
    const sheets = [...parsed.sheets];
    const sheet = parsed.sheet;
    const grid = parsed.grid.map((row) => [...row]);

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
