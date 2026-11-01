
import { z } from "zod";
import { levenshteinDistance } from "./levenshtein.js";

/** 0..1 confidence plus which tier produced it. */
export const NameMatchResultSchema = z.strictObject({
  score: z.number().min(0).max(1),
  reason: z.enum(["exact", "token-set", "fuzzy", "none"]),
});
export type NameMatchResult = z.infer<typeof NameMatchResultSchema>;

function tokenizeName(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z\s]/gu, " ")
    .split(/\s+/u)
    .filter(Boolean);
}

// Two distinct tokens per name prevent spurious token-set matches.
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
const TOKEN_VARIANT_MAX = 2;

/** Three-way name comparison aligned token-by-token, so name-order differences never masquerade as a mismatch. */
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
