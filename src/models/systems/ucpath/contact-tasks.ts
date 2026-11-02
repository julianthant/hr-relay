import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { ContractFieldPathSchema, defineTaskContract } from "../../task/task-contract.js";
import { UCPATH_CONTACT_DISPLAYED_NAME } from "../../ui/ucpath-emergency-contact.js";
import { UCPATH_CONTACT_REFUSAL_CODES, UcpathContactSetSchema, UcpathEmergencyContactInputSchema } from "./emergency-contacts.js";

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

export const UcpathReadEmergencyContacts = defineTaskContract({
  id: taskId("ucpath/read-emergency-contacts"), title: "Read Emergency Contacts", effect: "read",
  input: UcpathContactSubjectSchema, output: UcpathContactReadOutputSchema,
  errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "before-subject-read" }, freshness, provenance, scenarios, example,
});

export const UcpathStageEmergencyContact = defineTaskContract({
  id: taskId("ucpath/stage-emergency-contact"), title: "Stage Emergency Contact", effect: "prepare",
  input: UcpathContactTargetSchema, output: UcpathContactReadOutputSchema,
  errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "after-prepare-before-fence" }, scenarios, checkpoint: "in-memory-only",
  example: { contacts: { ...example.contacts, observation: "staged" } },
});

// This comparison provides observations only; it is not a protected-write probe or receipt.
export const UcpathMatchEmergencyContact = defineTaskContract({
  id: taskId("ucpath/match-emergency-contact"), title: "Compare Emergency Contact Effect", effect: "read",
  input: UcpathContactTargetSchema, output: UcpathContactComparisonSchema,
  errorCodes: UCPATH_CONTACT_REFUSAL_CODES,
  subject: { ...subject, requiredAt: "before-subject-read" }, freshness, provenance, scenarios,
  example: { state: "absent", ...example },
});
