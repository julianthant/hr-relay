import { testProcessImport } from "../../../support/compiled-process.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { RuntimeAdmission } from "../../../../src/backend/storage/admission/admission.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore } from "../../../../src/backend/storage/configuration/credential-store.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { DatabaseSync } from "node:sqlite";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { runRecordColumns } from "../../../../src/backend/storage/sqlite/run-record-row.js";
import { createRunSearchIndex } from "../../../../src/backend/storage/sqlite/run-search-index.js";
import { attemptingOwnedWrite } from "../../../support/helpers/backend/worker-lifetime-world.js";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { RuntimeAlreadyRunningError, RuntimeLifetimeLock } from "../../../../src/backend/storage/admission/lifetime-lock.js";
import { credentialKeychainTestEnvironment } from "../../../support/helpers/credential-keychain-fake.js";
import { stopSyntheticDatabaseWorkers } from "../../../support/helpers/synthetic-database-admission.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, it } from "vitest";
import { createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";
import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";
import { reconcileStartupCrash } from "../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";

const world = createRunRecordServiceTestWorld();
afterEach(() => world.cleanup());

async function fixture() {
  const f = await world.fixture(), lock = f.lifetime, now = f.clock.now().toISOString();
  stopSyntheticDatabaseWorkers({ database: f.database, path: join(f.root, "state.db") });
  const profileRunId = randomUUID(), credentialKey = "ab".repeat(32);
  const slot = f.database.admitVerificationWorker({ ...f.admission.profileBinding, lockPort: lock.port,
    commandId: randomUUID(), workflow: "person-lookup", expectedPoolVersion: f.database.authority.workerPools.get("person-lookup")?.version ?? 0, profileRunId,
    system: "ucpath", credentialKey, leaseGeneration: 1, now }, lock);
  const hold = f.database.authority.workerSlots.verification(slot.workerId);
  assert.ok(hold);
  const request = { ...f.admission.profileBinding, commandId: randomUUID(), grantCommandId: hold.command.commandId,
    workerId: slot.workerId, expectedRevision: slot.membershipRevision,
    expectedPoolVersion: f.database.authority.workerPools.get(slot.workflow)?.version, now, cleanup: "interrupted" };
  const reconcile = () => reconcileStartupCrash({ ...f, lifecycle: f.service, lock });
  return { ...f, lock, slot, hold, retirementRequest: request, reconcile, credentialKey, profileRunId, now };
}

it("retires an abandoned verification reservation without a worker lease and records cleanup once", async () => {
  const f = await fixture();
  assert.equal(f.database.authority.workerLeases.get(f.slot.workerId), undefined);
  const browser = { workerId: f.slot.workerId, leaseGeneration: 1, sessionId: randomUUID(), system: "ucpath",
    configFingerprint: "a".repeat(64), signInFingerprint: "b".repeat(64), browserMode: "headless",
    acceptDownloads: false, exclusive: true, health: "unknown", observedAt: f.now, openedAt: f.now, profileRevision: 1,
    profileDirectory: join(f.admission.stateRoot, "scratch", "live-smoke", f.profileRunId, "browsers", `w${f.slot.ordinal}`, "ucpath") };
  f.database.authority.workerControls.observe(browser);
  const acquired = f.database.authority.duoCeremonyLeases.acquire({ credentialKey: f.credentialKey, workerId: f.slot.workerId,
    system: "ucpath", now: f.now, ttlMs: 60000 });
  assert.equal(acquired.state, "acquired");
  const duo = f.database.authority.duoCeremonyLeases.get(f.credentialKey); assert.ok(duo);
  f.reconcile();
  assert.deepEqual(f.database.authority.workerControls.browsers(f.slot.workerId), [{ ...browser, health: "closed" }]);
  const released = f.database.authority.duoCeremonyLeases.get(f.credentialKey); assert.ok(released);
  assert.deepEqual(released, { ...duo, state: "released", releasedAt: f.now, version: duo.version + 1, updatedAt: f.now });
  const retired = f.database.authority.workerSlots.get(f.slot.workerId); assert.ok(retired);
  assert.equal(retired.membershipRevision, f.slot.membershipRevision + 1);
  assert.equal(retired.retiredAt, f.now);
  const notifications = f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID);
  assert.equal(notifications.filter(note => note.title === "RUN_CRASH_RESOURCES_RELEASED").length, 3);
  const generation = f.database.getMeta().authorityGeneration;
  f.reconcile();
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), notifications);
});

for (const field of ["controller", "member", "revision", "reservation", "installation", "pool"] as const) {
  it(`refuses changed verification ${field} with zero effects`, async () => {
    const f = await fixture(), other = await runtimeLifetimeLock();
    const request = { ...f.retirementRequest,
      ...(field === "member" ? { workerId: "person-lookup-worker-999" } : {}),
      ...(field === "revision" ? { expectedRevision: f.slot.membershipRevision + 1 } : {}),
      ...(field === "reservation" ? { grantCommandId: randomUUID() } : {}),
      ...(field === "installation" ? { installationId: randomUUID() } : {}),
      ...(field === "pool" ? { expectedPoolVersion: 999 } : {}) };
    const before = f.database.readProfileResourceCustody(), generation = f.database.getMeta().authorityGeneration;
    assert.throws(() => f.database.retireVerificationWorker(request, field === "controller" ? other : f.lock));
    assert.deepEqual(f.database.readProfileResourceCustody(), before);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), []);
  });
}

it("refuses an unbound browser observation without closing rows or retiring its reservation", async () => {
  const f = await fixture();
  f.database.authority.workerControls.observe({ workerId: f.slot.workerId, leaseGeneration: 2, sessionId: randomUUID(),
    system: "ucpath", configFingerprint: "a".repeat(64), signInFingerprint: "b".repeat(64), browserMode: "headless",
    acceptDownloads: false, exclusive: true, health: "unknown", observedAt: f.now, openedAt: f.now, profileRevision: 1 });
  const before = f.database.readProfileResourceCustody();
  assert.throws(f.reconcile);
  assert.deepEqual(f.database.readProfileResourceCustody(), before);
  assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), []);
});

it("recovers an actual hard-crashed standalone reservation with no worker lease before admitting another", async () => {
  const f = await world.fixture();
  stopSyntheticDatabaseWorkers({ database: f.database, path: join(f.root, "state.db") });
  const port = f.lifetime.port, binding = f.admission.profileBinding;
  const installation = f.machine.readInstallationContext(); assert.ok(installation);
  await f.closeController();
  const child = spawn(process.execPath, ["--import", testProcessImport(),
    fileURLToPath(new URL("../../../support/processes/verification-reservation-owner.ts", import.meta.url)),
    installation.workspace, String(port), f.clock.now().toISOString()],
  { env: credentialKeychainTestEnvironment({}), stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const exited = once(child, "close");
  child.stderr?.resume();
  let lock: RuntimeLifetimeLock | undefined, machine: RuntimeAdmission | undefined, admission: RuntimeAdmission | undefined, database: AuthorityDatabase | undefined;
  try {
    const received = await Promise.race([once(child, "message"), exited.then(() => { throw new Error("verification-owner-exited-before-reservation"); })]);
    const member = z.strictObject({ workerId: z.string(), revision: z.number().int().positive() }).parse(received[0]);
    await assert.rejects(RuntimeLifetimeLock.acquire(port), RuntimeAlreadyRunningError);
    assert.equal(child.kill("SIGKILL"), true);
    assert.deepEqual(await exited, [null, "SIGKILL"]);
    lock = await RuntimeLifetimeLock.acquire(port);
    machine = acquireEntrypointAdmission(installation.workspace, "shared", lock);
    admission = machine.admitProfile(machine.issueRegisteredProfileClaim(binding.profileId));
    const credentials = createCredentialStore({ admission, stateRoot: admission.stateRoot, erasureJournalAdmission: machine,
      erasureJournalPath: join(machine.stateRoot, "machine", "erasures", binding.profileId + ".json") });
    database = AuthorityDatabase.open(admission, { path: join(f.root, "state.db"), busyTimeoutMs: 250,
      migrationOwner: "verification-restart-proof" }, f.clock, undefined, undefined, undefined, credentials);
    assert.equal(database.authority.workerLeases.get(member.workerId), undefined);
    reconcileStartupCrash({ machine, admission, database, clock: f.clock, lifecycle: testRunService(database, f.clock), lock });
    assert.equal(database.authority.workerSlots.get(member.workerId)?.retiredAt, f.clock.now().toISOString());
    assert.equal(database.authority.workerSlots.get(member.workerId)?.membershipRevision, member.revision + 1);
    assert.equal(database.authority.workerLeases.get(member.workerId), undefined);
    assert.equal(database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID)
      .filter(note => note.title === "RUN_CRASH_RESOURCES_RELEASED").length, 1);
    const next = database.admitVerificationWorker({ ...binding, lockPort: port, commandId: randomUUID(),
      workflow: "person-lookup", expectedPoolVersion: database.authority.workerPools.get("person-lookup")?.version,
      profileRunId: randomUUID(), system: "ucpath", credentialKey: "ab".repeat(32), leaseGeneration: 1,
      now: f.clock.now().toISOString() }, lock);
    assert.notEqual(next.workerId, member.workerId);
  } finally {
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; }
    database?.close(); admission?.release(); machine?.release(); await lock?.close();
  }
});

it("refuses unexpected run ownership in a verification-only member without retiring or closing resources", async () => {
  const f = await fixture(), queued = world.created(f.service, f.request);
  const claimed = RunRecordSchema.parse({ ...queued, claimGeneration: 1, version: queued.version + 1,
    lifecycle: { state: "claimed", workerId: f.slot.workerId, workerLifetime: { leaseGeneration: 1,
      membershipRevision: f.slot.membershipRevision }, claimedAt: f.now, heartbeatAt: f.now } });
  const raw = new DatabaseSync(join(f.root, "state.db")), sourceGeneration = f.database.getMeta().authorityGeneration;
  const search = createRunSearchIndex(raw); search.installTracking();
  const replace = (run: typeof queued) => {
    const columns = runRecordColumns(run);
    raw.exec("BEGIN IMMEDIATE");
    try {
      assert.equal(raw.prepare("UPDATE runs SET state=?,owner_worker_id=?,claim_generation=?,heartbeat_at=?,version=?,lifecycle_json=? WHERE id=?")
        .run(columns.state, columns.owner_worker_id, columns.claim_generation, columns.heartbeat_at, columns.version,
          columns.lifecycle_json, columns.id).changes, 1);
      let publication = search.rebuild({ restart: true, limit: 500 }, sourceGeneration, f.now);
      while (publication.state === "building") publication = search.rebuild({ restart: false, limit: 500 }, sourceGeneration, f.now);
      raw.exec("COMMIT");
    } catch (error) {
      try { raw.exec("ROLLBACK"); }
      catch (cleanup) { throw new AggregateError([error, cleanup], "verification fixture mutation and rollback failed", { cause: cleanup }); }
      throw error;
    }
  };
  let primary: { error: unknown } | undefined;
  try {
    replace(claimed);
    const before = f.database.readProfileResourceCustody(), generation = f.database.getMeta().authorityGeneration;
    assert.throws(() => f.database.retireVerificationWorker(f.retirementRequest, f.lock), /worker-verification-unexpected-run-owner/u);
    assert.deepEqual(f.database.readProfileResourceCustody(), before);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), []);
  } catch (error) { primary = { error }; }
  const failures: unknown[] = [];
  try { replace(queued); } catch (error) { failures.push(error); }
  try { raw.close(); } catch (error) { failures.push(error); }
  if (primary !== undefined && failures.length > 0) throw new AggregateError([primary.error, ...failures], "verification refusal and fixture cleanup failed", { cause: primary.error });
  if (primary !== undefined) throw primary.error;
  if (failures.length > 0) throw new AggregateError(failures, "verification fixture cleanup failed", { cause: failures[0] });
});

it("refuses unproved write ownership and rolls back startup cleanup without settling or retrying UNKNOWN", async () => {
  const f = await world.interruptedFixture();
  const intent = await attemptingOwnedWrite({ database: f.database,
    fence: async input => f.database.authority.writeIntents.fenceAttempt(input) }, f.run);
  const slot = f.database.admitVerificationWorker({ ...f.admission.profileBinding, lockPort: f.lock.port,
    commandId: randomUUID(), workflow: "person-lookup", expectedPoolVersion: f.database.authority.workerPools.get("person-lookup")?.version,
    profileRunId: randomUUID(), system: "ucpath", credentialKey: "ab".repeat(32), leaseGeneration: 1,
    now: f.clock.now().toISOString() }, f.lock);
  const raw = new DatabaseSync(join(f.root, "state.db"));
  let primary: { error: unknown } | undefined;
  try {
    raw.prepare("CREATE TEMP TABLE retained_claim_event AS SELECT * FROM timeline_events WHERE kind='run.claimed' AND run_id=?").run(f.run.envelope.runId);
    assert.equal(raw.prepare("DELETE FROM timeline_events WHERE kind='run.claimed' AND run_id=?").run(f.run.envelope.runId).changes, 1);
    const before = f.database.readProfileResourceCustody(), generation = f.database.getMeta().authorityGeneration;
    const attempts = f.database.authority.writeAttempts.listByIntent(intent.writeIntentId);
    assert.throws(() => reconcileStartupCrash({ ...f, lifecycle: f.service }));
    assert.deepEqual(f.database.readProfileResourceCustody(), before);
    assert.equal(f.database.getMeta().authorityGeneration, generation);
    assert.deepEqual(f.database.authority.writeIntents.get(intent.writeIntentId), intent);
    assert.deepEqual(f.database.authority.writeAttempts.listByIntent(intent.writeIntentId), attempts);
    assert.deepEqual(f.database.authority.runs.get(f.run.envelope.runId), f.run);
    assert.equal(f.database.authority.workerSlots.get(slot.workerId)?.retiredAt, null);
    assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), []);
  } catch (error) { primary = { error }; }
  const failures: unknown[] = [];
  try { assert.equal(raw.prepare("INSERT INTO timeline_events SELECT * FROM retained_claim_event").run().changes, 1); }
  catch (error) { failures.push(error); }
  try { raw.close(); } catch (error) { failures.push(error); }
  if (primary !== undefined && failures.length > 0) throw new AggregateError([primary.error, ...failures], "verification write refusal and fixture cleanup failed", { cause: primary.error });
  if (primary !== undefined) throw primary.error;
  if (failures.length > 0) throw new AggregateError(failures, "verification write fixture cleanup failed", { cause: failures[0] });
});
