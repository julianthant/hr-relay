/** Header-row discovery: pure and deliberately alias-independent — generic structure only, with known aliases a bounded bonus rather than a precondition. */
import { z } from "zod";
import { normalizeHeader } from "../../models/fields/registry.js";

/** One ranked candidate; the served projection is imported from here rather than restated, so the served shape cannot drift from the computed one. */
export const HeaderCandidateSchema = z.strictObject({
  /** 0-based index into the rows given to `rankHeaderRows`. */
  rowIndex: z.number().int().nonnegative(),
  cells: z.array(z.string()),
  /** 0–1. A rank, not a probability. */
  confidence: z.number().min(0).max(1),
  /** The measurements behind the rank, so a surprising ranking is explainable. */
  signals: z.strictObject({
    density: z.number().min(0).max(1),
    textShaped: z.number().min(0).max(1),
    distinct: z.number().min(0).max(1),
    widthMatch: z.number().min(0).max(1),
    /** Fraction of this row's values that appear in NO other row of the sheet. */
    soleUse: z.number().min(0).max(1),
    aliasHits: z.number().int().nonnegative(),
  }),
});
export type HeaderCandidate = z.infer<typeof HeaderCandidateSchema>;

/** The projection a caller serves: the rank without its working. */
export const ServedHeaderCandidateSchema = HeaderCandidateSchema.omit({ signals: true });

export const HeaderDiscoverySchema = z.strictObject({
  /** Non-null only when one candidate is both confident and clearly ahead. */
  headerRowIndex: z.number().int().nonnegative().nullable(),
  /** Ranked best-first. Empty only when the sheet has no non-empty row. */
  candidates: z.array(HeaderCandidateSchema),
  /** Why nothing preselected, for the UI to say out loud. */
  reason: z.enum(["preselected", "no-confident-candidate", "ambiguous-candidates", "no-rows"]),
});
export type HeaderDiscovery = z.infer<typeof HeaderDiscoverySchema>;


export const HEADER_SCAN_DEPTH = 20;
/** A candidate must reach this to preselect. */
export const HEADER_PRESELECT_FLOOR = 0.7;
/** …and must beat the runner-up by this, or the two are indistinguishable. */
export const HEADER_PRESELECT_MARGIN = 0.1;

function isBlank(cell: string): boolean {
  return cell.trim().length === 0;
}

/** A cell that reads as DATA rather than as a label; dates count in both the ISO and the `MM/DD/YYYY` wire form, and a header cell is essentially never a date. */
function looksLikeData(cell: string): boolean {
  const trimmed = cell.trim();
  if (trimmed.length === 0) return false;
  return /^[-+]?\$?\d[\d,]*(?:\.\d+)?%?$/.test(trimmed)
    || /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed);
}

function modalWidth(rows: readonly (readonly string[])[]): number {
  const counts = new Map<number, number>();
  for (const row of rows) {
    const width = row.filter((cell) => !isBlank(cell)).length;
    if (width === 0) continue;
    counts.set(width, (counts.get(width) ?? 0) + 1);
  }
  let best = 0;
  let bestCount = 0;
  for (const [width, count] of counts) {
    if (count > bestCount || (count === bestCount && width > best)) {
      best = width;
      bestCount = count;
    }
  }
  return best;
}

/** How many ROWS contain each normalized non-blank value. */
function rowsContainingValue(rows: readonly (readonly string[])[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const seen = new Set<string>();
    for (const cell of row) {
      const key = normalizeHeader(cell);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

/** Rank the leading rows of one sheet as header candidates; passing an empty alias set must still produce candidates. */
export function rankHeaderRows(
  rows: readonly (readonly string[])[],
  knownAliases: ReadonlySet<string>,
): HeaderDiscovery {
  const nonEmptyRows = rows.filter((row) => row.some((cell) => !isBlank(cell)));
  if (nonEmptyRows.length === 0) return { headerRowIndex: null, candidates: [], reason: "no-rows" };

  const candidates: HeaderCandidate[] = [];
  const depth = Math.min(HEADER_SCAN_DEPTH, rows.length);
  const rowsWithValue = rowsContainingValue(rows);

  for (let rowIndex = 0; rowIndex < depth; rowIndex += 1) {
    const cells = rows[rowIndex];
    const filled = cells.filter((cell) => !isBlank(cell));
    // A row with nothing in it, or with data but nothing beneath it, cannot be
    // a header: a header row exists to name the rows below it.
    const below = rows.slice(rowIndex + 1);
    const dataBelow = below.filter((row) => row.some((cell) => !isBlank(cell)));
    if (filled.length === 0 || dataBelow.length === 0) continue;

    const width = Math.max(cells.length, 1);
    const density = filled.length / width;
    const textShaped = filled.filter((cell) => !looksLikeData(cell)).length / filled.length;
    const distinct = new Set(filled.map((cell) => normalizeHeader(cell))).size / filled.length;
    // Extra header columns may be empty; fewer columns can indicate a merged title row.
    const beneathWidth = modalWidth(dataBelow);
    const widthMatch = beneathWidth === 0
      ? 0
      : filled.length >= beneathWidth
        ? 1
        : filled.length / beneathWidth;
    // Excluding this row: a value seen in exactly one row, and that row is this
    // one, appears in no OTHER row.
    const soleUse = filled.filter((cell) => rowsWithValue.get(normalizeHeader(cell)) === 1).length
      / filled.length;
    const aliasHits = knownAliases.size === 0
      ? 0
      : filled.filter((cell) => knownAliases.has(normalizeHeader(cell))).length;

    // Structure carries the whole decision; aliases add at most 0.15 on top and
    // are capped so a file with zero known headings still competes.
    const structural = density * 0.15 + textShaped * 0.2 + distinct * 0.15
      + widthMatch * 0.2 + soleUse * 0.3;
    const aliasBonus = Math.min(0.15, (aliasHits / filled.length) * 0.15);
    candidates.push({
      rowIndex,
      cells: [...cells],
      confidence: Math.min(1, Math.round((structural * 0.85 + aliasBonus) * 1000) / 1000),
      signals: { density, textShaped, distinct, widthMatch, soleUse, aliasHits },
    });
  }

  if (candidates.length === 0) return { headerRowIndex: null, candidates: [], reason: "no-rows" };

  candidates.sort((left, right) =>
    right.confidence - left.confidence || left.rowIndex - right.rowIndex);
  const [best, runnerUp] = candidates;
  if (best.confidence < HEADER_PRESELECT_FLOOR) {
    return { headerRowIndex: null, candidates, reason: "no-confident-candidate" };
  }
  if (runnerUp !== undefined && best.confidence - runnerUp.confidence < HEADER_PRESELECT_MARGIN) {
    return { headerRowIndex: null, candidates, reason: "ambiguous-candidates" };
  }
  return { headerRowIndex: best.rowIndex, candidates, reason: "preselected" };
}

/** Every canonical alias, normalized — the bonus term's input. */
export function canonicalAliasIndex(
  fields: readonly { readonly aliases: readonly string[]; readonly label: string }[],
): ReadonlySet<string> {
  const index = new Set<string>();
  for (const field of fields) {
    index.add(normalizeHeader(field.label));
    for (const alias of field.aliases) index.add(normalizeHeader(alias));
  }
  return index;
}
