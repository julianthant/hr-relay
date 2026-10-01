import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { ActivityVolumeSchema } from "../../../src/domain/dashboard/activity-volume.js";
import { ActivityReport } from "../../../src/dashboard/surfaces/activity.js";
import { ACTIVITY_SAMPLE_RANGE, activitySample } from "../../../src/dashboard/surfaces/activity/activity-fixture.js";
import { activityDuration, activityFailureRate } from "../../../src/dashboard/surfaces/activity/activity-view-model.js";
import { WorkflowExplorer } from "../../../src/dashboard/surfaces/explorer.js";
import { LogSample } from "../../../src/dashboard/surfaces/logs/log-sample.js";
import { separationLogs } from "../../../src/dashboard/surfaces/logs/log-fixture.js";
import { visualLogSteps } from "../../../src/dashboard/surfaces/log-feed-model.js";

const noop = () => {};
describe("frontend presentation producers", () => {
  it("keeps the approved report's counts, cohorts and distinct receipt ledger coherent", () => {
    const data = activitySample(ACTIVITY_SAMPLE_RANGE, "normal");
    assert.equal(data.state, "loaded");
    if (data.state !== "loaded") throw new Error("sample must load");
    const report = data.report;
    assert.deepEqual([report.total, report.completed, report.outstanding, report.failed], [44, 38, 4, 2]);
    assert.deepEqual([report.running, report.waiting, report.terminal], [3, 1, 40]);
    assert.deepEqual(report.duration, { medianSeconds: 134, measured: 36, unmeasured: 4 });
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
    assert.equal(steps.flatMap(step => step.entries).flatMap(entry => entry.kind === "note" ? [] : entry.screenshots ?? []).length, 2);
  });
});
