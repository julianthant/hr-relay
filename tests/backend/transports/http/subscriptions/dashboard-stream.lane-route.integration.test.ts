import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, describe, it } from "vitest";
import { createOperatorProjection } from "../../../../../src/backend/app/composition/dashboard/queue.js";
import { composeQueueSummaries } from "../../../../../src/backend/app/composition/dashboard/queue-summaries.js";
import { DESCRIPTORS, descriptorSetHash, READABLE_WORKFLOW_MODULES } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { BackfillGapObservationSchema } from "../../../../../src/backend/runs/notifications/backfill-gap.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { createDashboardReadHost } from "../../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import { createDashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import { searchPartitionDay } from "../../../../../src/models/dashboard/search-calendar.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
import { LANE_WARM_ENTRY, laneWarmed, WARM_MS } from "../../../../support/fixtures/backend/dashboard-lane-warm-reads.js";
import { LANE_WARM_REFUSED_ENTRY, laneWarmRefused } from "../../../../support/fixtures/backend/dashboard-lane-warm-refused.js";
import { openBoundDatabaseFixture } from "../../../../support/helpers/admission-fixture.js";
import { foundationFixture, id } from "../../../../support/helpers/database-foundation/fixtures.js";

const cleanups: (() => unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** The lane entry the dashboard's composition starts its read lanes from. */
const COMPOSED_LANE_ENTRY = new URL("../../../../../src/backend/app/composition/dashboard/read-lane-entry.js", import.meta.url);
const APP_VERSION = (JSON.parse(readFileSync(new URL("../../../../../package.json", import.meta.url), "utf8")) as { version: string }).version;
const SET_HASH = descriptorSetHash(DESCRIPTORS.map(descriptor => descriptor.contractFingerprint));

/** Methods the host needs to hold the lanes and close the store; every other main-connection read refuses. */
const HOST_METHODS = new Set(["constructor", "holdCheckpointCustody", "retainDashboardReadSource", "close"]);

/** Makes every read on main's own connection throw, until the returned restore runs. */
function refuseMainReads(database: AuthorityDatabase): () => void {
  const names = Object.getOwnPropertyNames(AuthorityDatabase.prototype).filter(name => !HOST_METHODS.has(name)
    && typeof Object.getOwnPropertyDescriptor(AuthorityDatabase.prototype, name)?.value === "function");
  const authority = Object.getOwnPropertyDescriptor(database, "authority");
  for (const name of names) Object.defineProperty(database, name, { configurable: true, value: () => { throw new Error(`main-connection-read: ${name}`); } });
  Object.defineProperty(database, "authority", { configurable: true, get: () => { throw new Error("main-connection-read: authority"); } });
  return () => {
    for (const name of names) Reflect.deleteProperty(database, name);
    if (authority !== undefined) Object.defineProperty(database, "authority", authority);
  };
}

async function composed() {
  const f = await foundationFixture();
  cleanups.push(() => f.dispose());
  const lanes = createDashboardReadHost({ admission: f.profile.admission, database: f.db, clock: f.clock, lanes: ["navigation"], entry: COMPOSED_LANE_ENTRY });
  cleanups.push(() => lanes.close());
  await lanes.ready;
  const reader = new RunRecordService({ database: f.db, clock: f.clock, ids: { uuid: () => id(9901) }, publishQueued: () => {} });
  const servedReader = { read: reader.read.bind(reader), list: reader.list.bind(reader), withRunTreeSnapshot: reader.withRunTreeSnapshot.bind(reader),
    summaries: { ...composeQueueSummaries(f.db), activity: () => { throw new Error("activity-unserved"); } } };
  const options = { database: f.db, stateRoot: f.root, clock: f.clock, appVersion: APP_VERSION, descriptorSetHash: SET_HASH,
    ledger: createTransactionHistory(f.db.authority),
    // The descriptors the lane's replica resolves, as the dashboard's composition passes them to main.
    descriptors: { resolve: (workflowId: string) => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === workflowId)?.descriptor }, reader: servedReader, workerMembers: () => [] };
  const main = createOperatorProjection({ ...options, readLanes: lanes });
  const local = createOperatorProjection(options);
  return { f, main, local };
}

const unstamped = ({ snapshotCursor: _cursor, projectionGeneration: _generation, ...day }: DashboardDayWire): unknown => JSON.parse(JSON.stringify(day));

describe("the queue day through the composition's navigation lane", () => {
  it("serves GET and the SSE handoff from the lane while every main-connection read throws", async () => {
    const { f, main, local } = await composed();
    const DAY = searchPartitionDay(new Date(f.run.envelope.enqueuedAt));
    const expected = DashboardDayWireSchema.parse(JSON.parse(await local.servedDashboardDay(DAY)));
    assert.ok(expected.queueSurfaces.length > 0, "the fixture's run is on the day");
    const hub = createDashboardStreamHub({ projection: main,
      backfillGaps: { detected: input => Promise.resolve({ published: false as const, gap: BackfillGapObservationSchema.parse(input) }) } });
    cleanups.push(() => hub.close());

    const restore = refuseMainReads(f.db);
    cleanups.push(restore);
    assert.throws(() => f.db.authority, /main-connection-read/u);
    const served = DashboardDayWireSchema.parse(JSON.parse(await main.servedDashboardDay(DAY)));
    assert.deepEqual(unstamped(served), unstamped(expected), "the lane's day is the day main would build");
    assert.equal(served.projectionGeneration, main.generation());
    assert.equal(served.snapshotCursor, main.cursor());

    const connection = await hub.connect({ day: DAY });
    const snapshot = connection.initial.find(envelope => envelope.type === "snapshot");
    assert.ok(snapshot?.type === "snapshot");
    assert.deepEqual(unstamped(snapshot.payload), unstamped(expected));
    assert.equal(snapshot.payload.snapshotCursor, snapshot.cursor);
    connection.close();
  });
});

describe("a lane read's warm step", () => {
  it("runs before the lane reports ready, once", async () => {
    const fixture = await openBoundDatabaseFixture("read-lane-warm");
    cleanups.push(() => fixture.close());
    const started = performance.now();
    const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock,
      lanes: ["navigation"], entry: LANE_WARM_ENTRY });
    cleanups.push(() => lanes.close());
    await lanes.ready;
    assert.ok(performance.now() - started >= WARM_MS, "ready waits for the warm step");
    const reply = JSON.parse((await lanes.read(laneWarmed, {})).body) as { warms: number; warmedAt: number | null };
    assert.equal(reply.warms, 1);
    assert.notEqual(reply.warmedAt, null);
  });

  it("fails the lane's boot when it throws", async () => {
    const fixture = await openBoundDatabaseFixture("read-lane-warm-refused");
    cleanups.push(() => fixture.close());
    const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock,
      lanes: ["navigation"], entry: LANE_WARM_REFUSED_ENTRY });
    cleanups.push(() => lanes.close());
    await assert.rejects(lanes.ready, /lane-warm-refused/u);
    await assert.rejects(lanes.read(laneWarmRefused, {}));
  });
});
