/**
 * Confidence → tier bucketing for a roster/OCR match (doc 06 §4).
 *
 * Ported VERBATIM from the legacy repository (D93 — copy with provenance,
 * never link): `legacy:src/dashboard/components/ocr/shared/match-confidence.ts`
 * at commit `0fd181c2`. Doc 06 §4 calls this mapping out by name: the
 * thresholds are LIVE-VERIFIED and port as-is into this one domain module so
 * the roster task and the dashboard badge import the SAME numbers — no
 * re-implementation, no drift.
 *
 * `high` starts at the backend's own `LLM_HIGH_CONFIDENCE` cutoff (0.6) —
 * below that legacy never auto-resolved to `matched` and always attached a
 * review warning, so a confidence below 0.6 must never read as "high". `low`
 * further isolates near-coin-flip picks (<0.4) so those are visually distinct
 * from a borderline 0.4–0.6 pick. A non-finite confidence is `low`, never a
 * crash and never a hidden default.
 *
 * The legacy file's Tailwind badge classes did NOT port here: presentation
 * belongs to the dashboard (2i), and this module must stay pure domain.
 */
import { z } from "zod";

export const MatchConfidenceTierSchema = z.enum(["high", "medium", "low"]);
export type MatchConfidenceTier = z.infer<typeof MatchConfidenceTierSchema>;

const HIGH_CONFIDENCE_THRESHOLD = 0.6;
const LOW_CONFIDENCE_THRESHOLD = 0.4;

export function matchConfidenceTier(confidence: number): MatchConfidenceTier {
  if (!Number.isFinite(confidence)) return "low";
  if (confidence >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (confidence >= LOW_CONFIDENCE_THRESHOLD) return "medium";
  return "low";
}

/** Renders e.g. `0.4` -> `"40%"`. Clamps to [0, 1] before formatting so a
 * malformed value (out-of-range, never expected past the Zod schema) still
 * renders something sane instead of "-12%"/"140%". */
export function formatMatchConfidencePercent(confidence: number): string {
  const clamped = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
  return `${Math.round(clamped * 100)}%`;
}
