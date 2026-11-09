import assert from "node:assert/strict";
import { it } from "vitest";
import { pauseTimeline, type LogTimelineStage } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-timeline-model.js";

it("marks a pending pause without claiming completion, and records the completed pause boundary", () => {
  const timeline: readonly LogTimelineStage[] = [
    { id: "read", label: "Read", state: "completed", substeps: [] },
    { id: "verify", label: "Verify", state: "active", substeps: [] },
    { id: "finish", label: "Finish", state: "pending", substeps: [] },
  ];
  const pending = pauseTimeline(timeline, "pause-pending", { action: "pause", step: "cancel" });
  assert.equal(pending[1].state, "active");
  assert.equal(pending[1].statusLabel, "This step will restart");
  assert.equal(pauseTimeline(timeline, "pause-pending", { action: "stop", step: "cancel" })[1]?.statusLabel, "This step is cancelled");
  assert.equal(pauseTimeline(timeline, "pause-pending", { action: "stop", step: "finish-write" })[1]?.statusLabel, "Finishing the save first");
  assert.equal(pauseTimeline(timeline, "pause-pending")[1]?.statusLabel, undefined);
  const finished = timeline.map(stage => stage.id === "verify" ? { ...stage, state: "completed" as const } : stage);
  const paused = pauseTimeline(finished, "paused");
  assert.equal(paused[1].state, "completed");
  assert.equal(paused[1].statusLabel, "Pause recorded. Resume to continue.");
  assert.equal(paused[2], finished[2]);
  assert.equal(pauseTimeline(timeline, "unavailable"), timeline);
  assert.equal(pauseTimeline(timeline, undefined), timeline);
});
