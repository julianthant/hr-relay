import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { SessionPanel } from "../../../src/dashboard/surfaces/session-panel.js";
import { previewSessionAdd, previewSessionControl, sessionsSample } from "../../../src/dashboard/surfaces/sessions/sessions-fixture.js";
import { sessionProgressPercent, sessionTallies } from "../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import { previewScenarios } from "../../../src/dashboard/surfaces/logs/log-fixture.js";
import { visualLogSteps } from "../../../src/dashboard/surfaces/log-feed-model.js";

describe("frontend timeline and sessions", () => {
  it("every available timeline jump targets a displayed confirmed-action step", () => {
    for (const scenario of previewScenarios) {
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
  it("local worker controls preserve peers and input fixtures; invalid transitions fail loud", () => {
    const data = sessionsSample("active");
    if (data.state !== "ready") throw new Error("ready sample required");
    const first = data.workers[0];
    const paused = previewSessionControl(data, first.id, "pause");
    if (paused.state !== "ready") throw new Error("ready result required");
    assert.equal(paused.workers[0].state, "paused");
    assert.equal(data.workers[0].state, "running");
    assert.equal(paused.workers[1], data.workers[1]);
    const resumed = previewSessionControl(paused, first.id, "resume");
    if (resumed.state !== "ready") throw new Error("ready result required");
    assert.equal(resumed.workers[0].state, "running");
    const stopped = previewSessionControl(resumed, first.id, "stop");
    if (stopped.state !== "ready") throw new Error("ready result required");
    assert.equal(stopped.workers[0].state, "idle");
    assert.equal(stopped.workers[0].subject, undefined);
    assert.equal(stopped.workers[0].progress, undefined);
    assert.deepEqual(stopped.workers[0].browsers, []);
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
    assert.ok(current.browsers.every(browser => browser.state === "starting"));
    assert.equal(data.workers.find(worker => worker.id === failed.id)?.state, "failed");
  });
  it("adds the selected local count without mutating fixtures or accepting invalid input", () => {
    const empty = sessionsSample("empty");
    const added = previewSessionAdd(empty, "separations", 2, 1);
    if (empty.state !== "ready" || added.state !== "ready") throw new Error("ready sample required");
    assert.equal(empty.workers.length, 0);
    assert.deepEqual(added.workers.map(worker => [worker.id, worker.workflow, worker.state]), [["sample-added-1", "Separations", "starting"], ["sample-added-2", "Separations", "starting"]]);
    for (const count of [0, 7, 1.5, NaN]) assert.throws(() => previewSessionAdd(empty, "separations", count, 1), /sessions-preview-add-invalid/);
    assert.throws(() => previewSessionAdd(empty, "missing", 1, 1), /sessions-preview-add-invalid/);
  });
  it("distinguishes unknown state from empty workers and rejects false progress", () => {
    const active = sessionsSample("active");
    if (active.state !== "ready") throw new Error("ready sample required");
    assert.deepEqual(sessionTallies(active.workers), [{ state: "running", count: 2 }, { state: "starting", count: 1 }, { state: "idle", count: 1 }]);
    assert.equal(sessionsSample("loading").state, "loading");
    assert.equal(sessionsSample("unavailable").state, "unavailable");
    assert.equal(sessionProgressPercent({ completed: 0, total: 5 }), 0);
    assert.equal(sessionProgressPercent({ completed: 2, total: 5 }), 40);
    for (const progress of [{ completed: 0, total: 0 }, { completed: 6, total: 5 }, { completed: -1, total: 5 }]) assert.throws(() => sessionProgressPercent(progress), /session-progress-invalid/);
  });
  it("renders the canonical Sessions host without any dashboard client provider", () => {
    const markup = renderToStaticMarkup(createElement(SessionPanel, { open: true, onOpenChange: () => {} }));
    assert.equal((markup.match(/<article /gu) ?? []).length, 4);
    assert.match(markup, /Sample data/);
    assert.match(markup, /Read the timecard/);
    assert.doesNotMatch(markup, /pool version|expectedVersion|lease|Live<|No worker is running|>Worker \d+</);
  });
});
