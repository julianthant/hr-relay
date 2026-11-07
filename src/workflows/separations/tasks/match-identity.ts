import { defineTask } from "../../../workflow-kit/task.js";
import {
  MatchIdentityOutputSchema,
  SeparationsMatchIdentity,
} from "../../../models/workflows/separations/match-identity.js";
import {
  buildIdentityEvidencePacket,
  deriveIdentityEvidenceDigest,
} from "../../../rules/separations/identity-evidence.js";

/** The decision packet, executed. Its two refusals only guard input coherence (subject match, emplIdSource vs document EID); everything else is DATA that reaches the operator. */
export const matchIdentityTask = defineTask(SeparationsMatchIdentity, {
  sessions: [],
  async run({ input, ctx }) {
    if (input.jobSummary.emplId !== input.emplId) {
      return ctx.fail(
        "identity-subject-mismatch",
        "the checked subject does not match the subject bound to the UCPath job-summary checkpoint; "
        + "rerun the job-summary read for this run before presenting the identity gate.",
      );
    }
    const documentEidValue = input.documentEid.state === "present" ? input.documentEid.value : undefined;
    const documentEidPresent = documentEidValue !== undefined;
    if ((input.emplIdSource === "document-eid" && documentEidValue !== input.emplId)
      || (input.emplIdSource !== "document-eid" && input.emplIdSource !== "operator-entered" && documentEidPresent)) {
      return ctx.fail(
        "identity-source-inconsistent",
        `identity source ${input.emplIdSource} is inconsistent with the document EID field; correct the canonical input or source classification before retrying.`,
      );
    }

    const packet = buildIdentityEvidencePacket({
      ...(input.protectedBindings === undefined ? {} : { protectedBindings: input.protectedBindings }),
      documentNumber: input.documentNumber,
      documentName: input.documentName,
      documentEidText: documentEidPresent
        ? String(documentEidValue)
        : `blank (${input.documentEid.state === "absent" ? input.documentEid.reason : "no reason recorded"})`,
      emplIdSource: input.emplIdSource,
      documentEidConflicts: documentEidPresent && documentEidValue !== input.emplId,
      jobSummary: input.jobSummary,
      nameSelection: input.nameSelection,
      plan: input.plan,
    });
    const output = MatchIdentityOutputSchema.parse({
      packet,
      approvalRequired: packet.emplIdSource === "name-resolved" || packet.emplIdSource === "operator-entered",
      evidenceDigest: deriveIdentityEvidenceDigest(packet),
    });
    ctx.recordData([
      { direction: "read", field: "packet", value: output.packet },
      { direction: "read", field: "approvalRequired", value: output.approvalRequired },
      { direction: "read", field: "evidenceDigest", value: output.evidenceDigest },
    ]);
    return output;
  },
});
