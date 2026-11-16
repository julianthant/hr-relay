import { startAdmissionFixture as fixture } from "../../../../support/helpers/backend/start-admission-world.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it, vi } from "vitest";
import { readSettings } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import { StartPlanWireSchema } from "../../../../../src/models/dashboard/start-plan.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";


for (const input of [
  { workflowId: "person-lookup", submissions: [{ emplId: "10873698" }], dryRun: false },
  { workflowId: "separations", submissions: [{ documentNumber: "4510" }], dryRun: true },
]) it(`signed-in dashboard plans ${input.workflowId} with its current Settings and no worker or write effects`, async () => {
  const f = await fixture();
  try {
    const db = f.context.database, active = db.authority.runtimeConfig.get(); assert.ok(active);
    const snapshots = db.authority.configSnapshots.get(active.configSnapshotId);
    const response = await f.post("start-plans", input);
    assert.equal(response.status, 200);
    const plan = StartPlanWireSchema.parse(await response.json());
    assert.deepEqual(plan.refused, []);
    assert.equal(plan.configSnapshotId, active.configSnapshotId);
    assert.equal(plan.fingerprints.configFingerprint, active.configFingerprint);
    const stored = db.authority.startPlans.get(plan.startPlanId); assert.ok(stored);
    assert.equal(stored.dryRun, input.dryRun);
    assert.equal(stored.configSnapshotId, active.configSnapshotId);
    assert.deepEqual(db.authority.configSnapshots.get(active.configSnapshotId), snapshots);
    assert.deepEqual(db.authority.runs.listByWorkflow(input.workflowId), []);
    assert.deepEqual(db.authority.workerSlots.list(input.workflowId), []);
    assert.equal(f.spawns(), 0);
  } finally { await f.close(); }
});

for (const input of [
  { workflowId: "person-lookup", submissions: [{ emplId: "10873698" }], dryRun: false },
  { workflowId: "separations", submissions: [{ documentNumber: "4510" }], dryRun: true },
]) it(`plans ${input.workflowId} while the owner writes the authority during its doctor pass`, async () => {
  const f = await fixture(true);
  try {
    const control = await f.post("start-plans", input);
    assert.equal(control.status, 200); assert.deepEqual(StartPlanWireSchema.parse(await control.json()).refused, []);
    f.armDoctorRace();
    const response = await f.post("start-plans", input);
    assert.equal(response.status, 200); assert.deepEqual(StartPlanWireSchema.parse(await response.json()).refused, []);
    assert.deepEqual(f.detectorErrors, []);
    assert.equal(f.context.database.authority.notifications.listByActor("local-operator").length > 0, true, "the race write must land");
    assert.deepEqual(f.context.database.authority.runs.listByWorkflow(input.workflowId), []); assert.equal(f.spawns(), 0);
  } finally { await f.close(); }
});

for (const input of [
  { workflowId: "person-lookup", submissions: [{ emplId: "10873698" }], dryRun: false },
  { workflowId: "separations", submissions: [{ documentNumber: "4510" }], dryRun: true },
]) it(`starts the queued ${input.workflowId} worker while the owner writes the authority during its doctor pass`, async () => {
  const f = await fixture(true);
  try {
    const planned = await f.post("start-plans", input); assert.equal(planned.status, 200);
    const plan = StartPlanWireSchema.parse(await planned.json()); f.armDoctorRace();
    const command = { commandId: randomUUID(), family: "start", type: "start-run", requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "run-start",
      target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints };
    const response = await f.post("commands", command); assert.equal(response.status, 200);
    const result = CommandResultSchema.parse(await response.json()); assert.equal(result.state, "applied");
    if (result.state !== "applied") throw new Error("the enqueue committed before worker admission");
    assert.equal(result.workerStartup, undefined, "Start replies before its worker starts");
    // After the reply, preflight passes and startup reaches the fixture spawner, which refuses every spawn.
    await vi.waitFor(() => assert.equal(f.startupFaults().length, 1));
    assert.deepEqual(f.detectorErrors, []); assert.equal(f.spawns(), 1);
    assert.equal(f.context.database.authority.notifications.listByActor("local-operator").length > 0, true, "the race write must land");
    assert.equal(f.context.database.authority.workerSlots.active(input.workflowId).length, 1);
    const runs = f.context.database.authority.runs.listByWorkflow(input.workflowId);
    assert.equal(runs.length, 1); assert.equal(runs[0]?.lifecycle.state, "queued");
    assert.ok(result.affectedTargets.some(target => target.family === "run" && target.runId === runs[0]?.envelope.runId));
    const replay = CommandResultSchema.parse(await (await f.post("commands", command)).json());
    assert.equal(replay.state, "already-applied");
    if (replay.state !== "already-applied") throw new Error("an exact replay must retain the original enqueue");
    // A replay asks for worker capacity again; it reaches the refusing spawner a second time.
    assert.equal(replay.workerStartup, undefined);
    await vi.waitFor(() => assert.equal(f.startupFaults().length, 2));
    assert.deepEqual(f.detectorErrors, []); assert.equal(f.spawns(), 2);
    assert.deepEqual(f.context.database.authority.runs.listByWorkflow(input.workflowId), runs);
  } finally {
    await f.close();
  }
});

for (const input of [
  { workflowId: "person-lookup", submissions: [{ emplId: "10873698" }], dryRun: false },
  { workflowId: "separations", submissions: [{ documentNumber: "4510" }], dryRun: true },
]) it(`refuses an old ${input.workflowId} Run confirmation after an actual Settings command without spawning or rewriting its reviewed plan`, async () => {
  const f = await fixture();
  try {
    const db = f.context.database;
    const proposed = await f.post("start-plans", input);
    assert.equal(proposed.status, 200);
    const plan = StartPlanWireSchema.parse(await proposed.json());
    const stored = db.authority.startPlans.get(plan.startPlanId);
    const patch = { "browser.headless": { set: false } };
    const saved = await f.post("commands", { commandId: randomUUID(), family: "settings", type: "apply-settings",
      target: { expectedRevision: readSettings(db.authority).revision }, requestedAt: f.clock.now().toISOString(),
      requestedBy: "local-operator", source: "settings-surface", payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch), patch } });
    assert.equal(CommandResultSchema.parse(await saved.json()).state, "applied");
    const response = await f.post("commands", { commandId: randomUUID(), family: "start", type: "start-run",
      requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "run-start",
      target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints });
    const result = CommandResultSchema.parse(await response.json());
    assert.equal(result.state, "rejected");
    if (result.state !== "rejected") throw new Error("old configuration requires a new plan");
    assert.equal(result.code, "replan-required");
    assert.deepEqual(db.authority.startPlans.get(plan.startPlanId), stored);
    assert.deepEqual(db.authority.runs.listByWorkflow(input.workflowId), []);
    assert.equal(f.spawns(), 0);
  } finally { await f.close(); }
});

it("stops the dashboard while a Start's worker preflight is pending: the preflight aborts and the startup settles, reported once, before the stop returns", async () => {
  const f = await fixture(false, { holdWorkerPreflight: true });
  const input = { workflowId: "person-lookup", submissions: [{ emplId: "10873698" }], dryRun: false };
  try {
    const plan = StartPlanWireSchema.parse(await (await f.post("start-plans", input)).json());
    const command = { commandId: randomUUID(), family: "start", type: "start-run", requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "run-start",
      target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints };
    const result = CommandResultSchema.parse(await (await f.post("commands", command)).json());
    assert.equal(result.state, "applied");
    await vi.waitFor(() => assert.equal(f.workerPreflightsHeld(), 1));
    assert.equal(f.startupFaults().length, 0);
  } catch (error) { await f.close(); throw error; }
  await f.close();
  assert.equal(f.startupFaults().length, 1);
  assert.equal(f.spawns(), 0);
});
