import assert from "node:assert/strict";
import { Hono } from "hono";
import { afterEach, it } from "vitest";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { composeQueueSummaries } from "../../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { createRunQueueProjection } from "../../../../src/backend/runs/projections/run-queue-projection.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import type { DashboardApp } from "../../../../src/backend/transports/http/routes/api-types.js";
import { registerQueueRoutes } from "../../../../src/backend/transports/http/routes/queue.js";
import { DashboardStreamHub } from "../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { APP_VERSION, DAY, DESCRIPTOR_SET_HASH, queuedEventOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";

const { world, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);

it("retries a failed rebuild on the next poll and resumes tail ingestion", async () => {
  const w = await world();
  queuedEventOf(w, { seed: 1 });
  let failuresRemaining = 2;
  const projection = createRunQueueProjection({
    timeline: {
      ...w.timeline,
      page(input) {
        if (failuresRemaining > 0) {
          failuresRemaining -= 1;
          throw new Error("simulated transient timeline read failure");
        }
        return w.timeline.page(input);
      },
    },
    reader: w.runReader,
    stateRoot: w.stateRoot,
    clock: w.clock,
    appVersion: APP_VERSION,
    descriptorSetHash: DESCRIPTOR_SET_HASH,
    ledger: createTransactionHistory(w.database.authority),
    authority: w.authority,
    descriptors: { resolve: () => undefined },
  });

  projection.ingestFromTimeline();
  assert.equal(projection.health().state, "degraded");
  assert.match(projection.health().lastError ?? "", /timeline rebuild failed/);
  assert.throws(() => projection.buildDashboardDayWire(DAY), /projection is degraded/);

  projection.ingestFromTimeline();
  assert.equal(projection.health().state, "live");
  assert.ok(projection.runFold(uuidOf(1)));

  queuedEventOf(w, { seed: 2 });
  projection.ingestFromTimeline();
  assert.deepEqual(projection.buildDashboardDayWire(DAY).queueSurfaces.map(row => row.runId), [uuidOf(1), uuidOf(2)]);
});

it("shares an unchanged day across a GET and stream connects and refreshes it when the runs change", async () => {
  const w = await world();
  queuedEventOf(w, { seed: 1 });
  const summaries = composeQueueSummaries(w.database);
  let queueReads = 0;
  let runLists = 0;
  const unexpected = (): never => { throw new Error("unexpected command or Activity read"); };
  const projection = createOperatorProjection({
    database: w.database,
    reader: {
      ...w.runReader,
      list(input) {
        runLists += 1;
        return w.runReader.list(input);
      },
      summaries: { ...summaries, activity: unexpected, queue(input) {
        assert.equal(input.fromDay, DAY);
        assert.equal(input.toDay, DAY);
        queueReads += 1;
        return summaries.queue(input);
      } },
    },
    stateRoot: w.stateRoot,
    clock: w.clock,
    appVersion: APP_VERSION,
    descriptorSetHash: DESCRIPTOR_SET_HASH,
    ledger: createTransactionHistory(w.database.authority),
    descriptors: { resolve: () => undefined },
    workerMembers: () => [],
  });
  projection.rebuildFromTimeline();
  assert.equal(projection.health().state, "live");
  const app: DashboardApp = new Hono();
  registerQueueRoutes(app, { queue: { day: day => projection.buildDashboardDayWire(day) },
    startPlans: { plan: unexpected, previewWarnings: unexpected } });
  const hub = new DashboardStreamHub({ projection, backfillGaps: { detected: unexpected } });
  try {
    const readDay = () => app.request(`/api/v1/dashboard?day=${DAY}`);
    const first = await readDay();
    assert.equal(first.status, 200);
    const wire: unknown = await first.json();
    assert.equal(queueReads, 1);
    for (let tab = 0; tab < 2; tab += 1) {
      const connection = await hub.connect({ day: DAY });
      const snapshot = connection.initial.find(event => event.type === "snapshot");
      assert.ok(snapshot);
      assert.equal(JSON.stringify(snapshot.payload), JSON.stringify(wire));
      connection.close();
    }
    const listsBeforeDiagnostics = runLists;
    const cursorBeforeDiagnostics = projection.cursor();
    const debug = createDebugEventWriter({ repository: w.timeline, clock: w.clock, build: APP_VERSION });
    assert.equal(debug.emit({ category: "boot", phase: "failed", correlationId: uuidOf(99),
      area: "integration", reason: "unrelated-timeline-write" }).state, "inserted");
    projection.ingestFromTimeline();
    projection.reconcileWorkerAuthority();
    assert.equal(runLists, listsBeforeDiagnostics, "unrelated authority changes skip the canonical run listing");
    assert.equal(projection.cursor(), cursorBeforeDiagnostics);
    const repeated = await readDay();
    assert.equal(repeated.status, 200);
    assert.deepEqual(await repeated.json(), wire);
    assert.equal(queueReads, 1, "every unchanged request reuses the day build");

    queuedEventOf(w, { seed: 2 });
    const updated = await readDay();
    assert.equal(updated.status, 200);
    assert.notDeepEqual(await updated.json(), wire);
    assert.equal(queueReads, 2, "a durable run change invalidates the cached day before the next poll");
  } finally {
    hub.close();
  }
});
