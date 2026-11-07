import { PERSON_LOOKUP_EXAMPLE_EID } from "../person-lookup/input.js";
import { defineCanonicalInput } from "../../workflow/canonical-input.js";
import { ApprovedOcrRecordInputSchema } from "../ocr/approved-record.js";

export const EmergencyContactMemberInputSchema = ApprovedOcrRecordInputSchema;
export const EMERGENCY_CONTACT_MEMBER_EXAMPLE = EmergencyContactMemberInputSchema.parse({
  approval: { sourceRunId: "00000000-0000-4000-8000-000000000002", snapshotId: "00000000-0000-4000-8000-000000000001",
    revision: 1, digest: "a".repeat(64) },
  record: { recordId: `${"b".repeat(64)}#emergency-contact#1`, discarded: false, assertedEid: PERSON_LOOKUP_EXAMPLE_EID, fields: {
    answers: [
      { state: "read", path: "employee.name", raw: "Example, Alex", value: "Example, Alex", confidence: 1 },
      { state: "read", path: "contact.name", raw: "Example Contact", value: "Example Contact", confidence: 1 },
      { state: "read", path: "contact.relationship", raw: "Parent", value: "Parent", confidence: 1 },
      ...["cellPhone", "homePhone", "workPhone", "address1", "city", "state", "postalCode"].map(field =>
        ({ state: "absent", path: `contact.${field}`, reason: "blank" })),
    ], blockingPaths: [], answersFingerprint: "a".repeat(64),
  } },
});
export const EmergencyContactMemberCanonicalInput = defineCanonicalInput(EmergencyContactMemberInputSchema,
  EmergencyContactMemberInputSchema, [EMERGENCY_CONTACT_MEMBER_EXAMPLE]);
