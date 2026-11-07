// Parse asynchronously before the synchronous authority transaction; the kernel consumes only the prepared result.
import { z } from "zod";
import type { ContentAddressedArtifactWriter } from "../../../workflow-kit/artifacts.js";
import type { IntakeParser } from "../../../workflow-kit/intake-parser.js";
import { ArtifactRefSchema, type ArtifactRef } from "../../../models/artifacts/artifacts.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { CANONICAL_FIELDS } from "../../../models/fields/registry.js";
import { canonicalAliasIndex, rankHeaderRows } from "../../../rules/intake/header-discovery.js";
import { detectColumns, headerFingerprint } from "../../../models/intake/mapping.js";
import {
  IntakeParseSchema,
  type IntakeLayout,
  type IntakeParse,
} from "../../../models/intake/parse.js";
import {
  parseSpreadsheetGrid,
  readArtifactBytes,
  type SpreadsheetGridResult,
} from "./spreadsheet-grid.js";


export const COLUMN_SAMPLE_LIMIT = 5;


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
