import assert from "node:assert/strict";
import { describe, it } from "vitest";
import fixture from "../../../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";
import {
  contactEffect, contactSetFingerprint, compareSavedContactAddition, decideContactAddition,
  interpretContactPage, readContactSetWithPort, stageContactAdditionWithPort,
} from "../../../../../src/backend/systems/ucpath/driver/contact-operation.js";
import { createDeterministicUcpathContactPage } from "../../../../../src/backend/systems/ucpath/driver/contact-fake.js";
import {
  UcpathContactDecisionSchema, UcpathContactRefusedError, UcpathContactRefusalCodeSchema,
  UcpathEmergencyContactInputSchema,
} from "../../../../../src/models/systems/ucpath/emergency-contacts.js";
import type { UcpathContactRefusalCode } from "../../../../../src/models/systems/ucpath/emergency-contacts.js";
import { UcpathContactPageRowSchema, UcpathContactPageSnapshotSchema } from "../../../../../src/models/ui/ucpath-emergency-contact.js";
import type { UcpathContactPageSnapshot } from "../../../../../src/models/ui/ucpath-emergency-contact.js";
import { EidSchema } from "../../../../../src/rules/identity/ids.js";

const input = UcpathEmergencyContactInputSchema.parse(fixture.input);
const effect = contactEffect(input);
const page = UcpathContactPageSnapshotSchema.parse(fixture.page);
const savedRow = UcpathContactPageRowSchema.parse(fixture.savedRow);
const savedAddress = savedRow.address;
assert.ok(savedAddress !== null);
const before = interpretContactPage(page, input);
const addition = UcpathContactDecisionSchema.parse(decideContactAddition(before, effect));
assert.equal(addition.state, "add");
const savedPage = UcpathContactPageSnapshotSchema.parse({
  ...page, observedAt: "2026-11-01T12:01:00.000Z", rows: [page.rows[0], savedRow],
});

function setFromRows(rows: UcpathContactPageSnapshot["rows"]) {
  return interpretContactPage({ ...page, rows, totalRows: rows.length }, input);
}

function isRefusal(code: UcpathContactRefusalCode) {
  return (error: unknown): boolean => error instanceof UcpathContactRefusedError && error.code === code && error.message === code;
}

describe("UCPath contact contracts and sanitized page operations", () => {
  it("expands View All and retains the complete contact set and independent header identity", async () => {
    const port = createDeterministicUcpathContactPage({
      initial: { ...page, view: "paged", rows: page.rows.slice(0, 1) }, expanded: page,
    });
    const set = await readContactSetWithPort(port, input);
    assert.equal(set.rowCount, 2);
    assert.equal(set.viewAll, "expanded");
    assert.equal(set.displayedName, "Example, Alex");
    assert.deepEqual(port.actions, ["snapshot", "view-all", "snapshot"]);
    assert.equal(set.rows[0]?.kind === "contact" && set.rows[0].effect.phone, "2025550199");
  });

  it("refuses echoed, missing, foreign or differently named subjects before expanding or filling", async () => {
    for (const [displayedEid, displayedName, code] of [
      ["", input.expectedName, "contact-identity-unreadable"],
      [input.emplId, "", "contact-identity-unreadable"],
      ["10000002", input.expectedName, "contact-subject-mismatch"],
      [input.emplId, "Example, Robin", "contact-name-mismatch"],
    ] as const) {
      const port = createDeterministicUcpathContactPage({ initial: { ...page, view: "paged", displayedEid, displayedName } });
      await assert.rejects(readContactSetWithPort(port, input), isRefusal(code));
      assert.deepEqual(port.actions, ["snapshot"]);
    }
    assert.equal(interpretContactPage({ ...page, displayedName: " EXAMPLE,  ALEX " }, input).emplId, input.emplId);
  });

  it("refuses partial, gapped, duplicated or absent row reads and unreadable populated rows", () => {
    for (const raw of [
      { ...page, view: "paged" as const }, { ...page, totalRows: 3 },
      { ...page, rows: [{ ...savedRow, rowIndex: 1 }], totalRows: 1 },
      { ...page, rows: [savedRow, savedRow] }, { ...page, rows: [], totalRows: 0 },
    ]) assert.throws(() => interpretContactPage(raw, input), isRefusal("contact-set-incomplete"));
    for (const row of [
      { ...savedRow, phone: "unreadable" }, { ...savedRow, relationship: "not an option" },
      { ...savedRow, name: "" }, { ...savedRow, address: null, sameAddressAsEmployee: true },
    ]) assert.throws(() => setFromRows([{ ...row, rowIndex: 0 }]), isRefusal("unreadable-contact-row"));
  });

  it("maps relationship labels, phone priority and explicit address choice without defaults", () => {
    assert.equal(effect.relationship, "Parent");
    assert.equal(effect.phone, "2025550100");
    assert.deepEqual(effect.address, input.contact.address);
    for (const [relationship, label] of [["Grandparent", "Grand Parent"], ["Partner", "Domestic Partner Adult"], ["Relative", "Other Relative"], ["Friend", "Friend"]]) {
      assert.equal(contactEffect({ ...input, contact: { ...input.contact, relationship } }).relationship, label);
    }
    assert.equal(contactEffect({ ...input, contact: { ...input.contact, cellPhone: null } }).phone, "2025550101");
    assert.equal(contactEffect({ ...input, contact: { ...input.contact, cellPhone: null, homePhone: null } }).phone, "2025550102");
    assert.equal(contactEffect({ ...input, contact: { ...input.contact, cellPhone: null, homePhone: null, workPhone: null } }).phone, null);
    assert.throws(() => contactEffect({ ...input, contact: { ...input.contact, relationship: "Guardian" } }), isRefusal("relationship-unmapped"));
    assert.throws(() => contactEffect({ ...input, contact: { ...input.contact, relationship: "constructor" } }), isRefusal("relationship-unmapped"));
    assert.throws(() => contactEffect({ ...input, contact: { ...input.contact, address: { kind: "unspecified" } } }), isRefusal("address-choice-unresolved"));
    const same = { kind: "same-as-employee" as const, fields: savedAddress };
    assert.deepEqual(contactEffect({ ...input, contact: { ...input.contact, address: same } }).address, same);
  });

  it("requires the whole exact effect for already-present, including phone, address, relationship and primary", () => {
    assert.deepEqual(decideContactAddition(interpretContactPage(savedPage, input), effect), { state: "already-present", rowIndex: 1 });
    for (const row of [
      { ...savedRow, relationship: "Spouse" }, { ...savedRow, phone: "2025550198" },
      { ...savedRow, primary: true }, { ...savedRow, sameAddressAsEmployee: true },
      { ...savedRow, address: { ...savedAddress, address1: "456 Different Street" } },
    ]) {
      const decision = decideContactAddition(setFromRows([{ ...row, rowIndex: 0 }]), effect);
      assert.equal(decision.state === "conflict" && decision.code, "contact-conflict");
    }
  });

  it("reports duplicate/similar names, multiple primaries, primary changes and ambiguous blanks without resolving them", () => {
    for (const name of [savedRow.name, "Morgam Example"]) {
      const decision = decideContactAddition(setFromRows([{ ...savedRow, rowIndex: 0 }, { ...savedRow, name, rowIndex: 1 }]), effect);
      assert.equal(decision.state === "conflict" && decision.code, "ambiguous-contact");
    }
    const similar = decideContactAddition(setFromRows([{ ...savedRow, name: "Morgam Example", rowIndex: 0 }]), effect);
    assert.equal(similar.state === "conflict" && similar.code, "contact-conflict");
    const multiple = decideContactAddition(setFromRows([
      { ...savedRow, name: "Unrelated One", primary: true, rowIndex: 0 },
      { ...savedRow, name: "Unrelated Two", primary: true, rowIndex: 1 },
    ]), effect);
    assert.equal(multiple.state === "conflict" && multiple.code, "multiple-primary-contacts");
    const primary = decideContactAddition(before, { ...effect, primary: true });
    assert.equal(primary.state === "conflict" && primary.code, "primary-change-required");
    const blank = page.rows[1];
    const ambiguous = decideContactAddition(setFromRows([{ ...blank, rowIndex: 0 }, blank]), effect);
    assert.equal(ambiguous.state === "conflict" && ambiguous.code, "ambiguous-blank-rows");
  });

  it("reuses the exact blank row, fills name last and preserves every existing contact", async () => {
    const port = createDeterministicUcpathContactPage({ initial: page });
    const staged = await stageContactAdditionWithPort(port, input, addition);
    assert.equal(staged.observation, "staged");
    assert.deepEqual(staged.rows[0], before.rows[0]);
    assert.deepEqual(staged.rows[1], { kind: "contact", rowIndex: 1, effect });
    assert.deepEqual(port.actions.filter(action => action.startsWith("fill")), ["fill-fields:1", "fill-name:1"]);
    assert.ok(!port.actions.includes("add-row"));
    assert.ok(!("save" in port) && !("commit" in port) && !("demote" in port));
  });

  it("adds a row only when none is blank and resolves its new index before filling", async () => {
    const initial = { ...page, totalRows: 1, rows: page.rows.slice(0, 1) };
    const decision = decideContactAddition(interpretContactPage(initial, input), effect);
    assert.equal(decision.state, "add");
    assert.equal(decision.target.kind, "insert-row");
    const port = createDeterministicUcpathContactPage({ initial });
    const staged = await stageContactAdditionWithPort(port, input, decision);
    assert.deepEqual(staged.rows[0], { kind: "contact", rowIndex: 0, effect });
    assert.deepEqual(staged.rows[1], { ...before.rows[0], rowIndex: 1 });
    assert.deepEqual(port.actions.filter(action => action.startsWith("fill") || action === "add-row"), ["add-row", "fill-fields:0", "fill-name:0"]);
  });

  it("never uses a name on another row to cover target name loss or wrong field readback", async () => {
    const afterName = { ...savedPage, observation: "staged" as const, rows: [page.rows[0], { ...savedRow, name: "" }] };
    const lost = createDeterministicUcpathContactPage({ initial: page, afterName });
    await assert.rejects(stageContactAdditionWithPort(lost, input, addition), isRefusal("contact-name-lost"));
    const wrongFields = createDeterministicUcpathContactPage({ initial: page, afterName: {
      ...savedPage, observation: "staged", rows: [page.rows[0], { ...savedRow, phone: "2025550198" }],
    } });
    await assert.rejects(stageContactAdditionWithPort(wrongFields, input, addition), isRefusal("staged-effect-mismatch"));
  });

  it("rechecks independent identity and protected rows after a postback before filling the name", async () => {
    for (const [afterFields, code] of [
      [{ ...savedPage, displayedEid: "10000002" }, "contact-subject-mismatch"],
      [{ ...savedPage, rows: [{ ...page.rows[0], primary: false }, { ...savedRow, name: "" }] }, "contact-set-changed"],
    ] as const) {
      const port = createDeterministicUcpathContactPage({ initial: page, afterFields: UcpathContactPageSnapshotSchema.parse(afterFields) });
      await assert.rejects(stageContactAdditionWithPort(port, input, addition), isRefusal(code));
      assert.ok(!port.actions.includes("fill-name:1"));
    }
  });

  it("refuses a new blank row or changed primary introduced by the final postback", async () => {
    for (const rows of [
      [page.rows[0], savedRow, { ...page.rows[1], rowIndex: 2 }],
      [{ ...page.rows[0], primary: false }, savedRow],
    ]) {
      const port = createDeterministicUcpathContactPage({ initial: page, afterName: {
        ...savedPage, observation: "staged", totalRows: rows.length, rows,
      } });
      await assert.rejects(stageContactAdditionWithPort(port, input, addition), isRefusal("staged-effect-mismatch"));
    }
  });

  it("compares a fresh persisted whole effect with protected rows, never a staged/name-only observation", () => {
    const after = interpretContactPage(savedPage, input);
    assert.equal(compareSavedContactAddition(before, after, effect), "present");
    const upper = interpretContactPage({ ...savedPage, rows: [page.rows[0], { ...savedRow, name: "MORGAN  EXAMPLE" }] }, input);
    assert.equal(compareSavedContactAddition(before, upper, effect), "present");
    assert.equal(compareSavedContactAddition(before, { ...before, observedAt: after.observedAt }, effect), "absent");
    assert.equal(compareSavedContactAddition(before, { ...after, observation: "staged" }, effect), "unknown");
    assert.equal(compareSavedContactAddition(before, { ...after, observedAt: before.observedAt }, effect), "unknown");
    assert.equal(compareSavedContactAddition(before, { ...after, emplId: EidSchema.parse("10000002") }, effect), "unknown");
    const duplicate = setFromRows([page.rows[0], savedRow, { ...savedRow, rowIndex: 2 }]);
    assert.equal(compareSavedContactAddition(before, { ...duplicate, observedAt: after.observedAt }, effect), "ambiguous");
    for (const rows of [
      [{ ...page.rows[0], primary: false }, savedRow],
      [{ ...page.rows[0], name: "TAYLOR SAMPLE" }, savedRow],
      [page.rows[0], { ...savedRow, phone: "2025550198" }],
      [page.rows[0], { ...savedRow, address: null }],
      [page.rows[0], savedRow, { ...page.rows[1], rowIndex: 2 }],
    ]) assert.equal(compareSavedContactAddition(before, { ...setFromRows(rows), observedAt: after.observedAt }, effect), "unknown");
  });

  it("has a sanitized fixture for every named structural or staging refusal", async () => {
    const seen = new Set<UcpathContactRefusalCode>();
    async function rejects(code: UcpathContactRefusalCode, action: () => unknown) {
      await assert.rejects(async () => action(), isRefusal(code));
      seen.add(code);
    }
    await rejects("unexpected-contact-page", () => interpretContactPage({ ...page, pageStateId: "search" }, input));
    await rejects("contact-identity-unreadable", () => interpretContactPage({ ...page, displayedEid: "" }, input));
    await rejects("contact-subject-mismatch", () => interpretContactPage({ ...page, displayedEid: "10000002" }, input));
    await rejects("contact-name-mismatch", () => interpretContactPage({ ...page, displayedName: "Somebody Else" }, input));
    await rejects("contact-set-incomplete", () => interpretContactPage({ ...page, totalRows: 3 }, input));
    await rejects("unreadable-contact-row", () => setFromRows([{ ...savedRow, rowIndex: 0, phone: "bad" }]));
    await rejects("relationship-unmapped", () => contactEffect({ ...input, contact: { ...input.contact, relationship: "unknown relationship" } }));
    await rejects("address-choice-unresolved", () => contactEffect({ ...input, contact: { ...input.contact, address: { kind: "unspecified" } } }));
    const changed = createDeterministicUcpathContactPage({ initial: { ...page, rows: [{ ...page.rows[0], phone: "2025550198" }, page.rows[1]] } });
    await rejects("contact-set-changed", () => stageContactAdditionWithPort(changed, input, addition));
    await rejects("contact-plan-refused", () => stageContactAdditionWithPort(createDeterministicUcpathContactPage({ initial: page }), input, { ...addition, target: { kind: "reuse-blank", rowIndex: 0 } }));
    const full = { ...page, rows: page.rows.slice(0, 1), totalRows: 1 };
    const insert = decideContactAddition(interpretContactPage(full, input), effect);
    assert.equal(insert.state, "add");
    await rejects("blank-row-unavailable", () => stageContactAdditionWithPort(createDeterministicUcpathContactPage({ initial: full, afterAdd: full }), input, insert));
    await rejects("contact-name-lost", () => stageContactAdditionWithPort(createDeterministicUcpathContactPage({ initial: page, afterName: page }), input, addition));
    await rejects("staged-effect-mismatch", () => stageContactAdditionWithPort(createDeterministicUcpathContactPage({ initial: page, afterFields: {
      ...savedPage, rows: [page.rows[0], { ...savedRow, name: "", phone: "2025550198" }],
    } }), input, addition));
    assert.deepEqual([...seen].sort(), [...UcpathContactRefusalCodeSchema.options].sort());
    assert.notEqual(contactSetFingerprint(before), contactSetFingerprint(interpretContactPage(savedPage, input)));
  });
});
