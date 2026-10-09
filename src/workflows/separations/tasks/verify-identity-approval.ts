import { defineTask } from "../../../workflow-kit/task.js";
import {
  SeparationsVerifyIdentityApproval,
  VerifyIdentityApprovalOutputSchema,
} from "../../../models/workflows/separations/verify-identity-approval.js";
import { verifyIdentityApproval } from "../../../rules/separations/identity-approval.js";

/** The identity-authority check, executed. It re-uses the comparison node's stored evidenceDigest so approval and machine verification share one authority. */
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
