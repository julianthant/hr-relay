import assert from "node:assert/strict";
import { describe, it } from "vitest";
import fixture from "../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { UcpathContactSetSchema, UcpathEmergencyContactInputSchema } from "../../../../src/models/systems/ucpath/emergency-contacts.js";
import { interpretContactPage } from "../../../../src/backend/systems/ucpath/driver/contact-operation.js";
import { UcpathContactPageSnapshotSchema } from "../../../../src/models/ui/ucpath-emergency-contact.js";

describe("emergency contact boundary contracts", () => {
  it("keeps all phone slots and explicit absence, with no implicit employee address", () => {
    const input = UcpathEmergencyContactInputSchema.parse(fixture.input);
    const unresolved = UcpathEmergencyContactInputSchema.parse({ ...input, contact: { ...input.contact, address: { kind: "unspecified" } } });
    assert.deepEqual(unresolved.contact.address, { kind: "unspecified" });
    assert.equal(UcpathEmergencyContactInputSchema.safeParse({ ...input, contact: { ...input.contact, invented: true } }).success, false);
    assert.equal(UcpathEmergencyContactInputSchema.safeParse({ ...input, contact: { ...input.contact, cellPhone: undefined } }).success, false);
  });
  it("rejects contact-set counts, missing fields and positional gaps", () => {
    const input = UcpathEmergencyContactInputSchema.parse(fixture.input);
    const set = interpretContactPage(UcpathContactPageSnapshotSchema.parse(fixture.page), input);
    for (const invalid of [
      { ...set, rowCount: 3 }, { ...set, displayedName: undefined }, { ...set, rows: [], rowCount: 0 },
      { ...set, rows: set.rows.map(row => ({ ...row, rowIndex: 4 })) },
    ]) assert.equal(UcpathContactSetSchema.safeParse(invalid).success, false);
  });
});
