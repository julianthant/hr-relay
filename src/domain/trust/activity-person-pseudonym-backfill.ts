import { z } from "zod";
import { NonNegativeIntSchema, RunIdSchema } from "../ids.js";
import { ApprovedIdentitySubjectSchema } from "../separations/identity-approval.js";
import { TerminationReceiptSchema } from "../separations/termination-receipt.js";
import { KualiSavedFinalizationProofSchema } from "../ui/kuali-separation-finalization.js";
import { UcpathPendingSweepProofSchema } from "../ui/ucpath-smart-hr-termination.js";
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
  "run-archived",
  "run-identity-mismatch",
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

/**
 * D288 deliberately pins the complete current Separations terminal value at
 * the trust boundary. The backfill does not accept a looser object merely
 * because it happens to contain an identifier-shaped `approved.emplId`.
 */
export const CurrentSeparationsPseudonymSourceResultSchema = z.strictObject({
  documentNumber: z.string().min(1),
  approved: ApprovedIdentitySubjectSchema,
  employment: z.strictObject({
    emplRecord: z.string().min(1),
    payrollTitleCode: z.string().min(1),
    payrollTitle: z.string().min(1),
  }),
  department: z.strictObject({
    option: z.string().min(1),
    departmentCode: z.string().min(1),
  }),
  dates: z.strictObject({
    kualiLastDayWorked: z.string().min(1),
    lastDayWorked: z.string().min(1),
    kualiSeparationDate: z.string().min(1),
    separationDate: z.string().min(1),
    terminationEffectiveDate: z.string().min(1),
    lastDayWorkedChanged: z.boolean(),
    separationDateChanged: z.boolean(),
  }),
  pendingSweep: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: UcpathPendingSweepProofSchema,
  }),
  termination: TerminationReceiptSchema,
  finalization: z.strictObject({
    disposition: z.enum(["committed", "already-present"]),
    proof: KualiSavedFinalizationProofSchema,
  }),
});

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
