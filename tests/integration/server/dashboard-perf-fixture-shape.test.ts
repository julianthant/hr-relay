/**
 * The §7.4 measurement fixture produces the shape it DECLARES.
 *
 * `npm run perf:dashboard` prints numbers, and a number is only meaningful if
 * everybody agrees what it is a number of. This suite is the agreement: it
 * seeds the real fixture once and asserts, against the production day wire and
 * the production span fold, that the world really is 1,240 rows on one day with
 * a 108-member operation and a ≥20,000-line note corpus. A seeder that quietly
 * shrank would otherwise make a baseline look like an improvement.
 *
 * It is deliberately a SHAPE test and not a timing test — this lane runs in the
 * ordinary unit project on shared CI-shaped hardware, where a duration
 * assertion would be flaky and would say nothing about the code under it.
 */
import assert from "node:assert/strict";
import { afterAll, beforeAll, describe, it } from "vitest";
import { readEventStreamLines } from "../../../src/backend/storage/events/jsonl-streams.js";
import {
  assertDashboardPerformanceStructuralBounds,
  DASHBOARD_PERFORMANCE_STRUCTURAL_BOUNDS,
  type DashboardPerformanceStructuralCounters,
} from "../../perf/dashboard-benchmark.js";
import {
  PERF_FIXTURE_PROFILE,
  seedDashboardPerfFixture,
  type PerfFixture,
} from "../../perf/dashboard-fixture.js";

// The fixture buckets rows by `localDatePart`, which reads the HOST timezone
// (`Date#getFullYear`/`getMonth`/`getDate`). Its instants are minted at
// `09:00-07:00` on `PERF_FIXTURE_PROFILE.day`, so a host west of roughly
// UTC-9 or east of UTC+7 would land some seeded rows on the neighbouring
// calendar date and this suite's exact row counts would fail on that
// machine alone. Pin the same `TZ=UTC` the `perf:dashboard` script pins, so
// the day boundary this test asserts is a property of the fixture, not of
// whoever's laptop runs it.
process.env.TZ = "UTC";

let fixture: PerfFixture;

beforeAll(() => {
  fixture = seedDashboardPerfFixture();
});

afterAll(() => {
  fixture.close();
});

describe("the §7.4 dashboard perf fixture", () => {
  it("accepts the ratified non-duration structural performance bounds", () => {
    assert.doesNotThrow(() => assertDashboardPerformanceStructuralBounds({
      ...DASHBOARD_PERFORMANCE_STRUCTURAL_BOUNDS,
    }));
  });

  it("refuses every structural performance regression by its exact counter", () => {
    const keys: readonly (keyof DashboardPerformanceStructuralCounters)[] = [
      "dayWireStatements",
      "rowPatchDayWireParses",
      "logsSpanEventParses",
      "logsFilesInScope",
      "archiveFreezeStatements",
      "memberPreviewDeltaStatements",
    ];
    for (const key of keys) {
      const broken = {
        ...DASHBOARD_PERFORMANCE_STRUCTURAL_BOUNDS,
        [key]: DASHBOARD_PERFORMANCE_STRUCTURAL_BOUNDS[key] + 1,
      };
      assert.throws(
        () => assertDashboardPerformanceStructuralBounds(broken),
        new RegExp(`dashboard performance ${key} must`),
        key,
      );
    }
  });

  it("serves exactly the declared row count for the measured day", () => {
    const wire = fixture.projection.buildDashboardDayWire(PERF_FIXTURE_PROFILE.day);
    assert.equal(wire.queueSurfaces.length, PERF_FIXTURE_PROFILE.dayRunCount);
    assert.equal(fixture.seeded.dayRunCount, PERF_FIXTURE_PROFILE.dayRunCount);
  });

  it("puts exactly one operation on the day, with the declared member count", () => {
    const wire = fixture.projection.buildDashboardDayWire(PERF_FIXTURE_PROFILE.day);
    const operations = wire.queueSurfaces.filter((surface) => surface.surfaceKind === "operation");
    assert.equal(operations.length, 1);
    assert.equal(operations[0].runId, fixture.runIds.operationRun);

    const members = wire.queueSurfaces.filter((surface) => surface.surfaceKind === "member");
    assert.equal(members.length, PERF_FIXTURE_PROFILE.operationMemberCount);

    // The fold, not the wire: `#memberPreview` walks THIS list, so it is the
    // list the P2 measurement is a measurement of.
    const fold = fixture.projection.runFold(fixture.runIds.operationRun);
    assert.notEqual(fold, undefined);
    assert.equal(fold?.memberRunIds.length, PERF_FIXTURE_PROFILE.operationMemberCount);
  });

  it("scopes by day, so the day filter has something to filter", () => {
    for (const day of PERF_FIXTURE_PROFILE.neighbouringDays) {
      const wire = fixture.projection.buildDashboardDayWire(day);
      assert.equal(wire.queueSurfaces.length, PERF_FIXTURE_PROFILE.neighbouringDayRunCount);
    }
    assert.equal(
      fixture.seeded.neighbouringRunCount,
      PERF_FIXTURE_PROFILE.neighbouringDays.length * PERF_FIXTURE_PROFILE.neighbouringDayRunCount,
    );
  });

  it("writes a note corpus above the declared floor, through the real writer", () => {
    const lines = readEventStreamLines(fixture.stateRoot, "notes");
    assert.equal(lines.length, fixture.seeded.noteLines);
    assert.ok(
      lines.length >= PERF_FIXTURE_PROFILE.minimumNoteLines,
      `the corpus holds ${String(lines.length)} lines, below the declared floor`,
    );
  });

  it("carries a realistic terminal mix — settled rows with and without a derived receipt", () => {
    const wire = fixture.projection.buildDashboardDayWire(PERF_FIXTURE_PROFILE.day);
    const statuses = new Set(wire.queueSurfaces.map((surface) => surface.status));
    for (const expected of ["done", "failed", "cancelled", "running", "awaiting-approval", "queued"]) {
      assert.ok(statuses.has(expected as never), `the day serves no ${expected} row`);
    }
    assert.equal(fixture.seeded.receiptCount, PERF_FIXTURE_PROFILE.receiptRunCount);

    // D141: both `#warningVerdict` arms must be on ONE wire, or the P4 double
    // receipt read would be measured over a day where the lookup always missed.
    const done = wire.queueSurfaces.filter((surface) => surface.status === "done");
    assert.ok(done.some((surface) => surface.facts.state === "present"));
    assert.ok(done.some((surface) => surface.facts.state === "absent"));
  });

  it("names a measured run that can actually serve a logs page", () => {
    const row = fixture.projection.queueSurface(fixture.runIds.measuredRun);
    assert.notEqual(row, undefined);
    assert.equal(row?.status, "done");
    assert.ok(fixture.sampleRunIds.includes(fixture.runIds.measuredRun));
  });
});
