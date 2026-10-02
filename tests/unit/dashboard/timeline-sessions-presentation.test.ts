import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { SessionPanel } from "../../../src/dashboard/surfaces/session-panel.js";
import { previewSessionAdd, previewSessionControl, sessionsSample } from "../../../src/dashboard/surfaces/sessions/sessions-fixture.js";
import { sessionTimelineSummary, sessionTallies } from "../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import { decisionScenarios, previewScenarios, separationLogs } from "../../../src/dashboard/surfaces/logs/log-fixture.js";
import { visualLogSteps } from "../../../src/dashboard/surfaces/log-feed-model.js";

describe("frontend timeline and sessions", () => {
  it("every available timeline jump targets a displayed confirmed-action step", () => {
    for (const scenario of [...previewScenarios, ...decisionScenarios]) {
      const visual = new Set(visualLogSteps(scenario.steps).map(step => step.id));
      assert.equal(scenario.timeline.length, 5);
      for (const stage of scenario.timeline) {
        if (stage.stepId) assert.ok(visual.has(stage.stepId), `${scenario.id}: ${stage.id}`);
        if (stage.state === "pending") { assert.equal(stage.time, undefined); assert.equal(stage.durationLabel, undefined); assert.equal(stage.stepId, undefined); }
      }
    }
    assert.ok(previewScenarios.find(item => item.id === "waiting")?.timeline.some(stage => stage.state === "waiting"));
    assert.ok(previewScenarios.find(item => item.id === "failed")?.timeline.some(stage => stage.state === "failed"));
  });
  it("timeline substep durations match fixture boundaries and incomplete steps do not claim measurements", () => {
    const seconds = (time: string) => time.split(":").map(Number).reduce((total, value) => total * 60 + value, 0);
    const full = previewScenarios.find(item => item.id === "separation")!;
    const substeps = full.timeline.flatMap(stage => stage.substeps);
    assert.deepEqual(substeps.map(step => step.id), separationLogs.map(step => step.id));
    const durations = substeps.map((substep, index) => {
      const start = seconds(separationLogs[index].time);
      const end = seconds(separationLogs[index + 1]?.time ?? "09:33:36");
      assert.equal(substep.durationLabel, `${end - start}s`);
      assert.equal(substep.state, "completed");
      return end - start;
    });
    assert.equal(durations.reduce((sum, duration) => sum + duration, 0), 156);
    for (const scenario of previewScenarios) for (const stage of scenario.timeline) for (const substep of stage.substeps) {
      if (substep.state !== "completed") assert.equal(substep.durationLabel, undefined, `${scenario.id}: ${substep.id}`);
    }
    assert.equal(previewScenarios.find(item => item.id === "failed")?.timeline.at(-1)?.substeps.at(-1)?.state, "failed");
    assert.ok(previewScenarios.find(item => item.id === "waiting")?.timeline.some(stage => stage.substeps.some(substep => substep.state === "waiting")));
  });
  it("preserves completed stages and grays later stages around the affected portion", () => {
    const full = previewScenarios.find(item => item.id === "separation")!;
    const failure = decisionScenarios.find(item => item.id === "failure-prepared")!;
    assert.equal(failure.timeline.length, 5);
    assert.deepEqual(failure.timeline.slice(0, 3), full.timeline.slice(0, 3));
    assert.equal(failure.timeline[3].label, "File termination");
    assert.equal(failure.timeline[3].state, "failed");
    assert.equal(failure.timeline[4].state, "pending");
    assert.equal(failure.timeline[4].durationLabel, undefined);
    const review = decisionScenarios.find(item => item.id === "review-employment")!;
    assert.deepEqual(review.timeline[0], full.timeline[0]);
    assert.equal(review.timeline[1].label, "Verify employee");
    assert.equal(review.timeline[1].state, "waiting");
    assert.ok(review.timeline.slice(2).every(stage => stage.state === "pending"));
  });
  it("local worker controls preserve peers and input fixtures; invalid transitions fail loud", () => {
    const data = sessionsSample("active");
    if (data.state !== "ready") throw new Error("ready sample required");
    const first = data.workers[0];
    const paused = previewSessionControl(data, first.id, "pause");
    if (paused.state !== "ready") throw new Error("ready result required");
    assert.equal(paused.workers[0].state, "paused");
    assert.equal(paused.workers[0].timeline?.find(node => node.id === "separation-12")?.state, "paused");
    assert.equal(data.workers[0].state, "running");
    assert.equal(paused.workers[1], data.workers[1]);
    const resumed = previewSessionControl(paused, first.id, "resume");
    if (resumed.state !== "ready") throw new Error("ready result required");
    assert.equal(resumed.workers[0].state, "running");
    assert.equal(resumed.workers[0].timeline?.find(node => node.id === "separation-12")?.state, "active");
    const stopped = previewSessionControl(resumed, first.id, "stop");
    if (stopped.state !== "ready") throw new Error("ready result required");
    assert.equal(stopped.workers[0].state, "idle");
    assert.equal(stopped.workers[0].subject, undefined);
    assert.equal(stopped.workers[0].timeline, undefined);
    assert.deepEqual(stopped.workers[0].browsers, []);
    const removed = previewSessionControl(stopped, first.id, "remove");
    if (removed.state !== "ready") throw new Error("ready result required");
    assert.deepEqual(removed.workers, data.workers.slice(1));
    assert.equal(removed.workers[0], data.workers[1]);
    assert.equal(stopped.workers.length, 4);
    assert.throws(() => previewSessionControl(data, first.id, "remove"), /sessions-preview-remove-invalid/);
    assert.throws(() => previewSessionControl(data, first.id, "resume"), /sessions-preview-resume-invalid/);
    assert.throws(() => previewSessionControl(data, "missing", "stop"), /sessions-preview-worker-missing/);
    assert.throws(() => previewSessionControl(sessionsSample("loading"), first.id, "stop"), /sessions-preview-not-ready/);
  });
  it("a retry removes stale failure and keeps other attention cards intact", () => {
    const data = sessionsSample("attention");
    if (data.state !== "ready") throw new Error("ready sample required");
    const failed = data.workers.find(worker => worker.state === "failed")!;
    const retried = previewSessionControl(data, failed.id, "retry");
    if (retried.state !== "ready") throw new Error("ready result required");
    const current = retried.workers.find(worker => worker.id === failed.id)!;
    assert.equal(current.state, "starting");
    assert.equal(current.problem, undefined);
    assert.deepEqual(sessionTimelineSummary(current.timeline!), { completed: 0, total: 4 });
    assert.equal(current.timeline?.[0].state, "active");
    assert.ok(current.browsers.every(browser => browser.state === "starting"));
    assert.equal(data.workers.find(worker => worker.id === failed.id)?.state, "failed");
  });
  it("adds the selected local count without mutating fixtures or accepting invalid input", () => {
    const empty = sessionsSample("empty");
    const added = previewSessionAdd(empty, "separations", 2, 1);
    if (empty.state !== "ready" || added.state !== "ready") throw new Error("ready sample required");
    assert.equal(empty.workers.length, 0);
    assert.deepEqual(added.workers.map(worker => [worker.id, worker.workflow, worker.state]), [["sample-added-1", "Separations", "starting"], ["sample-added-2", "Separations", "starting"]]);
    const many = previewSessionAdd(empty, "person-lookup", 12, 3);
    if (many.state !== "ready") throw new Error("ready result required");
    assert.equal(many.workers.length, 12);
    assert.equal(new Set(many.workers.map(worker => worker.id)).size, 12);
    assert.ok(many.workers.every(worker => worker.workflow === "Person lookup"));
    assert.equal(empty.workers.length, 0);
    for (const count of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => previewSessionAdd(empty, "separations", count, 1), /sessions-preview-add-invalid/);
    assert.throws(() => previewSessionAdd(empty, "missing", 1, 1), /sessions-preview-add-invalid/);
  });
  it("distinguishes unknown state from empty workers and rejects false progress", () => {
    const active = sessionsSample("active");
    if (active.state !== "ready") throw new Error("ready sample required");
    assert.deepEqual(sessionTallies(active.workers), [{ state: "running", count: 2 }, { state: "starting", count: 1 }, { state: "idle", count: 1 }]);
    assert.equal(sessionsSample("loading").state, "loading");
    assert.equal(sessionsSample("unavailable").state, "unavailable");
    assert.deepEqual(sessionTimelineSummary(active.workers[0].timeline!), { completed: 11, total: 22 });
    assert.deepEqual(sessionTimelineSummary(active.workers[1].timeline!), { completed: 3, total: 4 });
    assert.throws(() => sessionTimelineSummary([]), /session-timeline-invalid/);
    const node = active.workers[0].timeline![0];
    assert.throws(() => sessionTimelineSummary([node, node]), /session-timeline-invalid/);
    assert.deepEqual(sessionTimelineSummary([{ ...node, state: "pending" }]), { completed: 0, total: 1 });
  });
  it("renders the canonical Sessions host without any dashboard client provider", () => {
    const markup = renderToStaticMarkup(createElement(SessionPanel, { open: true, onOpenChange: () => {} }));
    assert.equal((markup.match(/<article /gu) ?? []).length, 4);
    assert.doesNotMatch(markup, /Sample data|Add to preview/);
    assert.match(markup, /Ready for the next run/);
    assert.match(markup, /aria-label="No run in progress"/);
    assert.match(markup, /aria-label="Remove worker"/);
    assert.doesNotMatch(markup, /Worker stopped|Worker paused|>Pause<|>Stop<|>Retry<|>Resume</);
    assert.match(markup, /Read the timecard/);
    assert.doesNotMatch(markup, /pool version|expectedVersion|lease|Live<|No worker is running|>Worker \d+</);
  });
});
