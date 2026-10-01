/**
 * The kernel's `intakeParser` seam, composed (D170).
 *
 * The kernel cannot import a spreadsheet parser — that lives in
 * `src/backend/processing/spreadsheet/intake-parser.ts`, below it — and its authority transaction is synchronous,
 * while reading an artifact and parsing a workbook are not. So this module
 * splits the seam in two:
 *
 * - `prepare` is async. It reads the immutable artifact once, parses it
 *   through the ONE shared grid edge, and retains the resulting grid.
 * - `parse` is synchronous and PURE over that retained grid: it ranks header
 *   candidates, settles a header row, detects columns and computes the layout
 *   fingerprint. A key nobody prepared throws by name rather than answering
 *   with an empty parse — a kernel that mapped against a guessed layout would
 *   bind a column that is not there.
 *
 * The retained value is the GRID, never the derived parse, because the
 * derivation is cheap and depends on the header row the operator may still be
 * moving. Two operators are not a case here: the cap exists so a long session
 * of sheet-switching cannot grow without bound, not to make lookups fast.
 */
import { z } from "zod";
import type { ContentAddressedArtifactWriter } from "../../../base/artifacts.js";
import type { IntakeParser } from "../../../base/intake-parser.js";
import { ArtifactRefSchema, type ArtifactRef } from "../../../domain/artifacts.js";
import { canonicalJsonStringify } from "../../../domain/canonical-json.js";
import { CANONICAL_FIELDS } from "../../../domain/fields/registry.js";
import { canonicalAliasIndex, rankHeaderRows } from "../../../domain/intake/header-discovery.js";
import { detectColumns, headerFingerprint } from "../../../domain/intake/mapping.js";
import {
  IntakeParseSchema,
  type IntakeLayout,
  type IntakeParse,
} from "../../../domain/intake/parse.js";
import {
  parseSpreadsheetGrid,
  readArtifactBytes,
  type SpreadsheetGridResult,
} from "./spreadsheet-grid.js";

/**
 * How many real values per column the mapping grid gets to show. Ref data-intake-and-edit-data §2.2
 * asks for "a few"; five is enough for the suggestion scorer's sample
 * agreement to mean something while staying a glance rather than a data dump.
 */
export const COLUMN_SAMPLE_LIMIT = 5;

/**
 * How many `(artifact, sheet)` grids stay retained. An operator maps one file
 * at a time and may switch between its worksheets; eight leaves room for that
 * without letting a long session hold every workbook it ever opened.
 */
export const RETAINED_GRID_LIMIT = 8;

const ALIASES = canonicalAliasIndex(Object.values(CANONICAL_FIELDS));

export interface IntakeParseKey {
  readonly artifact: ArtifactRef;
  /** Absent asks for the workbook's first worksheet. */
  readonly sheet?: string | undefined;
  /** Null (or absent) asks discovery to settle the header row. */
  readonly headerRowIndex?: number | null | undefined;
}

export interface PreparedIntakeParser extends IntakeParser {
  prepare(key: IntakeParseKey): Promise<IntakeParse>;
  parse(key: Readonly<{ artifact: ArtifactRef; sheet: string; headerRowIndex: number | null }>): IntakeParse;
}

function retainKey(sha256: string, sheet: string | undefined): string {
  return canonicalJsonStringify({ sha256, sheet: sheet ?? null });
}

function buildLayout(grid: readonly (readonly string[])[], headerRowIndex: number): IntakeLayout {
  const headers = [...grid[headerRowIndex]];
  // A wholly blank row is not a data row. Counting one would reject a person
  // who is not in the file, and source rows are header-relative anyway.
  const rows = grid.slice(headerRowIndex + 1)
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row) => [...row]);
  const samples: string[][] = [];
  for (let index = 0; index < headers.length; index += 1) {
    const column: string[] = [];
    for (const row of rows) {
      const cell = row[index] ?? "";
      if (cell.trim().length === 0) continue;
      column.push(cell);
      if (column.length === COLUMN_SAMPLE_LIMIT) break;
    }
    samples.push(column);
  }
  const columns = detectColumns(headers, samples);
  return { headerRowIndex, columns, headerFingerprint: headerFingerprint(columns), rows };
}

/** Pure: the same grid and header selection always yield the same parse. */
export function deriveIntakeParse(
  grid: SpreadsheetGridResult,
  headerRowIndex: number | null,
): IntakeParse {
  if (grid.state === "refused") {
    return IntakeParseSchema.parse({ state: "refused", code: grid.code, message: grid.message });
  }
  const discovery = rankHeaderRows(grid.grid, ALIASES);
  const settled = headerRowIndex ?? discovery.headerRowIndex;
  if (settled !== null && settled >= grid.grid.length) {
    return IntakeParseSchema.parse({
      state: "refused",
      code: "header-row-absent",
      message: `worksheet ${JSON.stringify(grid.sheet)} has ${String(grid.grid.length)} rows, `
        + `so row ${String(settled)} cannot be its header row`,
    });
  }
  return IntakeParseSchema.parse({
    state: "parsed",
    sheets: grid.sheets,
    sheet: grid.sheet,
    candidates: discovery.candidates.map((candidate) => ({
      rowIndex: candidate.rowIndex,
      cells: candidate.cells,
      confidence: candidate.confidence,
    })),
    discoveryReason: discovery.reason,
    layout: settled === null ? null : buildLayout(grid.grid, settled),
  });
}

export function createIntakeParser(options: Readonly<{
  artifacts: ContentAddressedArtifactWriter;
}>): PreparedIntakeParser {
  const retained = new Map<string, SpreadsheetGridResult>();

  const retain = (key: string, grid: SpreadsheetGridResult): void => {
    retained.set(key, grid);
    while (retained.size > RETAINED_GRID_LIMIT) {
      const oldest = retained.keys().next();
      if (oldest.done === true) break;
      retained.delete(oldest.value);
    }
  };

  return Object.freeze({
    async prepare(key: IntakeParseKey): Promise<IntakeParse> {
      const artifact = ArtifactRefSchema.parse(key.artifact);
      const sheet = key.sheet;
      const retainedKey = retainKey(artifact.sha256, sheet);
      const held = retained.get(retainedKey);
      if (held !== undefined) return deriveIntakeParse(held, key.headerRowIndex ?? null);
      const bytes = await readArtifactBytes(() => options.artifacts.open(artifact));
      const grid = await parseSpreadsheetGrid({
        bytes,
        artifactId: artifact.id,
        mediaType: artifact.mediaType,
        ...(sheet === undefined ? {} : { sheet }),
      });
      retain(retainedKey, grid);
      // A caller that asked for "the first worksheet" gets the same bytes back
      // under the sheet's REAL name too, so the kernel's later read of the
      // session's concrete selection does not re-open the artifact.
      if (grid.state === "parsed") retain(retainKey(artifact.sha256, grid.sheet), grid);
      return deriveIntakeParse(grid, key.headerRowIndex ?? null);
    },

    parse(key: Readonly<{ artifact: ArtifactRef; sheet: string; headerRowIndex: number | null }>): IntakeParse {
      const artifact = ArtifactRefSchema.parse(key.artifact);
      const sheet = z.string().min(1).parse(key.sheet);
      const held = retained.get(retainKey(artifact.sha256, sheet));
      if (held === undefined) {
        throw new Error(
          `no intake parse was prepared for artifact ${artifact.sha256} sheet ${JSON.stringify(sheet)}; `
          + "the caller must prepare the exact selection before the kernel reads it",
        );
      }
      return deriveIntakeParse(held, key.headerRowIndex);
    },
  });
}
