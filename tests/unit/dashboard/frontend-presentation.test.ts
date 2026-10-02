import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { ActivityVolumeSchema } from "../../../src/domain/dashboard/activity-volume.js";
import { ActivityReport } from "../../../src/dashboard/surfaces/activity.js";
import { ACTIVITY_SAMPLE_RANGE, activitySample } from "../../../src/dashboard/surfaces/activity/activity-fixture.js";
import { activityCompletionRate, activityDuration, activityFailureRate } from "../../../src/dashboard/surfaces/activity/activity-view-model.js";
import { WorkflowExplorer } from "../../../src/dashboard/surfaces/explorer.js";
import { LogSample } from "../../../src/dashboard/surfaces/logs/log-sample.js";
import { separationLogs } from "../../../src/dashboard/surfaces/logs/log-fixture.js";
import { visualLogSteps } from "../../../src/dashboard/surfaces/log-feed-model.js";
import { selectedLogPresentation } from "../../../src/dashboard/surfaces/logs/log-selection-model.js";
import { FIXTURE_DAY_WIRE, FIXTURE_IDS } from "../../parity/helpers/fixture-queue.js";

const noop = () => {};
describe("frontend presentation producers", () => {
  it("keeps the approved report's counts, cohorts and distinct receipt ledger coherent", () => {
    const data = activitySample(ACTIVITY_SAMPLE_RANGE, "normal");
    assert.equal(data.state, "loaded");
    if (data.state !== "loaded") throw new Error("sample must load");
    const report = data.report;
    assert.deepEqual([report.total, report.completed, report.outstanding, report.failed], [44, 38, 4, 2]);
    assert.deepEqual([report.running, report.waiting, report.terminal], [3, 1, 40]);
    assert.deepEqual(report.duration, { medianSeconds: 134, longestSeconds: 281, totalSeconds: 4911, measured: 36, unmeasured: 4 });
    assert.deepEqual(report.failures, [{ label: "Document read timeout", runs: 2 }]);
    assert.deepEqual(report.evidence, { verified: 35, unread: 3 });
    assert.deepEqual(report.workflows.map(row => [row.completed, row.outstanding, row.failed, row.total]), [[24, 3, 2, 29], [14, 1, 0, 15]]);
    assert.deepEqual(report.transactions.map(row => row.count), [18, 17]);
    const volume = ActivityVolumeSchema.parse(report.volume);
    assert.deepEqual(volume.buckets.map(row => row.runs), [0, 5, 8, 7, 6, 9, 9]);
  });
  it("changes all local sample measurements with the applied range and preserves measured zero", () => {
    const data = activitySample({ from: "2026-09-26", to: "2026-09-26" }, "normal");
    assert.equal(data.state, "loaded");
    if (data.state !== "loaded") throw new Error("sample must load");
    assert.equal(data.report.total, 9);
    assert.equal(ActivityVolumeSchema.parse(data.report.volume).coveredRuns, 9);
    const empty = activitySample({ from: "2026-08-01", to: "2026-08-31" }, "normal");
    assert.equal(empty.state, "loaded");
    if (empty.state !== "loaded") throw new Error("empty period must load");
    assert.equal(empty.report.total, 0);
    assert.equal(empty.report.duration.medianSeconds, null);
    assert.equal(empty.report.evidence.verified, 0);
    assert.ok(ActivityVolumeSchema.parse(empty.report.volume).buckets.every(bucket => bucket.runs === 0));
  });
  it("distinguishes unknown, loading and failure from a successful empty report", () => {
    const incomplete = activitySample(ACTIVITY_SAMPLE_RANGE, "incomplete");
    if (incomplete.state !== "loaded") throw new Error("incomplete report must load");
    assert.equal(incomplete.report.evidence.verified, null);
    assert.equal(incomplete.report.evidence.unread, null);
    assert.equal(incomplete.report.duration.medianSeconds, null);
    assert.equal(incomplete.report.volume, undefined);
    assert.equal(incomplete.report.total, 44);
    assert.deepEqual(activitySample(ACTIVITY_SAMPLE_RANGE, "loading"), { state: "loading" });
    assert.equal(activitySample(ACTIVITY_SAMPLE_RANGE, "unavailable").state, "unavailable");
    assert.equal(activityFailureRate(0, 0), "No terminal runs");
    assert.equal(activityFailureRate(2, 40), "2 of 40 terminal runs · 5%");
    assert.equal(activityDuration(null), "Unavailable");
    assert.equal(activityDuration(134), "2m 14s");
  });
  it("keeps new performance metrics scoped to finished and measured runs, with unknown distinct from zero", () => {
    assert.equal(activityCompletionRate(38, 40), "95%");
    assert.equal(activityCompletionRate(0, 0), "No finished runs");
    assert.equal(activityDuration(4911), "1h 21m");
    const missing = activitySample(ACTIVITY_SAMPLE_RANGE, "incomplete");
    const empty = activitySample(ACTIVITY_SAMPLE_RANGE, "empty");
    if (missing.state !== "loaded" || empty.state !== "loaded") throw new Error("samples must load");
    assert.equal(missing.report.duration.longestSeconds, null);
    assert.equal(missing.report.duration.totalSeconds, null);
    assert.equal(missing.report.failures, null);
    assert.equal(empty.report.duration.longestSeconds, null);
    assert.equal(empty.report.duration.totalSeconds, 0);
    assert.deepEqual(empty.report.failures, []);
    const today = activitySample({ from: "2026-09-26", to: "2026-09-26" }, "normal");
    if (today.state !== "loaded") throw new Error("today sample must load");
    assert.equal(activityCompletionRate(today.report.completed, today.report.terminal), "100%");
    assert.equal(today.report.duration.longestSeconds, 134);
    assert.equal(today.report.duration.totalSeconds, 536);
  });
  it("renders canonical surfaces without a client provider or registered-definition fallback", () => {
    const activity = renderToStaticMarkup(createElement(ActivityReport, { range: "", onRange: noop }));
    assert.match(activity, /Workflow outcomes/);
    assert.match(activity, /36 measured/);
    assert.match(activity, /Sample data/);
    const explorer = renderToStaticMarkup(createElement(WorkflowExplorer, { onVersionRegistry: noop }));
    assert.equal((explorer.match(/data-step-number=/g) ?? []).length, 22);
    assert.doesNotMatch(explorer, /Registered definition|Back to dashboard/);
    const logs = renderToStaticMarkup(createElement(LogSample));
    assert.match(logs, /Save and Submit/);
    assert.doesNotMatch(logs, /Load more actions|No captures|dry run|Rerun|0s working/);
  });
  it("shows visible confirmed actions while excluding computation-only steps", () => {
    const steps = visualLogSteps(separationLogs);
    assert.ok(!steps.some(step => step.title === "Build separation plan" || step.title === "Reconcile dates"));
    assert.ok(steps.some(step => step.entries.some(entry => entry.kind === "click" && entry.label === "Save and Submit")));
    assert.equal(steps.flatMap(step => step.entries).flatMap(entry => entry.kind === "decision" ? entry.decision.screenshots ?? [] : entry.kind === "note" ? [] : entry.screenshots ?? []).length, 16);
  });
  it("updates selected-run context without inventing action history or unmeasured durations", () => {
    const row = FIXTURE_DAY_WIRE.queueSurfaces.find(item => item.runId === FIXTURE_IDS.runningRun);
    assert.ok(row);
    const running = selectedLogPresentation({ row, workflowLabel: "Person Lookup" });
    assert.equal(running.title, "Person Lookup · Battistessa, Johnnie");
    assert.equal(running.status, "Running");
    assert.match(JSON.stringify(running.steps), /Searching UCPath for Battistessa, Johnnie/u);
    assert.doesNotMatch(JSON.stringify(running.steps), /Alex Morgan|screenshots|Save and Submit/u);
    assert.ok(running.timeline.every(stage => stage.durationLabel === undefined));
    const changed = selectedLogPresentation({ workflowLabel: "Person Lookup", row: {
      ...row, liveMessage: { state: "present", value: "Could not click Search" }, status: "failed",
      pipeline: [{ ...row.pipeline[0], state: "done", durationSec: 0 }, { ...row.pipeline[1], state: "failed" }, { ...row.pipeline[2], state: "pending" }, { ...row.pipeline[3], state: "skipped" }],
    } });
    assert.equal(changed.status, "Failed");
    assert.match(JSON.stringify(changed.steps), /Could not click Search/u);
    assert.doesNotMatch(JSON.stringify(changed.steps), /Searching UCPath for/u);
    assert.equal(changed.timeline[0].durationLabel, "0s");
    assert.deepEqual(changed.timeline.map(stage => stage.state), ["completed", "failed", "pending", "skipped"]);
    assert.equal(changed.timeline[1].stepId, row.pipeline[1].id);
    assert.ok(changed.timeline.slice(2).every(stage => stage.stepId === undefined));
  });
  it("binds classified captures to the filled fields, submission and matching person", () => {
    for (const step of visualLogSteps(separationLogs)) for (const entry of step.entries) {
      if (entry.kind === "note") continue;
      if (entry.kind === "fields" && entry.fields.some(field => field.kind === "fill")) assert.ok(entry.screenshots?.some(shot => shot.kind === "fields"), `missing filled fields capture: ${entry.id}`);
      if (entry.kind === "click" && ["Save", "Save and Submit"].includes(entry.label)) assert.ok(entry.screenshots?.some(shot => shot.kind === "form" && shot.height > shot.width && shot.time >= entry.time));
      for (const shot of (entry.kind === "decision" ? entry.decision.screenshots : entry.screenshots) ?? []) {
        assert.equal(shot.system, step.system);
        const svg = readFileSync(new URL(`../../../src/dashboard/public${shot.src}`, import.meta.url), "utf8");
        assert.match(svg, new RegExp(`width="${shot.width}" height="${shot.height}"`));
        assert.match(svg, /FICTIONAL/);
      }
    }
    const candidate = separationLogs.find(step => step.id === "search-person")?.entries.find(entry => entry.id === "person-match");
    assert.ok(candidate?.kind === "fields" && candidate.screenshots?.some(shot => shot.kind === "person"));
  });
});
