import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { createOperatorProjection, queueDayRead, warmDayOf, WARM_DAY_RUN_LIMIT } from "../../../../../src/backend/app/composition/dashboard/queue.js";
import { createCopySamples, sampleWorkerId, type CopySampleSession } from "../../../../../src/backend/app/composition/dashboard/copy-samples.js";
import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { AuthoritySnapshotChangedError } from "../../../../../src/backend/storage/sqlite/authority-errors.js";
import { createComposedDashboardReadHost } from "../../../../../src/backend/app/composition/dashboard/runtime-resources.js";
import { DESCRIPTORS, descriptorSetHash } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { admitReadLane, openReadLane, prepareReadLaneStart } from "../../../../../src/backend/storage/sqlite/read-lane-admission.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import { DashboardDayWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { searchPartitionDay } from "../../../../../src/models/dashboard/search-calendar.js";
import { systemIdFactory } from "../../../../../src/rules/identity/identifiers.js";
import { foundationFixture } from "../../../../support/helpers/database-foundation/fixtures.js";
import { personLookupDescriptor } from "../../../../support/helpers/registered-workflows.js";

const cleanups: (() => unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

it("serves a seeded copy's Queue day and sample Sessions cards through the read lane", async () => {
  const f = await foundationFixture();
  cleanups.push(() => f.dispose());
  const lanes = createComposedDashboardReadHost({ admission: f.profile.admission, database: f.db, clock: f.clock, lanes: ["navigation"] });
  cleanups.push(() => lanes.close());
  const resolve = (id: string) => id === personLookupDescriptor.id ? personLookupDescriptor : undefined;
  const reader = new RunRecordService({ database: f.db, clock: f.clock, ids: systemIdFactory,
    publishQueued: () => { throw new Error("Queue day cannot publish a run"); }, resolveDescriptor: resolve });
  const session: CopySampleSession = { workflow: "person-lookup", ordinal: 9001, state: "waiting",
    startedAt: f.clock.now().toISOString(), browsers: [{ system: "ucpath", health: "starting", duo: true }] };
  const workerId = sampleWorkerId(session);
  const samples = createCopySamples({ stored: { runIds: [], sessions: [{ workerId, payload: session }] },
    realSlots: () => f.db.authority.workerSlots.list(), changed() {} });
  const projection = createOperatorProjection({ database: f.db, reader, stateRoot: f.root, clock: f.clock, appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash(DESCRIPTORS.map(descriptor => descriptor.contractFingerprint)), ledger: createTransactionHistory(f.db.authority),
    descriptors: { resolve }, readLanes: lanes, workerMembers: samples.views, samples });
  const day = searchPartitionDay(new Date(f.run.envelope.enqueuedAt));
  const read = await projection.requestDashboardDay(day);
  assert.equal(read.foldedHere, false);
  const wire = DashboardDayWireSchema.parse(JSON.parse(projection.stampDay(day, read, read.dispatchCursor)));
  assert.ok(wire.queueSurfaces.some(row => row.runId === f.run.envelope.runId));
  const card = wire.workerCards.find(row => row.workerId === workerId);
  assert.ok(card?.sample === true);
  assert.equal(card.browsers[0]?.signIn, "needs-duo");
  assert.ok(!wire.workerAuthority.members.some(member => member.workerId === workerId));
});

describe("the queue day read's warm step", () => {
  it("folds before ready, and leaves its optional day build's refusal to the host", async () => {
    const f = await foundationFixture();
    cleanups.push(() => f.dispose());
    const lane = admitReadLane(prepareReadLaneStart(f.profile.admission, f.db, "navigation"));
    cleanups.push(() => lane.admission.release());
    const opened = openReadLane(lane, 250);
    cleanups.push(() => opened.native.close());
    const context = { start: lane.start, native: opened.native, history: opened.history, nowMs: f.clock.nowMs(), retain: () => {} };
    Object.defineProperty(opened.history, "readQueueDayCounts", { configurable: true, value: () => { throw new AuthoritySnapshotChangedError(); } });
    assert.doesNotThrow(() => opened.history.withAuthorityReadSnapshot(() => queueDayRead.warm?.(context)), "the fold reads no day counts");
    assert.throws(() => opened.history.withAuthorityReadSnapshot(() => queueDayRead.prebuild?.(context)), AuthoritySnapshotChangedError,
      "the day build is a prebuild, which the host skips on a refusal");
    Reflect.deleteProperty(opened.history, "readQueueDayCounts");

    const day = searchPartitionDay(new Date(f.run.envelope.enqueuedAt));
    const body = opened.history.withAuthorityReadSnapshot(() => queueDayRead.run({ ...context, processFacts: { workers: [], startupPending: [] }, snapshotAt: () => {} },
      queueDayRead.args.parse({ day })));
    assert.equal(z.object({ queueSurfaces: z.array(z.unknown()) }).parse(body.d).queueSurfaces.length, 1,
      "the folded replica serves the day");
  });

  it("fails the lane's boot when its fold degrades", async () => {
    const f = await foundationFixture();
    cleanups.push(() => f.dispose());
    const lane = admitReadLane(prepareReadLaneStart(f.profile.admission, f.db, "navigation"));
    cleanups.push(() => lane.admission.release());
    const opened = openReadLane(lane, 250);
    cleanups.push(() => opened.native.close());
    const context = { start: lane.start, native: opened.native, history: opened.history, nowMs: f.clock.nowMs(), retain: () => {} };
    const authority = opened.history.authority;
    const timelineEvents = Object.create(authority.timelineEvents, { withReadSnapshot: { value: () => { throw new Error("timeline-unreadable"); } } }) as typeof authority.timelineEvents;
    Object.defineProperty(opened.history, "authority", { configurable: true, value: Object.create(authority, { timelineEvents: { value: timelineEvents } }) as typeof authority });
    assert.throws(() => opened.history.withAuthorityReadSnapshot(() => queueDayRead.warm?.(context)), /queue-day-fold-degraded/u,
      "a degraded replica never reports ready");
  });

  it("builds the smallest recent day with runs, never one over its run limit", () => {
    assert.equal(warmDayOf(new Map([["2026-11-20", 1180], ["2026-11-21", 49], ["2026-11-22", 3], ["2026-11-24", 3]])), "2026-11-24",
      "the smallest day, the most recent of a tie");
    assert.equal(warmDayOf(new Map([["2026-11-20", WARM_DAY_RUN_LIMIT + 1]])), undefined, "a day over the limit is not built");
    assert.equal(warmDayOf(new Map()), undefined);
  });
});
