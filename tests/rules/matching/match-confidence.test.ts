
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
formatMatchConfidencePercent,
matchConfidenceTier,
} from "../../../src/rules/matching/match-confidence.js";

describe("matchConfidenceTier — the verbatim live-verified bucketing", () => {
  it("starts high at exactly the 0.6 backend cutoff", () => {
    assert.equal(matchConfidenceTier(0.6), "high");
    assert.equal(matchConfidenceTier(0.59), "medium");
  });

  it("starts medium at exactly 0.4", () => {
    assert.equal(matchConfidenceTier(0.4), "medium");
    assert.equal(matchConfidenceTier(0.39), "low");
  });

  it("buckets a non-finite confidence low, never a crash and never high", () => {
    assert.equal(matchConfidenceTier(Number.NaN), "low");
    assert.equal(matchConfidenceTier(Number.POSITIVE_INFINITY), "low");
  });

  it("formats and clamps the percent rendering", () => {
    assert.equal(formatMatchConfidencePercent(0.4), "40%");
    assert.equal(formatMatchConfidencePercent(1.4), "100%");
    assert.equal(formatMatchConfidencePercent(Number.NaN), "0%");
  });
});
