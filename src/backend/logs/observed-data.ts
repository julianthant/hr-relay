
import type { TaskId } from "../../rules/identity/ids.js";
import type { RecordedDataPoint } from "../../rules/workflow/task-provenance.js";
import {
  evidenceLeaves,
  redactEvidenceLeaf,
} from "../../models/trust/evidence-classification.js";
import { ObservedDataPointSchema } from "./span-emitter.js";
import type { ObservedDataPoint } from "./span-emitter.js";

// Recorded field paths belong to the producing task output contract for validation and redaction.
export function redactObservedDataPoints(
  taskId: TaskId,
  points: readonly RecordedDataPoint[],
): readonly ObservedDataPoint[] {
  if (points.length === 0) {
    throw new Error(`task ${taskId} produced an empty observed-data batch; an emission describes an observation`);
  }
  const scope = { kind: "task-output", taskId } as const;
  return Object.freeze(points.map((point) => Object.freeze(ObservedDataPointSchema.parse({
    direction: point.direction,
    field: point.field,
    ...(point.origins === undefined ? {} : { origins: point.origins }),
    values: evidenceLeaves(point.value, point.field).map((leaf) => redactEvidenceLeaf(scope, leaf)),
  }))));
}
