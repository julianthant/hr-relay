// Refuse conflicting identity evidence; near misses require person lookup, never a fabricated EID.
import { z } from "zod";
import { EidSchema, ItemIdSchema, StableRecordIdSchema } from "../identity/ids.js";
import { MatchConfidenceTierSchema, matchConfidenceTier } from "./match-confidence.js";
import { classifyNameSimilarity, scoreNameMatch } from "./name-match.js";

/** The auto-accept floor for a name-only roster match — a ported fact, not a new choice. */
export const ROSTER_ACCEPT_THRESHOLD = 0.85;

/** Who a subject is to its caller: an intake row or an admitted OCR record; the matcher never interprets it and echoes it back verbatim. */
export const RosterSubjectIdSchema = z.union([ItemIdSchema, StableRecordIdSchema]);
export type RosterSubjectId = z.infer<typeof RosterSubjectIdSchema>;

export const RosterMatchSubjectSchema = z.strictObject({
  subjectId: RosterSubjectIdSchema,
  name: z.string().min(1).optional(),
  eid: EidSchema.optional(),
});
export type RosterMatchSubject = z.infer<typeof RosterMatchSubjectSchema>;

/** One roster data row after mapping + coercion; `eid`/`name` are `null` when the cell was empty or failed coercion, and the row stays but can never emit what it lacks. */
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
    // Name evidence must not overwrite a conflicting subject-supplied EID.
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
