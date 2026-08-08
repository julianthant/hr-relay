/**
 * Name-match scoring and name-similarity classification (doc 06 §4).
 *
 * Ported from the legacy repository (D93 — copy with provenance, never link):
 * `legacy:src/services/matching/match.ts` at commit `ab9ab5ab` — `tokenize`,
 * `scoreNameMatch` (the five-tier scorer) and `classifyNameSimilarity` (the
 * order-insensitive same/similar/different classifier), each byte-equivalent
 * in behaviour. Doc 06 §4 draws the line precisely: the confidence→tier
 * BUCKETING (`match-confidence.ts`) is live-verified and ports verbatim,
 * while the roster SCORING COMPOSITION built over these functions
 * (`roster-match.ts`) is REDESIGNED code that must be re-verified against
 * real rosters at the roster migration — these primitives carry legacy's
 * accumulated accuracy knowledge, and the composition around them does not
 * inherit that pedigree.
 *
 * NOT ported, deliberately: `matchAgainstRosterAsync`'s LLM disambiguation
 * arm (a provider concern; doc 06 §4's rebuilt contract has no LLM tier),
 * `correctNameSpelling` (a Kuali write-path concern), and the address
 * helpers (address matching is not part of `roster/match-spreadsheet`).
 */
import { z } from "zod";
import { levenshteinDistance } from "./levenshtein.js";

/** 0..1 confidence plus which tier produced it. */
export const NameMatchResultSchema = z.strictObject({
  score: z.number().min(0).max(1),
  reason: z.enum(["exact", "token-set", "fuzzy", "none"]),
});
export type NameMatchResult = z.infer<typeof NameMatchResultSchema>;

export function tokenizeName(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z\s]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

/**
 * Five-tier name match scoring (handwritten form names vs. roster
 * "Last, First" or "First Last" entries):
 *   - Exact (sorted tokens equal) → 1.0
 *   - Token-set near-subset on the smaller side (≥ 0.8) → 0.9
 *   - Levenshtein ≤ 2 on the full normalized name → 0.7
 *   - Otherwise → 0.0
 *
 * The token-set tier requires both sides to hold at least 2 distinct tokens:
 * without that guard, "John John" collapses to a 1-element set and would
 * match "John X" at ratio 1/1 = 1.0. Requiring a near-subset on the SMALLER
 * side keeps "John Michael Doe" vs "John Doe" strong while rejecting
 * "John Doee" vs "John Doe" (only 1/2 tokens match — that difference is a
 * Levenshtein-1 case the fuzzy tier catches).
 */
export function scoreNameMatch(a: string, b: string): NameMatchResult {
  const at = tokenizeName(a);
  const bt = tokenizeName(b);
  if (at.length === 0 || bt.length === 0) return { score: 0, reason: "none" };

  const aSorted = [...at].sort().join(" ");
  const bSorted = [...bt].sort().join(" ");
  if (aSorted === bSorted) return { score: 1.0, reason: "exact" };

  const aSet = new Set(at);
  const bSet = new Set(bt);
  const inter = [...aSet].filter((token) => bSet.has(token));
  if (aSet.size >= 2 && bSet.size >= 2 && inter.length / Math.min(aSet.size, bSet.size) >= 0.8) {
    return { score: 0.9, reason: "token-set" };
  }

  const d = levenshteinDistance(at.join(" "), bt.join(" "));
  if (d <= 2) return { score: 0.7, reason: "fuzzy" };

  return { score: 0, reason: "none" };
}

/** Max per-token Levenshtein distance still counted as a spelling variant. */
export const TOKEN_VARIANT_MAX = 2;

/**
 * Three-way name comparison for "same person?" decisions where one side may
 * be a misspelling of the other (e.g. a roster "Balmaceda, Jaden" vs the
 * subject's "Jayden Balmaceda"):
 *
 *   - `"same"`      — identical token multiset (order-insensitive), OR every
 *                     token of the shorter name is an EXACT token of the
 *                     longer (the longer side may carry extra middle names).
 *   - `"similar"`   — every token of the shorter name finds a partner within
 *                     `TOKEN_VARIANT_MAX` edits and at least one is a
 *                     non-exact variant → same person, spelling drift.
 *   - `"different"` — some token of the shorter name has NO partner within
 *                     `TOKEN_VARIANT_MAX` edits → different people (or one
 *                     side is empty).
 *
 * Unlike `scoreNameMatch`'s fuzzy tier (Levenshtein on the UNSORTED joined
 * tokens, which inflates the distance on a First-Last vs Last-First swap),
 * this aligns token-by-token, so name-order differences never masquerade as
 * a mismatch.
 */
export const NameSimilarityTierSchema = z.enum(["same", "similar", "different"]);
export type NameSimilarityTier = z.infer<typeof NameSimilarityTierSchema>;

export function classifyNameSimilarity(a: string, b: string): NameSimilarityTier {
  const at = tokenizeName(a);
  const bt = tokenizeName(b);
  if (at.length === 0 || bt.length === 0) return "different";

  if ([...at].sort().join(" ") === [...bt].sort().join(" ")) return "same";

  const [small, large] = at.length <= bt.length ? [at, bt] : [bt, at];
  let anyVariant = false;
  for (const token of small) {
    let best = Number.POSITIVE_INFINITY;
    for (const other of large) {
      best = Math.min(best, levenshteinDistance(token, other));
      if (best === 0) break;
    }
    if (best > TOKEN_VARIANT_MAX) return "different";
    if (best > 0) anyVariant = true;
  }
  return anyVariant ? "similar" : "same";
}
