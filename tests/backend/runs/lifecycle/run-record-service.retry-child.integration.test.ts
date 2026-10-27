import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach,it } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../src/backend/runs/settings/run-settings.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); });
async function fixture() { const f = await settingsFixture(); cleanups.push(f.close); return f; }
for (const operation of ["retry", "restart"] as const) it(`${operation} selects saved configuration without changing inputs or source and replays exactly`, async () => {
  const f = await fixture(); const source = f.create();
  const terminal = requireLifecycleApplied(f.service.transition({ commandId: randomUUID(), runId: source.envelope.runId,
    expectedVersion: source.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: f.clock.now().toISOString() } }));
  assert.equal(f.save({ "timeouts.taskMs": { set: 90_000 } }).state, "applied");
  const request = { commandId: randomUUID(), runId: terminal.envelope.runId, expectedVersion: terminal.version,
    runtimeConfig: selectRunRuntime(f.database.authority) };
  const next = requireLifecycleApplied(f.service[operation](request, personLookupDescriptor));
  assert.equal(next.envelope.configSnapshotId, f.database.authority.runtimeConfig.get()?.configSnapshotId);
  assert.notEqual(next.envelope.configSnapshotId, terminal.envelope.configSnapshotId);
  assert.deepEqual(next.input, source.input); assert.equal(next.envelope.dryRun, source.envelope.dryRun);
  assert.deepEqual(next.envelope.resolvedInstance, source.envelope.resolvedInstance);
  assert.equal(next.envelope.retryOf, source.envelope.runId);
  assert.deepEqual(f.database.authority.runs.get(source.envelope.runId), terminal);
  f.save({ "timeouts.taskMs": { set: 120_000 } });
  const generation = f.database.getMeta().authorityGeneration;
  assert.deepEqual(requireLifecycleApplied(f.service[operation](request, personLookupDescriptor)), next);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
});
it("a later parent-linked creation selects current settings while the existing parent retains its own", async () => {
  const f = await fixture(); const parent = f.create();
  f.save({ "timeouts.taskMs": { set: 90_000 } });
  const child = f.create({ parent: { runId: parent.envelope.runId, tracePrefix: parent.envelope.traceId, edgeId: "members" }, matchKey: "child" });
  assert.equal(child.envelope.configSnapshotId, f.database.authority.runtimeConfig.get()?.configSnapshotId);
  assert.notEqual(child.envelope.configSnapshotId, parent.envelope.configSnapshotId);
  assert.deepEqual(f.database.authority.runs.get(parent.envelope.runId), parent);
  assert.deepEqual(child.envelope.parent, { runId: parent.envelope.runId, tracePrefix: parent.envelope.traceId, edgeId: "members" });
  assert.equal(f.service.create(f.request({ parent: { runId: randomUUID(), tracePrefix: parent.envelope.traceId, edgeId: "members" } })).state, "refused");
});
