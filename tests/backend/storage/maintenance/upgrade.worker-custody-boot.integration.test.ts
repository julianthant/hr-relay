import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it, vi } from "vitest";
import { composeDashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { composeProfileRuntime, initializeRegisteredPersonStores, restoreNewestPersonBackup } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { acquireSharedRuntimeAdmission, RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { inspectNativeAuthority } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CURRENT_AUTHORITY_SCHEMA_VERSION, isWorkerCustodyDroppedTable } from "../../../../src/backend/storage/sqlite/migrations.js";
import { AuthorityBackupManifestSchema } from "../../../../src/backend/storage/sqlite/recovery-contracts.js";
import { StartPlanWireSchema } from "../../../../src/models/dashboard/start-plan.js";
import { CommandResultSchema } from "../../../../src/rules/commands/commands.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { healthyRuntimePreflightRunners } from "../../../support/fixtures/preflight-seams.js";
import { restoreSchema22WorkerCustodyFixture } from "../../../support/fixtures/storage/historical-run-schema.js";
import { releaseAdmissionFixture, releaseAdmissionFixtures } from "../../../support/helpers/admission-fixture.js";
import { createDashboardChildTestWorld, fixtureWorkerLaunch, type RealChildRecord } from "../../../support/helpers/backend/dashboard-child-world.js";
import { startAdmissionFixture } from "../../../support/helpers/backend/start-admission-world.js";
import { takeStoppedProfileBackupFixture } from "../../../support/helpers/storage/backup-fixtures.js";

const children = createDashboardChildTestWorld(() => { releaseAdmissionFixtures(); }, root => { releaseAdmissionFixture(root); });
afterEach(children.cleanup, 30_000);

const hostFacts = { primaryDisplay: null };
const login = { email: "fixture@ucsd.edu", password: "disposable-fixture-password" };
const START = { workflowId: "person-lookup", submissions: [{ emplId: "10873698" }], dryRun: false };

function startCommand(plan: ReturnType<typeof StartPlanWireSchema.parse>, requestedAt = systemClock.now().toISOString()) {
  return { commandId: randomUUID(), family: "start", type: "start-run", requestedAt, requestedBy: "local-operator", source: "run-start",
    target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints };
}

function query<T>(path: string, read: (raw: DatabaseSync) => T): T {
  const raw = new DatabaseSync(path, { readOnly: true });
  try { return read(raw); } finally { raw.close(); }
}

it("boots a person restored from a schema-21 backup through the startup upgrade, then one worker runs a new start to done with no custody refusal", async () => {
  // A queued run whose worker never started, left by a stopped build.
  const before = await startAdmissionFixture();
  const { workspace, path, stateRoot } = before.profile, profileId = before.profile.admission.profileBinding.profileId;
  children.cleanups.push(() => before.profile.close());
  const plan = StartPlanWireSchema.parse(await (await before.post("start-plans", START)).json());
  const queued = CommandResultSchema.parse(await (await before.post("commands", startCommand(plan, before.clock.now().toISOString()))).json());
  assert.ok(queued.state === "applied" && queued.workerStartup === undefined, JSON.stringify(queued));
  // The refusing spawner fails the start after the reply; let it settle before the dashboard stops.
  await vi.waitFor(() => assert.equal(before.startupFaults().length, 1));
  const [stale] = before.context.database.authority.runs.listByWorkflow("person-lookup");
  assert.ok(stale?.lifecycle.state === "queued");
  await before.dashboard.stop(); await before.runtime.close(); await before.profile.closeController();
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  children.cleanups.push(() => lifetime.close());
  assert.ok(![3938, 3939, 5174].includes(lifetime.port));
  // A schema-21 file admits only through the startup upgrade, so the stopped backup keeps an admission bound before the rewind.
  const stopped = acquireEntrypointAdmission(workspace, "exclusive", lifetime), owner = stopped.admitProfile(profileId);

  const raw = new DatabaseSync(path);
  try {
    raw.exec("PRAGMA foreign_keys=ON; BEGIN EXCLUSIVE; PRAGMA defer_foreign_keys=ON");
    restoreSchema22WorkerCustodyFixture(raw);
    raw.exec("UPDATE database_states SET schema_version=21; PRAGMA user_version=21; COMMIT");
    assert.equal(inspectNativeAuthority(raw, 21).schemaVersion, 21);
  } finally { raw.close(); }

  const backups = join(stateRoot, "backups", "authority");
  const manifests = () => readdirSync(backups).filter(name => name.endsWith(".manifest.json")).map(name => AuthorityBackupManifestSchema.parse(JSON.parse(readFileSync(join(backups, name), "utf8"))));
  try {
    assert.equal((await takeStoppedProfileBackupFixture(owner, systemClock)).state, "verified");
    assert.deepEqual(manifests().map(manifest => manifest.schemaVersion), [21]);
  } finally { owner.release(); stopped.release(); }
  // The automatic repair's restore under its stopped repair admission: the newest verified backup replaces the person's store.
  const repair = RuntimeAdmission.acquireStoppedMachineControlMaintenance(workspace, lifetime), operation = repair.maintenanceOperation();
  try {
    const repaired = repair.admitStoppedProfileRepair(profileId, operation);
    try {
      const restored = await restoreNewestPersonBackup(repaired, operation, systemClock);
      assert.deepEqual([restored.state, restored.schemaVersion], ["restored", 21]);
    } finally { repaired.release(); }
  } finally { repair.release(); }
  query(path, database => { assert.equal(inspectNativeAuthority(database, 21).schemaVersion, 21); });

  await initializeRegisteredPersonStores(workspace, lifetime, hostFacts, systemClock);
  assert.ok(manifests().every(manifest => manifest.schemaVersion === 21), "the upgrade's own backup is the restored schema-21 store");
  query(path, database => {
    assert.equal(inspectNativeAuthority(database).schemaVersion, CURRENT_AUTHORITY_SCHEMA_VERSION);
    assert.deepEqual(database.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row => String(row.name)).filter(isWorkerCustodyDroppedTable), []);
    assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), []);
    // The build-id upgrade settles and deletes every non-terminal run of the previous build.
    assert.equal(database.prepare("SELECT count(*) AS count FROM runs WHERE id=?").get(stale.envelope.runId)?.count, 0);
    assert.equal(database.prepare("SELECT count(*) AS count FROM deleted_runs WHERE run_id=?").get(stale.envelope.runId)?.count, 1);
  });

  const machine = acquireSharedRuntimeAdmission(workspace, lifetime);
  const runtime = composeProfileRuntime({ admission: machine, clock: systemClock, hostFacts });
  children.cleanups.push(async () => { await runtime.close(); machine.release(); });
  const active = runtime.session.signIn({ ...login, at: systemClock.now().toISOString() });
  assert.equal(active.state, "active", JSON.stringify(active));
  if (active.state !== "active") throw new Error("restored profile sign-in refused");
  const context = runtime.selectedContext(active.token);
  const records: RealChildRecord[] = [], faults: string[] = [];
  const dashboard = await composeDashboardRuntime({ lifetimeLock: lifetime, admission: machine, profile: { runtime, token: active.token }, repoRoot: workspace,
    isolation: rebuildRuntimeIsolation, env: {}, backendPortOverride: 0, frontendPortOverride: 0, preflightRunnerFactory: healthyRuntimePreflightRunners,
    workerProcess: { launch: fixtureWorkerLaunch(lifetime), spawn: children.realStubSpawner(records, lifetime), faultSink: line => { faults.push(line); } } });
  let running = true;
  children.cleanups.push(async () => { if (running) await dashboard.stop(); });
  assert.ok(![3938, 3939, 5174].includes(dashboard.port));
  const origin = `http://127.0.0.1:${String(dashboard.port)}`;
  const post = (route: string, body: unknown) => fetch(`${origin}/api/v1/${route}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });

  const fresh = StartPlanWireSchema.parse(await (await post("start-plans", START)).json());
  assert.deepEqual(fresh.refused, []);
  const started = CommandResultSchema.parse(await (await post("commands", startCommand(fresh))).json());
  assert.equal(started.state, "applied", JSON.stringify(started));
  const runs = () => context.database.authority.runs.listByWorkflow("person-lookup");
  const output = () => JSON.stringify({ runs: runs().map(run => [run.envelope.runId, run.lifecycle]), spawns: records.map(record => record.argv.join(" ")), faults });
  await children.waitFor(() => runs().some(run => run.lifecycle.state === "terminal"), "the post-upgrade run to settle", output, 60_000);
  const [run] = runs();
  assert.equal(runs().length, 1, output());
  assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "done", output());
  assert.equal(run.claimGeneration, 1);
  assert.equal(context.database.authority.runResults.get(run.envelope.runId)?.runId, run.envelope.runId);
  assert.equal(records.length, 1, `one ensure spawns one worker: ${output()}`);
  assert.deepEqual(faults, []);
  assert.doesNotMatch(output(), /RUNTIME_CUSTODY_UNCERTAIN|PROFILE_[A-Z_]*_UNPROVED|WORKER_SUPERVISOR_FAILED|RUN_QUEUED_WORKER_UNAVAILABLE/u);

  const [child] = records; assert.ok(child?.pid !== undefined);
  await dashboard.stop(); running = false;
  assert.equal(children.pidAlive(child.pid), false);
  assert.deepEqual([child.child.exitCode, child.child.signalCode], [0, null], "the stop is observed as the worker's own clean exit");
  for (const opened of [path, backups]) assert.ok(realpathSync(opened).startsWith(realpathSync(workspace)));
});
