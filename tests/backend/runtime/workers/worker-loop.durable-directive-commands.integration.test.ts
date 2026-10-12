import { createWorkerDirectiveTestWorld } from "../../../support/helpers/backend/worker-directive-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { runWorkerLoop } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { RUN_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";

const { disposers, loopHarness } = createWorkerDirectiveTestWorld();

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

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
