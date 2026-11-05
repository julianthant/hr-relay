import { assertStoppedProfileResourcesClosed } from "../../../src/backend/storage/maintenance/profile-custody.js";
import assert from "node:assert/strict";
import { once } from "node:events";
import { neverBornFixture, refusedStart, nativeWorkerBytes } from "../helpers/backend/never-born-worker-world.js";
import { FakeKeyringEntry } from "../helpers/credential-keychain-fake.js";
import { RuntimeLifetimeLock } from "../../../src/backend/storage/admission/lifetime-lock.js";
import { acquireEntrypointAdmission } from "../../../src/backend/storage/admission/bootstrap-admission.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore } from "../../../src/backend/storage/configuration/credential-store.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { composeWorkerProcessControl } from "../../../src/backend/app/composition/dashboard/worker-process.js";
import { kernelOver } from "../helpers/backend/dashboard-pool-world.js";
import { ManualScheduler } from "../helpers/phase1f-executor-harness.js";
import { CommandRequestSchema } from "../../../src/rules/commands/commands.js";
import { lifecycleCommandId } from "../../../src/rules/commands/lifecycle-command-id.js";
import { randomUUID } from "node:crypto";
import { join } from "node:path";

const [mode, workspace, profileId, path] = process.argv.slice(2);
if (workspace === undefined) {
  const f = await neverBornFixture(true);
  const db = f.context.database;
  if (mode === "allocation") {
    await new Promise<void>((resolve, reject) => process.send?.({ workspace: f.profile.workspace,
      profileId: f.context.admission.profileBinding.profileId, path: f.profile.path, keychain: FakeKeyringEntry.snapshot() },
    error => { if (error) reject(error); else resolve(); }));
    const record = db.recordWorkerNonBirthRefusal.bind(db);
    db.recordWorkerNonBirthRefusal = commandId => {
      record(commandId);
      const control = db.authority.workerControls.get(commandId);
      if (control?.request.type === "plan-worker-count" && control.auditedAt !== undefined) {
        db.afterAuthorityCommit(() => { process.kill(process.pid, "SIGKILL"); });
      }
    };
    await refusedStart(f);
    throw new Error("controller must die after additive Plan audit COMMIT before Spawn admission");
  }
  const started = await refusedStart(f);
  assert.equal(f.spawns(), 0); assert.equal(db.hasWorkerNonBirth(started.slot), true);
  process.send?.({ workspace: f.profile.workspace, profileId: f.context.admission.profileBinding.profileId,
    path: f.profile.path, keychain: FakeKeyringEntry.snapshot() });
  await once(process, "disconnect");
} else {
  assert.ok(profileId); assert.ok(path);
  const lifetime = await RuntimeLifetimeLock.acquire(0);
  const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  const admission = machine.admitProfile(profileId);
  const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot });
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  const db = AuthorityDatabase.open(admission, { path, busyTimeoutMs: 250, migrationOwner: "never-born-successor" }, clock,
    undefined, undefined, undefined, credentials);
  try {
    const before = nativeWorkerBytes(path), slot = db.authority.workerSlots.list("person-lookup")[0]; assert.ok(slot);
    assert.equal(db.hasWorkerNonBirth(slot), false);
    db.settleNeverSpawnedWorkers();
    assert.deepEqual(nativeWorkerBytes(path), before);
    assert.equal(db.authority.workerSlots.get(slot.workerId)?.retiredAt, null);
    let effects = 0;
    const control = composeWorkerProcessControl({ admission, database: db, clock, scheduler: new ManualScheduler(clock),
      profileRoot: join(admission.stateRoot, "browsers"), launch: { command: process.execPath, environment: {}, prefixArgs: [], cwd: workspace },
      spawn: () => { effects += 1; throw new Error("successor must not spawn"); }, birth: { pollMs: 1, timeoutMs: 10 }, onFault: error => { throw error; }, onExit: () => {} });
    try {
      assert.equal(db.hasWorkerNonBirth(slot), false, "successor composition must not hydrate live proof");
      db.settleNeverSpawnedWorkers();
      assert.deepEqual(nativeWorkerBytes(path), before, "composed successor cannot finish an uncommitted retirement");
      const kernel = kernelOver(db, clock, control.workerRuntime.pool);
      const pool = db.authority.workerPools.get(slot.workflow); assert.ok(pool);
      const plan = db.authority.workerControls.get(slot.reservationCommandId ?? ""); assert.ok(plan?.request.type === "plan-worker-count");
      assert.equal(plan.phase.state, "succeeded"); assert.ok(plan.auditedAt);
      assert.equal(db.authority.commandAudits.findByCommand(plan.commandId)?.result.state, "applied");
      if (mode === "allocation") {
        assert.equal(db.authority.workerControls.list().filter(row => row.request.type === "spawn-worker").length, 0);
        assert.equal(before.commands.filter(row => row.family === "worker-browser" && CommandRequestSchema.parse(JSON.parse(String(row.request_json))).type === "spawn-worker").length, 0);
        const result = await kernel.executeWorkerPool(CommandRequestSchema.parse({ ...plan.request, commandId: randomUUID(),
          target: { workflowId: slot.workflow, expectedVersion: pool.version }, payload: { desiredWorkers: 0 } }));
        assert.equal(result.state, "rejected", "missing Spawn history must not authorize generic retirement");
        if (result.state !== "rejected") throw new Error("generic retirement must refuse");
        assert.equal(result.message, "worker-retirement-non-birth-capability-required");
        assert.deepEqual(nativeWorkerBytes(path).slots, before.slots);
        assert.deepEqual(nativeWorkerBytes(path).pools, before.pools);
      } else {
        const spawn = db.authority.workerControls.list().find(row => row.request.type === "spawn-worker"); assert.ok(spawn);
        const missing = CommandRequestSchema.parse({ ...plan.request,
          commandId: lifecycleCommandId("never-born-retirement", [slot.reservationCommandId, spawn.commandId, slot.workerId]),
          target: { workflowId: slot.workflow, expectedVersion: pool.version }, payload: { desiredWorkers: 0 } });
        assert.throws(() => db.withAuthorityTransaction(repositories => repositories.commands.assertIdentity(missing)), /missing-settlement-replay-refused/);
        assert.equal((await kernel.executeWorkerPool(missing)).state, "rejected");
        assert.deepEqual(nativeWorkerBytes(path), before);
      }
      const after = nativeWorkerBytes(path);
      for (const key of ["commands", "controls", "audits"] as const) {
        for (const row of before[key]) assert.ok(after[key].some(value => JSON.stringify(value) === JSON.stringify(row)), `successor rewrote original ${key}`);
      }
      assert.deepEqual(after.runs, before.runs);
      assert.equal(effects, 0);
    } finally { control.supervisor.close(); }
    assert.throws(() => assertStoppedProfileResourcesClosed(db.readProfileResourceCustody()), /credential-maintenance-custody-unproved/);
    process.send?.({ observed: true });
  } finally { db.close(); admission.release(); machine.release(); await lifetime.close(); }
}
