/** Separations identity authority: the typed operator result for a name-only selection and the fold that either verifies supplied-EID evidence or consumes that result. */
import { z } from "zod";
import { EidSchema, FingerprintSchema, type Fingerprint } from "../identity/ids.js";
import { directIdentifierDisplay } from "../redaction/redaction.js";
import {
  IdentityApprovalShapeSchema,
  IdentityEvidencePacketSchema,
  deriveIdentityEvidenceDigest,
} from "./identity-evidence.js";
import type { IdentityEvidencePacket } from "./identity-evidence.js";

export const IdentityApprovalChoiceSchema = z.enum([
  /** The EID the run checked — the document's own, or the one it was given. */
  "checked",
  /** The EID the document's NAME resolves to, when that is a different person. */
  "name-search",
  /** Another EID the packet SHOWED. */
  "manual",
]);
export type IdentityApprovalChoice = z.infer<typeof IdentityApprovalChoiceSchema>;

export const IdentityApprovalResultSchema = z.discriminatedUnion("decision", [
  z.strictObject({
    decision: z.literal("approved"),
    eid: EidSchema,
    chosenFrom: IdentityApprovalChoiceSchema,
    evidenceDigest: FingerprintSchema,
  }),
  z.strictObject({
    decision: z.literal("rejected"),
    reason: z.string().min(1),
    evidenceDigest: FingerprintSchema,
  }),
]);
export type IdentityApprovalResult = z.infer<typeof IdentityApprovalResultSchema>;

export const ApprovedIdentitySubjectSchema = z.strictObject({
  authority: z.literal("operator-approval"),
  emplId: EidSchema,
  chosenFrom: IdentityApprovalChoiceSchema,
  /** The packet the approval was granted on, re-derived and proved identical. */
  evidenceDigest: FingerprintSchema,
  /** The name UCPath displayed for the checked EID, carried onto the receipt. */
  ucpathName: z.string().min(1),
  nameTier: z.enum(["same", "similar", "different"]),
  approvalShape: IdentityApprovalShapeSchema,
});
export type ApprovedIdentitySubject = z.infer<typeof ApprovedIdentitySubjectSchema>;

/** Machine evidence is a different authority from an operator's choice. */
export const VerifiedIdentitySubjectSchema = z.strictObject({
  authority: z.literal("machine-verification"),
  source: z.enum(["document-eid", "canonical-eid"]),
  emplId: EidSchema,
  evidenceDigest: FingerprintSchema,
  ucpathName: z.string().min(1),
  nameTier: z.enum(["same", "similar", "different"]),
});
export const ResolvedIdentitySubjectSchema = z.discriminatedUnion("authority", [
  ApprovedIdentitySubjectSchema,
  VerifiedIdentitySubjectSchema,
]);

/** The literal tuple a contract's `errorCodes` needs, and the schema derived FROM it — one source, both shapes, so the literal types survive. */
export const IDENTITY_APPROVAL_REFUSAL_CODES = [
  "identity-approval-rejected",
  "identity-approval-evidence-moved",
  "identity-approval-eid-not-shown",
  "identity-approval-choice-mismatch",
  "identity-approval-required",
  "identity-supplied-eid-unproved",
] as const;
export const IdentityApprovalRefusalCodeSchema = z.enum(IDENTITY_APPROVAL_REFUSAL_CODES);
export type IdentityApprovalRefusalCode = z.infer<typeof IdentityApprovalRefusalCodeSchema>;

export const IdentityApprovalVerificationSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("verified"), subject: VerifiedIdentitySubjectSchema }),
  z.strictObject({ state: z.literal("approved"), subject: ApprovedIdentitySubjectSchema }),
  z.strictObject({
    state: z.literal("refused"),
    code: IdentityApprovalRefusalCodeSchema,
    reason: z.string().min(1),
  }),
]);
export type IdentityApprovalVerification = z.infer<typeof IdentityApprovalVerificationSchema>;

function choiceFor(packet: IdentityEvidencePacket, eid: string): IdentityApprovalChoice | undefined {
  if (eid === packet.emplId) return "checked";
  if (packet.nameSearch.status === "resolved" && eid === packet.nameSearch.candidate.eid) {
    return "name-search";
  }
  return packet.approvableEids.includes(EidSchema.parse(eid)) ? "manual" : undefined;
}

/** The identity-authority check, run as a real node so every refusal has a durable code: the decision, the packet digest, that the EID was SHOWN, and that `chosenFrom` agrees. */
export function verifyIdentityApproval(
  packetInput: IdentityEvidencePacket,
  result: IdentityApprovalResult | undefined,
  reDerivedDigest?: Fingerprint,
): IdentityApprovalVerification {
  const packet = IdentityEvidencePacketSchema.parse(packetInput);
  const actualDigest = deriveIdentityEvidenceDigest(packet);
  const expectedDigest = reDerivedDigest ?? actualDigest;
  if (actualDigest !== expectedDigest) {
    return IdentityApprovalVerificationSchema.parse({
      state: "refused",
      code: "identity-approval-evidence-moved",
      reason: "the stored identity evidence does not describe this packet",
    });
  }

  if (result !== undefined && packet.emplIdSource !== "name-resolved") {
    return IdentityApprovalVerificationSchema.parse({
      state: "refused",
      code: "identity-supplied-eid-unproved",
      reason: `a ${packet.emplIdSource} packet requires machine verification and cannot consume an operator gate result`,
    });
  }

  if (result === undefined) {
    if (packet.emplIdSource === "name-resolved") {
      return IdentityApprovalVerificationSchema.parse({
        state: "refused",
        code: "identity-approval-required",
        reason: "an EID resolved by name requires an operator identity decision",
      });
    }
    if (packet.emplIdSource === "document-eid" && packet.documentEidText !== packet.emplId) {
      return IdentityApprovalVerificationSchema.parse({
        state: "refused",
        code: "identity-supplied-eid-unproved",
        reason: "the supplied document EID does not match the UCPath read-back bound to this packet",
      });
    }
    return IdentityApprovalVerificationSchema.parse({
      state: "verified",
      subject: {
        authority: "machine-verification",
        source: packet.emplIdSource,
        emplId: packet.emplId,
        evidenceDigest: actualDigest,
        ucpathName: packet.ucpathName,
        nameTier: packet.nameTier,
      },
    });
  }

  if (result.evidenceDigest !== expectedDigest) {
    return IdentityApprovalVerificationSchema.parse({
      state: "refused",
      code: "identity-approval-evidence-moved",
      reason: "the approval is bound to different evidence. An approval is an "
        + "observation of a specific packet (ref write-safety §14.5); it never survives the disappearance of "
        + "what it approved.",
    });
  }
  if (result.decision === "rejected") {
    const disagreements = packet.comparisons.filter(({ agrees }) => !agrees);
    return IdentityApprovalVerificationSchema.parse({
      state: "refused",
      code: "identity-approval-rejected",
      reason: `an operator rejected the identity for separation document ${packet.documentNumber}: `
        + `${result.reason}. What they were shown: ${
          disagreements.length === 0
            ? "every compared field agreed"
            : disagreements
              .map(({ field, documentValue, ucpathValue }) =>
                `${field} — document ${JSON.stringify(documentValue)} vs UCPath ${JSON.stringify(ucpathValue)}`)
              .join("; ")
        }.`,
    });
  }
  const actual = choiceFor(packet, result.eid);
  if (actual === undefined) {
    return IdentityApprovalVerificationSchema.parse({
      state: "refused",
      code: "identity-approval-eid-not-shown",
      reason: `EID ${directIdentifierDisplay(result.eid)} was approved for separation document ${packet.documentNumber}, and the `
        + `identity packet never showed it (it showed ${packet.approvableEids.map(directIdentifierDisplay).join(", ")}). A typed EID `
        + "is an assertion, not evidence: nothing in this run read that person, so there is nothing to approve.",
    });
  }
  if (actual !== result.chosenFrom) {
    return IdentityApprovalVerificationSchema.parse({
      state: "refused",
      code: "identity-approval-choice-mismatch",
      reason: `the approval labels EID ${directIdentifierDisplay(result.eid)} as "${result.chosenFrom}", and on this packet it is `
        + `"${actual}". A receipt that mislabels where an approved identity came from states something false about the human decision it records.`,
    });
  }
  return IdentityApprovalVerificationSchema.parse({
    state: "approved",
    subject: {
      authority: "operator-approval",
      emplId: result.eid,
      chosenFrom: result.chosenFrom,
      evidenceDigest: result.evidenceDigest,
      ucpathName: packet.ucpathName,
      nameTier: packet.nameTier,
      approvalShape: packet.approvalShape,
    },
  });
}
