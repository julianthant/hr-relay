import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs, { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { composeProfileRuntime, initializeRegisteredPersonStores, type ProfileCommandActivity } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { requireLifecycleApplied, RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import type { WorkerMemberView } from "../../../../src/backend/runtime/workers/worker-pool.js";
import { acquireEntrypointAdmission } from "../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createDuoCredentialStore } from "../../../../src/backend/storage/configuration/duo-credential-store.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { finishProfileOnboarding, syntheticOnboardingDuo } from "../../../support/helpers/admission-fixture.js";
import { runtimeLifetimeLock } from "../../../support/helpers/backend/runtime-lifetime.js";

const AT = "2026-10-21T12:00:00.000Z";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); syncBuiltinESMExports(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** A composed profile runtime, signed in, with a re-enrolment whose two methods are proved and staged. */
async function stagedRuntime() {
  const workspace = realpathSync(mkdtempSync(join(tmpdir(), "duo-reenrol-fence-")));
  const lifetime = await runtimeLifetimeLock();
  const clock = manualClock(new Date(AT));
  const machine = acquireEntrypointAdmission(workspace, "exclusive", lifetime);
  mkdirSync(join(workspace, rebuildRuntimeIsolation.processLockRoot), { recursive: true, mode: 0o700 });
  const runtime = composeProfileRuntime({ onboardingDuo: syntheticOnboardingDuo(), admission: machine, clock, hostFacts: { primaryDisplay: null } });
  let closed = false;
  const close = async () => { if (closed) return; closed = true; try { await runtime.close("shutdown"); } finally { machine.release(); } };
  cleanups.push(async () => { try { await close(); } finally { rmSync(workspace, { recursive: true, force: true }); } });
  const fields = { firstName: "Synthetic", lastName: "Operator", email: "fence@ucsd.edu", password: "synthetic-fence-password", createdAt: AT };
  const active = await finishProfileOnboarding(runtime.session, runtime.session.signUp(fields));
  if (active.state !== "active") throw new Error("synthetic sign-up refused");
  const context = runtime.selectedContext(active.token);
  const duo = () => {
    const owner = machine.admitProfile(active.profileId);
    try { const store = createDuoCredentialStore(owner, clock); return { identity: store.identity(), ready: store.credentials().map(row => row.credentialId) }; }
    finally { owner.release(); }
  };
  const before = duo();
  const opened = runtime.session.beginDuoReenrol(active.token);
  for (const method of ["key", "touch"] as const) {
    const started = await runtime.session.startDuoReenrol(active.token, opened.operationId, method);
    const attemptId: string | undefined = started.methods[method].attemptId;
    assert.ok(attemptId);
    if (method === "key") runtime.session.confirmDuoReenrol(active.token, opened.operationId, method, attemptId);
  }
  assert.equal(runtime.session.readDuoReenrol(active.token, opened.operationId).step, "ready");
  const lifecycle = new RunRecordService({ database: context.database, clock, ids: { uuid: randomUUID }, publishQueued: () => undefined });
  /** A run start the way the dashboard writes one: inside a transaction that checks the session before and after. */
  const startRun = () => context.database.withAuthorityTransaction(repositories => {
    runtime.assertCurrent(active.token);
    const config = repositories.runtimeConfig.get(); assert.ok(config);
    repositories.runs.enqueue(RunRecordSchema.parse({ ...QUEUED_RUN, envelope: { ...QUEUED_RUN.envelope, runId: randomUUID(),
      configSnapshotId: config.configSnapshotId, configFingerprint: config.configFingerprint } }));
    runtime.assertCurrent(active.token);
  });
  const commit = () => runtime.session.commitDuoReenrol(active.token, opened.operationId);
  return { workspace, lifetime, clock, machine, runtime, active, context, duo, before, operationId: opened.operationId, lifecycle, startRun, commit, close,
    recordFile: join(machine.stateRoot, "machine", "duo-credentials", `${active.profileId}.json`) };
}
type Staged = Awaited<ReturnType<typeof stagedRuntime>>;

function assertCommittable(f: Staged) {
  assert.equal(f.runtime.session.readDuoReenrol(f.active.token, f.operationId).step, "ready");
  assert.equal(f.runtime.session.prepareCurrentStorage(f.active.token).state, "available");
  assert.deepEqual(f.duo(), f.before);
}

it("lets runs start while setup is open, refuses commit while one is unsettled, and commits the idle profile", async () => {
  const f = await stagedRuntime();
  f.startRun();
  await assert.rejects(f.commit(), { code: "PROFILE_DUO_REENROL_BUSY" });
  assertCommittable(f);
  for (const run of f.context.database.readProfileResourceCustody().runs) {
    requireLifecycleApplied(f.lifecycle.transition({ commandId: randomUUID(), runId: run.envelope.runId, expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: AT, errorSummary: "RUN_LOGOUT_CANCELLED: synthetic" } }));
  }
  assert.deepEqual(await f.commit(), { state: "active", token: f.active.token, epoch: f.active.epoch, profileId: f.active.profileId });
  assert.notEqual(f.duo().identity, f.before.identity);
  assert.equal(f.runtime.selectedContext(f.active.token), f.context);
});

const live: WorkerMemberView = { member: { workflowId: "person-lookup", workerId: "person-lookup-worker-1", ordinal: 1, poolIndex: 1 },
  lifetimeId: "aaaaaaaa-0001-4000-8000-000100000000", version: 0, state: "running", directive: "run", pid: 4242,
  startedAt: AT, activity: { state: "idle" }, browsers: [], exit: undefined, held: undefined };

it("refuses commit with PROFILE_DUO_REENROL_BUSY while a worker child or a command is live", async () => {
  for (const hold of ["child", "command"] as const) {
    const f = await stagedRuntime();
    let liveHold = true;
    if (hold === "child") {
      f.runtime.beginSupervisorConstruction(f.active.token);
      f.runtime.bindSupervisor(f.active.token, { snapshot: () => liveHold ? [live] : [], stopAll: async () => [] });
    } else {
      const command: ProfileCommandActivity = { hasUnquiescedWork: () => liveHold, requestCancellation() {}, awaitCancellation: () => Promise.resolve() };
      f.runtime.registerCommandActivity(f.active.token, command);
    }
    await assert.rejects(f.commit(), { code: "PROFILE_DUO_REENROL_BUSY" }, hold);
    assertCommittable(f);
    liveHold = false;
    await f.commit();
    assert.notEqual(f.duo().identity, f.before.identity);
  }
});

it("refuses commit with PROFILE_DUO_REENROL_BUSY for an open write intent, a held Duo lease and a pending artifact", async () => {
  // These facts need a claimed worker run to create; the fence reads them through the same custody read as the activity check.
  for (const facts of [{ writeIntents: [{ status: "attempting" }] }, { duoLeases: [{ state: "held" }] }, { pendingArtifacts: [{}] }]) {
    const f = await stagedRuntime();
    const read = f.context.database.readProfileResourceCustody.bind(f.context.database);
    const spy = vi.spyOn(f.context.database, "readProfileResourceCustody").mockImplementation(() => ({ ...read(), ...facts }) as ReturnType<typeof read>);
    await assert.rejects(f.commit(), { code: "PROFILE_DUO_REENROL_BUSY" }, Object.keys(facts)[0]);
    spy.mockRestore();
    assertCommittable(f);
  }
});

it("holds the profile closed after an unsettled commit effect: the selected context, guarded transactions and run starts refuse", async () => {
  const f = await stagedRuntime();
  const rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
    if (String(destination) === f.recordFile) throw new Error("synthetic record publication failure");
    return rename(source, destination);
  });
  syncBuiltinESMExports();
  await assert.rejects(f.commit(), { code: "PROFILE_DUO_REENROL_UNCERTAIN" });
  vi.restoreAllMocks(); syncBuiltinESMExports();
  assert.equal(f.runtime.session.duoReenrolCommitHeld(f.active.profileId), true);
  assert.throws(() => f.runtime.selectedContext(f.active.token), { code: "PROFILE_SESSION_STALE" });
  assert.throws(() => f.runtime.assertCurrent(f.active.token), { code: "PROFILE_SESSION_STALE" });
  const runs = f.context.database.readProfileResourceCustody().runs.length;
  assert.throws(() => f.startRun(), { code: "PROFILE_SESSION_STALE" });
  assert.equal(f.context.database.readProfileResourceCustody().runs.length, runs);
  assert.equal((await f.runtime.session.readCurrentAuthority(f.active.token)).state, "refused");
  // The failed publication left a re-enrolment stage, which keeps the credential store unreadable until boot removes it.
  await assert.rejects(f.close(), { code: "RUNTIME_CUSTODY_UNCERTAIN" });
});

it("boot rolls a recorded commit forward under stopped custody before any session", async () => {
  const f = await stagedRuntime();
  let left = 2;
  const rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
    if (left > 0 && String(destination) === f.recordFile) { left--; throw new Error("synthetic record publication failure"); }
    return rename(source, destination);
  });
  syncBuiltinESMExports();
  await assert.rejects(f.commit(), { code: "PROFILE_DUO_REENROL_UNCERTAIN" });
  vi.restoreAllMocks(); syncBuiltinESMExports();
  assert.equal(f.runtime.session.duoReenrolCommitHeld(f.active.profileId), true);
  // Shutdown cannot prove the store closed while the failed write's stage lingers; the process ends and boot settles it.
  await assert.rejects(f.close(), { code: "RUNTIME_CUSTODY_UNCERTAIN" });

  await initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, f.clock);
  const machine = acquireEntrypointAdmission(f.workspace, "exclusive", f.lifetime);
  const runtime = composeProfileRuntime({ onboardingDuo: syntheticOnboardingDuo(), admission: machine, clock: f.clock, hostFacts: { primaryDisplay: null } });
  try {
    assert.deepEqual(machine.readDuoReenrolCommitProfileIds(), []);
    const resumed = runtime.session.resumeSignedInProfile({ at: AT });
    assert.equal(resumed.state, "active");
    if (resumed.state === "active") assert.equal(runtime.session.prepareCurrentStorage(resumed.token).state, "available");
    const owner = machine.admitProfile(f.active.profileId);
    try { assert.notEqual(createDuoCredentialStore(owner, f.clock).identity(), f.before.identity); } finally { owner.release(); }
  } finally { await runtime.close("shutdown"); machine.release(); }
});

it("boot holds only that person when the recorded commit cannot be proved", async () => {
  const f = await stagedRuntime();
  const rename = fs.renameSync;
  vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
    if (String(destination) === f.recordFile) throw new Error("synthetic record publication failure");
    return rename(source, destination);
  });
  syncBuiltinESMExports();
  await assert.rejects(f.commit(), { code: "PROFILE_DUO_REENROL_UNCERTAIN" });
  vi.restoreAllMocks(); syncBuiltinESMExports();
  await assert.rejects(f.close(), { code: "RUNTIME_CUSTODY_UNCERTAIN" });
  // Foreign record content: the classifier cannot prove the record against the intent.
  fs.writeFileSync(f.recordFile, "{}", { mode: 0o600 });

  await initializeRegisteredPersonStores(f.workspace, f.lifetime, { primaryDisplay: null }, f.clock);
  const machine = acquireEntrypointAdmission(f.workspace, "exclusive", f.lifetime);
  const runtime = composeProfileRuntime({ onboardingDuo: syntheticOnboardingDuo(), admission: machine, clock: f.clock, hostFacts: { primaryDisplay: null } });
  try {
    assert.deepEqual(machine.readDuoReenrolCommitProfileIds(), [f.active.profileId]);
    assert.equal(machine.readProfileRegistry().activeProfileId, null);
    assert.throws(() => runtime.session.signIn({ email: "fence@ucsd.edu", password: "synthetic-fence-password", at: AT }), { code: "PROFILE_DUO_REENROL_UNCERTAIN" });
  } finally { await runtime.close("shutdown"); machine.release(); }
});
