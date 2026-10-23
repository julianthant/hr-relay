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
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { SETTINGS_SCHEMA_HASH, deriveSettingsPatchFingerprint } from "../../../../../src/models/config/settings.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";

async function fixture() {
  const profile = createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(profile.workspace, name));
  const runtime = composeProfileRuntime({ admission: profile.machine, clock, hostFacts: { primaryDisplay: null },
    processLockRoot: join(profile.workspace, rebuildRuntimeIsolation.processLockRoot) });
  const active = runtime.session.signIn({ email: "fixture@example.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.equal(active.state, "active");
  if (active.state !== "active") throw new Error("profile activation required");
  let spawns = 0;
  try {
    const dashboard = await composeDashboardRuntime({ admission: profile.machine, profile: { runtime, token: active.token },
      repoRoot: profile.workspace, clock, isolation: rebuildRuntimeIsolation, env: {}, backendPortOverride: 0, frontendPortOverride: 0,
      preflightRunnerFactory: healthyRuntimePreflightRunners,
      workerProcess: { spawn: () => { spawns += 1; throw new Error("refused start must not spawn a worker"); } } });
    const origin = `http://127.0.0.1:${String(dashboard.port)}`;
    return { clock, context: runtime.selectedContext(active.token), spawns: () => spawns,
      post: (path: string, input: unknown) => fetch(`${origin}/api/v1/${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input) }),
      async close() { try { await dashboard.stop(); } finally { profile.close(); } } };
  } catch (error) { await runtime.close(); profile.close(); throw error; }
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

it("refuses an old Run confirmation after an actual Settings command without spawning or rewriting its reviewed plan", async () => {
  const f = await fixture();
  try {
    const db = f.context.database;
    const proposed = await f.post("start-plans", { workflowId: "person-lookup", submissions: [{ emplId: "10873698" }], dryRun: false });
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
    assert.deepEqual(db.authority.runs.listByWorkflow("person-lookup"), []);
    assert.equal(f.spawns(), 0);
  } finally { await f.close(); }
});
