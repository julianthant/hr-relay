import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";

const { world, queuedEventOf, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);
it("links a child with its canonical day across midnight while keeping each row in its own partition", async () => {
  const w = await world();
  queuedEventOf(w, { seed: 1, enqueuedAt: new Date(2026, 7, 3, 23, 59).toISOString() });
  queuedEventOf(w, { seed: 2, parentSeed: 1, enqueuedAt: new Date(2026, 7, 4, 0, 1).toISOString() });
  const parentDay = w.projection.buildDashboardDayWire("2026-08-03");
  const childDay = w.projection.buildDashboardDayWire("2026-08-04");
  assert.deepEqual(parentDay.queueSurfaces.map(row => row.runId), [uuidOf(1)]);
  assert.deepEqual(childDay.queueSurfaces.map(row => row.runId), [uuidOf(2)]);
  assert.deepEqual(parentDay.queueSurfaces[0].linkedRuns, [{ runId: uuidOf(2), partitionDay: "2026-08-04",
    workflowId: "person-lookup", label: "person-lookup", panelKind: "run", status: "queued" }]);
});
