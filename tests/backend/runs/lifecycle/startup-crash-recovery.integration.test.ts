import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { join } from "node:path";
import { afterEach, it, vi } from "vitest";
import { createRunRecordServiceTestWorld } from "../../../support/helpers/backend/run-record-service-world.js";
import { ownedWorkerLifetimeFixture, attemptingOwnedWrite } from "../../../support/helpers/backend/worker-lifetime-world.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { profileProcessQuery } from "../../../../src/backend/storage/maintenance/process-closure.js";
import { acquireRuntimeProcessLock, readRuntimeProcessLock, readProcessCustodyFile, readStartupProcessClosure, WorkerProcessLockFileSchema } from "../../../../src/backend/storage/sqlite/runtime-process-locks.js";
import { reconcileStartupCrash, StartupCrashRecoveryRefusedError } from "../../../../src/backend/runs/lifecycle/startup-crash-recovery.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../src/rules/identity/ids.js";

const world = createRunRecordServiceTestWorld();
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); await world.cleanup(); vi.restoreAllMocks(); });

function osProof() {
  return vi.spyOn(profileProcessQuery, "spawnSync").mockImplementation(command => ({ pid: 1, output: [], status: 0, signal: null,
    stdout: command === "/bin/ps" ? "1 /sbin/launchd\n" : "p1\nfcwd\ntDIR\nn/\n", stderr: "" }));
}
async function fixture() {
  const h = await ownedWorkerLifetimeFixture(world, { installationLocks: true, fenceInOwner: true }); cleanups.push(h.dispose);
  const installation = h.machine.readInstallationContext(); assert.ok(installation);
  const processLockRoot = join(installation.workspace, rebuildRuntimeIsolation.processLockRoot);
  const reconcile = () => reconcileStartupCrash({ ...h, lifecycle: h.service, processLockRoot });
  const die = async () => { const closed = once(h.old.child, "close"); h.old.child.kill("SIGKILL"); await closed; };
  return { ...h, processLockRoot, reconcile, die };
}

it("cancels only previous-local-day pristine queues, records notifications, and repeats without effects", async () => {
  const f = await fixture();
  const old = world.created(f.service, f.request);
  f.clock.advanceWall(24 * 60 * 60 * 1000);
  const today = world.created(f.service, { ...f.request, commandId: randomUUID(), matchKey: "today-synthetic-item" });
  f.reconcile();
  const cancelled = f.database.authority.runs.get(old.envelope.runId); assert.ok(cancelled);
  assert.ok(cancelled.lifecycle.state === "terminal" && cancelled.lifecycle.outcome === "cancelled");
  assert.match(cancelled.lifecycle.errorSummary ?? "", /RUN_STALE_QUEUE_CANCELLED/u);
  assert.equal(f.database.authority.runs.get(today.envelope.runId)?.lifecycle.state, "queued");
  const notifications = f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID);
  assert.equal(notifications.filter(note => note.title === "RUN_STALE_QUEUE_CANCELLED").length, 1);
  f.reconcile();
  assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), notifications);
});

for (const mode of ["none", "unknown", "released"] as const) it(`recovers a killed worker with ${mode} custody and preserves the original file`, async () => {
  const writes = mode === "unknown";
  const f = await fixture(); osProof();
  const queued = world.created(f.service, f.request);
  const claim = f.database.authority.runs.claimNext({ workflow: queued.envelope.workflow, workerId: f.slot.workerId,
    workerLifetime: { leaseGeneration: f.started.leaseGeneration, membershipRevision: f.slot.membershipRevision }, now: f.now });
  assert.equal(claim.state, "claimed"); if (claim.state !== "claimed") throw new Error("claim-refused");
  let run = claim.run;
  for (const state of ["validating", "running"] as const) {
    const next = f.database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version, now: f.now,
      lifecycle: { state, workerId: f.slot.workerId, claimedAt: f.now, heartbeatAt: f.now,
        workerLifetime: { leaseGeneration: f.started.leaseGeneration, membershipRevision: f.slot.membershipRevision } } });
    assert.equal(next.state, "applied"); if (next.state !== "applied") throw new Error("transition-refused"); run = next.run;
  }
  const intent = writes ? await attemptingOwnedWrite(f, run) : undefined;
  const custody = f.database.workerLifetimeCustody(f.slot.workerId);
  const file = join(f.processLockRoot, "workers", `${custody.birth.owner.acquisitionId}.lock.json`);
  if (mode === "released") f.old.handle.release();
  const original = readProcessCustodyFile(file);
  if (!writes) acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name: "server", pid: f.old.pid }, f.clock);
  await f.die(); f.reconcile();
  const recovered = f.database.authority.runs.get(run.envelope.runId); assert.ok(recovered);
  assert.equal(recovered.lifecycle.state, writes ? "parked-write" : "terminal");
  const receipt = readStartupProcessClosure(f.processLockRoot, WorkerProcessLockFileSchema.parse(JSON.parse(original.bytes.toString("utf8")))); assert.ok(receipt);
  assert.equal(receipt.proof.nativeWrites, writes ? "HELD" : "settled");
  assert.deepEqual(readProcessCustodyFile(file), original);
  if (!writes) assert.ok(readRuntimeProcessLock(f.processLockRoot, "server")?.releasedAt);
  if (intent !== undefined) assert.deepEqual(f.database.authority.writeIntents.get(intent.writeIntentId), intent);
  assert.equal(f.database.authority.workerLeases.get(f.slot.workerId)?.lifecycle.state, "stopped");
  const notifications = f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID);
  assert.ok(notifications.some(note => note.title === "STARTUP_PROCESS_CLOSED"));
  assert.ok(notifications.some(note => note.title === (writes ? "RUN_CRASH_WRITE_UNRESOLVED" : "RUN_INTERRUPTED_BY_CRASH")));
  f.reconcile();
  assert.deepEqual(f.database.authority.runs.get(run.envelope.runId), recovered);
  assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), notifications);
});

it("refuses failed OS closure proof without settling process custody", async () => {
  const f = await fixture();
  const custody = f.database.workerLifetimeCustody(f.slot.workerId);
  await f.die();
  osProof().mockReturnValue({ pid: 1, output: [], status: 1, signal: null, stdout: "", stderr: "synthetic OS failure" });
  assert.throws(f.reconcile, StartupCrashRecoveryRefusedError);
  assert.equal(readStartupProcessClosure(f.processLockRoot, custody.birth.owner), undefined);
});

it("preserves the source-closure error identity for composition custody retention", async () => {
  const f = await fixture();
  const failure = new AuthoritySourceClosureUnprovedError([new Error("synthetic unclosed proof reader")]);
  await f.die();
  osProof().mockImplementationOnce(() => { throw failure; });
  assert.throws(f.reconcile, error => error === failure);
});

it("settles singleton claims whose pid was reused without changing their original files", async () => {
  const f = await fixture(); osProof();
  const originals = (["server", "live-smoke", "geocode"] as const).map(name => {
    const handle = acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name, pid: process.pid }, f.clock,
      { observeProcessIdentity: () => ({ state: "alive", identity: { platform: "darwin", startToken: "previous-synthetic-birth" } }) });
    const file = readProcessCustodyFile(join(f.processLockRoot, `${name}-claims`, `${handle.generation}.claim.json`));
    const original = readRuntimeProcessLock(f.processLockRoot, name); assert.ok(original);
    return { name, file, original };
  });
  f.reconcile();
  for (const { name, file, original } of originals) {
    assert.deepEqual(readProcessCustodyFile(file.witness.path), file);
    assert.ok(readStartupProcessClosure(f.processLockRoot, original));
    assert.ok(readRuntimeProcessLock(f.processLockRoot, name)?.releasedAt);
  }
  const notifications = f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID);
  assert.equal(notifications.filter(note => note.title === "STARTUP_PROCESS_CLOSED").length, 3);
  f.reconcile();
  assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), notifications);
});

it("refuses a worker record whose pid was reused and leaves its custody unsettled", async () => {
  const f = await fixture(); osProof();
  const handle = acquireRuntimeProcessLock({ processLockRoot: f.processLockRoot, name: "workers", pid: process.pid,
    admission: { kind: "unbound-worker", authorityPath: join(f.admission.stateRoot, "state.db") } }, f.clock,
    { observeProcessIdentity: () => ({ state: "alive", identity: { platform: "darwin", startToken: "previous-synthetic-birth" } }) });
  cleanups.push(async () => { handle.release(); });
  const file = readProcessCustodyFile(join(f.processLockRoot, "workers", `${handle.acquisitionId}.lock.json`));
  const original = WorkerProcessLockFileSchema.parse(JSON.parse(file.bytes.toString("utf8")));
  assert.throws(f.reconcile, error => error instanceof StartupCrashRecoveryRefusedError
    && error.cause instanceof Error && error.cause.message === "startup-process-identity-changed");
  assert.deepEqual(readProcessCustodyFile(file.witness.path), file);
  assert.equal(readStartupProcessClosure(f.processLockRoot, original), undefined);
  assert.deepEqual(f.database.authority.notifications.listByActor(LOCAL_OPERATOR_ACTOR_ID), []);
});
