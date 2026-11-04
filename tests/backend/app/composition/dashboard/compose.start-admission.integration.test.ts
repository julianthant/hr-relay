import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { composeDashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { readSettings } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import { StartPlanWireSchema } from "../../../../../src/models/dashboard/start-plan.js";
import { WireErrorSchema } from "../../../../../src/models/dashboard/primitives.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { PreflightObservationChangedError } from "../../../../../src/rules/preflight/preflight-admission.js";
import { RuntimeCustodyUncertainError } from "../../../../../src/backend/app/composition/storage-compose.js";

async function fixture(realDoctor = false) {
  const profile = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(profile.workspace, name));
  const runtime = composeProfileRuntime({ admission: profile.machine, clock, hostFacts: { primaryDisplay: null } });
  const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.equal(active.state, "active");
  if (active.state !== "active") throw new Error("profile activation required");
  const context = runtime.selectedContext(active.token);
  let doctorRace = false;
  const detectorErrors: unknown[] = [];
  let spawns = 0;
  try {
    const dashboard = await composeDashboardRuntime({ lifetimeLock: profile.lifetime, admission: profile.machine, profile: { runtime, token: active.token },
      repoRoot: profile.workspace, clock, isolation: rebuildRuntimeIsolation, env: {}, backendPortOverride: 0, frontendPortOverride: 0,
      preflightRunnerFactory: input => healthyRuntimePreflightRunners(input).map(runner => !realDoctor || runner.check !== "authority.health" ? runner : {
        ...runner, async run(check) {
          const checking = input.dashboard.authorityHealth.run(check);
          if (doctorRace) context.database.authority.notifications.create({ notificationId: randomUUID(), actorId: "local-operator", dedupeFingerprint: "e".repeat(64),
            trigger: "failed", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: "Fixture notice", summary: "Concurrent fixture write",
            links: [{ kind: "run", runId: "00010001-0001-4001-8001-000100010001" }], count: 1, lastSeenAt: clock.now().toISOString(), version: 1,
            createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() });
          try { return await checking; } catch (error) { detectorErrors.push(error); throw error; }
        },
      }),
      workerProcess: { spawn: () => { spawns += 1; throw new Error("refused start must not spawn a worker"); } } });
    const origin = `http://127.0.0.1:${String(dashboard.port)}`;
    return { clock, context, spawns: () => spawns, detectorErrors, armDoctorRace() { doctorRace = true; },
      post: (path: string, input: unknown) => fetch(`${origin}/api/v1/${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input) }),
      async close() { try { await dashboard.stop(); } finally { await profile.close(); } } };
  } catch (error) { await runtime.close(); await profile.close(); throw error; }
}

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
]) it(`reports a real changed doctor observation while planning ${input.workflowId} before enqueue or browser effects`, async () => {
  const f = await fixture(true);
  try {
    const control = await f.post("start-plans", input);
    assert.equal(control.status, 200); assert.deepEqual(StartPlanWireSchema.parse(await control.json()).refused, []);
    f.armDoctorRace();
    const response = await f.post("start-plans", input);
    assert.equal(response.status, 409);
    assert.equal(WireErrorSchema.parse(await response.json()).code, "PREFLIGHT_OBSERVATION_CHANGED");
    assert.equal(f.detectorErrors.length, 1); assert.ok(f.detectorErrors[0] instanceof PreflightObservationChangedError);
    assert.deepEqual(f.context.database.authority.runs.listByWorkflow(input.workflowId), []); assert.equal(f.spawns(), 0);
  } finally { await f.close(); }
});

for (const input of [
  { workflowId: "person-lookup", submissions: [{ emplId: "10873698" }], dryRun: false },
  { workflowId: "separations", submissions: [{ documentNumber: "4510" }], dryRun: true },
]) it(`truthfully confirms the queued ${input.workflowId} run when its real doctor race refuses worker startup`, async () => {
  const f = await fixture(true);
  try {
    const planned = await f.post("start-plans", input); assert.equal(planned.status, 200);
    const plan = StartPlanWireSchema.parse(await planned.json()); f.armDoctorRace();
    const command = { commandId: randomUUID(), family: "start", type: "start-run", requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "run-start",
      target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints };
    const response = await f.post("commands", command); assert.equal(response.status, 200);
    const result = CommandResultSchema.parse(await response.json()); assert.equal(result.state, "applied");
    if (result.state !== "applied") throw new Error("the enqueue committed before worker admission");
    assert.equal(result.workerStartup?.state, "refused"); assert.equal(result.workerStartup?.code, "RUN_QUEUED_WORKER_UNAVAILABLE");
    assert.equal(f.detectorErrors.length, 1); assert.ok(f.detectorErrors[0] instanceof PreflightObservationChangedError);
    const runs = f.context.database.authority.runs.listByWorkflow(input.workflowId);
    assert.equal(runs.length, 1); assert.equal(runs[0]?.lifecycle.state, "queued"); assert.equal(f.spawns(), 0);
    assert.ok(result.affectedTargets.some(target => target.family === "run" && target.runId === runs[0]?.envelope.runId));
    const replay = CommandResultSchema.parse(await (await f.post("commands", command)).json());
    assert.equal(replay.state, "already-applied");
    if (replay.state !== "already-applied") throw new Error("an exact replay must retain the original enqueue");
    assert.equal(replay.workerStartup?.commandId, result.workerStartup?.commandId);
    assert.equal(f.detectorErrors.length, 1); assert.equal(f.spawns(), 0);
    assert.deepEqual(f.context.database.authority.runs.listByWorkflow(input.workflowId), runs);
  } finally {
    await assert.rejects(f.close(), (error: unknown) => {
      assert.ok(error instanceof RuntimeCustodyUncertainError);
      const messages = (value: unknown): string[] => value instanceof AggregateError
        ? [value.message, ...value.errors.flatMap(messages)] : value instanceof Error ? [value.message] : [];
      assert.ok(messages(error).includes("profile-worker-lifetime-unavailable"));
      return true;
    });
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
