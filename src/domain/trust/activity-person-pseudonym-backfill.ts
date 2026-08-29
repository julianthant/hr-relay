import { z } from "zod";
import { NonNegativeIntSchema, RunIdSchema } from "../ids.js";
import {
  ActivityPersonPseudonymKeyGenerationSchema,
  ActivityPersonPseudonymRunSetSchema,
} from "./activity-person-pseudonym.js";

export const ActivityPersonPseudonymBackfillRequestSchema = z.discriminatedUnion("scope", [
  z.strictObject({ scope: z.literal("current-separations") }),
  z.strictObject({
    scope: z.literal("selected-runs"),
    runIds: ActivityPersonPseudonymRunSetSchema.refine(
      (runIds) => runIds.length > 0,
      "selected pseudonym backfill requires at least one run id",
    ),
  }),
]);

export const ActivityPersonPseudonymBackfillUnavailableReasonSchema = z.enum([
  "run-not-found",
  "workflow-not-separations",
  "run-not-terminal",
  "terminal-outcome-not-done",
  "run-result-missing",
  "run-result-identity-mismatch",
  "result-schema-not-current",
  "canonical-subject-missing",
  "canonical-subject-ambiguous",
  "canonical-subject-malformed",
]);

export const ActivityPersonPseudonymBackfillOutcomeSchema = z.discriminatedUnion("state", [
  z.strictObject({
    runId: RunIdSchema,
    state: z.enum(["inserted", "existing"]),
    keyGeneration: ActivityPersonPseudonymKeyGenerationSchema,
  }),
  z.strictObject({
    runId: RunIdSchema,
    state: z.literal("unavailable"),
    reason: ActivityPersonPseudonymBackfillUnavailableReasonSchema,
  }),
]);

export const ActivityPersonPseudonymBackfillReportSchema = z.strictObject({
  scope: z.enum(["current-separations", "selected-runs"]),
  keyGeneration: ActivityPersonPseudonymKeyGenerationSchema,
  outcomes: z.array(ActivityPersonPseudonymBackfillOutcomeSchema),
  counts: z.strictObject({
    examined: NonNegativeIntSchema,
    inserted: NonNegativeIntSchema,
    existing: NonNegativeIntSchema,
    unavailable: NonNegativeIntSchema,
  }),
}).superRefine((report, context) => {
  const expectedCounts = [
    ["examined", report.outcomes.length],
    ["inserted", report.outcomes.filter(({ state }) => state === "inserted").length],
    ["existing", report.outcomes.filter(({ state }) => state === "existing").length],
    ["unavailable", report.outcomes.filter(({ state }) => state === "unavailable").length],
  ] as const;
  for (const [name, count] of expectedCounts) {
    if (report.counts[name] === count) continue;
    context.addIssue({
      code: "custom",
      path: ["counts", name],
      message: `${name} must be derived from the exact backfill outcomes`,
    });
  }
});

export type ActivityPersonPseudonymBackfillRequest = z.infer<
  typeof ActivityPersonPseudonymBackfillRequestSchema
>;
export type ActivityPersonPseudonymBackfillOutcome = z.infer<
  typeof ActivityPersonPseudonymBackfillOutcomeSchema
>;
export type ActivityPersonPseudonymBackfillReport = z.infer<
  typeof ActivityPersonPseudonymBackfillReportSchema
>;
