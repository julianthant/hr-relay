import assert from "node:assert/strict";
import { describe, it } from "vitest";
import fixture from "../../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { createDeterministicUcpathContactPage } from "../../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/fake.js";
import { contactEffect, interpretContactPage } from "../../../../../src/backend/systems/ucpath/driver/contact-operation.js";
import { UcpathEmergencyContactInputSchema } from "../../../../../src/models/systems/ucpath/emergency-contacts.js";
import { UcpathContactPageSnapshotSchema } from "../../../../../src/models/ui/ucpath-emergency-contact.js";

describe("deterministic UCPath contact editor", () => {
  it("refuses contact calls on unrelated UCPath fixtures instead of inventing contacts", async () => {
    const input = UcpathEmergencyContactInputSchema.parse(fixture.input);
    const before = interpretContactPage(UcpathContactPageSnapshotSchema.parse(fixture.page), input);
    const driver = createDeterministicUcpathPersonOrgDriver();
    await assert.rejects(driver.readEmergencyContacts(input), /explicit contact page observations/u);
    await assert.rejects(driver.stageEmergencyContact(input, before), /explicit contact page observations/u);
  });

  it("requires explicit paged observations and refuses to overwrite a populated row", async () => {
    const page = UcpathContactPageSnapshotSchema.parse(fixture.page);
    const port = createDeterministicUcpathContactPage({ initial: page });
    const { name: _name, ...fields } = contactEffect(UcpathEmergencyContactInputSchema.parse(fixture.input));
    await assert.rejects(port.viewAll(), /explicit complete View All/);
    await assert.rejects(port.fillFields(0, fields), /overwrite a populated/);
    await assert.rejects(port.fillName(0, "Replacement"), /replace a populated/);
    await assert.rejects(port.fillName(99, "Fixture name"), /row disappeared/);
    const read = await port.snapshot();
    read.rows.splice(0, 1);
    assert.equal((await port.snapshot()).rows.length, 2);
    assert.ok(!("save" in port) && !("commit" in port));
  });
});
