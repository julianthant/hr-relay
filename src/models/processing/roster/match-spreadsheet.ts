/** Unmatched roster subjects retain no-match and null EID, never fabricated identity. */
import { z } from "zod";
import { ArtifactRefSchema } from "../../artifacts/artifacts.js";
import { CANONICAL_FIELDS } from "../../fields/registry.js";
import { IsoInstantSchema, taskId } from "../../../rules/identity/ids.js";
import { ColumnMappingSchema } from "../../intake/mapping.js";
import {
  RosterSubjectIdSchema,
  RosterSubjectMatchSchema,
} from "../../../rules/matching/roster-match.js";
import { defineTaskContract } from "../../task/task-contract.js";

export const RosterMatchSubjectInputSchema = z.strictObject({
  subjectId: RosterSubjectIdSchema,
  /** Composed from the canonical field registry by identity. */
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
  /** The roster is operator-mapped too (ref data-intake-and-edit-data §2). */
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
