// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { ActivityReport } from "../../../../src/dashboard/surfaces/activity/activity.js";
import type { ActivityClient } from "../../../../src/dashboard/state/activity-wiring-adapter.js";
import { ActivityPopulationSelectionSchema } from "../../../../src/models/dashboard/activity-population.js";
import { buildActivityVolumeBoundarySkeleton } from "../../../../src/models/dashboard/activity-volume.js";
import { ERROR_CATALOG } from "../../../../src/models/failures/error-catalog.js";
import { createActivityReportFixtures } from "../../../support/helpers/dashboard/activity-report-fixtures.js";

it("keeps the served CSV control pending until its exact snapshot download settles", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const empty = createActivityReportFixtures().EMPTY;
  const skeleton = buildActivityVolumeBoundarySkeleton(empty, "UTC");
  const report = { ...empty, volume: { state: "complete" as const, ...skeleton, coveredRuns: 0, buckets: skeleton.buckets.map(bucket => ({ ...bucket, runs: 0 })) } };
  const identity = { from: report.from, to: report.to, generatedAt: report.generatedAt,
    expiresAt: "2026-08-07T12:15:00.000Z", sourceIdentity: "a".repeat(64), authorityGeneration: 1, reportDigest: "b".repeat(64) };
  const selected = ActivityPopulationSelectionSchema.parse({ report: { ...report, snapshot: { ...identity, token: "as1.fixture.signature" } }, population: [], successfulTiming: [],
    snapshot: { ...identity, reportToken: "as1.fixture.signature", populationDigest: "c".repeat(64), token: "ap1.fixture.signature" } });
  let download = Promise.withResolvers<Awaited<ReturnType<ActivityClient["exportActivityPopulationCsv"]>>>();
  const exportCsv = vi.fn<ActivityClient["exportActivityPopulationCsv"]>(() => download.promise);
  const unavailable = () => { throw new Error("Unexpected detail read"); };
  const client: ActivityClient = { activityPopulation: async () => selected, exportActivityPopulationCsv: exportCsv,
    readActivityPopulation: unavailable, dashboardDay: unavailable, runDetail: unavailable, runSection: unavailable, artifactUrl: unavailable };
  const createUrl = vi.fn(() => "blob:synthetic-csv"), revokeUrl = vi.fn();
  const createDescriptor = Object.getOwnPropertyDescriptor(URL, "createObjectURL"), revokeDescriptor = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: revokeUrl });
  const downloads: string[] = [];
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const button = () => { const node = [...host.querySelectorAll("button")].find(node => node.textContent === "Export CSV"); assert(node); return node; };
  try {
    await act(async () => root.render(createElement(ActivityReport, { source: "served", client, range: `${report.from}..${report.to}`, today: report.to, onRange() {} })));
    assert.equal(button().disabled, false);
    await act(async () => button().click());
    assert.equal(button().disabled, true); assert.equal(button().getAttribute("aria-busy"), "true");
    await act(async () => button().click()); assert.equal(exportCsv.mock.calls.length, 1); assert.equal(exportCsv.mock.calls[0]?.[0], selected);
    assert.equal(createUrl.mock.calls.length, 0);
    await act(async () => download.resolve({ filename: "canonical.csv", mediaType: "text/csv; charset=utf-8", bytes: new ArrayBuffer(2) }));
    assert.equal(button().disabled, false); assert.deepEqual(downloads, ["canonical.csv"]); assert.equal(createUrl.mock.calls.length, 1);
    await act(async () => { vi.advanceTimersByTime(1000); }); assert.deepEqual(revokeUrl.mock.calls, [["blob:synthetic-csv"]]);
    download = Promise.withResolvers();
    await act(async () => button().click()); assert.equal(button().disabled, true);
    await act(async () => download.reject(new Error("Synthetic export refusal")));
    assert.equal(button().disabled, false); assert(host.textContent?.includes(ERROR_CATALOG.DASHBOARD_READ_FAILED.text)); assert.equal(click.mock.calls.length, 1);
  } finally {
    await act(async () => root.unmount()); host.remove(); click.mockRestore(); vi.unstubAllGlobals(); vi.clearAllTimers(); vi.useRealTimers();
    if (createDescriptor) Object.defineProperty(URL, "createObjectURL", createDescriptor); else Reflect.deleteProperty(URL, "createObjectURL");
    if (revokeDescriptor) Object.defineProperty(URL, "revokeObjectURL", revokeDescriptor); else Reflect.deleteProperty(URL, "revokeObjectURL");
  }
});
