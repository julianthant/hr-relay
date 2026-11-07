import { interpretContactPage } from "../../../../src/backend/systems/ucpath/driver/contact-operation.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { approvedEmergencyContact } from "../../../../src/rules/ucpath/emergency-contact.js";
import { EMERGENCY_CONTACT_MEMBER_EXAMPLE } from "../../../../src/models/workflows/emergency-contact-member/input.js";
import { contactPlanChanges, planEmergencyContact, contactEffect } from "../../../../src/rules/ucpath/emergency-contact.js";
import { UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";
import fixture from "../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";

const record = EMERGENCY_CONTACT_MEMBER_EXAMPLE.record;
describe("approved Emergency Contact mapping", () => {
  it("maps only the approved contact half, retains blank address and declares primary policy", () => {
    const contact = approvedEmergencyContact(record);
    assert.equal(contact.emplId, record.assertedEid);
    assert.equal(contact.expectedName, "Example, Alex");
    assert.equal(contact.contact.primary, true);
    assert.deepEqual(contact.contact.address, { kind: "explicit", fields: { address1: null, address2: null, city: null, state: null, postalCode: null, country: null } });
    const employeeAddress = { state: "read" as const, path: "employee.address1", raw: "Employee street", value: "Employee street", confidence: 1 };
    assert.deepEqual(approvedEmergencyContact({ ...record, fields: { ...record.fields, answers: [...record.fields.answers, employeeAddress] } }), contact);
    const before = interpretContactPage(UcpathContactPageSnapshotSchema.parse(fixture.page), contact);
    assert.deepEqual(contactPlanChanges(planEmergencyContact(before, contactEffect(contact))), ["Uncheck Primary on row 1 (Taylor Sample)", "Add Example Contact as Primary"]);
  });
  it("refuses missing, duplicated, unreadable or illegible fields instead of assuming blanks", () => {
    const optional = record.fields.answers.find(answer => answer.path === "contact.address1");
    assert.ok(optional);
    for (const answers of [
      record.fields.answers.filter(answer => answer.path !== optional.path),
      [...record.fields.answers, optional],
      record.fields.answers.map(answer => answer.path === optional.path ? { state: "absent" as const, path: optional.path, reason: "illegible" as const } : answer),
      record.fields.answers.map(answer => answer.path === "contact.name" ? { state: "read" as const, path: answer.path, raw: "true", value: true, confidence: 1 } : answer),
    ]) assert.throws(() => approvedEmergencyContact({ ...record, fields: { ...record.fields, answers } }));
  });
});
