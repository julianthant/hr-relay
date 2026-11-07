import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { claimEventOf, DAY, traceOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";

const {world, runRecordOf, queuedEventOf, CLAIM, seedExitRunShape, cleanup } = createRunQueueProjectionTestWorld();


afterEach(cleanup);

describe("settled run presentation retains skip reasons and measured timing", () => {
  it("serves the terminal instant on a settled row and an explicit absence while in flight", async () => {
    const w = await world();
    seedExitRunShape(w);
    queuedEventOf(w, { seed: 2 });
    w.authority.put(runRecordOf({
      seed: 2, lifecycle: { state: "running", ...CLAIM }, claimGeneration: 1, version: 2,
    }));
    claimEventOf(w, 2);

    const day = w.projection.buildDashboardDayWire(DAY);
    const done = day.queueSurfaces.find((surface) => surface.runId === uuidOf(1));
    const running = day.queueSurfaces.find((surface) => surface.runId === uuidOf(2));
    assert.ok(done && running);
    assert.deepEqual(done.endedAt, { state: "present", value: "2026-08-03T17:14:30.000Z" });
    assert.equal(running.endedAt.state, "absent");
  });

  it("ignores a stale run end and leaves a nonterminal run undated", async () => {
    const w = await world();
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    // The span contradicts canonical queued authority; neither status nor duration may follow it.
    w.writer.emit({
      t: "span.ended", kind: "run", ts: "2026-08-03T17:20:00.000Z", workflow: "person-lookup",
      runId: uuidOf(1), attempt: 1, traceId: traceOf(1), spanPath: traceOf(1), outcome: "cancelled",
    });
    const surface = w.projection.buildDashboardDayWire(DAY).queueSurfaces
      .find((row) => row.runId === uuidOf(1));
    assert.ok(surface);
    assert.equal(surface.status, "queued");
    assert.deepEqual(surface.endedAt, { state: "absent", reason: "run is queued and has not ended" });
  });
});
