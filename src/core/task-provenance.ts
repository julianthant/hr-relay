import { deriveCheckpointOutputDigest, deriveCheckpointProvenanceDigest } from "../domain/run/result.js";
import { deriveSchemaHash } from "../domain/schema-bound-value.js";
import { evaluateNodeCondition } from "../domain/workflow/node-condition.js";
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

/**
 * ONE `ctx.recordData` call's worth of observation (D270).
 *
 * A batch is one observation of the page, so the collector reads the clock ONCE
 * per call and stamps every point in it with that instant: `recordedAt` is
 * therefore a fact the whole batch shares, which is what lets the emitted event
 * carry a single honest `observedAt` instead of a derived one.
 */
export type RecordedDataBatch = Readonly<{
  readonly recordedAt: string;
  readonly points: readonly RecordedDataPoint[];
}>;

export type TaskProvenanceCollector = Readonly<{
  readonly recordData: (point: DataPoint | readonly DataPoint[]) => void;
  readonly finalizeRead: (output: unknown) => TaskProvenanceResult;
}>;

export type TaskProvenanceCollectorInput = Readonly<{
  readonly descriptor: AnyWorkflowDescriptor;
  readonly execution: z.input<typeof TaskExecutionIdentitySchema>;
  readonly upstreamEvidence: z.input<typeof TaskUpstreamCheckpointEvidenceSchema>;
  readonly clock: Clock;
  readonly canonicalInput?: JsonValue;
  /**
   * Where a recorded batch goes AT RECORD TIME (D270). Required, with no no-op
   * default, for the same reason the executor's `SpanEmitter` has none: a
   * collector that could run with a silently absent sink would leave the
   * observations a task made before it threw unreconstructable, and nothing
   * would fail.
   *
   * The sink is called INSIDE `recordData`, so a throw from it — the intended
   * answer to an undeclared leaf — surfaces at the recording task, naming the
   * field, instead of at a finalization the failing task may never reach.
   */
  readonly onRecord: (batch: RecordedDataBatch) => void;
}>;

export function jsonLeafPaths(value: JsonValue, prefix = ""): readonly string[] {
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
    ...evidence.skippedGates,
    ...(evidence.children ?? []).map((child) => child.nodeId),
  ]);
  for (const checkpoint of evidence.checkpoints) {
    if (!expected.has(checkpoint.nodeId)) {
      throw new Error(`task ${taskId} received undeclared upstream checkpoint ${checkpoint.nodeId}`);
    }
  }
  for (const child of evidence.children ?? []) {
    if (!expected.has(child.nodeId)) throw new Error(`task ${taskId} received undeclared upstream child ${child.nodeId}`);
  }
  for (const gate of evidence.gateResults) {
    if (!expected.has(gate.gateId)) {
      throw new Error(`task ${taskId} received undeclared upstream gate result ${gate.gateId}`);
    }
  }
  for (const gateId of evidence.skippedGates) {
    if (!expected.has(gateId)) throw new Error(`task ${taskId} received undeclared skipped gate ${gateId}`);
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
  for (const gateId of evidence.skippedGates) {
    const gate = nodes.find((candidate) => String(candidate.id) === gateId);
    if (gate?.kind !== "gate" || gate.resolvedBy !== "operator" || gate.when === undefined) {
      throw new Error(`task ${execution.taskId} cannot skip unconditional gate ${gateId}`);
    }
    if (input.canonicalInput === undefined) throw new Error(`skipped gate ${gateId} requires the validated canonical input`);
    const outputs = Object.fromEntries(evidence.checkpoints.map((checkpoint) => [checkpoint.nodeId, checkpoint.output.value]));
    if (evaluateNodeCondition(gate.when, { input: input.canonicalInput, outputs })) {
      throw new Error(`task ${execution.taskId} cannot skip required gate ${gateId}`);
    }
  }
  const childFacts = (evidence.children ?? []).flatMap((child) => {
    const declared = nodes.find((candidate) => candidate.id === child.nodeId);
    if (declared?.kind !== "child-run" || declared.await !== "terminal" || declared.cardinality !== "one"
      || child.parentRunId !== execution.runId || child.edgeId !== declared.edgeId || child.result.workflowId !== declared.target.id
      || child.result.resultSchemaHash !== deriveSchemaHash(declared.target.result, "output")) throw new Error("task-child-upstream-identity-mismatch");
    const records = new Map(child.results.map((result) => [result.runId, result]));
    if (records.size !== child.results.length || !records.has(child.result.runId) || canonicalJsonStringify(records.get(child.result.runId)) !== canonicalJsonStringify(child.result)) throw new Error("task-child-upstream-result-mismatch");
    const expectedCheckpoints = new Set<string>();
    const facts: FactProvenance[] = [];
    const visited = new Set<string>();
    const visit = (runId: string): void => {
      if (visited.has(runId)) throw new Error("task-child-upstream-cycle");
      visited.add(runId);
      const result = records.get(runId);
      if (result === undefined) throw new Error("task-child-upstream-result-unavailable");
      for (const dependency of result.dependencies) {
        if (dependency.state === "resolved") {
          const checkpoint = child.checkpoints.find((checkpoint) => checkpoint.runId === dependency.checkpoint.runId && checkpoint.nodeId === dependency.nodeId
            && checkpoint.attempt === dependency.checkpoint.attempt && checkpoint.claimGeneration === dependency.checkpoint.claimGeneration);
          if (checkpoint === undefined || checkpoint.contractFingerprint !== dependency.contractFingerprint
            || deriveCheckpointOutputDigest(checkpoint.output) !== dependency.outputDigest || deriveCheckpointProvenanceDigest(checkpoint.provenance) !== dependency.provenanceDigest) throw new Error("task-child-upstream-checkpoint-mismatch");
          expectedCheckpoints.add(canonicalJsonStringify(checkpoint));
          facts.push(...validateCheckpointFacts(checkpoint.workflowId, checkpoint));
        } else if (dependency.state === "child-resolved") {
          const nested = records.get(dependency.child.runId);
          if (nested === undefined || nested.resultDigest !== dependency.child.resultDigest || nested.dependencyDigest !== dependency.child.dependencyDigest
            || nested.contractFingerprint !== dependency.child.contractFingerprint || nested.resultSchemaHash !== dependency.child.resultSchemaHash) throw new Error("task-child-upstream-descendant-mismatch");
          visit(nested.runId);
        } else if (dependency.state === "asserted") facts.push(FactProvenanceSchema.parse({ path: "assertion", source: "operator", observedAt: dependency.assertedAt, originalObservedAt: dependency.assertedAt }));
      }
    };
    visit(child.result.runId);
    if (visited.size !== records.size || child.checkpoints.some((checkpoint) => !expectedCheckpoints.has(canonicalJsonStringify(checkpoint)))) throw new Error("task-child-upstream-extra-evidence");
    if (facts.length === 0) throw new Error("task-child-upstream-observation-unavailable");
    return facts;
  });
  const upstream = Object.freeze([
    ...childFacts,
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
      source: "source" in gate ? "live" : "operator",
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
    // ONE clock read for the whole batch — see `RecordedDataBatch`.
    const recordedAt = IsoInstantSchema.parse(input.clock.now().toISOString());
    const recorded: RecordedDataPoint[] = [];
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
      const stored = RecordedDataPointSchema.parse({ ...point, execution, recordedAt });
      points.set(point.field, stored);
      recorded.push(stored);
    }
    input.onRecord(Object.freeze({ recordedAt, points: Object.freeze(recorded) }));
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
