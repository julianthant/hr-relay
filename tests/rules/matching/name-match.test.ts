
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
classifyNameSimilarity,
scoreNameMatch,
} from "../../../src/rules/matching/name-match.js";

describe("scoreNameMatch — the ported five-tier scorer", () => {
  it("scores identical token sets 1.0 regardless of order and punctuation", () => {
    assert.deepEqual(scoreNameMatch("Morrow, Bea", "Bea Morrow"), { score: 1.0, reason: "exact" });
  });

  it("scores an extra middle name as a 0.9 token-set match", () => {
    assert.deepEqual(scoreNameMatch("John Michael Doe", "John Doe"), { score: 0.9, reason: "token-set" });
  });

  it("keeps the 2-distinct-token guard: 'John John' must not token-set match 'John X'", () => {
    const result = scoreNameMatch("John John", "John Xavier");
    assert.notEqual(result.reason, "token-set");
  });

  it("scores a small typo 0.7 through the fuzzy tier", () => {
    assert.deepEqual(scoreNameMatch("John Doee", "John Doe"), { score: 0.7, reason: "fuzzy" });
  });

  it("scores unrelated names 0", () => {
    assert.deepEqual(scoreNameMatch("Zebulon Highwater", "Bea Morrow"), { score: 0, reason: "none" });
  });

  it("scores an empty side 0", () => {
    assert.deepEqual(scoreNameMatch("", "Bea Morrow"), { score: 0, reason: "none" });
  });
});

describe("classifyNameSimilarity — the ported same/similar/different classifier", () => {
  it("calls a token-order swap the same person", () => {
    assert.equal(classifyNameSimilarity("Balmaceda, Jaden", "Jaden Balmaceda"), "same");
  });

  it("tolerates an extra middle name on the longer side as same", () => {
    assert.equal(classifyNameSimilarity("John Doe", "John Michael Doe"), "same");
  });

  it("calls the live Jaden/Jayden spelling drift similar, not different", () => {
    assert.equal(classifyNameSimilarity("Balmaceda, Jaden", "Jayden Balmaceda"), "similar");
  });

  it("calls a token with no within-2-edit partner different", () => {
    assert.equal(classifyNameSimilarity("Rick Roe", "Johnnie Battistessa"), "different");
  });

  it("calls an empty side different", () => {
    assert.equal(classifyNameSimilarity("", "Bea Morrow"), "different");
  });
});
