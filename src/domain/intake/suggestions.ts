/**
 * The header-suggestion scorer — ref data-intake-and-edit-data §2.5, the redesigned successor to
 * legacy's `COLUMN_PATTERNS` regex table.
 *
 * It **proposes**. It cannot bind. That is structural rather than
 * conventional: a `ColumnBinding` requires `confirmedAt`, and a `Suggestion`
 * has no such field and no way to acquire one — only `confirmBinding` in
 * `mapping.ts`, called from an operator action, mints one. So there is no code
 * path from this module to a populated `bindings` array, which is what ref data-intake-and-edit-data
 * §7 vector #1 asks for.
 *
 * The reason this matters more than it looks: legacy's regexes silently decided
 * what a column meant, and a confident-but-wrong guess ("Name" → `fullName`
 * when the file's real name lives in "Legal Name") produces a run against the
 * wrong person. Suggestions make the same knowledge available while keeping the
 * decision where it belongs.
 *
 * ## Sample values are evidence, and disagreement is the strongest signal
 *
 * Header text alone is weak — "Dept" could be `deptId` or `department`. So each
 * candidate is also tried against the column's real sample values through the
 * canonical field's own `coerce` + `schema`. A column whose samples all parse
 * is corroborated; a column where none do is suppressed to zero no matter how
 * well its header scored, because a header that matches while the data cannot
 * is the mis-map ref data-intake-and-edit-data §2.4 wants surfaced.
 *
 * A `CellCoercionError` here is an expected outcome, not a failure: it is the
 * measurement. Anything else propagates.
 */
import { z } from "zod";
import {
  IntakeTargetFieldIdSchema,
  SourceColumnIdSchema,
  WorkflowIdSchema,
  type IntakeTargetFieldId,
} from "../ids.js";
import { CANONICAL_FIELDS, normalizeHeader } from "../fields/registry.js";
import { isCellCoercionError, type CellLocation } from "../fields/cell-coercion.js";
import type { DetectedColumn } from "./mapping.js";
import type { IntakeProjection } from "./projection.js";

export const SuggestionSchema = z.strictObject({
  targetFieldId: IntakeTargetFieldIdSchema,
  sourceColumnId: SourceColumnIdSchema,
  /** 0–1. Not a probability — a rank, and only ever a rank. */
  score: z.number().min(0).max(1),
  /** What produced the score, so the grid can say WHY a column is proposed. */
  why: z.array(z.enum(["alias-exact", "label-exact", "token-overlap", "samples-parse"])).min(1),
  /**
   * True when a second candidate scores within `AMBIGUITY_EPSILON`. The grid
   * must NOT pre-highlight an ambiguous suggestion: picking one of two
   * indistinguishable columns for the operator is the silent guess in
   * miniature.
   */
  ambiguous: z.boolean(),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

/** Below this a proposal is noise and is not shown at all. */
const SUGGESTION_FLOOR = 0.35;
/** Two candidates this close are indistinguishable to the scorer. */
const AMBIGUITY_EPSILON = 0.05;

function tokens(value: string): Set<string> {
  return new Set(normalizeHeader(value).split(/[^a-z0-9]+/).filter(Boolean));
}

function tokenOverlap(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / new Set([...a, ...b]).size;
}

/**
 * What fraction of a column's non-blank samples survive this field's own
 * coercion and schema. `null` when the column offers no samples to judge with —
 * absent evidence, which must not read as evidence of absence.
 */
function sampleAgreement(
  canonicalFieldId: keyof typeof CANONICAL_FIELDS,
  column: DetectedColumn,
  location: CellLocation,
): number | null {
  const field = CANONICAL_FIELDS[canonicalFieldId];
  const candidates = column.samples.filter((sample) => sample.trim().length > 0);
  if (candidates.length === 0) return null;
  let parsed = 0;
  for (const sample of candidates) {
    try {
      field.schema.parse(field.coerce(sample, location));
      parsed += 1;
    } catch (error) {
      // A refused cell is the measurement. Anything else is a real fault and
      // must not be counted as "this column does not look like this field".
      if (!isCellCoercionError(error) && !(error instanceof z.ZodError)) throw error;
    }
  }
  return parsed / candidates.length;
}

function headerScore(canonicalFieldId: keyof typeof CANONICAL_FIELDS, column: DetectedColumn): {
  score: number;
  why: Suggestion["why"][number][];
} {
  const field = CANONICAL_FIELDS[canonicalFieldId];
  const normalized = column.normalizedHeader;
  if (field.aliases.some((alias) => normalizeHeader(alias) === normalized)) {
    return { score: 1, why: ["alias-exact"] };
  }
  if (normalizeHeader(field.label) === normalized) return { score: 0.95, why: ["label-exact"] };
  const best = Math.max(
    tokenOverlap(field.label, column.header),
    ...field.aliases.map((alias) => tokenOverlap(alias, column.header)),
  );
  return best > 0 ? { score: best * 0.8, why: ["token-overlap"] } : { score: 0, why: [] };
}

/**
 * Rank each detected column against each declared target field.
 *
 * The result is ordered by target then descending score, and carries every
 * candidate above the floor rather than one winner per target — the operator
 * chooses from a list, and a list of two is how ambiguity is communicated.
 */
export function suggestBindings(args: {
  workflow: string;
  detected: readonly DetectedColumn[];
  projection: IntakeProjection;
  /** The observation instant; resolves a two-digit year in a sample value. */
  readAt: string;
}): Suggestion[] {
  const workflow = WorkflowIdSchema.parse(args.workflow);
  const out: Suggestion[] = [];

  for (const target of args.projection.targets) {
    const scored: { column: DetectedColumn; score: number; why: Suggestion["why"][number][] }[] = [];
    for (const column of args.detected) {
      const canonicalFieldId = target.canonicalFieldId;
      const header = headerScore(canonicalFieldId, column);
      const agreement = sampleAgreement(canonicalFieldId, column, {
        workflow,
        readAt: args.readAt,
        sourceRow: 1,
        header: column.header,
        targetFieldId: target.targetFieldId,
      });
      if (header.score === 0 && (agreement === null || agreement === 0)) continue;
      // A header that matches while NONE of the data parses is a mis-map, not
      // a weak match — it scores zero rather than being merely discounted.
      const score = agreement === null
        ? header.score * 0.9
        : agreement === 0
          ? 0
          : header.score * 0.7 + agreement * 0.3;
      const why = agreement !== null && agreement > 0 ? [...header.why, "samples-parse" as const] : header.why;
      if (score >= SUGGESTION_FLOOR && why.length > 0) scored.push({ column, score, why });
    }

    scored.sort((left, right) => right.score - left.score);
    const runnerUp = scored[1]?.score ?? 0;
    for (const [index, entry] of scored.entries()) {
      out.push(SuggestionSchema.parse({
        targetFieldId: target.targetFieldId,
        sourceColumnId: entry.column.sourceColumnId,
        score: Math.min(1, Math.round(entry.score * 1000) / 1000),
        why: entry.why,
        ambiguous: index === 0 ? scored.length > 1 && entry.score - runnerUp <= AMBIGUITY_EPSILON : true,
      }));
    }
  }
  return out;
}

/** The top proposal per target, excluding ambiguous ones (which must not preselect). */
export function unambiguousTopSuggestions(
  suggestions: readonly Suggestion[],
): ReadonlyMap<IntakeTargetFieldId, Suggestion> {
  const best = new Map<IntakeTargetFieldId, Suggestion>();
  for (const suggestion of suggestions) {
    if (suggestion.ambiguous) continue;
    const held = best.get(suggestion.targetFieldId);
    if (held === undefined || suggestion.score > held.score) best.set(suggestion.targetFieldId, suggestion);
  }
  return best;
}

export const SUGGESTION_THRESHOLDS = Object.freeze({
  floor: SUGGESTION_FLOOR,
  ambiguityEpsilon: AMBIGUITY_EPSILON,
});
