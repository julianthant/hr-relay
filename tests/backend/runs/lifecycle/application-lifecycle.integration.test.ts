import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { createApplicationLifecycle } from "../../../../src/backend/runs/lifecycle/application-lifecycle.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { ApplicationAdmissionRefusedError } from "../../../../src/backend/storage/sqlite/run-store-contracts.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { testAdmittedWorker } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { NO_INTAKE_PROJECTIONS, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { unusedWorkerPool } from "../../../support/helpers/backend/unused-worker-pool.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { workflowProjections } from "../../../../src/workflow-kit/workflow.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });

it("polls current lifecycle facts without collecting the profile closure inventory", async () => {
  const f = await settingsFixture(); cleanups.push(f.close);
  const inventory = vi.spyOn(f.database, "readProfileResourceCustody").mockImplementation(() => {
    throw new Error("lifecycle must not collect the closure inventory");
  });
  const artifacts = vi.spyOn(f.database, "readManagedArtifactReferences").mockImplementation(() => {
    throw new Error("lifecycle must not scan retained JSON for artifacts");
  });
  cleanups.push(() => { inventory.mockRestore(); artifacts.mockRestore(); });
  const lifecycle = createApplicationLifecycle({ database: f.database, requestQuit() {}, onFailure: error => { throw error; },
    updateHost: { pending: () => true, async install() {} } });
  cleanups.push(lifecycle.dispose);
  assert.equal(lifecycle.snapshot().update, "pending");
  assert.deepEqual(lifecycle.snapshot().targets, []);
  const run = f.create();
  assert.equal(lifecycle.snapshot().update, "deferred");
  assert.deepEqual(lifecycle.snapshot().targets, [{ runId: run.envelope.runId, expectedVersion: run.version, pauseUnavailable: false }]);
  const paused = f.service.pause({ commandId: "a1000000-0000-4000-8000-000000000002", runId: run.envelope.runId, expectedVersion: run.version });
  assert.equal(paused.state, "applied");
  const target = lifecycle.snapshot().targets[0]; assert.ok(target);
  assert.equal(target.expectedVersion, run.version + 1);
  assert.equal(target.pause?.state, "paused");
  assert.equal(inventory.mock.calls.length, 0);
  assert.equal(artifacts.mock.calls.length, 0);
});

it("refuses changed physical run evidence on the next lifecycle poll", async () => {
  const f = await settingsFixture(); cleanups.push(f.close);
  const run = f.create();
  const lifecycle = createApplicationLifecycle({ database: f.database, requestQuit() {}, onFailure: error => { throw error; } });
  cleanups.push(lifecycle.dispose);
  assert.equal(lifecycle.snapshot().targets[0]?.expectedVersion, run.version);
  const peer = new DatabaseSync(f.path);
  try {
    peer.prepare("UPDATE runs SET version=version+1 WHERE id=?").run(run.envelope.runId);
    assert.throws(() => lifecycle.snapshot(), /version.*whole-record JSON/u);
  } finally {
    peer.prepare("UPDATE runs SET version=? WHERE id=?").run(run.version, run.envelope.runId);
    peer.close();
  }
});

it("holds durable current-runtime admission before awaiting an idle installer and retains it on failure", async () => {
  const f = await settingsFixture(); cleanups.push(f.close);
  let rejectInstall: ((error: Error) => void) | undefined;
  let installs = 0;
  const lifecycle = createApplicationLifecycle({ database: f.database, requestQuit: () => { throw new Error("unexpected quit"); },
    onFailure: error => { throw error; }, updateHost: { pending: () => true,
      install: () => { installs += 1; return new Promise<void>((_resolve, reject) => { rejectInstall = reject; }); } } });
  cleanups.push(lifecycle.dispose);
  assert.equal(lifecycle.snapshot().update, "pending");
  const installing = lifecycle.installIdleUpdate();
  assert.equal(installs, 1);
  assert.equal(f.database.authority.runs.admission().state, "draining");
  assert.throws(() => f.create());
  await assert.rejects(lifecycle.installIdleUpdate(), /application-update-work-active/u);
  assert.ok(rejectInstall); rejectInstall(new Error("fixture installer failed"));
  await assert.rejects(installing, error => error instanceof ApplicationAdmissionRefusedError
    && error.code === "APPLICATION_ADMISSION_REFUSED" && error.cause instanceof Error && error.cause.message === "fixture installer failed");
  assert.equal(f.database.authority.runs.admission().state, "draining");
  const active = f.database.authority.runtimeConfig.get(); assert.ok(active);
  assert.notEqual(f.save({ "timeouts.taskMs": { set: 90_000 } }).state, "applied");
  assert.deepEqual(f.database.authority.runtimeConfig.get(), active);
  assert.equal(f.database.authority.runs.admission().state, "draining");
  f.database.authority.runtimeConfig.activate({ settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint,
    configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint, activatedAt: f.clock.now().toISOString() });
  assert.equal(f.database.authority.runs.admission().state, "open");
});

it("defers idle updates while a paused run is retained", async () => {
  const f = await settingsFixture(); cleanups.push(f.close);
  const run = f.create();
  const pause = f.service.pause({ commandId: "a1000000-0000-4000-8000-000000000001", runId: run.envelope.runId, expectedVersion: run.version });
  assert.equal(pause.state, "applied");
  let installs = 0;
  const lifecycle = createApplicationLifecycle({ database: f.database, requestQuit() {}, onFailure: error => { throw error; },
    updateHost: { pending: () => true, async install() { installs += 1; } } });
  cleanups.push(lifecycle.dispose);
  assert.equal(lifecycle.snapshot().update, "deferred");
  const target = lifecycle.snapshot().targets.find(target => target.runId === run.envelope.runId);
  assert.equal(target?.pause?.state, "paused");
  assert.equal(target.pauseUnavailable, false);
  await assert.rejects(lifecycle.installIdleUpdate(), /application-update-work-active/u);
  assert.equal(installs, 0);
  assert.equal(f.database.authority.runs.admission().state, "open");
});

/** A Pause all and quit accepted over one claimed run that has not reached its step boundary and one queued run. */
async function pendingQuitWorld() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  cleanups.push(() => { vi.useRealTimers(); });
  const f = await settingsFixture(); cleanups.push(f.close);
  const unexpected = (): never => { throw new Error("unexpected kernel effect"); };
  const runtime = f.database.authority.runtimeConfig.get(); assert.ok(runtime);
  const kernel = createCommandKernel({ lifecycle: f.service, authority: f.database, clock: f.clock, ids: sequentialIdFactory("d"),
    appVersion: "0.1.0", descriptors: { resolve: () => personLookupDescriptor }, applicationQuitAvailable: true,
    configIdentity: { configSnapshotId: runtime.configSnapshotId, configFingerprint: runtime.configFingerprint },
    intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS,
    writeResolution: { recheck: unexpected, resolveAbsent: unexpected }, workerRuntime: { pool: unusedWorkerPool(unexpected) } });
  const { member } = testAdmittedWorker(f.database, f.clock, { path: f.path, workflow: "person-lookup", poolIndex: 1, browserSystems: workflowProjections(personLookupDescriptor).systems });
  const stuck = f.create({ matchKey: "settings-proof-stuck" });
  const claim = f.database.authority.runs.claimNext({ workflow: "person-lookup", workerId: member.workerId, now: f.clock.now().toISOString() });
  assert.ok(claim.state === "claimed" && claim.run.envelope.runId === stuck.envelope.runId);
  const waiting = f.create();
  let quits = 0;
  const lifecycle = createApplicationLifecycle({ database: f.database, requestQuit() { quits += 1; }, onFailure: error => { throw error; } });
  cleanups.push(lifecycle.dispose);
  const quit = kernel.execute({ commandId: "a1000000-0000-4000-8000-000000000010", family: "application", type: "pause-all-and-quit",
    requestedBy: "local-operator", source: "dashboard", requestedAt: f.clock.now().toISOString(), target: { runtimeGeneration: runtime.generation },
    payload: { confirmed: true, targets: lifecycle.snapshot().targets.map(({ runId, expectedVersion }) => ({ runId, expectedVersion })) } });
  assert.equal(quit.state, "applied");
  lifecycle.quitAccepted();
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(quits, 0);
  const acknowledgeStuck = (commandId: string) => f.service.acknowledgePause({ commandId, runId: stuck.envelope.runId,
    claim: { workerId: member.workerId, claimGeneration: claim.run.claimGeneration } }).state;
  return { f, lifecycle, runtime, stuck, waiting, acknowledgeStuck, quits: () => quits };
}

it("ends a Pause all and quit that cannot complete when the operator resumes a paused run", async () => {
  const { f, lifecycle, waiting, quits } = await pendingQuitWorld();
  assert.equal(lifecycle.snapshot().state, "pausing");
  const paused = f.database.authority.runs.get(waiting.envelope.runId); assert.ok(paused);
  assert.equal(paused.pause?.state, "paused");
  const resumed = f.service.resumePaused({ commandId: "a1000000-0000-4000-8000-000000000011", runId: waiting.envelope.runId, expectedVersion: paused.version });
  assert.equal(resumed.state, "applied");
  assert.equal(f.database.authority.runs.admission().state, "open");
  assert.equal(lifecycle.snapshot().state, "ready");
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(quits(), 0);
  f.create({ matchKey: "settings-proof-after-quit" });
});

it("quits once the last claimed run of a Pause all and quit reaches its boundary", async () => {
  const { lifecycle, acknowledgeStuck, quits } = await pendingQuitWorld();
  assert.equal(acknowledgeStuck("a1000000-0000-4000-8000-000000000014"), "applied");
  assert.equal(lifecycle.snapshot().state, "pausing");
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(quits(), 1);
});

it("does not quit for a released Pause all and quit when a logout hold takes admission before the next poll", async () => {
  const { f, lifecycle, runtime, waiting, acknowledgeStuck, quits } = await pendingQuitWorld();
  const paused = f.database.authority.runs.get(waiting.envelope.runId); assert.ok(paused?.pause?.state === "paused");
  assert.equal(f.service.resumePaused({ commandId: "a1000000-0000-4000-8000-000000000011", runId: waiting.envelope.runId, expectedVersion: paused.version }).state, "applied");

  // Logout takes admission and quiesces every run before the quit observer polls again.
  f.database.authority.runs.holdAdmission({ commandId: "a1000000-0000-4000-8000-000000000012", runtimeGeneration: runtime.generation, reason: "logout" });
  const resumed = f.database.authority.runs.get(waiting.envelope.runId); assert.ok(resumed);
  assert.equal(f.service.pause({ commandId: "a1000000-0000-4000-8000-000000000013", runId: waiting.envelope.runId, expectedVersion: resumed.version }).state, "applied");
  assert.equal(acknowledgeStuck("a1000000-0000-4000-8000-000000000014"), "applied");
  assert.equal(lifecycle.snapshot().state, "pausing");
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(quits(), 0);
});

it("serves one application pause from Pause all and quit until every run that can pause has paused", async () => {
  const { lifecycle, acknowledgeStuck } = await pendingQuitWorld();
  assert.equal(lifecycle.snapshot().pause, "pause-pending");
  assert.equal(acknowledgeStuck("a1000000-0000-4000-8000-000000000014"), "applied");
  assert.equal(lifecycle.snapshot().pause, "paused");
});

it("withdraws every pending pause and ends the quit when the operator resumes all before the pauses are processed", async () => {
  const { f, lifecycle, stuck, waiting, acknowledgeStuck, quits } = await pendingQuitWorld();
  for (const [index, run] of [stuck, waiting].entries()) {
    const current = f.database.authority.runs.get(run.envelope.runId); assert.ok(current);
    assert.equal(f.service.resumePaused({ commandId: `a1000000-0000-4000-8000-00000000002${index}`, runId: run.envelope.runId, expectedVersion: current.version }).state, "applied");
  }
  assert.equal(f.database.authority.runs.admission().state, "open");
  assert.deepEqual([lifecycle.snapshot().state, lifecycle.snapshot().pause], ["ready", "running"]);
  // The worker that already stopped its step for the withdrawn pause releases the run unpaused.
  assert.equal(acknowledgeStuck("a1000000-0000-4000-8000-000000000014"), "applied");
  const released = f.database.authority.runs.get(stuck.envelope.runId); assert.ok(released);
  assert.deepEqual([released.lifecycle.state, released.pause], ["queued", undefined]);
  await vi.advanceTimersByTimeAsync(200);
  assert.equal(quits(), 0);
});
