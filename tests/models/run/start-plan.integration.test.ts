import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { derivePlannedInputFingerprint,StartPlanRecordSchema } from "../../../src/models/run/start-plan.js";
import { launchHarness } from "../../support/fixtures/run-launch-fixtures.js";

const cleanup: (() => void)[] = [];
afterEach(() => { for (const dispose of cleanup.splice(0)) dispose(); });
function setup() { const h = launchHarness("supersede-active"); cleanup.push(h.dispose); return h; }
describe("start-specific supersede review is atomic", () => {
  it("unconsumed plans without review basis stay readable but require replanning", () => {
    const h = setup(); const wire = h.proposal(); const record = h.database.authority.startPlans.get(wire.startPlanId); assert.ok(record);
    const planned = record.planned.map(({ supersedeTargets: _targets, ...entry }) => entry);
    const old = StartPlanRecordSchema.parse({ ...record, startPlanId: h.planIds.uuid(), planned,
      inputFingerprint: derivePlannedInputFingerprint(planned, record.ingressSchemaHash, record.canonicalInputSchemaHash) });
    h.database.authority.startPlans.create(old);
    const result = h.kernel.execute(h.command({ ...wire, startPlanId: old.startPlanId, fingerprints: { ...wire.fingerprints, inputFingerprint: old.inputFingerprint } }));
    assert.ok(result.state === "rejected"); assert.equal(result.code, "replan-required"); assert.equal(h.queueRoots.length, 0);
  });

});


it("current start-plan readers reject the removed workers choice", () => {
  const h = setup(); const wire = h.proposal();
  const record = h.database.authority.startPlans.get(wire.startPlanId); assert.ok(record);
  assert.equal(StartPlanRecordSchema.safeParse(record).success, true);
  for (const workers of ["auto", 1, 8]) {
    assert.equal(StartPlanRecordSchema.safeParse({ ...record, workers }).success, false);
  }
});
