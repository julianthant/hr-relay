import type { MutationCapability } from "../../../../../src/models/ui/driver.js";
import { contactEffect, planEmergencyContact } from "../../../../../src/rules/ucpath/emergency-contact.js";
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import fixture from "../../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import { createDeterministicUcpathContactPage, deterministicContactOperations } from "../../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../../../src/backend/systems/ucpath/driver/fake.js";
import { interpretContactPage } from "../../../../../src/backend/systems/ucpath/driver/contact-operation.js";
import { UcpathEmergencyContactInputSchema } from "../../../../../src/models/systems/ucpath/emergency-contacts.js";
import { UcpathContactPageSnapshotSchema } from "../../../../../src/models/ui/ucpath-emergency-contact.js";

describe("deterministic UCPath contact editor", () => {
  it("never relabels a prior staged preview as persisted on a reused port", async () => {
    const input = UcpathEmergencyContactInputSchema.parse(fixture.input);
    const port = createDeterministicUcpathContactPage({ initial: UcpathContactPageSnapshotSchema.parse(fixture.page) });
    const driver = deterministicContactOperations(port), before = await driver.readEmergencyContacts(input);
    await driver.stageEmergencyContact(input, planEmergencyContact(before, contactEffect(input)));
    await assert.rejects(driver.readEmergencyContacts(input), /contact-plan-refused/u);
  });
  it("refuses contact calls on unrelated UCPath fixtures instead of inventing contacts", async () => {
    const input = UcpathEmergencyContactInputSchema.parse(fixture.input);
    const before = interpretContactPage(UcpathContactPageSnapshotSchema.parse(fixture.page), input);
    const driver = createDeterministicUcpathPersonOrgDriver();
    await assert.rejects(driver.readEmergencyContacts(input), /explicit contact page observations/u);
    await assert.rejects(driver.stageEmergencyContact(input, planEmergencyContact(before, contactEffect(input))), /explicit contact page observations/u);
  });

  it("requires explicit paged observations and refuses to overwrite a populated row", async () => {
    const page = UcpathContactPageSnapshotSchema.parse(fixture.page);
    const port = createDeterministicUcpathContactPage({ initial: page });
    const { name: _name, ...fields } = contactEffect(UcpathEmergencyContactInputSchema.parse(fixture.input));
    await port.viewAll();
    assert.deepEqual(port.actions, []);
    const paged = createDeterministicUcpathContactPage({ initial: { ...page, view: "paged", rows: page.rows.slice(0, 1) } });
    await assert.rejects(paged.viewAll(), /explicit complete View All/);
    await assert.rejects(port.fillFields(0, fields), /overwrite a populated/);
    await assert.rejects(port.fillName(0, "Replacement"), /replace a populated/);
    await assert.rejects(port.fillName(99, "Fixture name"), /row disappeared/);
    const read = await port.snapshot();
    read.rows.splice(0, 1);
    assert.equal((await port.snapshot()).rows.length, 2);
    assert.ok(!("save" in port) && !("commit" in port));
  });
});

it("rejects caller-created mutation tokens before invoking a Save surface", async () => {
  const input = UcpathEmergencyContactInputSchema.parse(fixture.input);
  const before = interpretContactPage(UcpathContactPageSnapshotSchema.parse(fixture.page), input);
  const port = createDeterministicUcpathContactPage({ initial: UcpathContactPageSnapshotSchema.parse(fixture.page) });
  let saves = 0;
  const driver = deterministicContactOperations(port, { async save() { saves++; }, async readPersisted() { return before; } });
  const plan = planEmergencyContact(before, contactEffect(input));
  await driver.stageEmergencyContact(input, plan);
  await assert.rejects(driver.saveEmergencyContact({ ...input, plan }, {} as MutationCapability), /not minted/u);
  assert.equal(saves, 0);
});
