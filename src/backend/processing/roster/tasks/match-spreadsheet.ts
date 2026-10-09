/**
 * `roster/match-spreadsheet` — the implementation.
 *
 * A thin edge over pure domain logic: parse the roster artifact through the
 * SAME shared grid edge extraction uses, prove the operator's mapping fits
 * these exact bytes, coerce the bound cells through the canonical field
 * registry, and hand everything to `matchRosterSubjects` (ref data-intake-and-edit-data §4's
 * redesigned composition, which owns every verdict rule).
 *
 * Fail-closed rules at this edge:
 * - the mapping is APPLIED, never guessed: the freshly detected columns must
 *   reproduce the mapping's own header fingerprint, and every bound column
 *   must resolve by its source-column identity — a moved or missing layout
 *   refuses with `mapping-mismatch` naming what changed, exactly the
 *   fail-closed reuse rule D147 pins for intake;
 * - a cell that fails its canonical coercion makes THAT FACT null on THAT
 *   row (the row's other field may still match); it is data the matcher
 *   handles, not a swallowed error — the counts are recorded and a null fact
 *   can never emit an EID;
 * - every other throw propagates untouched.
 */
import { defineTask } from "../../../../workflow-kit/task.js";
import { MatchSpreadsheet } from "../../../../models/processing/roster/match-spreadsheet.js";
import {
  isCellCoercionError,
  type CellLocation,
} from "../../../../models/fields/cell-coercion.js";
import { CANONICAL_FIELDS } from "../../../../models/fields/registry.js";
import { EidSchema } from "../../../../rules/identity/ids.js";
import type { ColumnBinding, DetectedColumn } from "../../../../models/intake/mapping.js";
import { detectColumns, headerFingerprint } from "../../../../models/intake/mapping.js";
import {
  matchRosterSubjects,
  RosterMatchSubjectSchema,
  RosterRowFactsSchema,
  type RosterRowFacts,
} from "../../../../rules/matching/roster-match.js";
import {
  parseSpreadsheetGrid,
  readArtifactBytes,
} from "../../spreadsheet/spreadsheet-grid.js";

/** Mirrors extraction's preview depth; detection identity ignores samples. */
const SAMPLE_LIMIT = 3;

type CellCoercion =
  | Readonly<{ coerced: true; value: unknown }>
  | Readonly<{ coerced: false; reason: string }>;

/** The sanctioned discriminated wrapper over a throwing canonical coercer. */
function attemptCoercion(
  coerce: (raw: string, location: CellLocation) => unknown,
  raw: string,
  location: CellLocation,
): CellCoercion {
  try {
    return { coerced: true, value: coerce(raw, location) };
  } catch (error) {
    if (!isCellCoercionError(error)) throw error;
    return { coerced: false, reason: error.reason };
  }
}

export const matchSpreadsheetTask = defineTask(MatchSpreadsheet, {
  sessions: [],
  async run({ input, ctx }) {
    const bytes = await readArtifactBytes(() => ctx.artifacts.open(input.rosterFileRef));
    const parsed = await parseSpreadsheetGrid({
      bytes,
      artifactId: input.rosterFileRef.id,
      mediaType: input.rosterFileRef.mediaType,
      sheet: input.sheet,
    });
    // Every parse refusal is one code here: which worksheet/byte problem it
    // was stays in the message, and the operator's fix is the same — supply a
    // readable roster.
    if (parsed.state === "refused") return ctx.fail("roster-unreadable", parsed.message);

    const { mapping } = input;
    if (mapping.headerRowIndex >= parsed.grid.length - 1) {
      return ctx.fail(
        "mapping-mismatch",
        `the mapping's header row ${String(mapping.headerRowIndex)} leaves no data rows in this `
        + `${String(parsed.grid.length)}-row worksheet — this is not the file the mapping was built for`,
      );
    }
    const headers = parsed.grid[mapping.headerRowIndex] ?? [];
    const dataRows = parsed.grid
      .map((cells, gridRow) => ({ cells, sourceRow: gridRow + 1 }))
      .slice(mapping.headerRowIndex + 1)
      .filter(({ cells }) => cells.some((cell) => cell.trim().length > 0));

    const samples = headers.map((_header, columnIndex) =>
      dataRows
        .map(({ cells }) => cells[columnIndex] ?? "")
        .filter((cell) => cell.trim().length > 0)
        .slice(0, SAMPLE_LIMIT));
    const detected = detectColumns(headers, samples);
    if (headerFingerprint(detected) !== mapping.fingerprint) {
      return ctx.fail(
        "mapping-mismatch",
        "this roster file's columns are not the layout the mapping was built for — re-map the roster",
      );
    }

    const detectedById = new Map(detected.map((column) => [column.sourceColumnId, column]));
    const bindingFor = (canonicalFieldId: "eid" | "fullName"): {
      binding: ColumnBinding;
      column: DetectedColumn;
    } | undefined => {
      const binding = mapping.bindings.find((candidate) => candidate.canonicalFieldId === canonicalFieldId);
      if (binding === undefined) return undefined;
      const column = detectedById.get(binding.sourceColumnId);
      if (column === undefined) {
        // The fingerprint matched, so the column set is the mapping's own —
        // a binding onto a column outside it is a corrupt mapping, not data.
        throw new Error(
          `roster mapping binds ${canonicalFieldId} to column ${binding.sourceColumnId}, `
          + "which the mapping's own layout does not contain",
        );
      }
      return { binding, column };
    };

    const eidBound = bindingFor("eid");
    if (eidBound === undefined) {
      return ctx.fail(
        "no-eid-column",
        "the roster mapping binds no EID column; a roster that cannot name an EID cannot resolve one",
      );
    }
    const nameBound = bindingFor("fullName");
    if (nameBound === undefined) {
      return ctx.fail(
        "no-name-column",
        "the roster mapping binds no name column; name evidence is what a roster match is",
      );
    }

    let eidCellsUnusable = 0;
    let nameCellsUnusable = 0;
    const roster: RosterRowFacts[] = dataRows.map(({ cells, sourceRow }) => {
      const locationFor = (bound: { binding: ColumnBinding; column: DetectedColumn }): CellLocation => ({
        workflow: mapping.workflow,
        readAt: input.readAt,
        sourceRow,
        header: bound.column.header,
        targetFieldId: bound.binding.targetFieldId,
      });
      const rawEid = cells[eidBound.column.currentIndex] ?? "";
      const rawName = cells[nameBound.column.currentIndex] ?? "";
      let eid: RosterRowFacts["eid"] = null;
      if (rawEid.trim().length > 0) {
        const attempt = attemptCoercion(CANONICAL_FIELDS.eid.coerce, rawEid, locationFor(eidBound));
        if (attempt.coerced) eid = EidSchema.parse(attempt.value);
        else eidCellsUnusable += 1;
      }
      let name: RosterRowFacts["name"] = null;
      if (rawName.trim().length > 0) {
        const attempt = attemptCoercion(CANONICAL_FIELDS.fullName.coerce, rawName, locationFor(nameBound));
        if (attempt.coerced) name = String(attempt.value);
        else nameCellsUnusable += 1;
      }
      return RosterRowFactsSchema.parse({ sourceRow, eid, name });
    });

    const subjects = input.subjects.map((subject) => RosterMatchSubjectSchema.parse(subject));
    const matches = matchRosterSubjects(subjects, roster);

    ctx.recordData([
      { direction: "read", field: "matches", value: matches },
    ]);
    ctx.log.info("roster match completed", {
      rosterRows: roster.length,
      subjects: subjects.length,
      eidCellsUnusable,
      nameCellsUnusable,
    });

    return { matches: [...matches] };
  },
});
