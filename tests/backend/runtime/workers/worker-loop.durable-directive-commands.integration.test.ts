import { createWorkerDirectiveTestWorld } from "../../../support/helpers/backend/worker-directive-world.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "vitest";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";
import { testAdmittedWorker, testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { workflowProjections } from "../../../../src/workflow-kit/workflow.js";
import { admitWorkerReset } from "../../../../src/backend/storage/sqlite/worker-control.js";

const {loopHarness, cleanup } = createWorkerDirectiveTestWorld();

afterEach(cleanup);

describe("durable worker directives (ref dashboard-surfaces), observed between items", () => {
  it("stops without claiming when the directive says stop", async () => {
    const harness = await loopHarness();
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
    const harness = await loopHarness({ exitWhenIdle: false });
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

  for (const directive of ["pause", "stop"] as const) {
    it(`finishes the actual active read run before observing its durable ${directive} directive`, async () => {
      const harness = await loopHarness({ exitWhenIdle: false });
      const database = harness.authority.database;
      database.authority.runs.enqueue(personLookupQueuedRun());
      const nextRunId = "ffffffff-ffff-4fff-8fff-fffffffffffe";
      assert.ok(RUN_ID < nextRunId);
      database.authority.runs.enqueue(personLookupQueuedRun({ runId: nextRunId, itemId: randomUUID() }));
      let changed = false, polls = 0;
      const report = await runWorkerLoop({ ...harness.deps,
        emitter: { emit(event) {
          harness.deps.emitter.emit(event);
          if (!changed && event.t === "span.started" && event.kind === "task") {
            const lease = database.authority.workerLeases.get(harness.deps.workerId);
            assert.ok(lease);
            const run = database.authority.runs.get(RUN_ID);
            assert.ok(run?.lifecycle.state === "running");
            const now = harness.authority.clock.now().toISOString();
            assert.equal(database.authority.workerLeases.control({ workerId: lease.workerId, expectedVersion: lease.version,
              now, control: { directive, requestedAt: now, requestedBy: "local-operator" } }).state, "applied");
            harness.deps.lifecycle.assertCurrentExecution({ runId: RUN_ID,
              claim: { workerId: lease.workerId, claimGeneration: run.claimGeneration } });
            changed = true;
          }
        } },
        controlPoll: () => {
          polls++;
          const lease = database.authority.workerLeases.get(harness.deps.workerId); assert.ok(lease);
          if (changed) {
            const current = database.authority.runs.get(RUN_ID);
            assert.ok(current?.lifecycle.state === "terminal" && current.lifecycle.outcome === "done");
            if (directive === "pause") queueMicrotask(() => harness.stop.abort(new Error("completed paused fixture")));
          }
          return lease.control.directive;
        },
      });
      assert.equal(changed, true);
      assert.equal(polls, 2);
      assert.equal(report.stopped, directive === "stop" ? "stop-directive" : "stop-signal");
      assert.equal(report.outcomes.length, 1);
      assert.equal(report.outcomes[0]?.state, "done");
      assert.equal(database.authority.workerLeases.get(harness.deps.workerId)?.control.directive, directive);
      const run = database.authority.runs.get(RUN_ID);
      assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
      assert.ok(database.authority.runResults.get(RUN_ID));
      assert.equal(database.authority.runs.get(nextRunId)?.lifecycle.state, "queued");
      assert.equal(database.authority.runResults.get(nextRunId), undefined);
    });
  }

  it("finishes the actual active read while an unrelated member has a genuine pending lifecycle control", async () => {
    const harness = await loopHarness(), database = harness.authority.database;
    database.authority.runs.enqueue(personLookupQueuedRun());
    let pending: ReturnType<typeof admitWorkerReset> | undefined;
    const report = await runWorkerLoop({ ...harness.deps, emitter: { emit(event) {
      harness.deps.emitter.emit(event);
      if (pending === undefined && event.t === "span.started" && event.kind === "task") {
        const owner = testAdmittedWorker(database, harness.authority.clock, { path: harness.authority.path,
          workflow: harness.deps.workflowId, poolIndex: 2, browserSystems: workflowProjections(personLookupDescriptor).systems });
        assert.notEqual(owner.workerId, harness.deps.workerId);
        const now = harness.authority.clock.now().toISOString();
        pending = database.withAuthorityTransaction(repositories => admitWorkerReset(repositories, {
          commandId: randomUUID(), family: "worker-browser", type: "stop-worker", source: "dashboard",
          requestedBy: "local-operator", requestedAt: now, target: { workerId: owner.workerId,
            membershipRevision: owner.member.membershipRevision,
            controlBasis: { leaseGeneration: owner.lease.leaseGeneration, controlRevision: owner.lease.controlRevision } },
        }, randomUUID(), now));
        const run = database.authority.runs.get(RUN_ID); assert.ok(run?.lifecycle.state === "running");
        harness.deps.lifecycle.assertCurrentExecution({ runId: RUN_ID,
          claim: { workerId: harness.deps.workerId, claimGeneration: run.claimGeneration } });
      }
    } } });
    assert.ok(pending);
    assert.equal(report.stopped, "idle");
    assert.equal(report.outcomes.length, 1); assert.equal(report.outcomes[0]?.state, "done");
    assert.equal(database.authority.workerControls.get(pending.commandId)?.phase.state, "admitted");
    assert.equal(database.authority.workerControls.lifecycleForWorker(harness.deps.workerId), undefined);
    const run = database.authority.runs.get(RUN_ID);
    assert.ok(run?.lifecycle.state === "terminal" && run.lifecycle.outcome === "done");
    assert.ok(database.authority.runResults.get(RUN_ID));
    assert.ok(pending.reset);
    database.authority.workerControls.transition(pending.commandId, "admitted", { state: "executing",
      startedAt: harness.authority.clock.now().toISOString() });
    testRunService(database, harness.authority.clock).settleResetWork(pending.reset);
  });

  it("refuses to run when the directive cannot be read", async () => {
    const harness = await loopHarness();
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
    const harness = await loopHarness();
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
