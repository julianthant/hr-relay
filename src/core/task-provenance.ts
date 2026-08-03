import { z } from "zod";
import { canonicalJsonStringify, JsonValueSchema } from "../domain/canonical-json.js";
import type { JsonValue } from "../domain/canonical-json.js";
import type { Clock } from "../domain/clock.js";
import {
  ContractFieldPathSchema,
  ProvenancePolicySchema,
} from "../domain/contracts/base.js";
import type { ProvenancePolicy } from "../domain/contracts/base.js";
import { IsoInstantSchema } from "../domain/ids.js";
import {
  DataPointSchema,
  RecordedDataPointSchema,
  TaskExecutionIdentitySchema,
  TaskProvenanceResultSchema,
} from "../domain/task-provenance.js";
import type {
  DataPoint,
  RecordedDataPoint,
  TaskProvenanceResult,
} from "../domain/task-provenance.js";
import { FactProvenanceSchema } from "../domain/workflow/checkpoint.js";
import type { FactProvenance } from "../domain/workflow/checkpoint.js";

type ParsedDataPoint = z.output<typeof DataPointSchema>;

export type TaskProvenanceCollector = Readonly<{
  readonly recordData: (point: DataPoint | readonly DataPoint[]) => void;
  readonly finalizeRead: (output: unknown) => TaskProvenanceResult;
  readonly recordedPoints: () => readonly RecordedDataPoint[];
}>;

export type TaskProvenanceCollectorInput = Readonly<{
  readonly execution: z.input<typeof TaskExecutionIdentitySchema>;
  readonly policy: z.input<typeof ProvenancePolicySchema>;
  readonly outputSchema: z.ZodType;
  readonly upstreamProvenance?: readonly FactProvenance[];
  readonly clock: Clock;
}>;

function jsonLeafPaths(value: JsonValue, prefix = ""): readonly string[] {
  if (Array.isArray(value) || value === null || typeof value !== "object") {
    if (prefix.length === 0) throw new Error("task read output must be an object with named provenance fields");
    return [prefix];
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    if (prefix.length === 0) throw new Error("task read output cannot be an empty object");
    return [prefix];
  }
  return entries.flatMap(([key, child]) => jsonLeafPaths(child, prefix.length === 0 ? key : `${prefix}.${key}`));
}

function isJsonArray(value: JsonValue): value is readonly JsonValue[] {
  return Array.isArray(value);
}

function readPath(value: JsonValue, path: string): JsonValue {
  let current: JsonValue = value;
  for (const segment of path.split(".")) {
    if (current === null || isJsonArray(current) || typeof current !== "object") {
      throw new Error(`task provenance path ${path} traverses a non-object at ${segment}`);
    }
    const next = current[segment];
    if (next === undefined) throw new Error(`task provenance path ${path} does not exist in the output`);
    current = next;
  }
  return current;
}

function pointValueAtLeaf(point: ParsedDataPoint, leafPath: string): JsonValue {
  if (point.field === leafPath) return point.value;
  if (!leafPath.startsWith(`${point.field}.`)) {
    throw new Error(`recorded field ${point.field} does not cover output field ${leafPath}`);
  }
  return readPath(point.value, leafPath.slice(point.field.length + 1));
}

function sourceFor(path: string, policy: ProvenancePolicy): "live" | "derived" {
  const matching = (policy.byField ?? [])
    .filter((entry) => path === entry.path || path.startsWith(`${entry.path}.`))
    .sort((left, right) => right.path.length - left.path.length)[0];
  return matching?.source ?? policy.default;
}

function oldestOriginalObservation(provenance: readonly FactProvenance[]): string {
  const oldest = [...provenance].sort((left, right) =>
    Date.parse(left.originalObservedAt) - Date.parse(right.originalObservedAt))[0];
  if (oldest === undefined) throw new Error("derived task provenance requires at least one upstream fact");
  return oldest.originalObservedAt;
}

export function createTaskProvenanceCollector(input: TaskProvenanceCollectorInput): TaskProvenanceCollector {
  const execution = TaskExecutionIdentitySchema.parse(input.execution);
  const policy = ProvenancePolicySchema.parse(input.policy);
  const upstream = Object.freeze((input.upstreamProvenance ?? []).map((fact) => FactProvenanceSchema.parse(fact)));
  const points = new Map<string, RecordedDataPoint>();
  let finalized = false;

  const recordData = (pointInput: DataPoint | readonly DataPoint[]): void => {
    if (finalized) throw new Error(`task ${execution.taskId} cannot record provenance after finalization`);
    const batch = Array.isArray(pointInput) ? pointInput : [pointInput];
    if (batch.length === 0) throw new Error(`task ${execution.taskId} recordData batch cannot be empty`);
    for (const candidate of batch) {
      const point = DataPointSchema.parse(candidate);
      const existing = points.get(point.field);
      if (existing !== undefined) {
        const same = existing.direction === point.direction
          && canonicalJsonStringify(existing.value) === canonicalJsonStringify(point.value);
        if (same) throw new Error(`task ${execution.taskId} recorded field ${point.field} twice`);
        throw new Error(`task ${execution.taskId} recorded contradictory values for field ${point.field}`);
      }
      points.set(point.field, RecordedDataPointSchema.parse({
        ...point,
        execution,
        recordedAt: IsoInstantSchema.parse(input.clock.now().toISOString()),
      }));
    }
  };

  const recordedPoints = (): readonly RecordedDataPoint[] => Object.freeze([...points.values()]);

  const finalizeRead = (outputInput: unknown): TaskProvenanceResult => {
    if (finalized) throw new Error(`task ${execution.taskId} provenance was already finalized`);
    finalized = true;
    const output = JsonValueSchema.parse(input.outputSchema.parse(outputInput));
    const leaves = jsonLeafPaths(output).map((path) => ContractFieldPathSchema.parse(path));
    const recorded = recordedPoints();
    if (recorded.length === 0) throw new Error(`task ${execution.taskId} recorded no provenance points`);
    for (const point of recorded) {
      const outputValue = readPath(output, point.field);
      if (canonicalJsonStringify(outputValue) !== canonicalJsonStringify(point.value)) {
        throw new Error(`task ${execution.taskId} recorded value for ${point.field} contradicts its parsed output`);
      }
    }

    const provenance = leaves.map((path) => {
      const covering = recorded
        .filter((point) => path === point.field || path.startsWith(`${point.field}.`))
        .sort((left, right) => right.field.length - left.field.length)[0];
      if (covering === undefined) {
        throw new Error(`task ${execution.taskId} has no recorded provenance for output field ${path}`);
      }
      if (covering.direction !== "read") {
        throw new Error(`task ${execution.taskId} output field ${path} is covered by a ${covering.direction} point`);
      }
      const outputValue = readPath(output, path);
      const recordedValue = pointValueAtLeaf(covering, path);
      if (canonicalJsonStringify(outputValue) !== canonicalJsonStringify(recordedValue)) {
        throw new Error(`task ${execution.taskId} recorded value for ${path} contradicts its parsed output`);
      }
      const source = sourceFor(path, policy);
      if (source === "derived" && upstream.length === 0) {
        throw new Error(`task ${execution.taskId} derived output field ${path} has no upstream provenance`);
      }
      return FactProvenanceSchema.parse({
        path,
        source,
        observedAt: covering.recordedAt,
        originalObservedAt: source === "live"
          ? covering.recordedAt
          : oldestOriginalObservation(upstream),
      });
    });
    return TaskProvenanceResultSchema.parse({ points: recorded, provenance });
  };

  return Object.freeze({ recordData, finalizeRead, recordedPoints });
}
