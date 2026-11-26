import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createDashboardReadHost } from "../../../../../src/backend/storage/sqlite/dashboard-read-host.js";
import { DashboardDayWireSchema, type DashboardDayWire } from "../../../../../src/models/dashboard/projection.js";
import { searchPartitionDay } from "../../../../../src/models/dashboard/search-calendar.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
import { LANE_SOURCE_PROOF_ENTRY, perReadRead, perStatementRead, restoreSource } from "../../../../support/fixtures/backend/dashboard-lane-source-proof.js";
import { LANE_WARM_ENTRY, lanePrebuilt, laneWarmed, WARM_MS } from "../../../../support/fixtures/backend/dashboard-lane-warm-reads.js";
import { LANE_BUILD_REFUSED_ENTRY, laneFolded } from "../../../../support/fixtures/backend/dashboard-lane-build-refused.js";
import { LANE_WARM_REFUSED_ENTRY, laneWarmRefused } from "../../../../support/fixtures/backend/dashboard-lane-warm-refused.js";
import { openBoundDatabaseFixture } from "../../../../support/helpers/admission-fixture.js";
import { composedQueueLane } from "../../../../support/helpers/backend/composed-queue-lane.js";
import { id } from "../../../../support/helpers/database-foundation/fixtures.js";

const cleanups: (() => unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const unstamped = ({ snapshotCursor: _cursor, projectionGeneration: _generation, ...day }: DashboardDayWire): unknown => JSON.parse(JSON.stringify(day));
const dayOf = (body: string): unknown => unstamped(DashboardDayWireSchema.parse(JSON.parse(body)));

describe("a day the composition's navigation lane already built", () => {
  it("is rebuilt after a process-only change and after a new same-day run", async () => {
    const { f, main, members, memberOf, local } = await composedQueueLane(cleanups);
    const DAY = searchPartitionDay(new Date(f.run.envelope.enqueuedAt));
    const lane = async () => dayOf(await main.servedDashboardDay(DAY));
    const here = async () => dayOf(await local().servedDashboardDay(DAY));
    assert.deepEqual(await lane(), await here(), "the first read builds the day");

    const before = await here();
    members.push(memberOf(f.run.envelope.runId, 1));
    const after = await here();
    assert.notDeepEqual(after, before, "the pool's member shows on the day");
    assert.deepEqual(await lane(), after, "a process-only change is not served from the cached day");

    f.createRun(id(9902));
    const withRun = await here();
    assert.notDeepEqual(withRun, after, "the new run is on the day");
    assert.deepEqual(await lane(), withRun, "a new same-day run is not served from the cached day");
  });
});

describe("a lane read's source proof", () => {
  it("proves the source on every statement unless the read asks for one proof per read", async () => {
    const fixture = await openBoundDatabaseFixture("read-lane-source-proof");
    cleanups.push(() => fixture.close());
    const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock,
      lanes: ["navigation"], entry: LANE_SOURCE_PROOF_ENTRY });
    cleanups.push(() => lanes.close());
    await lanes.ready;
    const statement = JSON.parse((await lanes.read(perStatementRead, { path: fixture.path })).body) as { refusedInside: boolean };
    assert.equal(statement.refusedInside, true, "a default read refuses the statement that runs on a replaced source");
    try {
      await assert.rejects(lanes.read(perReadRead, { path: fixture.path }), /profile-database-open-source-changed/u,
        "a per-read proof refuses the read's result");
    } finally { restoreSource(fixture.path); }
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

  it("reports ready before its optional prebuild runs", async () => {
    const fixture = await openBoundDatabaseFixture("read-lane-prebuild");
    cleanups.push(() => fixture.close());
    const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock,
      lanes: ["navigation"], entry: LANE_WARM_ENTRY });
    cleanups.push(() => lanes.close());
    await lanes.ready;
    const readyAt = systemClock.nowMs();
    const reply = JSON.parse((await lanes.read(lanePrebuilt, {})).body) as { prebuiltAt: number | null };
    assert.ok(reply.prebuiltAt !== null && reply.prebuiltAt > readyAt, "the prebuild finished after ready was announced, and before the first read");
  });

  it("boots ready when a peer commit refuses the optional day build's snapshot before the build starts", async () => {
    const fixture = await openBoundDatabaseFixture("read-lane-build-refused");
    cleanups.push(() => fixture.close());
    const lanes = createDashboardReadHost({ admission: fixture.profile.admission, database: fixture.database, clock: systemClock,
      lanes: ["navigation"], entry: LANE_BUILD_REFUSED_ENTRY });
    cleanups.push(() => lanes.close());
    await lanes.ready;
    assert.deepEqual(JSON.parse((await lanes.read(laneFolded, {})).body), { built: false }, "the refused build is skipped, and the lane serves");
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
