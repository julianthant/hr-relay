import { join } from "node:path";
import { RuntimeAdmission } from "../../../../../../src/backend/storage/admission/admission.js";
import { WorkerIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { runWorkerLoop } from "../../../../../../src/backend/runtime/workers/worker-loop.js";
import { resolveConfigWithProvenance } from "../../../../../../src/backend/app/config/resolve.js";
import { readSettings } from "../../../../../../src/backend/runtime/settings/settings-runtime.js";
import { WorkflowIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { taskStoreRegistry } from "../../../../../../src/backend/app/registries/task-registry.js";
import { testWorkerPorts } from "../../../../../support/fixtures/run-lifecycle-fixtures.js";
import { fixtureDuoCeremonyGates } from "../../../../../support/helpers/duo-ceremony-fixtures.js";
import { personLookupDescriptor } from "../../../../../support/helpers/registered-workflows.js";
import { ManualScheduler, happySessionHarness, EXECUTOR_WORKER_ID, recordingTimelineEmitter, recordingLogger } from "../../../../../support/helpers/phase1f-executor-harness.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { createCredentialStore } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { createRunResourcesFactory } from "../../../../../../src/backend/app/composition/worker/run-resources.js";
import { createContentAddressedArtifactWriter } from "../../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { rebuildRuntimeIsolation } from "../../../../../../src/backend/app/config/runtime-isolation.js";
import { afterEach, it, vi } from "vitest";
import { requireLifecycleApplied } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../../../src/backend/runs/settings/run-settings.js";
import { settingsFixture } from "../../../../../support/helpers/backend/settings-activation-fixture.js";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); vi.restoreAllMocks(); });
function fixture(isolateBrowser = false) { const f = settingsFixture(isolateBrowser); cleanups.push(f.close); return f; }
it("current authorization claims old and new queued snapshots and still refuses stale tokens and owners", () => {
  const f = fixture(); const old = f.create(); const token = selectRunRuntime(f.database.authority);
  f.save({ "timeouts.taskMs": { set: 90_000 } }); const next = f.create();
  const claim = (workerId: string, runtimeConfig = selectRunRuntime(f.database.authority)) => f.service.claimNext({
    commandId: randomUUID(), workflow: "person-lookup", workerId, runtimeConfig,
  });
  assert.deepEqual(claim("stale", token), { state: "refused", refusal: { reason: "runtime-stale" } });
  const first = requireLifecycleApplied(claim("first"));
  const second = requireLifecycleApplied(claim("second"));
  assert.deepEqual(new Set([first.envelope.configSnapshotId, second.envelope.configSnapshotId]),
    new Set([old.envelope.configSnapshotId, next.envelope.configSnapshotId]));
  assert.deepEqual(claim("first"), { state: "refused", refusal: { reason: "worker-busy", runId: first.envelope.runId } });
  const now = f.clock.now().toISOString();
  const request = { commandId: randomUUID(), runId: first.envelope.runId, expectedVersion: first.version,
    claim: { workerId: "intruder", claimGeneration: first.claimGeneration },
    lifecycle: { state: "validating", workerId: "first", claimedAt: now, heartbeatAt: now } };
  assert.equal(f.service.workerTransition(request).state, "refused");
  const validated = requireLifecycleApplied(f.service.workerTransition({ ...request, commandId: randomUUID(),
    claim: { workerId: "first", claimGeneration: first.claimGeneration } }));
  assert.deepEqual(validated.envelope, first.envelope);
});

it("actual browser launch and execution resources use each run's retained display, timeouts and mode", async () => {
  const f = settingsFixture(true); cleanups.push(f.close);
  assert.equal(f.save({ "timeouts.taskMs": { set: 60_000 }, "timeouts.sessionAcquireMs": { set: 120_000 } }).state, "applied");
  const old = f.create();
  assert.equal(f.save({ "display.screenWidth": { set: 1980 }, "display.screenHeight": { set: 1080 },
    "browser.headless": { set: false }, "timeouts.taskMs": { set: 90_000 }, "timeouts.sessionAcquireMs": { set: 180_000 } }).state, "applied");
  const next = f.create();
  const artifacts = createContentAddressedArtifactWriter({ admission: RuntimeAdmission.syntheticRoots(join(f.root, ".tracker"), join(f.root, ".tracker/artifacts")) }); await artifacts.ready;
  const factory = createRunResourcesFactory({ processLockRoot: join(f.root, "locks"), authority: f.database.authority, artifacts, clock: f.clock,
    ids: { uuid: randomUUID }, isolation: rebuildRuntimeIsolation, protectedSecrets: createCredentialStore({ stateRoot: f.root }),
    scheduler: { schedule: () => ({ cancel: () => {} }) }, environment: {} });
  const first = factory.forRun(old); const second = factory.forRun(next);
  assert.equal(first.taskDeadlineMs, 60_000); assert.equal(second.taskDeadlineMs, 90_000);
  assert.equal(first.sessionAcquireMs, 120_000); assert.equal(second.sessionAcquireMs, 180_000);
  assert.equal(first.defaultBrowserMode, "headless"); assert.equal(second.defaultBrowserMode, "headed");
  const launch = vi.spyOn(chromium, "launchPersistentContext").mockRejectedValue(new Error("synthetic launch boundary"));
  const open = (run: typeof old) => factory.forRun(run).sessionFactory.open({ workerId: WorkerIdSchema.parse("settings-worker"), workflowId: WorkflowIdSchema.parse("person-lookup"),
    system: "ucpath", instance: "prod", configFingerprint: run.envelope.configFingerprint, acceptDownloads: false, exclusive: false,
    signal: new AbortController().signal, duoCeremony: { withCeremony: () => { throw new Error("no authentication in launch proof"); } } });
  await assert.rejects(open(old), /synthetic launch boundary/u);
  await assert.rejects(open(next), /synthetic launch boundary/u);
  assert.deepEqual(launch.mock.calls.map((call) => call[1]?.viewport), [{ width: 2560, height: 1440 }, { width: 1980, height: 1080 }]);
  assert.deepEqual(launch.mock.calls.map((call) => call[1]?.headless), [true, false]);
  assert.notEqual(launch.mock.calls[0]?.[0], launch.mock.calls[1]?.[0]);
  assert.equal(factory.forRun(old), first);
});

it("pause/requeue then resume keeps the same run configuration and rejects the former claim", () => {
  const f = fixture(); const original = f.create();
  const claim = requireLifecycleApplied(f.service.claimNext({ commandId: randomUUID(), workflow: "person-lookup", workerId: "owner",
    runtimeConfig: selectRunRuntime(f.database.authority) }));
  const fence = { workerId: "owner", claimGeneration: claim.claimGeneration };
  const recovery = f.service.requeue({ commandId: randomUUID(), runId: claim.envelope.runId,
    expectedVersion: claim.version, cause: "recovery", claim: fence });
  assert.ok(recovery.state === "applied" || recovery.state === "applied-already");
  const paused = requireLifecycleApplied(recovery);
  f.save({ "timeouts.taskMs": { set: 90_000 } });
  const resumed = requireLifecycleApplied(f.service.claimNext({ commandId: randomUUID(), workflow: "person-lookup", workerId: "new-owner",
    runtimeConfig: selectRunRuntime(f.database.authority) }));
  assert.deepEqual(resumed.envelope, original.envelope); assert.deepEqual(paused.envelope, original.envelope);
  assert.ok(resumed.claimGeneration > fence.claimGeneration);
  assert.deepEqual(f.service.renewClaim({ commandId: randomUUID(), runId: resumed.envelope.runId, claim: fence }),
    { state: "refused", refusal: { reason: "lost" } });
});


it("saved idle cadence applies at the next boundary without retiming the pending wait", async () => {
  const f = fixture();
  const scheduler = new ManualScheduler(f.clock, 0);
  const stop = new AbortController();
  const sessions = happySessionHarness();
  const cadence = () => resolveConfigWithProvenance(readSettings(f.database.authority).settings, f.host, f.clock).config.daemon.idleRepollMs;
  const initial = cadence();
  const looping = runWorkerLoop({ ...testWorkerPorts(f.database, f.clock),
    workflowId: WorkflowIdSchema.parse("person-lookup"), workerId: EXECUTOR_WORKER_ID,
    descriptor: personLookupDescriptor, stores: taskStoreRegistry, authority: f.database,
    sessionFactory: sessions.factory, emitter: recordingTimelineEmitter(f.database, f.clock).emitter,
    clock: f.clock, ids: { uuid: randomUUID }, scheduler, taskDeadlineMs: 60_000, sessionAcquireMs: 20_000,
    duoCeremony: fixtureDuoCeremonyGates(f.clock), heartbeatIntervalMs: 500, idleRepollMs: initial,
    idleCadence: cadence, log: recordingLogger().log, stopSignal: stop.signal, exitWhenIdle: false,
    controlPoll: () => "pause",
  });
  try {
    // Worker admission settles asynchronously before its first scheduled wait.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const first = scheduler.pending()[0]; assert.ok(first);
    assert.equal(first.deadlineMonotonicMs, f.clock.monotonicMs() + initial);
    assert.equal(f.save({ "daemon.idleRepollMs": { set: initial + 1_000 } }).state, "applied");
    assert.equal(scheduler.pending().length, 1);
    assert.equal(scheduler.pending()[0]?.deadlineMonotonicMs, first.deadlineMonotonicMs);
    first.fire();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(scheduler.pending()[0]?.deadlineMonotonicMs, f.clock.monotonicMs() + initial + 1_000);
    assert.equal(sessions.opens(), 0);
  } finally { stop.abort(); await looping; }
});
