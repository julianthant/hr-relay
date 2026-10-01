import { defineTask } from "../../../../base/task.js";
import {
  MatchIdentityOutputSchema,
  SeparationsMatchIdentity,
} from "../../../../domain/contracts/separations/match-identity.js";
import {
  buildIdentityEvidencePacket,
  deriveIdentityEvidenceDigest,
} from "../../../../domain/separations/identity-evidence.js";

/**
 * The decision packet, executed.
 *
 * The two refusals are both about the fold's own INPUTS being coherent, never
 * about what they say. A packet whose job summary is for a different person than
 * the run checked would present one person's employment as another's — the
 * `T002173685` shape, one layer in — and an `emplIdSource` that disagrees with
 * the document's own EID field would make the gate's `eid` comparison a lie.
 * Everything else the fold finds (a different name, no active job, two active
 * jobs, an unreadable department) is DATA and travels to the operator.
 */
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
      || (input.emplIdSource !== "document-eid" && documentEidPresent)) {
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
      evidenceDigest: deriveIdentityEvidenceDigest(packet),
    });
    ctx.recordData([
      { direction: "read", field: "packet", value: output.packet },
      { direction: "read", field: "evidenceDigest", value: output.evidenceDigest },
    ]);
    return output;
  },
});
