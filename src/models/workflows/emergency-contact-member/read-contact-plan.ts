import { z } from "zod";
import { taskId } from "../../../rules/identity/ids.js";
import { UcpathContactSetSchema,UcpathEmergencyContactInputSchema } from "../../systems/ucpath/emergency-contacts.js";
import { defineTaskContract } from "../../task/task-contract.js";
import { PERSON_LOOKUP_EXAMPLE_EID } from "../person-lookup/input.js";
import { contactExample,ContactPlanOutputSchema,policy } from "./contact-plan.js";
export const PlanApprovedEmergencyContact = defineTaskContract({ ...policy, id: taskId("workflow:emergency-contact-member/read-contact-plan"),
  title: "Plan ordered primary contact changes", input: z.strictObject({ contact: UcpathEmergencyContactInputSchema, contacts: UcpathContactSetSchema }),
  output: ContactPlanOutputSchema, errorCodes: ["contact-plan-refused", "relationship-unmapped", "address-choice-unresolved"],
  example: { target: { ...contactExample, plan: { state: "prepare", before: { pageStateId: "ucpath.emergency-contact.editor-ready",
    emplId: PERSON_LOOKUP_EXAMPLE_EID, displayedName: "Example, Alex", observation: "persisted", viewAll: "already-complete", rowCount: 1,
    rows: [{ kind: "blank", rowIndex: 0, primary: false, sameAddressAsEmployee: false }], observedAt: "2026-11-01T12:00:00.000Z" },
    setFingerprint: "a".repeat(64), effect: { name: "Example Contact", relationship: "Parent", primary: true, phone: null,
      address: contactExample.contact.address }, demotion: null, target: { kind: "reuse-blank", rowIndex: 0 } } }, changes: ["Add Example Contact as Primary"], demotionLine: "No existing primary needs demotion", contactLine: "Add Example Contact as Primary" },
});
