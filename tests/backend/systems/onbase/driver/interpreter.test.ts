import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { createOnbaseDriver } from "../../../../../src/backend/systems/onbase/driver/interpreter.js";
import { ONBASE_EXAMPLE_TARGET, OnbaseImportError, ONBASE_DISPLAYED_EID, OnbaseTargetSchema } from "../../../../../src/models/systems/onbase/import-document.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { fakeOnbasePage } from "../../../../support/helpers/browser/fake-onbase-page.js";
import { mintMutationCapability } from "../../../../../src/workflow-kit/mutation-capability.js";
import { FingerprintSchema, PositiveIntSchema } from "../../../../../src/rules/identity/ids.js";

const bytes = Buffer.from("one selected scanned page"), target = OnbaseTargetSchema.parse({ ...ONBASE_EXAMPLE_TARGET, pageSha256: createHash("sha256").update(bytes).digest("hex") });
const clock = manualClock(new Date("2026-11-02T12:00:00Z"));
const capability = () => mintMutationCapability(PositiveIntSchema.parse(1), FingerprintSchema.parse("a".repeat(64)));
const world = (options: Parameters<typeof fakeOnbasePage>[0] = {}) => {
  const fixture = fakeOnbasePage(options), driver = createOnbaseDriver(() => undefined, fixture.page, clock);
  driver.bindSourcePage(target, bytes); return { ...fixture, driver };
};

describe("OnBase semantic import driver", () => {
  it("clears queue residue, uses the lookup modal, verifies every keyword and stages one page without a save", async () => {
    const f = world({ queue: 2 });
    assert.equal((await f.driver.prepareImport(target)).observedEid, target.ucpathId);
    assert.equal(await f.driver.read(ONBASE_DISPLAYED_EID), target.ucpathId);
    assert.equal(f.queued.length, 1); assert.deepEqual(f.queued[0]?.buffer, bytes);
    assert.equal(f.actions.filter(action => action === "click:Remove").length, 2);
    assert.ok(f.actions.includes("click:Select Employee")); assert.ok(f.actions.includes("fill:lookup:UCPath ID"));
    assert.equal(f.actions.includes("click:Import"), false);
  });

  it.each([{ noMatch: true }, { stalled: true }, { eid: "10800001" }, { blankDepartment: true }])("refuses missing, stalled or wrong-identity keysets before Import: %j", async options => {
    const f = world(options);
    await assert.rejects(f.driver.prepareImport(target));
    assert.equal(f.actions.includes("click:Import"), false);
  });

  it("requires the real mutation token, consumes staging before the single click, and checks drift", async () => {
    const f = world(); await f.driver.prepareImport(target);
    await assert.rejects(f.driver.commitImport(target, {} as ReturnType<typeof capability>));
    assert.equal(f.actions.includes("click:Import"), false);
    f.fields.set("form:UCPath ID", "10800001");
    await assert.rejects(f.driver.commitImport(target, capability()), OnbaseImportError);
    assert.equal(f.actions.includes("click:Import"), false);
    const good = world(); await good.driver.prepareImport(target); await good.driver.commitImport(target, capability());
    await assert.rejects(good.driver.commitImport(target, capability()), OnbaseImportError);
    assert.equal(good.actions.filter(action => action === "click:Import").length, 1);
    assert.equal((await good.driver.readSavedImport(target)).state, "present");
  });

  it("a lost click acknowledgement never permits another click and can be reconciled by saved-PDF read-back", async () => {
    const f = world({ lostClick: true }); await f.driver.prepareImport(target);
    await assert.rejects(f.driver.commitImport(target, capability()), /acknowledgement lost/u);
    await assert.rejects(f.driver.commitImport(target, capability()), OnbaseImportError);
    assert.equal((await f.driver.readSavedImport(target)).state, "present");
    assert.equal(f.actions.filter(action => action === "click:Import").length, 1);
  });

  it("proves exact saved bytes, distinguishes complete absence, duplicate matches and incomplete retrieval", async () => {
    assert.equal((await world().driver.readSavedImport(target)).state, "absent");
    assert.equal((await world({ saved: [{ id: "1", eid: target.ucpathId, bytes: Buffer.from("another form") }] }).driver.readSavedImport(target)).state, "absent");
    const saved = [{ id: "1", eid: target.ucpathId, bytes }, { id: "2", eid: target.ucpathId, bytes }];
    assert.equal((await world({ saved }).driver.readSavedImport(target)).state, "ambiguous");
    assert.equal((await world({ incomplete: true }).driver.readSavedImport(target)).state, "unknown");
    for (const saved of [[{ id: "1", eid: "10800001", bytes }], [{ id: "1", eid: target.ucpathId, bytes, href: "https://example.test/foreign.pdf" }]]) {
      const f = world({ saved }); await assert.rejects(f.driver.readSavedImport(target), OnbaseImportError);
      assert.equal(f.actions.some(action => action.startsWith("download:")), false);
    }
  });

  it("fails revoked authority and foreign application routes before page actions", async () => {
    const f = fakeOnbasePage(), driver = createOnbaseDriver(() => { throw new Error("authority revoked"); }, f.page, clock);
    assert.throws(() => driver.bindSourcePage(target, bytes), /authority revoked/u);
    await assert.rejects(world({ foreignRoute: true }).driver.prepareImport(target), OnbaseImportError);
    assert.equal(f.actions.length, 0);
  });
});
