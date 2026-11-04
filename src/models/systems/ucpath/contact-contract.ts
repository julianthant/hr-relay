import { z } from "zod";
import { PERSON_LOOKUP_EXAMPLE_EID } from "../../workflows/person-lookup/input.js";
import { contactEffect } from "../../../rules/ucpath/emergency-contact.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { probeVerdictSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import { ContractFieldPathSchema } from "../../task/task-contract.js";
import { UCPATH_CONTACT_DISPLAYED_NAME } from "../../ui/ucpath-emergency-contact.js";
import type { UcpathContactWriteTarget } from "./emergency-contacts.js";
import {
contactEffectIdentity,
UcpathContactEffectProofSchema,UcpathContactEffectSchema,UcpathContactRefusedError,
UcpathContactSetSchema,
UcpathContactWriteTargetSchema,
UcpathEmergencyContactInputSchema
} from "./emergency-contacts.js";
export const UcpathContactSubjectSchema = UcpathEmergencyContactInputSchema.pick({ emplId: true, expectedName: true });
export const UcpathContactTargetSchema = UcpathEmergencyContactInputSchema.extend({ before: UcpathContactSetSchema });
export const UcpathContactReadOutputSchema = z.strictObject({ contacts: UcpathContactSetSchema });
export const UcpathContactComparisonSchema = z.strictObject({
  state: z.enum(["present", "absent", "ambiguous", "unknown"]),
  contacts: UcpathContactSetSchema,
});
export const subject = {
  kind: "person",
  expected: { fromInput: ContractFieldPathSchema.parse("expectedName"), identity: "name" },
  observe: UCPATH_CONTACT_DISPLAYED_NAME,
  match: "normalized-exact-name",
} as const;
export const freshness = { defaultMaxAgeMs: 0, defaultOverride: "forbidden" } as const;
export const provenance = { default: "live" } as const;
export const scenarios = ["emergency-contact/unambiguous-addition", "emergency-contact/exact-existing-effect", "emergency-contact/conflict-refused"];
export const example = UcpathContactReadOutputSchema.parse({
  contacts: {
    pageStateId: "ucpath.emergency-contact.editor-ready", emplId: PERSON_LOOKUP_EXAMPLE_EID, displayedName: "Example, Alex",
    observation: "persisted", viewAll: "already-complete", rowCount: 1,
    rows: [{ kind: "blank", rowIndex: 0, primary: false, sameAddressAsEmployee: false }],
    observedAt: "2026-11-01T12:00:00.000Z",
  },
});
const effectExample = UcpathContactEffectSchema.parse({ name: "Example Contact", relationship: "Parent", primary: true, phone: null,
  address: { kind: "explicit", fields: { address1: "1 Example Street", address2: null, city: "Example", state: "CA", postalCode: "90000", country: null } } });
export const completeExample = UcpathContactSetSchema.parse({ ...example.contacts, rows: [{ kind: "contact", rowIndex: 0, effect: effectExample }] });
export function contactOperation(id: string, label: string) {
  return { version: 1 as const, id, system: "ucpath" as const,
    session: { kind: "browser" as const, id: "contact-editor", system: "ucpath" as const },
    actions: [{ id: "verify-contact-observation", kind: "verify" as const, label }] };
}
export function emergencyContactIdempotencyKey(input: UcpathContactWriteTarget): string {
  const target = UcpathContactWriteTargetSchema.parse(input);
  const desired = contactEffect(target);
  if (contactEffectIdentity(desired) !== contactEffectIdentity(input.plan.effect)) throw new UcpathContactRefusedError("contact-plan-refused");
  const effectDigest = sha256Hex(JSON.stringify([target.emplId, contactEffectIdentity(desired)]));
  return `ucpath:emergency-contact|${effectDigest}`;
}
export const UcpathContactVerdictSchema = probeVerdictSchema(UcpathContactEffectProofSchema);
export const writeScenarios = [...scenarios, "emergency-contact/dry-run", "emergency-contact/unknown", "emergency-contact/verified-save"];
export const absent = { state: "absent", evidence: { idempotencyKeyDigest: "0".repeat(64), source: UCPATH_CONTACT_DISPLAYED_NAME,
  sourceState: "ucpath.emergency-contact.editor-ready", observedAt: "2026-11-01T12:00:00.000Z", queryDigest: "1".repeat(64), evidenceRef: "observation:00000000-0000-4000-8000-000000000001" } };
export const proofExample = UcpathContactEffectProofSchema.parse({ kind: "ucpath-emergency-contact", emplId: example.contacts.emplId,
  displayedName: example.contacts.displayedName, source: "complete-contact-set-read", contacts: completeExample, effect: effectExample });
