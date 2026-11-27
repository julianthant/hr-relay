import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { z } from "zod";
import { queueDayRead, warmDayOf, WARM_DAY_RUN_LIMIT } from "../../../../../src/backend/app/composition/dashboard/queue.js";
import { AuthoritySnapshotChangedError } from "../../../../../src/backend/storage/sqlite/authority-errors.js";
import { admitReadLane, openReadLane, prepareReadLaneStart } from "../../../../../src/backend/storage/sqlite/read-lane-admission.js";
import { searchPartitionDay } from "../../../../../src/models/dashboard/search-calendar.js";
import { foundationFixture } from "../../../../support/helpers/database-foundation/fixtures.js";

const cleanups: (() => unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

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
