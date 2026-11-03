import assert from "node:assert/strict";
import { it } from "vitest";
import { pauseTimeline, type LogTimelineStage } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-timeline-model.js";

it("marks a pending pause without claiming completion, and records the completed pause boundary", () => {
  const timeline: readonly LogTimelineStage[] = [
    { id: "read", label: "Read", state: "completed", substeps: [] },
    { id: "verify", label: "Verify", state: "active", substeps: [] },
    { id: "finish", label: "Finish", state: "pending", substeps: [] },
  ];
  const pending = pauseTimeline(timeline, "pause-pending");
  assert.equal(pending[1].state, "active");
  assert.equal(pending[1].statusLabel, "Pauses after this step");
  const finished = timeline.map(stage => stage.id === "verify" ? { ...stage, state: "completed" as const } : stage);
  const paused = pauseTimeline(finished, "paused");
  assert.equal(paused[1].state, "completed");
  assert.equal(paused[1].statusLabel, "Paused after this step");
  assert.equal(paused[2], finished[2]);
  assert.equal(pauseTimeline(timeline, "unavailable"), timeline);
  assert.equal(pauseTimeline(timeline, undefined), timeline);
});
