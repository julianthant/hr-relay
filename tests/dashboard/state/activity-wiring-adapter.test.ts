import { DS_STATUS } from "../../../src/dashboard/ds/ui.js";
// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, it, vi } from "vitest";
import { ActivityPopulationSelectionSchema, ActivityPopulationBrowseResultSchema, type ActivityPopulationRun, type ActivityPopulationSelection, type ActivityPopulationBrowse, type ActivityPopulationBrowseResult } from "../../../src/models/dashboard/activity-population.js";
import { buildActivityVolumeBoundarySkeleton } from "../../../src/models/dashboard/activity-volume.js";
import { canonicalJsonStringify } from "../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../src/rules/validation/sha256.js";
import { RunIdSchema } from "../../../src/rules/identity/ids.js";
import { projectActivityPopulation, projectActivityBrowse, useActivityWiring, type ActivityClient } from "../../../src/dashboard/state/activity-wiring-adapter.js";
import { ActivityView } from "../../../src/dashboard/surfaces/activity/activity-view.js";
import { workflowDurationChart } from "../../../src/dashboard/surfaces/activity/activity-duration-model.js";
import { ERROR_CATALOG } from "../../../src/models/failures/error-catalog.js";
import { DashboardClientError } from "../../../src/dashboard/client/errors.js";
import { createActivityReportFixtures } from "../../support/helpers/dashboard/activity-report-fixtures.js";

beforeEach(() => { vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => vi.unstubAllGlobals());
const sources = Object.freeze({ fixture: "mock" as const });
function selection(rowsInput: readonly Partial<ActivityPopulationRun>[] = [{ status: "done", durationMs: 0 }, { status: "failed", durationMs: 42000 }, { status: "queued" }]): ActivityPopulationSelection {
  const empty = createActivityReportFixtures().EMPTY;
  const population = rowsInput.map((row, index) => ({ runId: RunIdSchema.parse(`00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`), workflowId: "fixture", title: `Person ${index + 1}`, attempt: 1, parentRunId: null, shape: "single" as const, day: "2026-08-03", status: "queued" as const, terminal: ["done", "failed", "cancelled", "partial"].includes(row.status ?? "queued"), durationMs: null, readback: null, receiptResult: null, warningCount: null, ...row }));
  const count = (status: string) => population.filter(row => row.status === status).length;
  const terminal = population.filter(row => row.terminal);
  const measured = terminal.flatMap(row => row.durationMs === null ? [] : [row.durationMs]).sort((a, b) => a - b);
  const timing = population.filter(row => row.status === "done" && row.parentRunId === null);
  const timed = timing.flatMap(row => row.durationMs === null ? [] : [row.durationMs]);
  const skeleton = buildActivityVolumeBoundarySkeleton(empty, "UTC");
  const report = { ...empty, totalRuns: population.length, terminalRuns: terminal.length, inFlightRuns: population.length - terminal.length,
    completion: { readBack: 0, warnings: 0, warningsUnknown: count("done") }, days: population.length ? [{ day: "2026-08-03", runs: population.length }] : [],
    workflows: population.length ? [{ workflowId: "fixture", registration: { state: "unregistered", reason: "Synthetic registration unavailable" }, runs: population.length, completion: { readBack: 0, warnings: 0, warningsUnknown: count("done") }, failed: count("failed"), cancelled: count("cancelled"), partial: count("partial"), open: population.length - terminal.length }] : [],
    categories: population.length ? [{ category: { state: "unregistered", reason: "Synthetic registration unavailable" }, runs: population.length }] : [],
    statuses: [...new Set(population.map(row => row.status))].map(status => ({ status, runs: count(status), sample: ["done", "failed", "cancelled", "partial"].includes(status) ? [] : population.filter(row => row.status === status).slice(0, 5).map(row => row.runId) })),
    outcomes: [...new Set(terminal.map(row => row.status))].map(outcome => ({ outcome, runs: count(outcome) })),
    durations: { measuredRuns: measured.length, unmeasuredRuns: terminal.length - measured.length, medianMs: measured.length ? { state: "present", value: measured[Math.floor(measured.length / 2)] } : { state: "absent", reason: "No measurement" }, longestMs: measured.length ? { state: "present", value: measured.at(-1), runId: terminal.find(row => row.durationMs === measured.at(-1))!.runId } : { state: "absent", reason: "No measurement" }, totalMs: measured.reduce((sum, n) => sum + n, 0) },
    ledger: { systems: [{ system: "ucpath", entries: 3, prod: 2, test: 1 }] },
    volume: { state: "complete", ...skeleton, coveredRuns: population.length, buckets: skeleton.buckets.map(bucket => ({ ...bucket, runs: bucket.start.slice(0, 10) === "2026-08-03" ? population.length : 0 })) } };
  const identity = { from: report.from, to: report.to, generatedAt: report.generatedAt, expiresAt: "2026-08-07T12:15:00.000Z", sourceIdentity: "a".repeat(64), authorityGeneration: 1, reportDigest: sha256Hex(canonicalJsonStringify(report)) };
  const successfulTiming = population.length ? [{ workflowId: "fixture", totalMs: timed.length ? timed.reduce((sum, n) => sum + n, 0) : null, measured: timed.length, unmeasured: timing.length - timed.length }] : [];
  return ActivityPopulationSelectionSchema.parse({ report: { ...report, snapshot: { ...identity, token: "as1.fixture.signature" } }, population, successfulTiming, snapshot: { ...identity, reportToken: "as1.fixture.signature", populationDigest: sha256Hex(canonicalJsonStringify({ population, successfulTiming })), token: "ap1.fixture.signature" } });
}
function browseResult(selected: ActivityPopulationSelection, browse: ActivityPopulationBrowse): ActivityPopulationBrowseResult {
  const all = selected.population.filter(row => browse.metric === "completed" ? row.status === "done" : browse.metric === "timed" ? row.status === "done" && row.parentRunId === null && row.durationMs !== null : browse.metric === "failed" ? row.status === "failed" : ["queued", "running", "cancelling", "blocked", "awaiting-approval"].includes(row.status));
  const matches = all.filter(row => !browse.query || row.title.includes(browse.query));
  const identity = { from: selected.report.from, to: selected.report.to, token: selected.snapshot.token, browse };
  return ActivityPopulationBrowseResultSchema.parse({ identity: { ...identity, digest: sha256Hex(canonicalJsonStringify(identity)) }, total: all.length, totalMatches: matches.length, start: browse.page * 20, rows: matches.slice(browse.page * 20, browse.page * 20 + 20), run: browse.run ? matches.find(row => row.runId === browse.run) ?? null : null });
}
function clientOf(selected: ActivityPopulationSelection): ActivityClient {
  const unavailable = async (): Promise<never> => { throw new Error("unrequested detail"); };
  return { activityPopulation: vi.fn(async () => selected), readActivityPopulation: vi.fn<ActivityClient["readActivityPopulation"]>(async (_selection, browse) => ({ selection: selected, browse: browse === undefined ? null : browseResult(selected, browse) })), exportActivityPopulationCsv: vi.fn(async () => ({ filename: "selected.csv", mediaType: "text/csv; charset=utf-8", bytes: new ArrayBuffer(2) })), dashboardDay: vi.fn(unavailable), runDetail: vi.fn(unavailable), runSection: vi.fn(unavailable), artifactUrl: () => "unavailable" };
}
it("preserves full populations, successful root timing, all-terminal duration, null evidence and separate transaction environments", () => {
  const full = selection();
  const projected = projectActivityPopulation(full);
  assert.equal(projected.total, 3); assert.equal(projected.completed, 1); assert.equal(projected.outstanding, 1);
  assert.equal(projected.duration.totalSeconds, 42); assert.equal(projected.duration.measured, 2);
  assert.deepEqual(projected.workflows[0]?.successfulTiming, { totalSeconds: 0, measured: 1, unmeasured: 0 });
  assert.deepEqual(projected.evidence, { verified: null, unread: null });
  assert.deepEqual(projected.transactions.map(row => [row.environment, row.count]), [["production", 2], ["test", 1]]);
  const child = projectActivityPopulation(selection([{ status: "done", durationMs: 1000, parentRunId: RunIdSchema.parse("11111111-1111-4111-8111-111111111111") }]));
  assert.equal(child.workflows[0]?.completed, 1); assert.equal(child.durationWorkflows?.[0]?.completed, 0);
  assert.equal(workflowDurationChart(child.durationWorkflows).rows[0]?.averageSeconds, null);
  const missing = projectActivityPopulation(selection([{ status: "done", durationMs: null }]));
  assert.equal(missing.duration.totalSeconds, null); assert.deepEqual(missing.workflows[0]?.successfulTiming, { totalSeconds: null, measured: 0, unmeasured: 1 });
  const empty = projectActivityPopulation(selection([]));
  assert.equal(empty.total, 0); assert.equal(empty.duration.totalSeconds, 0); assert.equal(empty.duration.measured, 0); assert.equal(empty.duration.unmeasured, 0);
  assert.equal(missing.duration.unmeasured, 1);
  assert.equal(projected.runs?.[0]?.readback, null);
});
it("uses authoritative page rows once and refuses fixture logs for served identities", async () => {
  const selected = selection(Array.from({ length: 21 }, () => ({ status: "done" as const, durationMs: 1000 })));
  const client = clientOf(selected);
  const browse = browseResult(selected, { metric: "completed", page: 1, sort: { column: "duration", direction: "descending" } });
  const result = await projectActivityBrowse(client, selected, browse, sources, new AbortController().signal);
  assert.equal(result.state, "loaded"); if (result.state !== "loaded") throw new Error("loaded expected");
  assert.equal(result.totalMatches, 21); assert.equal(result.start, 20); assert.equal(result.rows.length, 1);
  const run = selected.population[0];
  const refused = await projectActivityBrowse(client, selected, browseResult(selected, { metric: "completed", page: 0, run: run.runId }), sources, new AbortController().signal);
  assert.deepEqual(refused, { state: "unavailable", reason: ERROR_CATALOG.LOGS_UNAVAILABLE_TITLE.text });
  assert.equal(vi.mocked(client.runDetail).mock.calls.length, 0);
});
it("retains search focus and stale rows while superseding browse requests, guards export and binds the settled selection", async () => {
  const selected = selection([{ status: "done", durationMs: 0 }, { status: "done", durationMs: 1000 }]);
  const client = clientOf(selected);
  const pending: { browse: ActivityPopulationBrowse; resolve: (value: Awaited<ReturnType<ActivityClient["readActivityPopulation"]>>) => void }[] = [];
  const immediate = client.readActivityPopulation.bind(client);
  client.readActivityPopulation = vi.fn<ActivityClient["readActivityPopulation"]>((input, browse, signal) => browse?.query ? new Promise<Awaited<ReturnType<ActivityClient["readActivityPopulation"]>>>(resolve => pending.push({ browse, resolve })) : immediate(input, browse, signal));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let state: ReturnType<typeof useActivityWiring>;
  function Scene() {
    const [browse, setBrowse] = useState<import("../../../src/dashboard/surfaces/activity/activity-drilldown-model.js").ActivityBrowse | null>({ metric: "completed", page: 0 });
    state = useActivityWiring(client, selected.report, browse, sources, true);
    return createElement(ActivityView, { data: state.data, browse: state.browse, pending: state.pending, notice: state.notice, selection: browse, onSelection: setBrowse, range: selected.report, today: selected.report.to, period: "custom", onPreset: () => {}, onRange: () => {} });
  }
  try {
    await act(async () => root.render(createElement(Scene)));
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Search runs"]'); assert.ok(input); await act(async () => input.focus());
    const change = async (value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await change("Person 1");
    assert.equal(document.activeElement, input); assert.equal(host.querySelector('input[aria-label="Search runs"]'), input);
    assert.match(host.textContent ?? "", /Refreshing Analytics selection/); assert.equal(host.querySelectorAll('button[aria-label^="Open logs for"]:disabled').length, 2);
    await assert.rejects(state!.exportCsv(), (error: unknown) => error instanceof DashboardClientError && error.code === "ACTIVITY_SNAPSHOT_STALE_OR_SELECTION_MISMATCH");
    await change("Person 2");
    assert.equal(pending.length, 2);
    await act(async () => pending[1].resolve({ selection: selected, browse: browseResult(selected, pending[1].browse) }));
    assert.equal(document.activeElement, input); assert.equal(host.querySelectorAll('button[aria-label^="Open logs for"]').length, 1); assert.match(host.textContent ?? "", /Person 2/);
    await act(async () => pending[0].resolve({ selection: selected, browse: browseResult(selected, pending[0].browse) }));
    assert.equal(host.querySelectorAll('button[aria-label^="Open logs for"]').length, 1); assert.match(host.textContent ?? "", /Person 2/);
    await state!.exportCsv(); assert.equal(vi.mocked(client.exportActivityPopulationCsv).mock.calls[0]?.[0], selected);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("keeps initial loading, read refusal, empty success and client replacement separate", async () => {
  const selected = selection([]);
  const client = clientOf(selected);
  const resolvers: ((value: ActivityPopulationSelection) => void)[] = [];
  client.activityPopulation = vi.fn(() => new Promise<ActivityPopulationSelection>(resolve => resolvers.push(resolve)));
  const failing = clientOf(selected);
  failing.activityPopulation = vi.fn(async () => { throw new DashboardClientError({ kind: "http", code: "ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED", message: "private detail", status: 409 }); });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let state: ReturnType<typeof useActivityWiring>;
  function Scene({ current }: { current: ActivityClient }) { state = useActivityWiring(current, selected.report, null, sources, true); return null; }
  try {
    await act(async () => root.render(createElement(Scene, { current: client })));
    assert.equal(state!.data.state, "loading");
    await act(async () => root.render(createElement(Scene, { current: failing })));
    assert.deepEqual(state!.data, { state: "unavailable", reason: ERROR_CATALOG.ACTIVITY_SNAPSHOT_INVALID_OR_EXPIRED.text });
    await act(async () => root.render(createElement(Scene, { current: client })));
    await act(async () => resolvers[0](selected));
    assert.equal(state!.data.state, "loading");
    await act(async () => resolvers[1](selected));
    const current = (): ReturnType<typeof useActivityWiring> => state;
    const loaded = current().data;
    assert.equal(loaded.state, "loaded");
    if (loaded.state !== "loaded") throw new Error("loaded expected");
    assert.equal(loaded.report.total, 0);
    const oldExport = state!.exportCsv;
    await act(async () => root.render(createElement(Scene, { current: failing })));
    await assert.rejects(oldExport(), /no longer matches/u);
    assert.equal(vi.mocked(client.exportActivityPopulationCsv).mock.calls.length, 0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

it("uses the served calendar for the product producer and never substitutes workflow fixture detail", async () => {
  const selected = selection([{ status: "done", durationMs: 0 }]);
  const client = clientOf(selected);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(ActivityReport, { client, today: "2026-08-07", range: "", onRange: () => {}, workflowSources: sources })));
    assert.deepEqual(vi.mocked(client.activityPopulation).mock.calls[0]?.slice(0, 2), ["2026-08-01", "2026-08-07"]);
    assert.match(host.textContent ?? "", /1 runs in this period/);
    const completed = host.querySelector<HTMLButtonElement>('button[aria-label="View completed runs (1)"]'); assert.ok(completed);
    await act(async () => completed.click());
    const run = host.querySelector<HTMLButtonElement>('button[aria-label^="Open logs for"]'); assert.ok(run);
    await act(async () => run.click());
    assert.match(host.textContent ?? "", /Logs unavailable/);
    assert.equal(host.querySelector('section[aria-label="Selected run logs"]'), null);
    assert.equal(vi.mocked(client.runDetail).mock.calls.length, 0);
  } finally { await act(async () => root.unmount()); host.remove(); }
});

import { ActivityReport } from "../../../src/dashboard/surfaces/activity/activity.js";

it("refuses a served detail without exact day membership before reading any logs", async () => {
  const selected = selection([{ status: "done", durationMs: 0 }]);
  const client = clientOf(selected);
  client.dashboardDay = vi.fn(async () => ({ ...FIXTURE_START_PICKER_DAY_WIRE, queueSurfaces: [] }));
  const run = selected.population[0];
  await assert.rejects(projectActivityBrowse(client, selected, browseResult(selected, { metric: "completed", page: 0, run: run.runId }), { fixture: "served" }, new AbortController().signal), /no longer matches/u);
  assert.equal(vi.mocked(client.runDetail).mock.calls.length, 0);
});

import { FIXTURE_START_PICKER_DAY_WIRE } from "../../support/fixtures/dashboard/fixture-start.js";

it("renders an invalid browse as a named refusal and revokes export after unmount", async () => {
  const selected = selection([]); const client = clientOf(selected);
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let state: ReturnType<typeof useActivityWiring>;
  function Scene() { state = useActivityWiring(client, selected.report, { metric: "completed", page: -1 }, sources, true); return null; }
  try {
    await act(async () => root.render(createElement(Scene)));
    assert.deepEqual(state!.browse, { state: "unavailable", reason: ERROR_CATALOG.ACTIVITY_POPULATION_BROWSE_INVALID.text });
    assert.equal(vi.mocked(client.readActivityPopulation).mock.calls.length, 0);
    await assert.rejects(state!.exportCsv(), /no longer matches/u);
    const exported = state!.exportCsv;
    await act(async () => root.unmount());
    await assert.rejects(exported(), /no longer matches/u);
    assert.equal(vi.mocked(client.exportActivityPopulationCsv).mock.calls.length, 0);
  } finally { host.remove(); }
});

it("never paints unknown or warning completion evidence as verified", async () => {
  for (const readback of [null, false]) {
    const selected = selection([{ status: "done", durationMs: 0, readback, receiptResult: readback === false ? "done-with-warnings" : null }]);
    const report = projectActivityPopulation(selected);
    const run = report.runs?.[0]; assert.ok(run);
    const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(ActivityView, { data: { state: "loaded", report }, range: report.range, today: selected.report.to, period: "custom", onPreset: () => {}, onRange: () => {}, selection: { metric: "outstanding", page: 0 }, onSelection: () => {}, browse: { state: "loaded", total: 1, totalMatches: 1, start: 0, rows: [run] } })));
      const statusTitles = [...host.querySelectorAll<HTMLElement>("[title]")].map(element => element.title);
      assert.equal(statusTitles.includes(DS_STATUS.verifiedDone.meaning), false);
      assert.equal(statusTitles.includes(DS_STATUS.doneWarnings.meaning), true);
      assert.match(host.textContent ?? "", /Done/);
      assert.equal(run.readback, readback);
    } finally { await act(async () => root.unmount()); host.remove(); }
  }
});
