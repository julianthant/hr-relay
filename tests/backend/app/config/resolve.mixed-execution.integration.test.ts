import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach,it,vi } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { settingsFixture } from "../../../support/helpers/backend/settings-activation-fixture.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { EXECUTOR_WORKER_ID,ManualScheduler,happySessionHarness,recordingLogger,recordingTimelineEmitter } from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
const cleanups: (() => void)[] = [];
afterEach(() => { for (const close of cleanups.splice(0).reverse()) close(); vi.restoreAllMocks(); });
function fixture(isolateBrowser = false) { const f = settingsFixture(isolateBrowser); cleanups.push(f.close); return f; }


it("saved idle cadence applies at the next boundary without retiming the pending wait", async () => {
  const f = fixture();
  const scheduler = new ManualScheduler(f.clock, 0);
  const stop = new AbortController();
  const sessions = happySessionHarness();
  const cadence = () => resolveConfigWithProvenance(readSettings(f.database.authority).settings, f.host, f.clock).config.daemon.idleRepollMs;
  const initial = cadence();
  const looping = runWorkerLoop({ ...testWorkerPorts(f.database, f.clock, { path: f.path, descriptor: personLookupDescriptor, poolIndex: 1 }),
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
