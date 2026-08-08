/**
 * The roster match composition — doc 06 §4's scoring, REDESIGNED.
 *
 * Doc 06 §4 splits the port precisely: the confidence→tier mapping and the
 * name primitives carry legacy's live-verified knowledge (`match-confidence.ts`,
 * `name-match.ts`, each with provenance), while THIS composition — how EID
 * and name evidence combine into one per-subject verdict — is NEW code,
 * flagged as redesigned and re-verified against real rosters at the roster
 * migration (doc 06 §7's honest residual). It is pure: no I/O, no clock, so
 * the store task stays a thin edge and every arm pins in a unit test.
 *
 * The verdict rules, in order:
 *
 * 1. Subject carries an EID found in the roster → the EID is the key.
 *    - no subject name → matched on the EID alone (1.0; a roster EID is a
 *      unique key, and there is no name to disagree with);
 *    - names `same` → 1.0, `similar` → 0.9 (legacy's spelling-drift rule:
 *      same person, fix the spelling downstream);
 *    - every row with that EID reads `different` → `name-eid-conflict`,
 *      `matchedEid: null`, confidence 0. A conflicted identity is REFUSED,
 *      never scored partially — a number implying partial trust on a
 *      conflicting EID is how a wrong person gets paid.
 * 2. Otherwise the subject's name scores against every roster row that has a
 *    usable EID (`scoreNameMatch`, legacy's five tiers):
 *    - best < 0.85 (legacy's auto-accept floor) → `no-match`,
 *      `matchedEid: null`, confidence = best score — the near-miss number is
 *      honest evidence for the operator, and the caller falls through to
 *      person-lookup, NEVER a fabricated EID;
 *    - best ≥ 0.85 with MORE THAN ONE distinct EID tied at the top →
 *      `ambiguous`, `matchedEid: null` — a tie between people is an operator
 *      decision, not a coin flip;
 *    - best ≥ 0.85, one EID → matched. If the subject ALSO claimed an EID
 *      (one the roster does not contain), a name-matched DIFFERENT EID is a
 *      `name-eid-conflict`, not a silent override of what the subject wrote.
 * 3. A subject with neither name nor EID cannot be matched (the contract
 *    refuses it at parse; this module still answers `no-match` at 0 so the
 *    function is total).
 */
import { z } from "zod";
import { EidSchema, ItemIdSchema, StableRecordIdSchema } from "../ids.js";
import { MatchConfidenceTierSchema, matchConfidenceTier } from "./match-confidence.js";
import { classifyNameSimilarity, scoreNameMatch } from "./name-match.js";

/**
 * Legacy's auto-accept floor for a name-only roster match — ported fact, not
 * a new choice: `legacy:src/services/matching/match.ts` at `ab9ab5ab`
 * ("Auto-accept threshold for roster matching is 0.85").
 */
export const ROSTER_ACCEPT_THRESHOLD = 0.85;

/**
 * Who a subject is to its caller: an intake row (`ItemId`) or an admitted
 * OCR record (`StableRecordId`). Doc 06 §4's sketch named a `StableItemId`
 * that was never built; the union of the two REAL identities is the as-built
 * resolution (doc 06 §4, D163). The matcher never interprets it — it is
 * echoed back verbatim so the caller can correlate.
 */
export const RosterSubjectIdSchema = z.union([ItemIdSchema, StableRecordIdSchema]);
export type RosterSubjectId = z.infer<typeof RosterSubjectIdSchema>;

export const RosterMatchSubjectSchema = z.strictObject({
  subjectId: RosterSubjectIdSchema,
  name: z.string().min(1).optional(),
  eid: EidSchema.optional(),
});
export type RosterMatchSubject = z.infer<typeof RosterMatchSubjectSchema>;

/**
 * One roster data row after mapping + coercion. `eid`/`name` are `null` when
 * the cell was empty or failed its canonical coercion — the row stays in the
 * set (its OTHER field may still match) but can never emit what it lacks.
 */
export const RosterRowFactsSchema = z.strictObject({
  /** 1-based row number in the SOURCE file, for operator-legible diagnostics. */
  sourceRow: z.number().int().positive(),
  eid: EidSchema.nullable(),
  name: z.string().nullable(),
});
export type RosterRowFacts = z.infer<typeof RosterRowFactsSchema>;

export const RosterMismatchSchema = z.enum(["none", "name-eid-conflict", "no-match", "ambiguous"]);
export type RosterMismatch = z.infer<typeof RosterMismatchSchema>;

export const RosterSubjectMatchSchema = z.strictObject({
  subjectId: RosterSubjectIdSchema,
  matchedEid: EidSchema.nullable(),
  matchConfidence: z.number().min(0).max(1),
  tier: MatchConfidenceTierSchema,
  mismatch: RosterMismatchSchema,
});
export type RosterSubjectMatch = z.infer<typeof RosterSubjectMatchSchema>;

function verdict(
  subjectId: RosterSubjectId,
  matchedEid: z.infer<typeof EidSchema> | null,
  matchConfidence: number,
  mismatch: RosterMismatch,
): RosterSubjectMatch {
  return RosterSubjectMatchSchema.parse({
    subjectId,
    matchedEid,
    matchConfidence,
    tier: matchConfidenceTier(matchConfidence),
    mismatch,
  });
}

function matchOneSubject(
  subject: RosterMatchSubject,
  roster: readonly RosterRowFacts[],
): RosterSubjectMatch {
  // Rule 1 — the subject's own EID, when the roster contains it, is the key.
  if (subject.eid !== undefined) {
    const eidRows = roster.filter((row) => row.eid === subject.eid);
    if (eidRows.length > 0) {
      if (subject.name === undefined) return verdict(subject.subjectId, subject.eid, 1.0, "none");
      let best: "same" | "similar" | "different" = "different";
      for (const row of eidRows) {
        if (row.name === null) continue;
        const tier = classifyNameSimilarity(subject.name, row.name);
        if (tier === "same") { best = "same"; break; }
        if (tier === "similar") best = "similar";
      }
      if (best === "same") return verdict(subject.subjectId, subject.eid, 1.0, "none");
      if (best === "similar") return verdict(subject.subjectId, subject.eid, 0.9, "none");
      return verdict(subject.subjectId, null, 0, "name-eid-conflict");
    }
  }

  // Rule 2 — name evidence against every row that could actually emit an EID.
  if (subject.name === undefined) return verdict(subject.subjectId, null, 0, "no-match");
  const subjectName = subject.name;
  const scored = roster
    .filter((row): row is RosterRowFacts & { eid: z.infer<typeof EidSchema>; name: string } =>
      row.eid !== null && row.name !== null)
    .map((row) => ({ row, score: scoreNameMatch(subjectName, row.name).score }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (top === undefined || top.score < ROSTER_ACCEPT_THRESHOLD) {
    return verdict(subject.subjectId, null, top?.score ?? 0, "no-match");
  }

  const tiedEids = new Set(
    scored.filter((entry) => entry.score === top.score).map((entry) => entry.row.eid),
  );
  if (tiedEids.size > 1) return verdict(subject.subjectId, null, top.score, "ambiguous");

  if (subject.eid !== undefined && top.row.eid !== subject.eid) {
    // The subject CLAIMED an EID the roster lacks, and the name points at a
    // different one. Silently overriding what the subject wrote is exactly
    // the wrong-person failure this program exists to prevent.
    return verdict(subject.subjectId, null, 0, "name-eid-conflict");
  }

  return verdict(subject.subjectId, top.row.eid, top.score, "none");
}

/** Match every subject independently; order follows the input. */
export function matchRosterSubjects(
  subjects: readonly RosterMatchSubject[],
  roster: readonly RosterRowFacts[],
): readonly RosterSubjectMatch[] {
  return subjects.map((subject) => matchOneSubject(subject, roster));
}
