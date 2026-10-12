
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { EidSchema,ItemIdSchema } from "../../../src/rules/identity/ids.js";
import {
matchRosterSubjects,
ROSTER_ACCEPT_THRESHOLD,
RosterRowFactsSchema,
type RosterRowFacts,
} from "../../../src/rules/matching/roster-match.js";

const SUBJECT_ID = ItemIdSchema.parse("7c9e6679-7425-40de-944b-e07fc1f90ae7");

function row(sourceRow: number, eid: string | null, name: string | null): RosterRowFacts {
  return RosterRowFactsSchema.parse({
    sourceRow,
    eid: eid === null ? null : EidSchema.parse(eid),
    name,
  });
}

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
