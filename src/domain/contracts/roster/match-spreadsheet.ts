/**
 * `roster/match-spreadsheet` — doc 06 §4's roster match contract.
 *
 * One dataset matched against another: the caller's subjects (intake rows or
 * admitted OCR records) against an operator-mapped roster spreadsheet,
 * producing one per-subject verdict with confidence, tier, and a FIRST-CLASS
 * mismatch field. A match the roster cannot make is `matchedEid: null` +
 * `mismatch: "no-match"` — the caller then falls through to person-lookup,
 * never a fabricated EID (doc 06 §7 vector #7).
 *
 * As-built deviations from doc 06 §4's sketch, recorded under D163:
 * - `subjectId` is the union of the two REAL caller identities (`ItemId` |
 *   `StableRecordId`) — the sketch's `StableItemIdSchema` was never built;
 * - the output is wrapped (`{ matches: [...] }`) so the one array leaf has a
 *   named field path for provenance and the shape can grow without a
 *   breaking re-parse;
 * - `readAt` joins the input (the canonical cell coercers demand the
 *   observation instant so a replayed match coerces exactly as the original
 *   did — the same rule intake validation follows), and `sheet` joins it for
 *   multi-worksheet roster files (same semantics as `extraction/
 *   extract-spreadsheet`);
 * - `mapping-mismatch` and `no-eid-column` join the error codes: a mapping
 *   that does not fit these exact bytes, and a mapping with no EID binding,
 *   are distinct refusals worth naming — shoehorning either into
 *   `roster-unreadable` would hide what the operator must fix.
 *
 * Freshness is a FINITE 24h (doc 06 §4, resolved 2026-07-22): a roster match
 * may feed a WRITE (an OnBase upload keyed on the matched EID), and a stale
 * match must not silently ride into that write on resume. A consuming
 * workflow may narrow it, never widen it without a reviewed policy change.
 */
import { z } from "zod";
import { ArtifactRefSchema } from "../../artifacts.js";
import { CANONICAL_FIELDS } from "../../fields/registry.js";
import { IsoInstantSchema, taskId } from "../../ids.js";
import { ColumnMappingSchema } from "../../intake/mapping.js";
import {
  RosterSubjectIdSchema,
  RosterSubjectMatchSchema,
} from "../../matching/roster-match.js";
import { defineTaskContract } from "../base.js";

export const RosterMatchSubjectInputSchema = z.strictObject({
  subjectId: RosterSubjectIdSchema,
  /** Composed from the canonical field registry by identity (D147). */
  name: CANONICAL_FIELDS.fullName.schema.optional(),
  eid: CANONICAL_FIELDS.eid.schema.optional(),
}).refine(
  (subject) => subject.name !== undefined || subject.eid !== undefined,
  { message: "a roster subject needs a name or an EID; with neither there is nothing to match" },
);

export const MatchSpreadsheetInputSchema = z.strictObject({
  subjects: z.array(RosterMatchSubjectInputSchema).min(1),
  rosterFileRef: ArtifactRefSchema,
  /** Which worksheet holds the roster. Absent means the first. */
  sheet: z.string().min(1).optional(),
  /** The roster is operator-mapped too (doc 06 §2). */
  mapping: ColumnMappingSchema,
  /** When the roster is being read — resolves coercion exactly on replay. */
  readAt: IsoInstantSchema,
});

export const MatchSpreadsheetOutputSchema = z.strictObject({
  matches: z.array(RosterSubjectMatchSchema),
});
export type MatchSpreadsheetOutput = z.infer<typeof MatchSpreadsheetOutputSchema>;

export const MatchSpreadsheet = defineTaskContract({
  id: taskId("roster/match-spreadsheet"),
  title: "Matching against roster",
  effect: "read",
  input: MatchSpreadsheetInputSchema,
  output: MatchSpreadsheetOutputSchema,
  errorCodes: ["roster-unreadable", "no-name-column", "no-eid-column", "mapping-mismatch"],
  subject: { kind: "none", reason: "pure cross-source roster matching resolves no single person" },
  freshness: { defaultMaxAgeMs: 24 * 60 * 60_000 },
  provenance: { default: "derived" },
  artifacts: "content-addressed",
  scenarios: [
    "roster/match/exact-eid",
    "roster/match/name-only",
    "roster/match/ambiguous",
    "roster/match/name-eid-conflict",
    "roster/match/no-match",
  ],
  example: {
    matches: [
      {
        subjectId: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
        matchedEid: "10456712",
        matchConfidence: 1,
        tier: "high",
        mismatch: "none",
      },
    ],
  },
});
