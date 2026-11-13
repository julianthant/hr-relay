/** The IDEMPOTENCY PROBE for the PayPath work-study transaction: does this person already have one on this effective date, as a four-state verdict. */
import { z } from "zod";
import { EidSchema, ObservationIdSchema, taskId } from "../../../rules/identity/ids.js";
import { probeVerdictSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";
import { UcpathPayPathWorkStudyTargetSchema } from "../../ui/ucpath-paypath.js";
import { UCPATH_SS_SMART_HR_DISPLAYED_NAME, UcpathUsDateSchema } from "../../ui/ucpath-smart-hr-termination.js";
import { UcpathTransactionReceiptSchema } from "../../ui/ucpath-ss-smart-hr.js";

/** Statuses under which a filed work-study transaction counts as filed; Denied, Error and Pushed Back leave the outcome to the operator. */
export const WORK_STUDY_FILED_STATUSES = ["Approved", "Manually Processed", "Pending"] as const;

/** One SS Smart HR transaction row proving the work-study transaction for this person and effective date, with an admissible status. */
export const UcpathWorkStudyTransactionProofSchema = z.strictObject({
  kind: z.literal("ucpath-paypath-work-study"),
  emplId: EidSchema,
  effectiveDate: UcpathUsDateSchema,
  transactionId: UcpathTransactionReceiptSchema,
  action: z.string().min(1),
  approvalStatus: z.enum(WORK_STUDY_FILED_STATUSES),
  displayedName: z.string().min(1),
  source: z.literal("ss-smart-hr-detail-read"),
});
export type UcpathWorkStudyTransactionProof = z.infer<typeof UcpathWorkStudyTransactionProofSchema>;

export const UcpathWorkStudyVerdictSchema = probeVerdictSchema(UcpathWorkStudyTransactionProofSchema);
export type UcpathWorkStudyVerdict = z.infer<typeof UcpathWorkStudyVerdictSchema>;

/** The natural business key: the person and the effective date, and nothing else. */
export function ucpathWorkStudyIdempotencyKey(input: z.output<typeof UcpathPayPathWorkStudyTargetSchema>): string {
  return ["ucpath:paypath-work-study", input.emplId, input.effectiveDate].join("|");
}

export const workStudySubject = {
  kind: "person",
  expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
  observe: ObservationIdSchema.parse(UCPATH_SS_SMART_HR_DISPLAYED_NAME),
  match: "normalized-exact-name",
  requiredAt: "before-subject-read",
} as const;

export const workStudyProofExample = UcpathWorkStudyTransactionProofSchema.parse({
  kind: "ucpath-paypath-work-study", emplId: "10000001", effectiveDate: "08/03/2026", transactionId: "T002209631",
  action: "Data Chg", approvalStatus: "Pending", displayedName: "Lee, Jordan", source: "ss-smart-hr-detail-read",
});

export const UcpathMatchPayPathWorkStudy = defineTaskContract({
  id: taskId("ucpath/match-paypath-work-study"),
  title: "Probe PayPath work-study transaction",
  effect: "read",
  input: UcpathPayPathWorkStudyTargetSchema,
  output: UcpathWorkStudyVerdictSchema,
  errorCodes: ["unexpected-page-state", "subject-mismatch"],
  subject: workStudySubject,
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" },
  provenance: { default: "live" },
  scenarios: ["work-study/planned-transaction", "work-study/already-filed"],
  example: {
    state: "absent",
    evidence: {
      idempotencyKeyDigest: "0".repeat(64),
      source: UCPATH_SS_SMART_HR_DISPLAYED_NAME,
      sourceState: "ucpath.ss-smart-hr.transaction-ready",
      observedAt: "2026-08-03T18:00:00.000Z",
      queryDigest: "1".repeat(64),
      evidenceRef: "observation:00000000-0000-4000-8000-000000000000",
    },
  },
});
