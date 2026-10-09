// Only date-formatted spreadsheet cells become dates; downstream text must not guess a bare Excel serial.
import { defineTask } from "../../../../workflow-kit/task.js";
import {
  ExtractSpreadsheet,
  ExtractSpreadsheetOutputSchema,
} from "../../../../models/processing/extraction/extract-spreadsheet.js";
import { CANONICAL_FIELDS, CANONICAL_FIELD_IDS } from "../../../../models/fields/registry.js";
import {
  canonicalAliasIndex,
  rankHeaderRows,
} from "../../../../rules/intake/header-discovery.js";
import { detectColumns } from "../../../../models/intake/mapping.js";
import {
  parseSpreadsheetGrid,
  readArtifactBytes,
} from "../../spreadsheet/spreadsheet-grid.js";

/** How many values per column the mapping grid previews. */
const SAMPLE_LIMIT = 3;

const ALIAS_INDEX = canonicalAliasIndex(CANONICAL_FIELD_IDS.map((id) => CANONICAL_FIELDS[id]));

// Spreadsheet dates are UTC midnight; local getters could shift the calendar day.
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
