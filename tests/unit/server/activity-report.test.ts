/**
 * The Activity report (D180, doc 13 §5/§6.7) — the range rendering of THE ONE
 * run/queue projection.
 *
 * The report is not a second counting path, so the assertions below are mostly
 * about AGREEMENT: the same hidden row, archived row and contained member that
 * leave `buildDashboardDayWire` leave every aggregate here, once, at the same
 * instant, because the exclusion is decided in one place and inherited. The
 * other half is D124 at scale — a terminal run whose surface carries no end
 * instant is reported as unmeasured and is never counted as a zero, because a
 * median over a denominator that quietly swallowed the unknowns is a lie the
 * operator cannot see.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import type { AnyWorkflowDescriptor } from "../../../src/base/workflow.js";
import { ActivityReportWireSchema } from "../../../src/domain/dashboard/activity.js";
import { kualiTimekeeperAnnotationDescriptor } from "../../../src/workflows/kuali-timekeeper-annotation/descriptor.js";
import { personLookupDescriptor } from "../../../src/workflows/person-lookup/descriptor.js";
import { fixtureDescriptor } from "../architecture/helpers/descriptor-fixtures.js";
import {
  atDayOffset,
  claimEventOf,
  dayOffsetOf,
  failureRecordOf,
  instantOffsetOf,
  makeWorld,
  queuedEventOf,
  runEndedEventOf,
  runRecordOf,
  uuidOf,
  type DashboardWorld,
} from "./helpers/dashboard-harness.js";

const worlds: DashboardWorld[] = [];

function world(...args: Parameters<typeof makeWorld>): DashboardWorld {
  const created = makeWorld(...args);
  worlds.push(created);
  return created;
}

afterEach(() => {
  for (const w of worlds.splice(0)) w.dispose();
});

/**
 * Two REAL descriptors plus the graph fixture. Two of the three share the
 * `operations` category on purpose: a category total that only ever saw one
 * workflow would never prove it accumulates across them.
 */
const REGISTRY = {
  resolve: (workflowId: string): AnyWorkflowDescriptor | undefined => {
    if (workflowId === "person-lookup") return personLookupDescriptor;
    if (workflowId === "kuali-timekeeper-annotation") return kualiTimekeeperAnnotationDescriptor;
    if (workflowId === fixtureDescriptor.id) return fixtureDescriptor;
    return undefined;
  },
};

const D0 = dayOffsetOf(0);
const D1 = dayOffsetOf(1);
const D2 = dayOffsetOf(2);
const D3 = dayOffsetOf(3);

const CLAIM = {
  workerId: "person-lookup-worker-1",
  claimedAt: "2026-08-03T17:00:05.000Z",
  heartbeatAt: "2026-08-03T17:00:05.000Z",
} as const;

/**
 * A three-day range with one row of every kind the report must decide about.
 *
 * D0: 1 done (5s) · 2 failed/transient (20s) · 3 HIDDEN
 * D1: 4 failed/transient (60s, kuali) · 5 failed/permanent (10s, kuali) · 6 ARCHIVED
 * D2: 7 terminal-interrupted on a RETIRED workflow · 8 running (fixture-graph)
 *     · 9 operation + 10/11 its MEMBERS
 * D3: 12 done — outside the range entirely
 */
function seedActivityWorld(w: DashboardWorld): void {
  atDayOffset(w, 0);
  queuedEventOf(w, { seed: 1 });
  claimEventOf(w, 1);
  runEndedEventOf(w, 1, "done");
  w.authority.put(runRecordOf({
    seed: 1,
    lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(0, 5_000) },
    version: 3,
  }));

  queuedEventOf(w, { seed: 2 });
  claimEventOf(w, 2);
  w.authority.failures.set(uuidOf(9002), failureRecordOf({ seed: 2, code: "STALE_SESSION", transient: true }));
  runEndedEventOf(w, 2, "failed", { failureId: uuidOf(9002) });
  w.authority.put(runRecordOf({
    seed: 2,
    lifecycle: {
      state: "terminal", outcome: "failed", endedAt: instantOffsetOf(0, 20_000), failureId: uuidOf(9002),
    },
    version: 3,
  }));

  queuedEventOf(w, { seed: 3, hidden: true });

  atDayOffset(w, 1);
  const kuali = "kuali-timekeeper-annotation";
  for (const [seed, code, transient, ms] of [
    [4, "STALE_SESSION", true, 60_000],
    [5, "SUBJECT_MISMATCH", false, 10_000],
  ] as const) {
    queuedEventOf(w, { seed, workflow: kuali });
    w.authority.failures.set(
      uuidOf(9000 + seed),
      failureRecordOf({ seed, code, transient, workflow: kuali }),
    );
    runEndedEventOf(w, seed, "failed", { workflow: kuali, failureId: uuidOf(9000 + seed) });
    w.authority.put(runRecordOf({
      seed,
      workflow: kuali,
      lifecycle: {
        state: "terminal",
        outcome: "failed",
        endedAt: instantOffsetOf(1, ms),
        failureId: uuidOf(9000 + seed),
      },
      version: 3,
    }));
  }

  queuedEventOf(w, { seed: 6, workflow: kuali });
  w.authority.archived.add(uuidOf(6));

  atDayOffset(w, 2);
  // A workflow that has since been retired from the registry. Its run still
  // happened and still counts; only its label and category are unavailable.
  queuedEventOf(w, { seed: 7, workflow: "retired-flow" });
  w.authority.put(runRecordOf({
    seed: 7,
    workflow: "retired-flow",
    lifecycle: { state: "terminal", outcome: "interrupted", endedAt: instantOffsetOf(2, 30_000) },
    version: 3,
  }));

  queuedEventOf(w, { seed: 8, workflow: fixtureDescriptor.id });
  w.authority.put(runRecordOf({
    seed: 8,
    workflow: fixtureDescriptor.id,
    lifecycle: { state: "running", ...CLAIM },
    claimGeneration: 1,
    version: 2,
  }));
  claimEventOf(w, 8);

  queuedEventOf(w, { seed: 9, shape: "operation", title: "I-9 batch" });
  queuedEventOf(w, { seed: 10, shape: "operation-member", parentSeed: 9 });
  queuedEventOf(w, { seed: 11, shape: "operation-member", parentSeed: 9 });

  atDayOffset(w, 3);
  queuedEventOf(w, { seed: 12 });
  runEndedEventOf(w, 12, "done");
  w.authority.put(runRecordOf({
    seed: 12,
    lifecycle: { state: "terminal", outcome: "done", endedAt: instantOffsetOf(3, 1_000) },
    version: 3,
  }));
}

describe("the Activity report (D180)", () => {
  it("rolls the range up by day, workflow, category, status and outcome from the one surface set", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);

    const report = ActivityReportWireSchema.parse(w.projection.buildActivityReportWire(D0, D2));

    // 7 top-level rows: the hidden row, the archived row, the two members and
    // the out-of-range day are all gone, and the schema's own superRefine has
    // already asserted that statuses sum to this number and that terminal +
    // in-flight partition it.
    assert.equal(report.totalRuns, 7);
    assert.equal(report.terminalRuns, 5);
    assert.equal(report.inFlightRuns, 2);
    assert.deepEqual(report.days, [
      { day: D0, runs: 2 },
      { day: D1, runs: 2 },
      { day: D2, runs: 3 },
    ]);

    assert.deepEqual(report.workflows, [
      {
        workflowId: fixtureDescriptor.id,
        registration: { state: "registered", label: "Fixture Graph", categoryId: "operations" },
        runs: 1,
      },
      {
        workflowId: "kuali-timekeeper-annotation",
        registration: { state: "registered", label: "Kuali Timekeeper Annotation", categoryId: "operations" },
        runs: 2,
      },
      {
        workflowId: "person-lookup",
        registration: { state: "registered", label: "Person Lookup", categoryId: "search" },
        runs: 3,
      },
      {
        workflowId: "retired-flow",
        registration: {
          state: "unregistered",
          reason: "workflow retired-flow is no longer registered; its label and category are unavailable",
        },
        runs: 1,
      },
    ]);

    // The two `operations` workflows fold into ONE category row, and the
    // retired workflow's run lands in the explicitly-unregistered bucket
    // rather than borrowing a category or vanishing from the total.
    assert.deepEqual(report.categories, [
      { category: { state: "registered", categoryId: "operations" }, runs: 3 },
      { category: { state: "registered", categoryId: "search" }, runs: 3 },
      {
        category: {
          state: "unregistered",
          reason: "the workflows behind these runs are no longer registered",
        },
        runs: 1,
      },
    ]);

    assert.deepEqual(report.statuses, [
      { status: "blocked", runs: 1 },
      { status: "done", runs: 1 },
      { status: "failed", runs: 3 },
      { status: "queued", runs: 1 },
      { status: "running", runs: 1 },
    ]);
    // Outcomes are AUTHORITY's settled verdicts, so only the five terminal
    // rows appear — the running and queued rows have reached none.
    assert.deepEqual(report.outcomes, [
      { outcome: "done", runs: 1 },
      { outcome: "failed", runs: 3 },
      { outcome: "interrupted", runs: 1 },
    ]);
    assert.equal(
      report.outcomes.reduce((total, { runs }) => total + runs, 0),
      report.terminalRuns,
    );
  });

  it("breaks failures down by their own code and says how many of them were transient", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    const report = w.projection.buildActivityReportWire(D0, D2);

    // "3 failures" reads very differently once two of them are known retryable.
    assert.deepEqual(report.failures, [
      { code: "STALE_SESSION", runs: 2, transient: 2, sample: [uuidOf(2), uuidOf(4)] },
      { code: "SUBJECT_MISMATCH", runs: 1, transient: 0, sample: [uuidOf(5)] },
    ]);
    assert.equal(
      report.failures.reduce((total, { runs }) => total + runs, 0),
      report.outcomes.find(({ outcome }) => outcome === "failed")?.runs,
    );
  });

  it("refuses to report a failure breakdown with a hole in it", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    // The run settled against a failure id authority no longer holds. Reporting
    // "2 failures" over three failed runs would understate the day silently.
    w.authority.failures.delete(uuidOf(9002));
    assert.throws(
      () => w.projection.buildActivityReportWire(D0, D2),
      /which authority does not hold; refusing to report a failure breakdown with a hole in it/,
    );
  });

  it("measures the durations it can and REPORTS the ones it cannot (D124 at scale)", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    const report = w.projection.buildActivityReportWire(D0, D2);

    // Four terminal rows carry a start and an end; the interrupted one carries
    // no terminal instant on its surface, because an interrupted run may still
    // be requeued and a row that says "it ended at X" would be claiming a
    // verdict nobody reached. It is counted as unmeasured — never as a zero,
    // which would drag the median down, and never as `now − startedAt`, which
    // would grow on every refresh.
    assert.equal(report.durations.measuredRuns, 4);
    assert.equal(report.durations.unmeasuredRuns, 1);
    assert.equal(report.durations.measuredRuns + report.durations.unmeasuredRuns, report.terminalRuns);

    // 5s, 10s, 20s, 60s.
    assert.deepEqual(report.durations.medianMs, { state: "present", value: 10_000 });
    assert.deepEqual(report.durations.longestMs, { state: "present", value: 60_000, runId: uuidOf(4) });
    assert.equal(report.durations.totalMs, 95_000);
  });

  it("names the absence rather than reporting a zero when nothing in range is measurable", () => {
    const w = world({ descriptors: REGISTRY });
    atDayOffset(w, 0);
    queuedEventOf(w, { seed: 1 });
    claimEventOf(w, 1);
    const report = w.projection.buildActivityReportWire(D0, D0);

    assert.equal(report.totalRuns, 1);
    assert.equal(report.terminalRuns, 0);
    assert.deepEqual(report.durations, {
      measuredRuns: 0,
      unmeasuredRuns: 0,
      medianMs: {
        state: "absent",
        reason: "no terminal run in range carries both a start and an end instant",
      },
      longestMs: {
        state: "absent",
        reason: "no terminal run in range carries both a start and an end instant",
      },
      totalMs: 0,
    });
  });

  it("caps a failure sample at five runs while the tally keeps counting", () => {
    const w = world({ descriptors: REGISTRY });
    atDayOffset(w, 0);
    for (let seed = 20; seed < 27; seed += 1) {
      queuedEventOf(w, { seed });
      w.authority.failures.set(uuidOf(9000 + seed), failureRecordOf({ seed, code: "STALE_SESSION", transient: true }));
      runEndedEventOf(w, seed, "failed", { failureId: uuidOf(9000 + seed) });
      w.authority.put(runRecordOf({
        seed,
        lifecycle: {
          state: "terminal", outcome: "failed", endedAt: instantOffsetOf(0, 1_000), failureId: uuidOf(9000 + seed),
        },
        version: 3,
      }));
    }
    const report = w.projection.buildActivityReportWire(D0, D0);
    assert.equal(report.failures.length, 1);
    assert.equal(report.failures[0].runs, 7);
    assert.equal(report.failures[0].transient, 7);
    assert.equal(report.failures[0].sample.length, 5);
  });
});

describe("the Activity report inherits the day's exclusions rather than re-deciding them (D81)", () => {
  it("agrees with the day payload it summarises, row for row and count for count", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);

    for (const [day, offset] of [[D0, 0], [D1, 1], [D2, 2]] as const) {
      const dayWire = w.projection.buildDashboardDayWire(day);
      const countable = dayWire.queueSurfaces.filter(({ surfaceKind }) => surfaceKind !== "member");
      const oneDay = w.projection.buildActivityReportWire(day, day);

      assert.equal(oneDay.totalRuns, countable.length, `day ${day} (offset ${String(offset)}) row count`);
      assert.deepEqual(oneDay.days, [{ day, runs: countable.length }]);
      assert.deepEqual(
        oneDay.statuses.map(({ status, runs }) => [status, runs]),
        [...dayWire.statusCounts].map(({ status, count }) => [status, count]),
      );
      assert.deepEqual(
        oneDay.workflows.map(({ workflowId, runs }) => [workflowId, runs]),
        [...dayWire.workflowCounts].map(({ workflowId, count }) => [workflowId, count]),
      );
    }
  });

  it("drops an archived run from the range at the same instant it leaves the day", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    const before = w.projection.buildActivityReportWire(D0, D2);
    assert.equal(before.totalRuns, 7);
    assert.equal(w.projection.buildDashboardDayWire(D0).queueSurfaces.length, 2);

    // D80/D179: one version bump archives the run. Nothing re-runs, nothing
    // re-decides — the next read of either surface simply does not see it.
    w.authority.archived.add(uuidOf(1));
    const after = w.projection.buildActivityReportWire(D0, D2);
    assert.equal(after.totalRuns, 6);
    assert.equal(after.terminalRuns, 4);
    assert.deepEqual(after.days[0], { day: D0, runs: 1 });
    assert.equal(after.durations.measuredRuns, 3);
    assert.equal(after.durations.totalMs, 90_000);
    assert.equal(w.projection.buildDashboardDayWire(D0).queueSurfaces.length, 1);
  });

  it("counts a delegated member inside its operation, never a second time at top level", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    const report = w.projection.buildActivityReportWire(D2, D2);
    const dayWire = w.projection.buildDashboardDayWire(D2);

    // The members ride the day payload flat for layout — the report counts the
    // operation once and the members not at all.
    assert.equal(dayWire.queueSurfaces.length, 5);
    assert.equal(dayWire.queueSurfaces.filter(({ surfaceKind }) => surfaceKind === "member").length, 2);
    assert.equal(report.totalRuns, 3);
    assert.deepEqual(report.days, [{ day: D2, runs: 3 }]);
  });
});

describe("the Activity report refuses rather than inventing a window", () => {
  it("refuses a range that ends before it starts", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    assert.throws(
      () => w.projection.buildActivityReportWire(D2, D0),
      new RegExp(`activity range ${D2}\\.\\.${D0} ends before it starts`),
    );
  });

  it("refuses a bound that is not a date", () => {
    const w = world({ descriptors: REGISTRY });
    assert.throws(() => w.projection.buildActivityReportWire("today", D0));
    assert.throws(() => w.projection.buildActivityReportWire(D0, "2026-08"));
  });

  it("refuses to serve aggregates while the projection is degraded", () => {
    const w = world({ descriptors: REGISTRY, collectRebuilds: true });
    queuedEventOf(w, { seed: 1 });
    // A claim naming a run with no `run.queued` cannot fold. `apply` never
    // throws into the emitting path; it degrades and schedules the rebuild.
    w.projection.apply({
      t: "run.claimed", ts: w.clock.now().toISOString(), workflow: "person-lookup", pid: 4242,
      runId: uuidOf(60), attempt: 1, traceId: "pl-100060-0060", spanPath: "pl-100060-0060",
      workerId: "person-lookup-worker-1",
    } as never);

    assert.equal(w.projection.health().state, "degraded");
    assert.throws(
      () => w.projection.buildActivityReportWire(D0, D2),
      /degraded and refuses to serve activity aggregates/,
    );

    // A half-folded range is never served as healthy; the guarded rebuild is
    // what makes it answerable again.
    w.scheduledRebuilds[0]();
    assert.equal(w.projection.health().state, "live");
    assert.equal(w.projection.buildActivityReportWire(D0, D2).totalRuns, 1);
  });

  it("keeps an out-of-range row out of the range even when authority never held it", () => {
    const w = world({ descriptors: REGISTRY });
    seedActivityWorld(w);
    // The day payload refuses a span-known run authority does not hold. The
    // report bounds its range FIRST, so a stale row on some other day cannot
    // make an unrelated week unanswerable.
    w.authority.records.delete(uuidOf(12));
    assert.equal(w.projection.buildActivityReportWire(D0, D2).totalRuns, 7);
    assert.throws(() => w.projection.buildActivityReportWire(D3, D3), /not in authority/);
  });
});
