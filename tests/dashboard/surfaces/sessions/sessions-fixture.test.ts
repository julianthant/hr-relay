import { servedFixtureSources as previewFixtureSources } from "../../../parity/helpers/workflow-composition.js";
import assert_m0 from "node:assert/strict";
import { describe as describe_m0,describe as describe_m1,expect as expect_m1,it as it_m0,it as it_m1 } from "vitest";
import { launchWorkflows as launchWorkflows_m1 } from "../../../../src/dashboard/surfaces/run-start/run-launch-model.js";
import { previewSessionAdd as previewSessionAdd_m0,previewSessionAdd as previewSessionAdd_m1,previewSessionControl as previewSessionControl_m0,sessionsSample as sessionsSample_m0 } from "../../../../src/dashboard/surfaces/sessions/sessions-fixture.js";
import { sessionTallies as sessionTallies_m0,sessionTimelineSummary as sessionTimelineSummary_m0 } from "../../../../src/dashboard/surfaces/sessions/sessions-view-model.js";
import { parseWorkflows as parseWorkflows_m1 } from "../../../../src/dashboard/surfaces/shell/shell-model.js";
import { buildWorkflowCatalog as buildWorkflowCatalog_m0,buildWorkflowCatalog as buildWorkflowCatalog_m1 } from "../../../../src/dashboard/surfaces/workflows/workflow-catalog-model.js";
import { FIXTURE_START_PICKER_BOOTSTRAP as FIXTURE_START_PICKER_BOOTSTRAP_m1 } from "../../../parity/helpers/fixture-start.js";


{

const catalog = buildWorkflowCatalog_m0([], true, previewFixtureSources([]));

describe_m0("frontend timeline and sessions", () => {
  it_m0("local worker controls preserve peers and input fixtures; invalid transitions fail loud", () => {
    const data = sessionsSample_m0("active");
    if (data.state !== "ready") throw new Error("ready sample required");
    const first = data.workers[0];
    const paused = previewSessionControl_m0(data, first.id, "pause");
    if (paused.state !== "ready") throw new Error("ready result required");
    assert_m0.equal(paused.workers[0].state, "paused");
    assert_m0.equal(paused.workers[0].timeline?.find(node => node.id === "separation-12")?.state, "paused");
    assert_m0.equal(data.workers[0].state, "running");
    assert_m0.equal(paused.workers[1], data.workers[1]);
    const resumed = previewSessionControl_m0(paused, first.id, "resume");
    if (resumed.state !== "ready") throw new Error("ready result required");
    assert_m0.equal(resumed.workers[0].state, "running");
    assert_m0.equal(resumed.workers[0].timeline?.find(node => node.id === "separation-12")?.state, "active");
    const stopped = previewSessionControl_m0(resumed, first.id, "stop");
    if (stopped.state !== "ready") throw new Error("ready result required");
    assert_m0.equal(stopped.workers[0].state, "idle");
    assert_m0.equal(stopped.workers[0].subject, undefined);
    assert_m0.equal(stopped.workers[0].timeline, undefined);
    assert_m0.deepEqual(stopped.workers[0].browsers, []);
    const removed = previewSessionControl_m0(stopped, first.id, "remove");
    if (removed.state !== "ready") throw new Error("ready result required");
    assert_m0.deepEqual(removed.workers, data.workers.slice(1));
    assert_m0.equal(removed.workers[0], data.workers[1]);
    assert_m0.equal(stopped.workers.length, 4);
    assert_m0.throws(() => previewSessionControl_m0(data, first.id, "remove"), /sessions-preview-remove-invalid/);
    assert_m0.throws(() => previewSessionControl_m0(data, first.id, "resume"), /sessions-preview-resume-invalid/);
    assert_m0.throws(() => previewSessionControl_m0(data, "missing", "stop"), /sessions-preview-worker-missing/);
    assert_m0.throws(() => previewSessionControl_m0(sessionsSample_m0("loading"), first.id, "stop"), /sessions-preview-not-ready/);
  });
  it_m0("a retry removes stale failure and keeps other attention cards intact", () => {
    const data = sessionsSample_m0("attention");
    if (data.state !== "ready") throw new Error("ready sample required");
    const failed = data.workers.find(worker => worker.state === "failed")!;
    const retried = previewSessionControl_m0(data, failed.id, "retry");
    if (retried.state !== "ready") throw new Error("ready result required");
    const current = retried.workers.find(worker => worker.id === failed.id)!;
    assert_m0.equal(current.state, "starting");
    assert_m0.equal(current.problem, undefined);
    assert_m0.deepEqual(sessionTimelineSummary_m0(current.timeline!), { completed: 0, total: 4 });
    assert_m0.equal(current.timeline?.[0].state, "active");
    assert_m0.ok(current.browsers.every(browser => browser.state === "starting"));
    assert_m0.equal(data.workers.find(worker => worker.id === failed.id)?.state, "failed");
  });
  it_m0("adds the selected local count without mutating fixtures or accepting invalid input", () => {
    const empty = sessionsSample_m0("empty");
    const added = previewSessionAdd_m0(empty, catalog, "separations", 2, 1);
    if (empty.state !== "ready" || added.state !== "ready") throw new Error("ready sample required");
    assert_m0.equal(empty.workers.length, 0);
    assert_m0.deepEqual(added.workers.map(worker => [worker.id, worker.workflow, worker.state]), [["sample-added-1", "Separations", "starting"], ["sample-added-2", "Separations", "starting"]]);
    const many = previewSessionAdd_m0(empty, catalog, "person-lookup", 12, 3);
    if (many.state !== "ready") throw new Error("ready result required");
    assert_m0.equal(many.workers.length, 12);
    assert_m0.equal(new Set(many.workers.map(worker => worker.id)).size, 12);
    assert_m0.ok(many.workers.every(worker => worker.workflow === "Person Lookup"));
    assert_m0.equal(empty.workers.length, 0);
    for (const count of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert_m0.throws(() => previewSessionAdd_m0(empty, catalog, "separations", count, 1), /sessions-preview-add-invalid/);
    assert_m0.throws(() => previewSessionAdd_m0(empty, catalog, "missing", 1, 1), /sessions-preview-add-invalid/);
  });
  it_m0("distinguishes unknown state from empty workers and rejects false progress", () => {
    const active = sessionsSample_m0("active");
    if (active.state !== "ready") throw new Error("ready sample required");
    assert_m0.deepEqual(sessionTallies_m0(active.workers), [{ state: "running", count: 2 }, { state: "starting", count: 1 }, { state: "idle", count: 1 }]);
    assert_m0.equal(sessionsSample_m0("loading").state, "loading");
    assert_m0.equal(sessionsSample_m0("unavailable").state, "unavailable");
    assert_m0.deepEqual(sessionTimelineSummary_m0(active.workers[0].timeline!), { completed: 11, total: 22 });
    assert_m0.deepEqual(sessionTimelineSummary_m0(active.workers[1].timeline!), { completed: 3, total: 4 });
    assert_m0.throws(() => sessionTimelineSummary_m0([]), /session-timeline-invalid/);
    const node = active.workers[0].timeline![0];
    assert_m0.throws(() => sessionTimelineSummary_m0([node, node]), /session-timeline-invalid/);
    assert_m0.deepEqual(sessionTimelineSummary_m0([{ ...node, state: "pending" }]), { completed: 0, total: 1 });
  });
});
}

{


const served = launchWorkflows_m1(parseWorkflows_m1(FIXTURE_START_PICKER_BOOTSTRAP_m1.workflows));
const catalog = buildWorkflowCatalog_m1(served);

describe_m1("frontend workflow catalog", () => {
  it_m1("adds local workers for every registration without inventing a UCPath browser or a claimed run", () => {
    for (const entry of catalog) {
      const result = previewSessionAdd_m1({ state: "ready", workers: [] }, catalog, entry.id, 2, 10);
      if (result.state !== "ready") throw new Error("ready expected");
      expect_m1(result.workers.map(worker => worker.workflow)).toEqual([entry.label, entry.label]);
      expect_m1(result.workers.map(worker => worker.id)).toEqual(["sample-added-10", "sample-added-11"]);
      expect_m1(result.workers.every(worker => worker.timeline === undefined && worker.subject === undefined)).toBe(true);
      expect_m1(result.workers[0].browsers.map(browser => browser.label)).toEqual([...new Set(entry.preview?.steps.flatMap(step => step.system ? [step.system] : []) ?? [])]);
    }
    expect_m1(() => previewSessionAdd_m1({ state: "ready", workers: [] }, catalog, "unregistered", 1, 10)).toThrow("sessions-preview-add-invalid");
  });
});
}
