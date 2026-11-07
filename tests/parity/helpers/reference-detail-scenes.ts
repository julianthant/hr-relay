import type { ReferenceScene,SceneAnchors } from "./reference-scenes.js";
import { CONTEXT_DATA_SCENES } from "./run-detail/context-data-scenes.js";
import { GATES_PARK_SCENES } from "./run-detail/gates-park-scenes.js";
import { LOGS_CAPTURES_SCENES } from "./run-detail/logs-captures-scenes.js";
import { RECEIPTS_FAILURES_SCENES } from "./run-detail/receipts-failures-scenes.js";
import { TIMELINE_ANCHORS,TIMELINE_SCENES } from "./run-detail/timeline-scenes.js";

export const SCENES: readonly ReferenceScene[] = [
  GATES_PARK_SCENES["run-open-gate"],
  RECEIPTS_FAILURES_SCENES["run-failed"],
  LOGS_CAPTURES_SCENES["run-running"],
  TIMELINE_SCENES["run-done"],
  CONTEXT_DATA_SCENES["run-queued"],
  GATES_PARK_SCENES["run-parked-write"],
  TIMELINE_SCENES["run-group"],
  TIMELINE_SCENES["run-member"],
];

export const ANCHORS: SceneAnchors = {
  ...TIMELINE_ANCHORS,
};
