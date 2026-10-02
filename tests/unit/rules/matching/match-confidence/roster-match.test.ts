/**
 * Ref data-intake-and-edit-data §4's matching stack, pinned in three layers:
 *
 * 1. The VERBATIM ports carry legacy's live-verified numbers — the five-tier
 *    name scorer and the confidence→tier bucketing. These cases mirror the
 *    legacy suites (`match.test.ts`, `match-confidence.test.ts`) so a drift
 *    from the ported behaviour fails by name.
 * 2. The order-insensitive same/similar/different classifier, including the
 *    real Jaden/Jayden spelling-drift case legacy fixed live.
 * 3. The REDESIGNED composition (`matchRosterSubjects`) — every verdict arm,
 *    because this half does NOT inherit legacy's pedigree and must stand on
 *    its own pins until the roster migration re-verifies it on real rosters.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  formatMatchConfidencePercent,
  matchConfidenceTier,
} from "../../../../../src/rules/matching/match-confidence.js";
import {
  classifyNameSimilarity,
  scoreNameMatch,
} from "../../../../../src/rules/matching/name-match.js";
import {
  matchRosterSubjects,
  ROSTER_ACCEPT_THRESHOLD,
  RosterRowFactsSchema,
  type RosterRowFacts,
} from "../../../../../src/rules/matching/roster-match.js";
import { EidSchema, ItemIdSchema } from "../../../../../src/rules/identity/ids.js";

const SUBJECT_ID = ItemIdSchema.parse("7c9e6679-7425-40de-944b-e07fc1f90ae7");

function row(sourceRow: number, eid: string | null, name: string | null): RosterRowFacts {
  return RosterRowFactsSchema.parse({
    sourceRow,
    eid: eid === null ? null : EidSchema.parse(eid),
    name,
  });
}

describe("scoreNameMatch — the ported five-tier scorer", () => {
  it("scores identical token sets 1.0 regardless of order and punctuation", () => {
    assert.deepEqual(scoreNameMatch("Blirea, Glaundi", "Glaundi Blirea"), { score: 1.0, reason: "exact" });
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
    assert.deepEqual(scoreNameMatch("Zebulon Highwater", "Glaundi Blirea"), { score: 0, reason: "none" });
  });

  it("scores an empty side 0", () => {
    assert.deepEqual(scoreNameMatch("", "Glaundi Blirea"), { score: 0, reason: "none" });
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
    assert.equal(classifyNameSimilarity("", "Glaundi Blirea"), "different");
  });
});

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

describe("matchRosterSubjects — the redesigned composition, every arm", () => {
  const roster = [
    row(2, "10456712", "Battistessa, Johnnie"),
    row(3, "10998801", "Blirea, Glaundi"),
    row(4, "10777771", "Doe, John"),
    row(5, "10777772", "Doe, John"),
    row(6, null, "Rowless, Norman"),
    row(7, "10555555", null),
  ];

  it("pins the ported 0.85 auto-accept floor", () => {
    assert.equal(ROSTER_ACCEPT_THRESHOLD, 0.85);
  });

  it("matches a bare EID at 1.0 when the roster contains it", () => {
    const [match] = matchRosterSubjects([{ subjectId: SUBJECT_ID, eid: EidSchema.parse("10555555") }], roster);
    assert.deepEqual(match, {
      subjectId: SUBJECT_ID,
      matchedEid: "10555555",
      matchConfidence: 1,
      tier: "high",
      mismatch: "none",
    });
  });

  it("matches an EID with a same-person spelling drift at 0.9", () => {
    const [match] = matchRosterSubjects(
      [{ subjectId: SUBJECT_ID, eid: EidSchema.parse("10456712"), name: "Jonnie Battistessa" }],
      roster,
    );
    assert.ok(match !== undefined);
    assert.equal(match.matchedEid, "10456712");
    assert.equal(match.matchConfidence, 0.9);
    assert.equal(match.mismatch, "none");
  });

  it("refuses a found EID whose roster name is a different person — confidence 0, no partial trust", () => {
    const [match] = matchRosterSubjects(
      [{ subjectId: SUBJECT_ID, eid: EidSchema.parse("10456712"), name: "Rick Roe" }],
      roster,
    );
    assert.deepEqual(match, {
      subjectId: SUBJECT_ID,
      matchedEid: null,
      matchConfidence: 0,
      tier: "low",
      mismatch: "name-eid-conflict",
    });
  });

  it("matches by name alone at the exact tier", () => {
    const [match] = matchRosterSubjects([{ subjectId: SUBJECT_ID, name: "Glaundi Blirea" }], roster);
    assert.ok(match !== undefined);
    assert.equal(match.matchedEid, "10998801");
    assert.equal(match.matchConfidence, 1);
    assert.equal(match.mismatch, "none");
  });

  it("refuses a top-score tie between two distinct EIDs as ambiguous", () => {
    const [match] = matchRosterSubjects([{ subjectId: SUBJECT_ID, name: "John Doe" }], roster);
    assert.ok(match !== undefined);
    assert.equal(match.matchedEid, null);
    assert.equal(match.mismatch, "ambiguous");
    assert.equal(match.matchConfidence, 1);
  });

  it("reports a sub-threshold best score honestly as no-match with the near-miss number", () => {
    // "nguyen thhi" vs "blirea glaundi" is Levenshtein 1 on the joined tokens —
    // the 0.7 fuzzy tier — and 0.7 sits below the 0.85 accept floor.
    const [match] = matchRosterSubjects([{ subjectId: SUBJECT_ID, name: "Nguyen, Thhi" }], roster);
    assert.ok(match !== undefined);
    assert.equal(match.matchedEid, null);
    assert.equal(match.mismatch, "no-match");
    assert.equal(match.matchConfidence, 0.7);
    assert.equal(match.tier, "high");
  });

  it("never overrides a claimed EID with a name-matched different one — that is a conflict", () => {
    const [match] = matchRosterSubjects(
      [{ subjectId: SUBJECT_ID, eid: EidSchema.parse("10999999"), name: "Glaundi Blirea" }],
      roster,
    );
    assert.deepEqual(match, {
      subjectId: SUBJECT_ID,
      matchedEid: null,
      matchConfidence: 0,
      tier: "low",
      mismatch: "name-eid-conflict",
    });
  });

  it("cannot emit an EID from a row whose EID cell was unusable", () => {
    const [match] = matchRosterSubjects([{ subjectId: SUBJECT_ID, name: "Norman Rowless" }], roster);
    assert.ok(match !== undefined);
    assert.equal(match.matchedEid, null);
    assert.equal(match.mismatch, "no-match");
  });

  it("answers no-match at 0 for a subject with nothing to match on", () => {
    const [match] = matchRosterSubjects([{ subjectId: SUBJECT_ID }], roster);
    assert.deepEqual(match, {
      subjectId: SUBJECT_ID,
      matchedEid: null,
      matchConfidence: 0,
      tier: "low",
      mismatch: "no-match",
    });
  });
});
