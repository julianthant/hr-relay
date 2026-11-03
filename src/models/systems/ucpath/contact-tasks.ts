import { z } from "zod";
import { taskId, TaskIdSchema } from "../../../rules/identity/ids.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";
import { UCPATH_CONTACT_DISPLAYED_NAME } from "../../ui/ucpath-emergency-contact.js";
import { UCPATH_CONTACT_REFUSAL_CODES, UcpathContactSetSchema, UcpathEmergencyContactInputSchema,
  UcpathContactWriteTargetSchema, UcpathContactEffectProofSchema, UcpathContactEffectSchema, UcpathContactRefusedError, contactEffectIdentity } from "./emergency-contacts.js";
import type { UcpathContactWriteTarget } from "./emergency-contacts.js";
import { probeVerdictSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import { contactEffect } from "../../../rules/ucpath/emergency-contact.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

export const UcpathContactSubjectSchema = UcpathEmergencyContactInputSchema.pick({ emplId: true, expectedName: true });
export const UcpathContactTargetSchema = UcpathEmergencyContactInputSchema.extend({ before: UcpathContactSetSchema });
export const UcpathContactReadOutputSchema = z.strictObject({ contacts: UcpathContactSetSchema });
export const UcpathContactComparisonSchema = z.strictObject({
  state: z.enum(["present", "absent", "ambiguous", "unknown"]),
  contacts: UcpathContactSetSchema,
});

const subject = {
  kind: "person",
  expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
  observe: UCPATH_CONTACT_DISPLAYED_NAME,
  match: "normalized-exact-name",
} as const;
const freshness = { defaultMaxAgeMs: 0, defaultOverride: "forbidden" } as const;
const provenance = { default: "live" } as const;
const scenarios = ["emergency-contact/unambiguous-addition", "emergency-contact/exact-existing-effect", "emergency-contact/conflict-refused"];
const example = UcpathContactReadOutputSchema.parse({
  contacts: {
    pageStateId: "ucpath.emergency-contact.editor-ready", emplId: "10000001", displayedName: "Example, Alex",
    observation: "persisted", viewAll: "already-complete", rowCount: 1,
    rows: [{ kind: "blank", rowIndex: 0, primary: false, sameAddressAsEmployee: false }],
    observedAt: "2026-11-01T12:00:00.000Z",
  },
});
const effectExample = UcpathContactEffectSchema.parse({ name: "Example Contact", relationship: "Parent", primary: true, phone: null,
  address: { kind: "explicit", fields: { address1: "1 Example Street", address2: null, city: "Example", state: "CA", postalCode: "90000", country: null } } });
const completeExample = UcpathContactSetSchema.parse({ ...example.contacts, rows: [{ kind: "contact", rowIndex: 0, effect: effectExample }] });

function contactOperation(id: string, label: string) {
  return { version: 1 as const, id, system: "ucpath" as const,
    session: { kind: "browser" as const, id: "contact-editor", system: "ucpath" as const },
    actions: [{ id: "verify-contact-observation", kind: "verify" as const, label }] };
}

export const UcpathReadEmergencyContacts = defineTaskContract({
  id: taskId("ucpath/read-emergency-contacts"), title: "Read Emergency Contacts", effect: "read", operation: contactOperation("read-contact-set", "Verify the complete saved contact set"),
  input: UcpathContactSubjectSchema, output: UcpathContactReadOutputSchema,
  errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "before-subject-read" }, freshness, provenance, scenarios, example,
});

export const UcpathStageEmergencyContact = defineTaskContract({
  id: taskId("ucpath/stage-emergency-contact"), title: "Stage Emergency Contact", effect: "prepare", operation: contactOperation("prepare-contact-plan", "Verify all prepared primary contact changes"),
  input: UcpathContactWriteTargetSchema, output: UcpathContactReadOutputSchema.extend({ stagedPageState: z.literal("ucpath.emergency-contact.editor-ready") }),
  errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "after-prepare-before-fence" }, scenarios, checkpoint: "in-memory-only",
  example: { contacts: { ...completeExample, observation: "staged" }, stagedPageState: "ucpath.emergency-contact.editor-ready" },
});

// This comparison provides observations only; it is not a protected-write probe or receipt.
export const UcpathMatchEmergencyContact = defineTaskContract({
  id: taskId("ucpath/match-emergency-contact"), title: "Compare Emergency Contact Effect", effect: "read",
  input: UcpathContactTargetSchema, output: UcpathContactComparisonSchema,
  errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "before-subject-read" }, freshness, provenance, scenarios,
  example: { state: "absent", ...example },
});

export function emergencyContactIdempotencyKey(input: UcpathContactWriteTarget): string {
  const target = UcpathContactWriteTargetSchema.parse(input);
  const desired = contactEffect(target);
  if (contactEffectIdentity(desired) !== contactEffectIdentity(input.plan.effect)) throw new UcpathContactRefusedError("contact-plan-refused");
  const effectDigest = sha256Hex(JSON.stringify([target.emplId, contactEffectIdentity(desired)]));
  return `ucpath:emergency-contact|${effectDigest}`;
}
export const UcpathContactVerdictSchema = probeVerdictSchema(UcpathContactEffectProofSchema);
const writeScenarios = [...scenarios, "emergency-contact/dry-run", "emergency-contact/unknown", "emergency-contact/real-save-unavailable"];
const absent = { state: "absent", evidence: { idempotencyKeyDigest: "0".repeat(64), source: UCPATH_CONTACT_DISPLAYED_NAME,
  sourceState: "ucpath.emergency-contact.editor-ready", observedAt: "2026-11-01T12:00:00.000Z", queryDigest: "1".repeat(64), evidenceRef: "observation:00000000-0000-4000-8000-000000000001" } };
export const UcpathProbeEmergencyContact = defineTaskContract({
  id: taskId("ucpath/match-emergency-contact-plan"), title: "Probe exact Emergency Contact plan", effect: "read", operation: contactOperation("probe-contact-plan", "Verify the complete persisted contact outcome"),
  input: UcpathContactWriteTargetSchema, output: UcpathContactVerdictSchema, errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "before-subject-read" }, freshness, provenance, scenarios: writeScenarios,
  example: UcpathContactVerdictSchema.parse(absent),
});
export const UcpathVerifyEmergencyContact = defineTaskContract({
  id: taskId("ucpath/verify-emergency-contact-plan"), title: "Verify exact Emergency Contact effect", effect: "read", operation: contactOperation("verify-contact-plan", "Verify exact persisted protected contact effects"),
  input: UcpathContactWriteTargetSchema, output: UcpathContactVerdictSchema, errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "before-subject-read" }, freshness, provenance, scenarios: writeScenarios,
  example: UcpathContactVerdictSchema.parse(absent),
});
const proofExample = UcpathContactEffectProofSchema.parse({ kind: "ucpath-emergency-contact", emplId: example.contacts.emplId,
  displayedName: example.contacts.displayedName, source: "complete-contact-set-read", contacts: completeExample, effect: effectExample });
export const UcpathSaveEmergencyContact = defineTaskContract({
  id: taskId("ucpath/save-emergency-contact"), title: "Save Emergency Contact unavailable", effect: "commit", operation: contactOperation("save-contact-unavailable", "Contact Save is unavailable"),
  input: UcpathContactWriteTargetSchema, output: z.strictObject({ proof: UcpathContactEffectProofSchema }),
  errorCodes: ["CONTACT_SAVE_UNAVAILABLE"], subject: { ...subject, requiredAt: "after-prepare-before-fence" }, scenarios: writeScenarios,
  writeSafety: {
    completion: { kind: "save-verify", verify: { taskId: TaskIdSchema.parse("ucpath/verify-emergency-contact-plan"), effect: "read" },
      proofSchema: UcpathContactEffectProofSchema, proofFromOutput: (output: { proof: z.output<typeof UcpathContactEffectProofSchema> }) => output.proof,
      proofFromPresentProbe: ({ proof }: { proof: z.output<typeof UcpathContactEffectProofSchema> }) => proof, outputFromProof: (proof: z.output<typeof UcpathContactEffectProofSchema>) => ({ proof }) },
    idempotency: { probe: { taskId: TaskIdSchema.parse("ucpath/match-emergency-contact-plan"), effect: "read" }, key: emergencyContactIdempotencyKey,
      recoveryAbsence: { kind: "operator-only", reason: "Contact Save has no accepted live saved-effect recovery authority." } },
  }, example: { proof: proofExample },
});
