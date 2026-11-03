import { UcpathContactVerdictSchema,emergencyContactIdempotencyKey } from "../../../models/systems/ucpath/contact-contract.js";
import type { UcpathContactRefusalCode,UcpathContactSet,UcpathContactWriteTarget } from "../../../models/systems/ucpath/emergency-contacts.js";
import { UcpathContactEffectProofSchema,UcpathContactRefusedError } from "../../../models/systems/ucpath/emergency-contacts.js";
import { UCPATH_CONTACT_DISPLAYED_NAME } from "../../../models/ui/ucpath-emergency-contact.js";
import { redactedEvidenceId } from "../../../rules/redaction/redaction.js";
import { assertContactSubject,contactEffect,contactPlanMatches,contactPlanPresent,contactSetFingerprint } from "../../../rules/ucpath/emergency-contact.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { deriveIdempotencyKeyDigest } from "../../../rules/write-safety/write-safety.js";

export function refuseContact(error: unknown, fail: (code: UcpathContactRefusalCode, message: string, options?: { cause?: unknown }) => never): never {
  if (error instanceof UcpathContactRefusedError) return fail(error.code, "UCPath contact inspection or preparation was refused.", { cause: error });
  throw error;
}
export function validatePlan(input: UcpathContactWriteTarget): void {
  assertContactSubject({ pageStateId: input.plan.before.pageStateId, displayedEid: input.plan.before.emplId,
    displayedName: input.plan.before.displayedName }, input);
  if (!contactPlanMatches(input.plan, input.plan.before, contactEffect(input))) {
    throw new UcpathContactRefusedError("contact-plan-refused");
  }
}
export function emergencyContactVerdict(input: UcpathContactWriteTarget, contacts: UcpathContactSet) {
  if (contactPlanPresent(input.plan, contacts)) return UcpathContactVerdictSchema.parse({ state: "present",
    proof: UcpathContactEffectProofSchema.parse({ kind: "ucpath-emergency-contact", emplId: input.emplId,
      displayedName: contacts.displayedName, effect: input.plan.effect, contacts, source: "complete-contact-set-read" }) });
  if (input.plan.state === "prepare" && contacts.observation === "persisted" && contactSetFingerprint(contacts) === input.plan.setFingerprint) {
    return UcpathContactVerdictSchema.parse({ state: "absent", evidence: {
      idempotencyKeyDigest: deriveIdempotencyKeyDigest("ucpath", emergencyContactIdempotencyKey(input)),
      source: UCPATH_CONTACT_DISPLAYED_NAME, sourceState: contacts.pageStateId, observedAt: contacts.observedAt,
      queryDigest: sha256Hex(emergencyContactIdempotencyKey(input)), evidenceRef: `observation:${redactedEvidenceId("ucpath-contact-set", [input.emplId, contactSetFingerprint(contacts), contacts.observedAt])}`,
    } });
  }
  return UcpathContactVerdictSchema.parse({ state: "unknown", reason: "The complete contact set does not match the approved plan or exact desired effect.", observedAt: contacts.observedAt });
}
