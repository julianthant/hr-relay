import { defineTask } from "../../../workflow-kit/task.js";
import {
  SeparationsVerifyIdentityApproval,
  VerifyIdentityApprovalOutputSchema,
} from "../../../models/workflows/separations/verify-identity-approval.js";
import { verifyIdentityApproval } from "../../../rules/separations/identity-approval.js";

/**
 * The identity-authority check, executed.
 *
 * The stored `evidenceDigest` from the comparison node is passed in as the
 * re-derivation, rather than recomputed here, for one specific reason: the
 * comparison node's output is what machine verification consumes and, on the
 * name-only arm, what the WIRE served for operator approval. The digest that
 * must match is therefore the one authority stored beside that packet. The fold
 * still parses and re-derives internally, so a stored digest that does not
 * describe its own packet fails too.
 */
export const verifyIdentityApprovalTask = defineTask(SeparationsVerifyIdentityApproval, {
  sessions: [],
  async run({ input, ctx }) {
    const verification = verifyIdentityApproval(input.packet, input.approval, input.evidenceDigest);
    if (verification.state === "refused") return ctx.fail(verification.code, verification.reason);

    const output = VerifyIdentityApprovalOutputSchema.parse({
      documentNumber: input.packet.documentNumber,
      approved: verification.subject,
      jobs: input.packet.jobs,
    });
    ctx.recordData([
      { direction: "read", field: "documentNumber", value: output.documentNumber },
      { direction: "read", field: "approved", value: output.approved },
      { direction: "read", field: "jobs", value: output.jobs },
    ]);
    return output;
  },
});
