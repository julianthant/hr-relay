import { defineTask } from "../../../base/task.js";
import {
  SeparationsVerifyIdentityApproval,
  VerifyIdentityApprovalOutputSchema,
} from "../../../domain/contracts/separations/verify-identity-approval.js";
import { verifyIdentityApproval } from "../../../domain/separations/identity-approval.js";

/**
 * The post-gate check, executed.
 *
 * The stored `evidenceDigest` from the comparison node is passed in as the
 * re-derivation, rather than recomputed here, for one specific reason: the
 * comparison node's output is what the WIRE served and what the operator
 * approved against, so the digest that must match is the one authority stored
 * beside that packet. Recomputing it here would compare the approval against a
 * value nobody had seen. The fold still parses and re-derives internally, so a
 * stored digest that does not describe its own stored packet fails too.
 */
export const verifyIdentityApprovalTask = defineTask(SeparationsVerifyIdentityApproval, {
  sessions: [],
  async run({ input, ctx }) {
    const verification = verifyIdentityApproval(input.packet, input.approval, input.evidenceDigest);
    if (verification.state === "refused") return ctx.fail(verification.code, verification.reason);

    const output = VerifyIdentityApprovalOutputSchema.parse(verification.subject);
    ctx.recordData([
      { direction: "read", field: "emplId", value: output.emplId },
      { direction: "read", field: "chosenFrom", value: output.chosenFrom },
      { direction: "read", field: "evidenceDigest", value: output.evidenceDigest },
      { direction: "read", field: "ucpathName", value: output.ucpathName },
      { direction: "read", field: "nameTier", value: output.nameTier },
      { direction: "read", field: "approvalShape", value: output.approvalShape },
    ]);
    return output;
  },
});
