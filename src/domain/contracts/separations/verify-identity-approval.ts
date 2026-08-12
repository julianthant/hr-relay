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
import { FingerprintSchema } from "../../ids.js";
import { defineTaskContract } from "../base.js";

export const VerifyIdentityApprovalOutputSchema = ApprovedIdentitySubjectSchema;
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
    emplId: "10873698",
    chosenFrom: "checked",
    evidenceDigest: "0".repeat(64),
    ucpathName: "Battistessa, Johnnie",
    nameTier: "same",
    approvalShape: "one-click",
  },
});
