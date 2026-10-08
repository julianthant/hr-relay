// @vitest-environment jsdom
/**
 * DCR1 at the rendered Activity seam: the served people and warning-evidence
 * axes must remain visible as different facts. The fixture goes through the
 * real strict wire before JSX sees it, so this test cannot render a state the
 * endpoint refuses.
 */
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import {
  ActivityReportWireSchema,
  type ActivityReportWire,
} from "../../../../../src/models/dashboard/activity.js";
import { buildActivityVolumeBoundarySkeleton } from "../../../../../src/models/dashboard/activity-volume.js";
import { ActivityBody } from "../../../../../src/dashboard/surfaces/activity/activity.js";

function report(): ActivityReportWire {
  return ActivityReportWireSchema.parse({
    wireVersion: 1,
    from: "2026-08-01",
    to: "2026-08-07",
    generatedAt: "2026-08-07T12:00:00.000Z",
    totalRuns: 2,
    terminalRuns: 2,
    inFlightRuns: 0,
    people: { state: "present", distinct: 3, evidenceRows: 3 },
    completion: { readBack: 1, warnings: 0, warningsUnknown: 1 },
    days: [{ day: "2026-08-03", runs: 2 }],
    workflows: [{
      workflowId: "person-lookup",
      registration: {
        state: "registered",
        code: "pl",
        label: "Person lookup",
        categoryId: "lookup",
      },
      runs: 2,
      completion: { readBack: 1, warnings: 0, warningsUnknown: 1 },
      failed: 0,
      cancelled: 0,
      partial: 0,
      open: 0,
    }],
    categories: [{ category: { state: "registered", categoryId: "lookup" }, runs: 2 }],
    statuses: [{ status: "done", runs: 2, sample: [] }],
    outcomes: [{ outcome: "done", runs: 2 }],
    failures: [],
    durations: {
      measuredRuns: 2,
      unmeasuredRuns: 0,
      medianMs: { state: "present", value: 12_000 },
      longestMs: {
        state: "present",
        value: 30_000,
        runId: "22222222-2222-4222-8222-222222222222",
      },
      totalMs: 42_000,
    },
    ledger: { systems: [] },
  });
}

function volume(from: string, to: string, runsAt: (index: number) => number) {
  const skeleton = buildActivityVolumeBoundarySkeleton({ from, to }, "America/Los_Angeles");
  const buckets = skeleton.buckets.map((boundary, index) => ({ ...boundary, runs: runsAt(index) }));
  return {
    state: "complete" as const,
    ...skeleton,
    coveredRuns: buckets.reduce((total, bucket) => total + bucket.runs, 0),
    buckets,
  };
}

function rendered(value: ActivityReportWire): HTMLElement {
  const host = document.createElement("main");
  host.innerHTML = renderToStaticMarkup(createElement(ActivityBody, { report: value, rows: [] }));
  return host;
}

describe("the rendered Activity axes (DCR1)", () => {
  it("shows cancellation requests as outstanding work rather than completed runs", () => {
    const value = ActivityReportWireSchema.parse({
      ...report(), terminalRuns: 0, inFlightRuns: 2,
      completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
      workflows: report().workflows.map((workflow) => ({
        ...workflow, open: 2, completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
      })),
      statuses: [{ status: "cancelling", runs: 2, sample: [
        "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333",
      ] }], outcomes: [],
      durations: { measuredRuns: 0, unmeasuredRuns: 0,
        medianMs: { state: "absent", reason: "no measured runs" },
        longestMs: { state: "absent", reason: "no measured runs" }, totalMs: 0 },
    });
    const table = rendered(value).querySelector('table[aria-label="Outstanding runs by what they are waiting on"]');
    assert.ok(table instanceof HTMLTableElement);
    assert.match(table.textContent ?? "", /Cancelling.*2/u);
  });

  it("shows distinct people while keeping workflow evidence and terminal exceptions reachable", () => {
    const host = rendered(report());
    const text = host.textContent ?? "";
    assert.match(text, /3 distinct people touched/u);

    const table = host.querySelector('table[aria-label="Activity by workflow, grouped by category"]');
    assert.ok(table instanceof HTMLTableElement);
    assert.deepEqual(
      [...table.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim()),
      ["Workflow", "Completed", "Outstanding", "Failed", "Total runs"],
    );
    const workflowRow = [...table.querySelectorAll("tbody tr")]
      .find((row) => row.textContent?.includes("Person lookup"));
    assert.ok(workflowRow instanceof HTMLTableRowElement);
    const cells = [...workflowRow.querySelectorAll("td")];
    assert.match(cells[0]?.textContent ?? "", /Person lookup/u);
    assert.match(cells[0]?.textContent ?? "", /1 warning status unread/u);
    assert.match(cells[0]?.textContent ?? "", /No cancelled or partial runs/u);
    assert.deepEqual(cells.slice(1).map((cell) => cell.textContent?.trim()), ["2", "0", "0", "2"]);
  });

  it("names unavailable people evidence instead of painting it as zero", () => {
    const value = ActivityReportWireSchema.parse({
      ...report(),
      people: {
        state: "absent",
        evidenceRows: 1,
        unavailableRows: 1,
        reason: "one current Separations row lacks validated canonical identity",
      },
    });
    const text = rendered(value).textContent ?? "";
    assert.match(text, /Distinct people unavailable/u);
    assert.doesNotMatch(text, /0 distinct people touched/u);
  });

  it("keeps a measured zero distinct from the unavailable arm", () => {
    const value = ActivityReportWireSchema.parse({
      ...report(),
      people: { state: "present", distinct: 0, evidenceRows: 0 },
    });
    const text = rendered(value).textContent ?? "";
    assert.match(text, /0 distinct people touched/u);
    assert.doesNotMatch(text, /Distinct people unavailable/u);
  });

  it("renders every authoritative daily bin, not the legacy report day list", () => {
    const base = report();
    const value = ActivityReportWireSchema.parse({
      ...base,
      to: "2026-08-31",
      volume: volume(base.from, "2026-08-31", (index) => index === 15 ? 2 : 0),
    });
    const host = rendered(value);
    const bars = [...host.querySelectorAll<HTMLButtonElement>("button[data-interval-start]")];
    assert.equal(bars.length, 31);
    assert.equal(host.textContent?.includes("Daily volume"), true);
    assert.equal(bars[15]?.dataset.runs, "2");
    assert.equal(bars[2]?.dataset.runs, "0");
    assert.equal(bars[15]?.dataset.intervalStart, "2026-08-16T00:00:00.000-07:00");
    assert.equal(bars[15]?.dataset.timeZone, "America/Los_Angeles");
    assert.match(bars[15]?.getAttribute("aria-label") ?? "", /^Interval \[2026-08-16T00:00:00\.000-07:00, 2026-08-17T00:00:00\.000-07:00\) in America\/Los_Angeles: 2 runs$/u);
  });

  it("uses the zero baseline and maximum top without a visible zero fallback", () => {
    const base = report();
    const value = ActivityReportWireSchema.parse({
      ...base,
      to: "2026-08-04",
      totalRuns: 23,
      terminalRuns: 23,
      completion: { readBack: 23, warnings: 0, warningsUnknown: 0 },
      days: [{ day: "2026-08-03", runs: 23 }],
      workflows: base.workflows.map((workflow) => ({
        ...workflow,
        runs: 23,
        completion: { readBack: 23, warnings: 0, warningsUnknown: 0 },
      })),
      categories: base.categories.map((category) => ({ ...category, runs: 23 })),
      statuses: [{ status: "done", runs: 23, sample: [] }],
      outcomes: [{ outcome: "done", runs: 23 }],
      durations: {
        measuredRuns: 23,
        unmeasuredRuns: 0,
        medianMs: { state: "present", value: 12_000 },
        longestMs: {
          state: "present",
          value: 30_000,
          runId: "22222222-2222-4222-8222-222222222222",
        },
        totalMs: 42_000,
      },
      volume: volume(base.from, "2026-08-04", (index) => [0, 3, 9, 11][index] ?? 0),
    });
    const host = rendered(value);
    const plot = [...host.querySelectorAll<HTMLElement>("div")].find((node) => (
      node.querySelector("button[data-interval-start]") !== null
      && node.className.includes("h-[8.125rem]")
    ));
    assert.ok(plot instanceof HTMLDivElement);
    const gridLines = [...plot.querySelectorAll<HTMLSpanElement>('div[aria-hidden] > span[style*="top"]')];
    const fills = [...plot.querySelectorAll<HTMLButtonElement>("button[data-interval-start]")]
      .map((button) => {
        const fill = button.firstElementChild;
        assert.ok(fill instanceof HTMLElement);
        return fill;
      });

    assert.deepEqual(gridLines.map((line) => line.style.top), ["0%", "25%", "50%", "75%", "100%"]);
    assert.deepEqual(fills.map((fill) => fill.getAttribute("style")), ["height:0%", "height:25%", "height:75%", "height:91.66666666666666%"]);
    assert.ok(fills.every((fill) => !fill.classList.contains("min-h-[var(--ds-space-hair)]")));

    for (const fill of fills) {
      const barTop = 100 - Number.parseFloat(fill.style.height);
      if (!Number.isInteger(barTop)) continue;
      assert.ok(gridLines.some((line) => Number.parseFloat(line.style.top) === barTop));
    }
  });

  it("shows a known-empty volume series and the independent ledger for a zero-run report", () => {
    const base = report();
    const value = ActivityReportWireSchema.parse({
      ...base,
      totalRuns: 0,
      terminalRuns: 0,
      inFlightRuns: 0,
      people: { state: "present", distinct: 0, evidenceRows: 0 },
      completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
      days: [],
      volume: volume(base.from, base.to, () => 0),
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
    const host = rendered(value);
    const bars = [...host.querySelectorAll<HTMLButtonElement>("button[data-interval-start]")];
    const ledger = host.querySelector('[role="list"][aria-label="Write ledger by system"]');
    assert.equal(bars.length, 7);
    assert.ok(bars.every((bar) => bar.dataset.runs === "0"));
    assert.match(host.textContent ?? "", /No runs in these reported intervals/u);
    assert.ok(ledger instanceof HTMLElement);
    assert.match(ledger.textContent ?? "", /UCPath.*2 production.*0 test instances.*2.*confirmed entries/u);
    assert.match(host.textContent ?? "", /No run started between 2026-08-01 and 2026-08-07/u);
    assert.doesNotMatch(host.textContent ?? "", /archived runs|Archive is where/u);
  });

  it("keeps absent volume unavailable instead of plotting the legacy day list", () => {
    const host = rendered(report());
    assert.match(host.textContent ?? "", /Volume series unavailable/u);
    assert.equal(host.querySelectorAll("button[data-interval-start]").length, 0);
  });
});
