/** Confidence → tier bucketing for a roster/OCR match: the thresholds are live-verified and live in this one domain module so the roster task and the dashboard badge import the SAME numbers. */
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

/** Renders e.g. `0.4` -> `"40%"`, clamped to [0, 1] so an out-of-range value still renders something sane. */
export function formatMatchConfidencePercent(confidence: number): string {
  const clamped = Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0;
  return `${Math.round(clamped * 100)}%`;
}
