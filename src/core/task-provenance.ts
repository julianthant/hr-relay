import { z } from "zod";
import { descriptorRuntimeNodes } from "../base/workflow.js";
import type { AnyWorkflowDescriptor } from "../base/workflow.js";
import { canonicalJsonStringify, JsonValueSchema } from "../domain/canonical-json.js";
import type { JsonValue } from "../domain/canonical-json.js";
import type { Clock } from "../domain/clock.js";
import {
  ContractFieldPathSchema,
} from "../domain/contracts/base.js";
import type { ProvenancePolicy } from "../domain/contracts/base.js";
import { IsoInstantSchema } from "../domain/ids.js";
import {
  DataPointSchema,
  RecordedDataPointSchema,
  TaskExecutionIdentitySchema,
  TaskProvenanceResultSchema,
  TaskUpstreamCheckpointEvidenceSchema,
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
}>;

export type TaskProvenanceCollectorInput = Readonly<{
  readonly descriptor: AnyWorkflowDescriptor;
  readonly execution: z.input<typeof TaskExecutionIdentitySchema>;
  readonly upstreamEvidence: z.input<typeof TaskUpstreamCheckpointEvidenceSchema>;
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

function validateCheckpointFacts(
  workflowId: string,
  checkpoint: z.output<typeof TaskUpstreamCheckpointEvidenceSchema>["checkpoints"][number],
): readonly FactProvenance[] {
  if (checkpoint.workflowId !== workflowId) {
    throw new Error(
      `upstream checkpoint ${checkpoint.nodeId} belongs to workflow ${checkpoint.workflowId}, expected ${workflowId}`,
    );
  }
  const leaves = jsonLeafPaths(checkpoint.output.value).map((path) => ContractFieldPathSchema.parse(path));
  const facts = new Map<string, FactProvenance>();
  for (const fact of checkpoint.provenance) {
    if (facts.has(fact.path)) {
      throw new Error(`upstream checkpoint ${checkpoint.nodeId} has duplicate provenance for ${fact.path}`);
    }
    facts.set(fact.path, fact);
  }
  for (const path of leaves) {
    if (!facts.has(path)) {
      throw new Error(`upstream checkpoint ${checkpoint.nodeId} has no provenance for output field ${path}`);
    }
  }
  for (const path of facts.keys()) {
    if (!leaves.includes(ContractFieldPathSchema.parse(path))) {
      throw new Error(`upstream checkpoint ${checkpoint.nodeId} has provenance for undeclared output field ${path}`);
    }
  }
  return Object.freeze([...facts.values()]);
}

function validateCheckpointSet(
  taskId: string,
  expectedDependencies: readonly string[],
  evidence: z.output<typeof TaskUpstreamCheckpointEvidenceSchema>,
): void {
  const expected = new Set(expectedDependencies);
  const actual = new Set<string>([
    ...evidence.checkpoints.map(({ nodeId }) => nodeId),
    ...evidence.gateResults.map(({ gateId }) => gateId),
  ]);
  for (const checkpoint of evidence.checkpoints) {
    if (!expected.has(checkpoint.nodeId)) {
      throw new Error(`task ${taskId} received undeclared upstream checkpoint ${checkpoint.nodeId}`);
    }
  }
  for (const gate of evidence.gateResults) {
    if (!expected.has(gate.gateId)) {
      throw new Error(`task ${taskId} received undeclared upstream gate result ${gate.gateId}`);
    }
  }
  for (const nodeId of expectedDependencies) {
    if (!actual.has(nodeId)) {
      throw new Error(`task ${taskId} declared dependency ${nodeId} has no upstream provenance`);
    }
  }
}

export function createTaskProvenanceCollector(input: TaskProvenanceCollectorInput): TaskProvenanceCollector {
  const execution = TaskExecutionIdentitySchema.parse(input.execution);
  const nodes = descriptorRuntimeNodes(input.descriptor);
  if (input.descriptor.id !== execution.workflowId) {
    throw new Error(
      `task ${execution.taskId} execution workflow ${execution.workflowId} does not match descriptor ${input.descriptor.id}`,
    );
  }
  const node = nodes.find(({ id }) => id === execution.nodeId);
  if (node === undefined) {
    throw new Error(`workflow ${execution.workflowId} has no execution node ${execution.nodeId}`);
  }
  if (node.kind !== "task") {
    const detail = node.kind === "transaction"
      ? "transaction prepare/commit roles require a role-specific non-read collector"
      : `node kind ${node.kind} does not execute a task`;
    throw new Error(`workflow ${execution.workflowId} node ${execution.nodeId} cannot use read provenance: ${detail}`);
  }
  if (node.uses.id !== execution.taskId) {
    throw new Error(
      `workflow ${execution.workflowId} node ${execution.nodeId} uses task ${node.uses.id}, not ${execution.taskId}`,
    );
  }
  const evidence = TaskUpstreamCheckpointEvidenceSchema.parse(input.upstreamEvidence);
  validateCheckpointSet(execution.taskId, node.dependsOn, evidence);
  const upstream = Object.freeze([
    ...evidence.checkpoints.flatMap((checkpoint) =>
      validateCheckpointFacts(execution.workflowId, checkpoint)),
    /*
     * A gate contributes exactly ONE fact and no output leaves: what a gate
     * dates is the DECISION, at the instant authority recorded it, attributed
     * `operator` — the arm `FactProvenance` already carries. It cannot make a
     * derived output look fresher than its live inputs, because the derived
     * leaf takes the OLDEST original observation and an approval is always at
     * least as new as the evidence it was granted on.
     */
    ...evidence.gateResults.map((gate) => FactProvenanceSchema.parse({
      path: "gateResult",
      source: "operator",
      observedAt: gate.resolvedAt,
      originalObservedAt: gate.resolvedAt,
    })),
  ]);
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
      const overlapping = [...points.keys()].find((field) =>
        field.startsWith(`${point.field}.`) || point.field.startsWith(`${field}.`));
      if (overlapping !== undefined) {
        throw new Error(`task ${execution.taskId} recorded overlapping fields ${overlapping} and ${point.field}`);
      }
      points.set(point.field, RecordedDataPointSchema.parse({
        ...point,
        execution,
        recordedAt: IsoInstantSchema.parse(input.clock.now().toISOString()),
      }));
    }
  };

  const finalizeRead = (outputInput: unknown): TaskProvenanceResult => {
    if (finalized) throw new Error(`task ${execution.taskId} provenance was already finalized`);
    finalized = true;
    const output = JsonValueSchema.parse(node.uses.output.parse(outputInput));
    const leaves = jsonLeafPaths(output).map((path) => ContractFieldPathSchema.parse(path));
    const recorded = Object.freeze([...points.values()]);
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
      const source = sourceFor(path, node.uses.provenance);
      if (source === "derived" && node.dependsOn.length === 0) {
        throw new Error(`task ${execution.taskId} derived output field ${path} has no declared upstream dependencies`);
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

  return Object.freeze({ recordData, finalizeRead });
}
