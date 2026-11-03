import { PERSON_LOOKUP_EXAMPLE_EID } from "../person-lookup/input.js";
import { z } from "zod";
import { EmergencyContactMemberInputSchema } from "./input.js";
import { UcpathContactSetSchema, UcpathContactWriteTargetSchema, UcpathEmergencyContactInputSchema } from "../../systems/ucpath/emergency-contacts.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { taskId } from "../../../rules/identity/ids.js";

const policy = { effect: "read", subject: { kind: "none", reason: "Derives the declared contact plan from approved fields and a complete observed set" },
  freshness: { defaultMaxAgeMs: 0, defaultOverride: "forbidden" }, provenance: { default: "derived" }, scenarios: [] } as const;
const contactExample = UcpathEmergencyContactInputSchema.parse({ emplId: PERSON_LOOKUP_EXAMPLE_EID, expectedName: "Example, Alex", contact: {
  name: "Example Contact", relationship: "Parent", primary: true, cellPhone: null, homePhone: null, workPhone: null,
  address: { kind: "explicit", fields: { address1: null, address2: null, city: null, state: null, postalCode: null, country: null } },
} });
export const MapApprovedEmergencyContact = defineTaskContract({ ...policy, id: taskId("workflow:emergency-contact-member/read-approved-contact"),
  title: "Map approved contact fields", operation: { version: 1, id: "map-approved-contact", system: "local", session: { kind: "local", id: "contact-plan" },
    actions: [{ id: "verify-approved-fields", kind: "verify", label: "Verify approved contact fields and primary policy" }] }, input: EmergencyContactMemberInputSchema, output: UcpathEmergencyContactInputSchema,
  errorCodes: ["CONTACT_APPROVED_FIELDS_INVALID", "CONTACT_SAVE_UNAVAILABLE"], example: contactExample });
export const ContactPlanOutputSchema = z.strictObject({ target: UcpathContactWriteTargetSchema, changes: z.array(z.string().min(1)).min(1), demotionLine: z.string().min(1), contactLine: z.string().min(1) });
export const PlanApprovedEmergencyContact = defineTaskContract({ ...policy, id: taskId("workflow:emergency-contact-member/read-contact-plan"),
  title: "Plan ordered primary contact changes", operation: { version: 1, id: "declare-contact-plan", system: "local", session: { kind: "local", id: "contact-plan" },
    values: [{ id: "demotion", presentation: "local-operator", source: { kind: "contract-output", path: "demotionLine" } },
      { id: "contact", presentation: "local-operator", source: { kind: "contract-output", path: "contactLine" } }],
    actions: [{ id: "read-demotion", kind: "read-field", label: "Existing primary change", valueSlot: "demotion", confirmationActionId: "verify-demotion" },
      { id: "verify-demotion", kind: "verify", label: "Verify the declared existing primary change" },
      { id: "read-contact", kind: "read-field", label: "Approved contact", valueSlot: "contact", confirmationActionId: "verify-contact" },
      { id: "verify-contact", kind: "verify", label: "Verify the declared approved contact" }] }, input: z.strictObject({ contact: UcpathEmergencyContactInputSchema, contacts: UcpathContactSetSchema }),
  output: ContactPlanOutputSchema, errorCodes: ["contact-plan-refused", "relationship-unmapped", "address-choice-unresolved"],
  example: { target: { ...contactExample, plan: { state: "prepare", before: { pageStateId: "ucpath.emergency-contact.editor-ready",
    emplId: PERSON_LOOKUP_EXAMPLE_EID, displayedName: "Example, Alex", observation: "persisted", viewAll: "already-complete", rowCount: 1,
    rows: [{ kind: "blank", rowIndex: 0, primary: false, sameAddressAsEmployee: false }], observedAt: "2026-11-01T12:00:00.000Z" },
    setFingerprint: "a".repeat(64), effect: { name: "Example Contact", relationship: "Parent", primary: true, phone: null,
      address: contactExample.contact.address }, demotion: null, target: { kind: "reuse-blank", rowIndex: 0 } } }, changes: ["Add Example Contact as Primary"], demotionLine: "No existing primary needs demotion", contactLine: "Add Example Contact as Primary" },
});
