import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "vitest";
import { requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { WORK_CONTROL_POLL_MS } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { RunDryRunPreviewResultSchema } from "../../../../src/models/run/result.js";
import { testRunService } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { absentProbeEvidence, WRITE_FIXTURE_NOW, WRITE_FIXTURE_RUN_ID, writeFixtureQueuedRun } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { createDryRunPreviewResultTestWorld } from "../../../support/helpers/backend/dry-run-preview-result-world.js";

const { harness, cleanup } = createDryRunPreviewResultTestWorld();
afterEach(cleanup);

type Harness = Awaited<ReturnType<typeof harness>>;
const tick = () => new Promise<void>(resolve => { setImmediate(resolve); });

/** Fires the work-control poll and idle re-poll timers until the condition holds. */
async function pump(h: Harness, until: () => boolean): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if (until()) return;
    const now = h.clock.monotonicMs();
    for (const timer of h.scheduler.pending()) {
      const delay = timer.deadlineMonotonicMs - now;
      if ((delay === WORK_CONTROL_POLL_MS || delay === 1_000) && !timer.cancelled()) timer.fire();
    }
    await tick();
  }
  assert.fail(`condition not reached; run is ${JSON.stringify(h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID)?.lifecycle)}`);
}

const current = (h: Harness) => { const run = h.database.authority.runs.get(WRITE_FIXTURE_RUN_ID); assert.ok(run); return run; };

describe("a dry run paused mid-preview resumes in the same process (ref workers-pause-cancels-step)", () => {
  for (const role of ["probe", "prepare"] as const) {
    it(`Pause during the ${role} span, then Resume, finishes the preview with one span per claim`, async () => {
      const h = await harness();
      let entered = false;
      const never = new Promise<void>(() => undefined);
      if (role === "probe") {
        h.world.probeWait = never;
        h.world.prepareSteps = undefined;
      } else {
        let first = true;
        h.world.prepareSteps = async () => { if (!entered) { entered = true; await never; } };
      }
      h.world.probeResults.push(absentProbeEvidence(WRITE_FIXTURE_NOW), absentProbeEvidence(WRITE_FIXTURE_NOW));
      const stop = new AbortController();
      const loop = h.loop(stop.signal);
      try {
        assert.equal(h.database.authority.runs.enqueue(writeFixtureQueuedRun({ dryRun: true })).state, "inserted");
        await pump(h, () => role === "probe" ? h.world.events.includes("probe") : entered);
        const firstGeneration = current(h).claimGeneration;
        requireLifecycleApplied(testRunService(h.database, h.clock).pause({ commandId: randomUUID(), runId: WRITE_FIXTURE_RUN_ID, expectedVersion: current(h).version }));
        await pump(h, () => current(h).lifecycle.state === "queued" && current(h).pause?.state === "paused");

        if (role === "probe") h.world.probeWait = undefined;
        requireLifecycleApplied(testRunService(h.database, h.clock).resumePaused({ commandId: randomUUID(), runId: WRITE_FIXTURE_RUN_ID, expectedVersion: current(h).version }));
        await pump(h, () => current(h).lifecycle.state === "terminal");
        assert.deepEqual(h.emitRefusals, []);

        assert.deepEqual(current(h).lifecycle.state === "terminal" && current(h).lifecycle.outcome, "done",
          JSON.stringify({ lifecycle: current(h).lifecycle, result: h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID)?.result }));
        assert.ok(current(h).claimGeneration > firstGeneration);
        const result = h.database.authority.runResults.get(WRITE_FIXTURE_RUN_ID);
        assert.ok(result);
        assert.deepEqual(RunDryRunPreviewResultSchema.parse(result.result.value).steps.map(step => [step.nodeId, step.state]),
          [["submit-write", "transaction-preview"]]);
        const started = h.emitter.events().flatMap(event => event.t === "span.started" && event.kind === "task" && event.spanPath.includes("/submit-write/") ? [event.spanPath] : []);
        const roleStarts = (name: string) => started.filter(path => path.includes(`/submit-write/${name}`)).length;
        assert.equal(new Set(started).size, started.length);
        assert.equal(roleStarts("probe"), 2, "the probe runs once per claim");
        assert.equal(roleStarts("prepare"), role === "probe" ? 1 : 2, "the prepare runs once per claim that reached it");
        assert.equal(h.world.events.filter(event => event.startsWith("commit-click")).length, 0);
      } finally {
        stop.abort(new Error("test done"));
        await loop;
      }
    });
  }
});
