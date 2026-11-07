/** The node that converts the comparison packet into explicit identity authority, fail-closed by construction: no arm downgrades a failed check into a warning. */
import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import {
  ResolvedIdentitySubjectSchema,
  IDENTITY_APPROVAL_REFUSAL_CODES,
  IdentityApprovalResultSchema,
} from "../../../rules/separations/identity-approval.js";
import { IdentityEvidencePacketSchema } from "../../../rules/separations/identity-evidence.js";
import { JobSummaryClassificationSchema } from "../../../rules/separations/job-summary-classification.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import { defineTaskContract } from "../../task/task-contract.js";

  /* The run's PRODUCT, deliberately the whole thing rather than just the subject: the terminal result must be graph-reachable only through this authority task. */
export const VerifyIdentityApprovalOutputSchema = z.strictObject({
  documentNumber: z.string().min(1),
  approved: ResolvedIdentitySubjectSchema,
  jobs: JobSummaryClassificationSchema,
});
export type VerifyIdentityApprovalOutput = z.infer<typeof VerifyIdentityApprovalOutputSchema>;

export const SeparationsVerifyIdentityApproval = defineTaskContract({
  id: taskId("workflow:separations/verify-identity-approval"),
  title: "Identity Approval",
  effect: "read",
  input: z.strictObject({
    packet: IdentityEvidencePacketSchema,
    /** The digest the comparison node stored, re-checked against the packet. */
    evidenceDigest: FingerprintSchema,
    /** The operator's typed gate result when the packet came from a name search. */
    approval: IdentityApprovalResultSchema.optional(),
  }),
  output: VerifyIdentityApprovalOutputSchema,
  errorCodes: IDENTITY_APPROVAL_REFUSAL_CODES,
  subject: {
    kind: "none",
    reason: "a pure fold over the packet and its optional name-only gate result",
  },
  freshness: { defaultMaxAgeMs: Number.POSITIVE_INFINITY, defaultOverride: "forbidden" },
  provenance: { default: "derived" },
  scenarios: [
    "separations-identity-check/gate-approved",
    "separations-identity-check/gate-rejected",
    "separations-identity-check/gate-evidence-moved",
  ],
  example: {
    documentNumber: "4510",
    approved: {
      authority: "operator-approval",
      emplId: "10873698",
      chosenFrom: "checked",
      evidenceDigest: "0".repeat(64),
      ucpathName: "Battistessa, Johnnie",
      nameTier: "same",
      approvalShape: "one-click",
    },
    jobs: {
      disposition: "single-active-job",
      rowCount: 1,
      activeRowCount: 1,
      inactiveRowCount: 0,
      unknownRowCount: 0,
      rows: [{
        rowIndex: 0,
        emplRecord: "0",
        hrStatus: "Active",
        tier: "active",
        department: "Housing Dining Hospitality",
        jobTitle: "Dining Assistant",
        effectiveDate: "07/01/2025",
      }],
      unreadableCells: [],
    },
  },
});
