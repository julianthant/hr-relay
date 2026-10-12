import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { continuedLookupTimeline } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-selected-fixture.js";
import { selectedLogPresentation,selectedLogSample } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-selection-model.js";
import { FIXTURE_DAY_WIRE,FIXTURE_IDS } from "../../../../parity/helpers/fixture-queue.js";
describe("frontend presentation producers", () => {
  it("updates selected-run context without inventing action history or unmeasured durations", () => {
    const row = FIXTURE_DAY_WIRE.queueSurfaces.find(item => item.runId === FIXTURE_IDS.runningRun);
    assert.ok(row);
    const running = selectedLogPresentation({ row, workflowLabel: "Person Lookup" });
    assert.equal(running.title, "Battistessa, Johnnie");
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
  it("retains completed mock history, opens the affected block and keeps timeline jumps valid", () => {
    const row = FIXTURE_DAY_WIRE.queueSurfaces.find(item => item.runId === FIXTURE_IDS.runningRun);
    assert.ok(row);
    for (const [status, expected] of [["awaiting-approval", "review"], ["blocked", "parked"], ["failed", "failed"]] as const) {
      const sample = selectedLogSample({ row: { ...row, status }, workflowLabel: "Person Lookup" });
      assert.equal(sample.subject, "Battistessa, Johnnie");
      assert.ok(sample.steps.length > 1);
      assert.equal(sample.timeline[0].state, "completed");
      assert.ok(sample.timeline[0].durationLabel);
      const entry = sample.steps.find(step => step.id === sample.initialStepId)?.entries[0];
      assert.ok(entry);
      assert.equal(entry.kind, "decision");
      if (entry.kind !== "decision") throw new Error("expected sample decision");
      assert.equal(entry.decision.state, expected);
      assert.ok(entry.decision.screenshots?.length);
      assert.ok(sample.timeline.filter(stage => stage.stepId !== undefined).length > 1);
      assert.ok(sample.timeline.every(stage => stage.stepId === undefined || sample.steps.some(step => step.id === stage.stepId)));
      assert.doesNotMatch(JSON.stringify(sample), /Alex Morgan|Morgan, Alex|DEMO-1042/u);
      assert.equal(sample.workflowLabel, status === "blocked" ? "Separations sample" : "Person Lookup");
    }
    const mock = (status: typeof row.status) => selectedLogSample({ row: { ...row, status }, workflowLabel: "Person Lookup" });
    assert.deepEqual(mock("running").timeline.map(stage => stage.state), ["active", "pending", "pending", "pending"]);
    assert.deepEqual(mock("running").timeline[0].substeps.map(step => step.state), ["completed", "completed", "active"]);
    assert.ok(mock("done").timeline.every(stage => stage.state === "completed" && stage.durationLabel && stage.substeps.every(step => step.state === "completed" && step.durationLabel)));
    assert.equal(mock("queued").steps.length, 0);
    assert.ok(mock("queued").timeline.every(stage => stage.state === "pending" && stage.stepId === undefined));
    assert.equal(mock("cancelling").status, "Stopping");
    assert.equal(mock("cancelled").timeline[0].state, "cancelled");
    assert.deepEqual(mock("partial").timeline.map(stage => stage.state), ["completed", "completed", "completed", "waiting"]);
    const review = mock("awaiting-approval");
    assert.deepEqual(review.timeline[1].substeps.map(step => [step.state, step.durationLabel]), [["completed", "4s"], ["completed", "3s"], ["waiting", undefined]]);
    assert.deepEqual(continuedLookupTimeline(review.timeline, "approve-lookup-match").map(stage => stage.state), ["completed", "completed", "active", "pending"]);
    assert.deepEqual(continuedLookupTimeline(mock("failed").timeline, "retry-crm").map(stage => stage.state), ["completed", "active", "pending", "pending"]);
    assert.deepEqual(continuedLookupTimeline(review.timeline, "reject-lookup-match")[0].substeps.map(step => step.state), ["completed", "active", "pending"]);
    assert.equal(continuedLookupTimeline(review.timeline, "unknown-action"), review.timeline);
  });
  it("authors readable captures with the selected subject and classifier-correct systems", () => {
    const row = FIXTURE_DAY_WIRE.queueSurfaces.find(item => item.runId === FIXTURE_IDS.openGateRun);
    assert.ok(row);
    for (const status of ["done", "failed", "awaiting-approval", "blocked", "partial"] as const) {
      const sample = selectedLogSample({ row: { ...row, status }, workflowLabel: "Person Lookup" });
      const captures = sample.steps.flatMap(step => step.entries).flatMap(entry => entry.kind === "decision" ? entry.decision.screenshots ?? [] : entry.kind === "note" ? [] : entry.screenshots ?? []);
      assert.ok(captures.length);
      for (const shot of captures) {
        const svg = decodeURIComponent(shot.src.slice(shot.src.indexOf(",") + 1));
        assert.match(svg, new RegExp(`width="${shot.width}" height="${shot.height}"`));
        assert.match(svg, /FICTIONAL SAMPLE/u);
        assert.doesNotMatch(svg, /Alex Morgan|Morgan, Alex/u);
      }
      if (status === "failed") {
        const decision = sample.steps.flatMap(step => step.entries).find(entry => entry.kind === "decision");
        assert.ok(decision?.kind === "decision");
        assert.deepEqual(decision.decision.screenshots?.map(shot => shot.system), ["UCPath", "CRM"]);
        assert.match(decision.decision.attemptedAction ?? "", /Click Search/u);
        assert.match(decision.decision.lastCompleted ?? "", /Employee ID entered/u);
      }
      if (status === "blocked") assert.ok(captures.some(shot => shot.kind === "form" && shot.height > shot.width));
    }
  });
});
