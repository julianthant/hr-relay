/**
 * `workflow:separations/verify-identity-approval` — the node immediately after
 * the gate, and the reason a resolved gate is not the end of the story.
 *
 * The command kernel proves that a gate result PARSES through the descriptor's
 * exact gate schema and stores it under the run's identity. It cannot prove the
 * result is about THIS run's evidence, that the approved EID was ever displayed,
 * or that `chosenFrom` is true — those are facts about the packet, and the
 * kernel does not read packets. So they are checked here, as a node, where each
 * refusal gets its own durable code and lands as a terminal `FailureRecord` an
 * operator can query on.
 *
 * Every refusal is fail-closed by construction: there is no arm that downgrades
 * a failed check into a warning, and no arm that proceeds on the run's own
 * checked EID when the approval names a different one.
 */
import { z } from "zod";
import { taskId } from "../../ids.js";
import {
  ApprovedIdentitySubjectSchema,
  IDENTITY_APPROVAL_REFUSAL_CODES,
  IdentityApprovalResultSchema,
} from "../../separations/identity-approval.js";
import { IdentityEvidencePacketSchema } from "../../separations/identity-evidence.js";
import { JobSummaryClassificationSchema } from "../../separations/job-summary-classification.js";
import { FingerprintSchema } from "../../ids.js";
import { defineTaskContract } from "../base.js";

/**
 * The run's PRODUCT, and it is deliberately the whole thing rather than just the
 * subject.
 *
 * `identity-gate-before-separation-commit` (ref write-safety §14.6 #2) requires the
 * terminal result to be graph-reachable only through the gate — and it caught a
 * real defect here: a terminal result that read the document number and the
 * employment picture straight off the PRE-gate comparison node had two ancestry
 * paths to the root that never crossed the gate. So the post-gate node carries
 * them forward instead. The rule generalises: in a gated graph, whatever the run
 * PRODUCES has to be a post-approval fact, or the gate dominates the decision
 * without dominating the output.
 */
export const VerifyIdentityApprovalOutputSchema = z.strictObject({
  documentNumber: z.string().min(1),
  approved: ApprovedIdentitySubjectSchema,
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
    /** The operator's typed gate result, exactly as authority stored it. */
    approval: IdentityApprovalResultSchema,
  }),
  output: VerifyIdentityApprovalOutputSchema,
  errorCodes: IDENTITY_APPROVAL_REFUSAL_CODES,
  subject: {
    kind: "none",
    reason: "a pure fold over a stored gate result and the packet it was granted on",
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
