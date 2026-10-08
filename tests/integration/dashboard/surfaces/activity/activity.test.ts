import { ActivityReportSelectionSchema } from "../../../../../src/models/dashboard/activity-selection.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, it, vi } from "vitest";
import {
  ActivityReportWireSchema,
  type ActivityReportWire,
} from "../../../../../src/models/dashboard/activity.js";
import { buildActivityVolumeBoundarySkeleton } from "../../../../../src/models/dashboard/activity-volume.js";
import { ActivityReport } from "../../../../../src/dashboard/surfaces/activity/activity.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { summaryFixture } from "../../../../support/helpers/backend/served-database-surfaces-fixtures.js";
import { id } from "../../../../support/helpers/database-foundation/fixtures.js";
import { activityReportCsv } from "../../../../../src/backend/runs/queries/activity-export.js";
import {
  activityPeopleEvidenceItems,
  activityPeriodOf,
  activityPeriodRange,
  activityRangeLabel,
  activityRangeValue,
  parseActivityRange,
  resolveActivityWho,
  type QueueRowIdentity,
} from "../../../../../src/dashboard/surfaces/activity/activity-model.js";

const RUN_A = "11111111-1111-4111-8111-111111111111";
const RUN_B = "22222222-2222-4222-8222-222222222222";

function report(overrides: Record<string, unknown> = {}): ActivityReportWire {
  const value = {
    wireVersion: 1,
    from: "2026-09-08",
    to: "2026-09-09",
    generatedAt: "2026-09-09T12:00:00.000Z",
    totalRuns: 2,
    terminalRuns: 0,
    inFlightRuns: 2,
    people: { state: "present", distinct: 1, evidenceRows: 2 },
    completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
    days: [{ day: "2026-09-08", runs: 1 }, { day: "2026-09-09", runs: 1 }],
    workflows: [{
      workflowId: "separations",
      registration: { state: "registered", code: "sp", label: "Separations", categoryId: "employment" },
      runs: 2,
      completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
      failed: 0,
      cancelled: 0,
      partial: 0,
      open: 2,
    }],
    categories: [{ category: { state: "registered", categoryId: "employment" }, runs: 2 }],
    statuses: [{ status: "queued", runs: 2, sample: [RUN_A, RUN_B] }],
    outcomes: [],
    failures: [],
    durations: {
      measuredRuns: 0,
      unmeasuredRuns: 0,
      medianMs: { state: "absent", reason: "no terminal run in range carries both a start and an end instant" },
      longestMs: { state: "absent", reason: "no terminal run in range carries both a start and an end instant" },
      totalMs: 0,
    },
    ledger: { systems: [] },
    ...overrides,
  };
  const from = typeof value.from === "string" ? value.from : "2026-09-08";
  const to = typeof value.to === "string" ? value.to : "2026-09-09";
  const totalRuns = typeof value.totalRuns === "number" ? value.totalRuns : 2;
  const days = Array.isArray(value.days) ? value.days as { day: string; runs: number }[] : [];
  const volumeSkeleton = buildActivityVolumeBoundarySkeleton({ from, to }, "UTC");
  const dayCounts = new Map(days.map(({ day, runs }) => [day, runs]));
  const buckets = volumeSkeleton.buckets.map((bucket, index) => ({
    ...bucket,
    runs: volumeSkeleton.granularity === "daily"
      ? dayCounts.get(bucket.start.slice(0, 10)) ?? 0
      : index === 0 ? totalRuns : 0,
  }));
  const volume = { state: "complete" as const, ...volumeSkeleton, coveredRuns: buckets.reduce((sum, bucket) => sum + bucket.runs, 0), buckets };
  return ActivityReportWireSchema.parse({ ...value, volume });
}

function reviewedReport(overrides:Record<string,unknown>={}) {
  const value=report(overrides);
  return ActivityReportSelectionSchema.parse({...value,snapshot:{from:value.from,to:value.to,generatedAt:value.generatedAt,
    expiresAt:"2026-09-09T12:15:00.000Z",sourceIdentity:"a".repeat(64),authorityGeneration:1,reportDigest:"b".repeat(64),token:"as1.fixture.signature"}});
}

const queueRow: QueueRowIdentity = {
  runId: RUN_A,
  workflowId: "separations",
  traceId: "sp-20260909-0001",
  title: "System title",
  displayName: { state: "present", value: "Named by operator" },
};

describe("Activity consumes the served summary boundary", () => {
  it("renders the same selected database summaries as Queue and CSV, without reading canonical history", () => {
    const f = summaryFixture();
    try {
      const now = "2026-09-09T12:00:00.000Z";
      for (const runId of [id(9781), id(9782)]) f.db.authority.runs.enqueue(RunRecordSchema.parse({
        ...f.run, envelope: { ...f.run.envelope, runId, itemId: runId, enqueuedAt: now },
        lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, createdAt: now, updatedAt: now,
      }));
      f.servedReader.list = () => { throw new Error("activity-consumer-enumerated-history"); };
      const selected = f.projection.buildActivityReportWire("2026-09-09", "2026-09-09");
      const held = f.projection.buildDashboardDayWire("2026-09-09").queueSurfaces;
      assert.equal(selected.totalRuns, 2);
      assert.deepEqual(selected.statuses.find((entry) => entry.status === "queued")?.sample, held.map((row) => row.runId));
      assert.match(activityReportCsv(selected), /Runs in range,2/u);
      assert.throws(() => f.projection.buildActivityReportWire("2026-09-10", "2026-09-09"));
    } finally { f.dispose(); }
  });
  it("refuses an explicit invalid span before fetching, hides stale exports, and ignores a superseded response", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const requests: { url: string; resolve: (response: Response) => void }[] = [];
    const client = createDashboardClient({ baseUrl: "http://bff.test", fetchImpl: async (input) =>
      new Promise<Response>((resolve) => { requests.push({ url: String(input), resolve }); }) });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const draw = async (range: string) => { await act(async () => {
      root.render(createElement(DashboardClientProvider, { client, children: createElement(ActivityReport, {
        range, today: "2026-09-10", queueRows: [], actorId: "synthetic", appVersion: "0.1.0", onRange: () => undefined,
      }) }));
    }); };
    try {
      await draw("2026-09-10..2026-09-08");
      assert.equal(requests.length, 0);
      assert.match(host.textContent ?? "", /requested range was not replaced/u);
      await draw("2026-09-08..2026-09-09");
      assert.equal(requests.length, 1);
      assert.match(requests[0]?.url ?? "", /from=2026-09-08&to=2026-09-09/u);
      await draw("2026-09-09..2026-09-09");
      assert.equal(requests.length, 2);
      await act(async () => { requests[0]?.resolve(Response.json(reviewedReport())); });
      assert.doesNotMatch(host.textContent ?? "", /Export CSV/u);
      await act(async () => { requests[1]?.resolve(Response.json(reviewedReport({ from: "2026-09-09", to: "2026-09-09", days: [{ day: "2026-09-09", runs: 2 }] }))); });
      assert.match(host.textContent ?? "", /Export/u);
      await draw("2026-09-08..");
      assert.equal(requests.length, 2);
      assert.doesNotMatch(host.textContent ?? "", /How it is counted/u);
      assert.match(host.textContent ?? "", /requested range was not replaced/u);
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
      vi.unstubAllGlobals();
    }
  });
  it("uses validated canonical identity language and never revives retired pseudonym claims", () => {
    const items = activityPeopleEvidenceItems(report().people);
    assert.match(items.join(" "), /validated canonical identity/u);
    assert.match(items.join(" "), /only the count reaches/u);
    assert.doesNotMatch(items.join(" "), /pseudonym|key generation/u);
  });

  it("resolves a sampled run only from Queue rows already held and names an absent row by id", () => {
    const value = report();
    assert.deepEqual(resolveActivityWho(RUN_A, [queueRow], value), {
      runId: RUN_A,
      name: { state: "present", value: "Named by operator" },
      workflowLabel: "Separations",
      traceId: queueRow.traceId,
    });
    assert.deepEqual(resolveActivityWho(RUN_B, [queueRow], value), {
      runId: RUN_B,
      name: {
        state: "absent",
        reason: "this run is not among the queue rows loaded for the day on screen, so its name is not known here",
      },
      workflowLabel: undefined,
      traceId: undefined,
    });
  });

  it("renders the known-empty chart and separate ledger when the selected report has zero runs", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const selected = reviewedReport({
      totalRuns: 0,
      terminalRuns: 0,
      inFlightRuns: 0,
      people: { state: "present", distinct: 0, evidenceRows: 0 },
      completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
      days: [],
      workflows: [],
      categories: [],
      statuses: [],
      outcomes: [],
      failures: [],
      durations: {
        measuredRuns: 0,
        unmeasuredRuns: 0,
        medianMs: { state: "absent", reason: "no measured runs" },
        longestMs: { state: "absent", reason: "no measured runs" },
        totalMs: 0,
      },
      ledger: { systems: [{ system: "ucpath", entries: 2, prod: 2, test: 0 }] },
    });
    const responses: ((response: Response) => void)[] = [];
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: async () => new Promise<Response>((resolve) => { responses.push(resolve); }),
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(createElement(DashboardClientProvider, {
          client,
          children: createElement(ActivityReport, {
            range: "2026-09-08..2026-09-09",
            today: "2026-09-10",
            queueRows: [],
            actorId: "synthetic",
            appVersion: "0.1.0",
            onRange: () => undefined,
          }),
        }));
      });
      assert.equal(responses.length, 1);
      await act(async () => { responses[0]?.(Response.json(selected)); });
      assert.match(host.textContent ?? "", /No run started between 2026-09-08 and 2026-09-09/u);
      assert.match(host.textContent ?? "", /No runs in these reported intervals/u);
      assert.match(host.textContent ?? "", /Confirmed transactions/u);
      assert.match(host.textContent ?? "", /UCPath/u);
      assert.match(host.textContent ?? "", /2/u);
      assert.equal(host.querySelectorAll('button[data-interval-start][data-runs="0"]').length, 2);
      assert.doesNotMatch(host.textContent ?? "", /Archived runs|Archive is where/u);
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
      vi.unstubAllGlobals();
    }
  });

  it("keeps a valid URL range explicit and refuses invalid explicit selections without substituting month-to-date", () => {
    const valid = parseActivityRange("2026-09-08..2026-09-09", "2026-09-10");
    assert.deepEqual(valid, { from: "2026-09-08", to: "2026-09-09" });
    assert.equal(activityRangeValue(valid), "2026-09-08..2026-09-09");
    assert.equal(activityRangeLabel(valid.from, valid.to), "Tue, Sep 8 – Wed, Sep 9");
    assert.deepEqual(activityPeriodRange("week", "2026-09-10"), { from: "2026-09-06", to: "2026-09-10" });
    assert.equal(activityPeriodOf({ from: "2026-09-06", to: "2026-09-10" }, "2026-09-10"), "week");
    assert.deepEqual(parseActivityRange("", "2026-09-10"), {
      from: "2026-09-01",
      to: "2026-09-10",
    });
    for (const input of ["2026-09-10..2026-09-08", "2026-02-30..2026-03-01", "2026-09-08..", "2026-09-08..2026-09-09..extra"]) {
      assert.match(parseActivityRange(input, "2026-09-10").refusal ?? "", /requested range was not replaced/u);
    }
  });

  it("keeps Custom selected when its applied dates equal a preset", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const client = createDashboardClient({
      baseUrl: "http://bff.test",
      fetchImpl: async () => new Promise<Response>(() => undefined),
    });
    const changes: string[] = [];
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(createElement(DashboardClientProvider, {
          client,
          children: createElement(ActivityReport, {
            range: "2026-09-06..2026-09-09",
            today: "2026-09-09",
            queueRows: [],
            actorId: "synthetic",
            appVersion: "0.1.0",
            onRange: (next) => { changes.push(next); },
          }),
        }));
      });
      const period = host.querySelector<HTMLSelectElement>('select[aria-label="Report period"]');
      assert.ok(period instanceof HTMLSelectElement);
      assert.equal(period.value, "this-week");

      await act(async () => {
        period.value = "custom";
        period.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const apply = [...document.body.querySelectorAll("button")].find((button) => button.textContent?.includes("Apply range"));
      assert.ok(apply instanceof HTMLButtonElement);
      await act(async () => { apply.click(); });

      assert.deepEqual(changes, ["2026-09-06..2026-09-09"]);
      assert.equal(period.value, "custom");
      assert.ok(host.querySelector('button[aria-label^="Select report dates:"]'));
    } finally {
      await act(async () => { root.unmount(); });
      host.remove();
      vi.unstubAllGlobals();
    }
  });

});
