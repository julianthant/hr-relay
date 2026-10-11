import { testWorkerPorts } from "../../../support/fixtures/run-lifecycle-fixtures.js";

import assert from "node:assert/strict";
import { afterEach,describe,it } from "vitest";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import {
runWorkerLoop,
type WorkerLoopDependencies
} from "../../../../src/backend/runtime/workers/worker-loop.js";
import { WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { RUN_ID,sequentialIdFactory,WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import {
EXECUTOR_WORKER_ID,
happySessionHarness,
ManualScheduler,
openAuthorityHarness,
personLookupQueuedRun,
recordingLogger,
recordingTimelineEmitter,
type SessionFactoryHarness
} from "../../../support/helpers/phase1f-executor-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

function loopHarness(options: Readonly<{
  sessions?: SessionFactoryHarness;
  heartbeatIntervalMs?: number;
  exitWhenIdle?: boolean;
}> = {}) {
  const authority = openAuthorityHarness();
  disposers.push(authority.dispose);
  const sessions = options.sessions ?? happySessionHarness();
  const scheduler = new ManualScheduler(authority.clock, 0);
  const emitter = recordingTimelineEmitter(authority.database, authority.clock);
  const stop = new AbortController();
  const deps: WorkerLoopDependencies = {
    ...testWorkerPorts(authority.database, authority.clock, { path: authority.path, descriptor: personLookupDescriptor, poolIndex: 1 }),
    workflowId: WorkflowIdSchema.parse(WORKFLOW_ID),
    workerId: EXECUTOR_WORKER_ID,
    descriptor: personLookupDescriptor,
    stores: taskStoreRegistry,
    authority: authority.database,
    sessionFactory: sessions.factory,
    emitter: emitter.emitter,
    clock: authority.clock,
    ids: sequentialIdFactory("c"),
    scheduler,
    taskDeadlineMs: 60_000,
    sessionAcquireMs: 20_000,
    duoCeremony: fixtureDuoCeremonyGates(authority.clock),
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 500,
    idleRepollMs: 1_000,
    log: recordingLogger().log,
    stopSignal: stop.signal,
    exitWhenIdle: options.exitWhenIdle ?? true,
  };
  return { authority, sessions, scheduler, emitter, stop, deps };
}

describe("durable worker directives (ref dashboard-surfaces §2.4), observed between items", () => {
  it("stops without claiming when the directive says stop", async () => {
    const harness = loopHarness();
    harness.authority.database.authority.runs.enqueue(personLookupQueuedRun());
    const polls: string[] = [];

    const report = await runWorkerLoop({
      ...harness.deps,
      controlPoll: () => {
        polls.push("stop");
        return "stop";
      },
    });

    assert.equal(report.stopped, "stop-directive");
    assert.deepEqual(report.outcomes, []);
    assert.deepEqual(polls, ["stop"]);

    assert.equal(harness.authority.database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
    assert.equal(harness.sessions.opens(), 0);
  });

  it("claims nothing while paused and re-polls on the bounded idle cadence", async () => {
    // exitWhenIdle=false so the pause branch is the ONLY reason it loops.
    const harness = loopHarness({ exitWhenIdle: false });
    harness.authority.database.authority.runs.enqueue(personLookupQueuedRun());
    let polls = 0;

    const looping = runWorkerLoop({
      ...harness.deps,
      controlPoll: () => {
        polls += 1;
        // The bounded idle wait resolves on abort, which ends the loop.
        if (polls === 1) queueMicrotask(() => harness.stop.abort(new Error("operator stop")));
        return "pause";
      },
    });
    const report = await looping;

    assert.equal(report.stopped, "stop-signal");
    assert.deepEqual(report.outcomes, []);
    assert.equal(harness.authority.database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
    assert.equal(harness.sessions.opens(), 0);
  });

  it("refuses to run when the directive cannot be read", async () => {
    const harness = loopHarness();
    harness.authority.database.authority.runs.enqueue(personLookupQueuedRun());
    await assert.rejects(
      runWorkerLoop({
        ...harness.deps,
        controlPoll: () => {
          throw new Error("worker lease disappeared");
        },
      }),
      /worker lease disappeared/,
    );
    assert.equal(harness.authority.database.authority.runs.get(RUN_ID)?.lifecycle.state, "queued");
  });

  it("refuses two competing write-sequencer seams", async () => {
    const harness = loopHarness();
    const sequencer = {
      executeTransaction: () => Promise.resolve(undefined),
      executeDryRun: () => Promise.resolve(undefined),
    };
    await assert.rejects(
      runWorkerLoop({ ...harness.deps, writeSequencer: sequencer, writeSequencerFor: () => sequencer }),
      /exactly one seam may own the sequencer/,
    );
  });
});
