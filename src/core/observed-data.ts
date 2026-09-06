import type { TaskLogger } from "../base/task.js";
import { retainedRunProtectedBindings, valueFreeProtectedEvidence } from "../domain/protected-input.js";
import type { RunRecord } from "../domain/run/record.js";
/**
 * The observed-log emission's redaction (D270, `03.1-finish-the-dashboard.md`
 * §Observed logs).
 *
 * Every point a task records through `ctx.recordData` — the D115 collector — is
 * what the run actually READ or WROTE, in the system's own words, and until
 * this module existed those points were used to validate the output and then
 * discarded. They are now emitted on the span at record time, and the ONE thing
 * that has to be true of them before they reach a durable channel is that each
 * value went through the classification `reference/operator-trust.md` §2.3
 * DECLARES for its `(taskId, path)` leaf.
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
 * 3. **There is no second redaction implementation.** `redactEvidenceLeaf` is
 *    the same function the receipt uses, over the same table; a parallel one
 *    here would be a second thing to drift, and a log that leaked a value the
 *    receipt would have dropped is the same defect from a different surface.
 */
import type { TaskId } from "../domain/ids.js";
import type { RecordedDataPoint } from "../domain/task-provenance.js";
import {
  evidenceLeaves,
  redactEvidenceLeaf,
} from "../domain/trust/evidence-classification.js";
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
  protectedPaths: readonly string[] = [],
): readonly ObservedDataPoint[] {
  if (points.length === 0) {
    throw new Error(`task ${taskId} produced an empty observed-data batch; an emission describes an observation`);
  }
  const scope = { kind: "task-output", taskId } as const;
  return Object.freeze(points.map((point) => Object.freeze(ObservedDataPointSchema.parse({
    direction: point.direction,
    field: point.field,
    values: valueFreeProtectedEvidence(evidenceLeaves(point.value, point.field).map((leaf) => redactEvidenceLeaf(scope, leaf)), protectedPaths),
  }))));
}

/** Free-text task logging cannot bypass the source-aware observed-data policy. */
export function protectedTaskLogger(log: TaskLogger, run: RunRecord): TaskLogger {
  const bindings = retainedRunProtectedBindings(run);
  if (bindings.length === 0) return log;
  const raw = run.input.parsed.value;
  const values = bindings.flatMap((binding) => {
    const value: unknown = raw !== null && typeof raw === "object" ? Reflect.get(raw, binding.inputPath) : undefined;
    return typeof value === "string" && value.length > 0 ? [{ value, marker: `<protected ${binding.name}>` }] : [];
  });
  const clean = (text: string): string => {
    let result = text;
    for (const { value, marker } of values) result = result.replaceAll(value, marker);
    return bindings.some(({ inputPath }) => inputPath !== "timekeeperName")
      ? result.replace(/key digest [a-f0-9]{12}…|\b[a-f0-9]{64}\b/gu, "protected digest withheld") : result;
  };
  const wrap = (emit: TaskLogger["info"]): TaskLogger["info"] => (message, fields) => emit(clean(message),
    fields === undefined ? undefined : Object.fromEntries(Object.entries(fields).map(([key, value]) =>
      [key, typeof value === "string" ? clean(value) : value])));
  return { debug: wrap(log.debug), info: wrap(log.info), warn: wrap(log.warn) };
}
