/**
 * The observed-data emission (D270, `03.1-finish-the-dashboard.md` §Observed logs).
 *
 * Every point a task records through `ctx.recordData` — the D115 collector — is
 * what the run actually READ or WROTE, in the system's own words, and until
 * this module existed those points were used to validate the output and then
 * discarded. They are now emitted on the span at record time, and the ONE thing
 * that has to be true of them before they reach a durable channel is that each
 * value was classified by `reference/operator-trust.md` §2.3 for its
 * `(taskId, path)` leaf. The durable field keeps both the classified transform
 * and the original value for the local operator.
 *
 * Three properties are deliberate.
 *
 * 1. **An undeclared leaf fails loud**, naming the task and the field, because
 *    `classifyEvidenceLeaf` refuses it. Dropping the leaf would make the log
 *    look complete while hiding what the run read — the same argument D140 made
 *    for the receipt, and the reason a fixture is not exempt from it either.
 * 2. **The leaf rule is the provenance collector's own** (`evidenceLeaves`): an
 *    array is one leaf, an empty object is one leaf, a populated object
 *    recurses. A recorded point may cover a whole subtree, so one point can
 *    carry several redacted values — and each one is dated by a stored
 *    `FactProvenance` row under the same path vocabulary.
 * 3. `redactEvidenceLeaf` shares the receipt's classification table and retains
 *    the original value alongside the transformed form.
 */
import type { TaskId } from "../../domain/ids.js";
import type { RecordedDataPoint } from "../../domain/task-provenance.js";
import {
  evidenceLeaves,
  redactEvidenceLeaf,
} from "../../domain/trust/evidence-classification.js";
import { ObservedDataPointSchema } from "./span-emitter.js";
import type { ObservedDataPoint } from "./span-emitter.js";

/**
 * Redact one `recordData` batch for emission.
 *
 * The scope is `task-output:<taskId>` because a recorded point's field IS a
 * path in the producing task's output contract — `finalizeRead` validates every
 * point, read or write, against the parsed output — so the leaf a point names
 * is the leaf the receipt would date, under one declaration rather than two.
 */
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
    values: evidenceLeaves(point.value, point.field).map((leaf) => redactEvidenceLeaf(scope, leaf)),
  }))));
}
