import { RETIRED_INPUT_GENERATIONS, type EvidenceSchemaReader } from "../../../models/storage/evidence-schema-admission.js";
import type { AnyCommitTaskContract } from "../../../models/task/task-contract.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { GateResultRecord } from "../../../models/workflow/gates.js";
import type { RuntimeFlowNode } from "../../../models/workflow/graph.js";
import { checkpointRecordKey } from "../../../models/workflow/checkpoint.js";
import type { WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import type { RunRecord } from "../../../models/run/record.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { retainedRunProtectedBindings, valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import { TransactionOutcomeSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import { projectTransactionOutcome } from "../../../models/workflow/graph.js";
import { orderOnlyOmission, type StepOmissions } from "../../../models/workflow/step-omission.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { BrowserSystemIdSchema } from "../../../rules/identity/ids.js";
import { RerunPlanSchema, RepeatWarningSchema, repeatEvidenceDigest, type RerunPlan, type RerunSource, type RepeatWarning } from "../../../models/run/rerun.js";
import type { PlannedRun } from "../../../models/run/start-plan.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { deriveIdempotencyKeyDigest, IdempotencyKeySchema } from "../../../rules/write-safety/write-safety.js";
import { taskSpanPath } from "../../logs/span-emitter.js";
import { readTimelineRecords } from "../../storage/events/timeline-reader.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-repositories.js";
import { projectStartSteps } from "./step-selection.js";
import { isInterruptedRerunSource, planInterruptedRerun } from "./recovery-plan.js";
import { RunContinuationSchema } from "../../../models/run/continuation.js";
import { delegationEvidenceOutput } from "../../../models/run/result.js";
import { AuthenticatedRunContinuation } from "../../storage/sqlite/run-continuation-delegation.js";

import { RerunRefusedError } from "./rerun-source.js";

export { RerunRefusedError } from "./rerun-source.js";

export function rerunEvidenceReader(reader?: EvidenceSchemaReader): EvidenceSchemaReader | undefined {
  return reader === undefined ? undefined : (...args) => {
    try { return reader(...args); }
    catch { throw new RerunRefusedError("schema-mismatch", "Rerun schema evidence is unavailable"); }
  };
}

export function validateRerunWriteProof(commit: AnyCommitTaskContract, intent: WriteIntentRecord, schemaReader?: EvidenceSchemaReader) {
  const proof = intent.status === "committed" ? intent.completionProof : intent.status === "observed-present" ? intent.observedProof : undefined;
  const schema = commit.writeSafety.completion.proofSchema, expected = deriveSchemaHash(schema, "output");
  if (intent.taskId !== commit.id || proof === undefined
    || (schemaReader?.({ kind: "write-proof", id: intent.writeIntentId, generation: intent.generation }, intent, proof.schemaHash, expected) ?? proof.schemaHash) !== expected
    || !schema.safeParse(proof.value).success) throw new RerunRefusedError("schema-mismatch", "Rerun permanent proof is invalid");
  return proof;
}

/** A source input of a pinned earlier generation, admitted by its sealed retirement; it is never parsed under the current schema. */
function isRetiredRunInput(descriptor: AnyWorkflowDescriptor, run: RunRecord, schemaReader?: EvidenceSchemaReader): boolean {
  const stored = run.input.parsed.schemaHash, current = deriveSchemaHash(descriptor.canonicalInput, "output");
  return stored !== current && RETIRED_INPUT_GENERATIONS[descriptor.id]?.includes(stored) === true && schemaReader !== undefined
    && schemaReader({ kind: "run-input", id: run.envelope.runId }, run.input, stored, current) === stored;
}

/**
 * The natural key a transaction binds. A retired input only names the key its permanent write already used: the
 * write values rebound from it are never validated as a fresh write, and the key must still match that write exactly.
 */
function boundNaturalKey(node: Extract<RuntimeFlowNode, { kind: "transaction" }>, input: JsonValue, outputs: Readonly<Record<string, JsonValue>>, retired: boolean) {
  const system = BrowserSystemIdSchema.parse(node.commit.uses.id.split("/")[0]);
  const keyOf = (commitInput: unknown) => IdempotencyKeySchema.parse(Reflect.apply(node.commit.uses.writeSafety.idempotency.key, undefined, [commitInput]));
  let key: string;
  if (!retired) key = keyOf(node.commit.uses.input.parse(node.commit.bind({ input, outputs })));
  else {
    try { key = keyOf(node.commit.bind({ input, outputs })); }
    catch { throw new RerunRefusedError("schema-mismatch", "Rerun transaction source input is invalid"); }
  }
  return { system, key, digest: deriveIdempotencyKeyDigest(system, key) };
}

function recordedGateSkipLookup(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor, run: RunRecord) {
  const { runId, traceId, workflow, descriptorVersion, contractFingerprint } = run.envelope;
  let records: ReturnType<typeof readTimelineRecords>["records"] | undefined;
  return (node: RuntimeFlowNode | undefined, checkpoint?: RunCheckpointRecord): boolean => {
    if (node?.kind !== "gate" || node.resolvedBy !== "operator" || node.when === undefined
      || descriptorVersion !== descriptor.version || contractFingerprint !== descriptor.contractFingerprint) return false;
    records ??= readTimelineRecords(repositories.timelineEvents, 0, runId).records;
    const attempt = checkpoint?.attempt ?? run.envelope.attempt;
    const claimGeneration = checkpoint?.claimGeneration ?? run.claimGeneration;
    let skipped = false;
    for (const { payload } of records) {
      if (payload.kind !== "span") continue;
      const { event } = payload;
      if (!("runId" in event) || event.runId !== runId || event.traceId !== traceId
        || event.workflow !== workflow || event.attempt !== attempt) continue;
      if (event.t === "gate.opened" && String(event.gate) === String(node.id)) return false;
      if (event.t !== "span.ended" || event.kind !== "task" || event.outcome !== "skipped"
        || event.notRunReason !== "condition-false" || event.parentSpanPath !== traceId) continue;
      const generation = Number(event.spanPath.split("#").at(-1)?.split(".")[0]);
      // Same-attempt resume can reuse a skip recorded by an earlier claim.
      if (Number.isSafeInteger(generation) && generation > 0 && generation <= claimGeneration
        && event.spanPath === taskSpanPath(traceId, node.id, 1, generation)) skipped = true;
    }
    return skipped;
  };
}

function rerunDelegationOutput(repositories: AuthorityRepositories, run: RunRecord, node: RuntimeFlowNode | undefined,
  historical: boolean, schemaReader?: EvidenceSchemaReader): JsonValue | undefined {
  if (node?.kind !== "child-run" || !isInterruptedRerunSource(repositories, run)) return undefined;
  const evidence = AuthenticatedRunContinuation.authenticate(repositories, run.envelope).dependency(node.id, node.edgeId, historical);
  return evidence === undefined ? undefined : JsonValueSchema.parse(delegationEvidenceOutput(evidence, node.target.result, schemaReader));
}

export function validateRerunTransactionEvidence(input: Readonly<{
  repositories: AuthorityRepositories; descriptor: AnyWorkflowDescriptor; run: RunRecord;
  node: Extract<RuntimeFlowNode, { kind: "transaction" }>; checkpoint: RunCheckpointRecord;
  checkpoints: ReadonlyMap<string, RunCheckpointRecord>; gates: readonly GateResultRecord[]; schemaReader?: EvidenceSchemaReader;
  gateWasSkipped?: ReturnType<typeof recordedGateSkipLookup>;
}>) {
  const { repositories, descriptor, run, node, checkpoint, checkpoints, gates, schemaReader,
    gateWasSkipped = recordedGateSkipLookup(repositories, descriptor, run) } = input;
  const currentInputHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  // A retired input stays history: it only names the natural key, and every accepted write must carry this checkpoint's exact proof.
  const retired = isRetiredRunInput(descriptor, run, schemaReader);
  if (!retired && ((schemaReader?.({ kind: "run-input", id: run.envelope.runId }, run.input, run.input.parsed.schemaHash, currentInputHash) ?? run.input.parsed.schemaHash) !== currentInputHash
    || !descriptor.canonicalInput.safeParse(run.input.parsed.value).success)) throw new RerunRefusedError("schema-mismatch", "Rerun transaction source input is invalid");
  try { projectTransactionOutcome(node.commit.uses, checkpoint.output.value, "Rerun transaction source", { checkpoint, schemaReader }); }
  catch { throw new RerunRefusedError("schema-mismatch", "Rerun transaction proof is invalid"); }
  const outcome = TransactionOutcomeSchema.parse(checkpoint.output.value), nodes = descriptorRuntimeNodes(descriptor);
  const outputs: Record<string, JsonValue> = {};
  for (const id of node.dependsOn) {
    const dependency = nodes.find(candidate => candidate.id === id), stored = checkpoints.get(id);
    if (stored !== undefined) {
      const schema = dependency?.kind === "task" ? dependency.uses.output : dependency?.kind === "transaction" ? TransactionOutcomeSchema : undefined;
      if (schema === undefined || (schemaReader?.({ kind: "task-output", id: checkpointRecordKey(stored) }, stored, stored.output.schemaHash,
        deriveSchemaHash(schema, "output")) ?? stored.output.schemaHash) !== deriveSchemaHash(schema, "output") || !schema.safeParse(stored.output.value).success)
        throw new RerunRefusedError("schema-mismatch", "Rerun transaction dependency is invalid");
      outputs[id] = dependency?.kind === "transaction" ? JsonValueSchema.parse(projectTransactionOutcome(dependency.commit.uses, stored.output.value,
        "Rerun transaction dependency", { checkpoint: stored, schemaReader })) : stored.output.value;
    } else {
      const gate = gates.find(gate => String(gate.gateId) === String(id));
      if (gate === undefined) {
        const delegated = rerunDelegationOutput(repositories, run, dependency, true, schemaReader);
        if (delegated !== undefined) { outputs[id] = delegated; continue; }
        if (gateWasSkipped(dependency, checkpoint) || orderOnlyOmission(descriptor.stepOmissions, run.envelope.stepOmissions, node.id, id)) continue;
        throw new RerunRefusedError("invalid-value", "Rerun transaction dependency is unavailable");
      }
      if (dependency?.kind !== "gate" || (schemaReader?.({ kind: "gate-result", id: canonicalJsonStringify([gate.runId, gate.gateId]) }, gate,
        gate.result.schemaHash, deriveSchemaHash(dependency.result, "output")) ?? gate.result.schemaHash) !== deriveSchemaHash(dependency.result, "output")
        || !dependency.result.safeParse(gate.result.value).success) throw new RerunRefusedError("schema-mismatch", "Rerun transaction gate is invalid");
      outputs[id] = gate.result.value;
    }
  }
  const { system, key, digest } = boundNaturalKey(node, run.input.parsed.value, outputs, retired);
  const intents = repositories.writeIntents.listByBusinessKey(system, digest).filter(intent => {
    if (intent.taskId !== node.commit.uses.id || intent.workflowId !== descriptor.id || intent.itemId !== run.envelope.itemId
      || intent.system !== system || (("occurrence" in intent ? intent.occurrence?.businessKeyDigest : undefined) ?? intent.idempotencyKeyDigest) !== digest
      || (!("occurrence" in intent) || intent.occurrence === undefined) && intent.idempotencyKey !== key || intent.status !== "committed" && intent.status !== "observed-present") return false;
    if (outcome.disposition === "committed" && (intent.status !== "committed" || intent.runId !== run.envelope.runId
      || intent.bindingProof.afterPrepareSpanPath !== `${run.envelope.traceId}/${node.id}/prepare`)) return false;
    return canonicalJsonStringify(validateRerunWriteProof(node.commit.uses, intent, schemaReader)) === canonicalJsonStringify(outcome.proof);
  });
  if (intents.length === 0) throw new RerunRefusedError("schema-mismatch", "Rerun transaction permanent proof link is invalid");
  return intents;
}

function field(value: unknown, path: string): JsonValue {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part)) {
      throw new RerunRefusedError("invalid-value", "copied-value coordinates do not resolve");
    }
    current = Reflect.get(current, part);
  }
  return JsonValueSchema.parse(current);
}

// Outputs from the source run provide warnings only; they never become rerun input.
export function buildRerunPlan(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor,
  source: RerunSource, planned: readonly PlannedRun[], acknowledgment?: string, stepOmissions?: StepOmissions, schemaReader?: EvidenceSchemaReader): RerunPlan {
  return buildWarnings(repositories, descriptor, source, planned[0], acknowledgment, stepOmissions, planned.length, rerunEvidenceReader(schemaReader));
}

/** Uses retained canonical input only to identify previous submissions; never creates a plan. */
export function previewRerunWarnings(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor,
  source: RerunSource, schemaReader?: EvidenceSchemaReader): RerunPlan {
  return buildWarnings(repositories, descriptor, source, undefined, undefined, undefined, undefined, rerunEvidenceReader(schemaReader));
}

function buildWarnings(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor,
  source: RerunSource, entry?: PlannedRun, acknowledgment?: string, stepOmissions?: StepOmissions, plannedLength?: number, schemaReader?: EvidenceSchemaReader): RerunPlan {
  if (repositories.deletedRuns.get(source.runId) !== undefined) throw new RerunRefusedError("target-deleted", "Rerun source was deleted");
  const run = repositories.runs.get(source.runId);
  if (run === undefined) throw new RerunRefusedError("target-not-found", "Rerun source does not exist");
  if (run.version !== source.expectedVersion) throw new RerunRefusedError("source-stale", "Rerun source revision changed; replan");
  if (run.envelope.workflow !== descriptor.id) throw new RerunRefusedError("schema-mismatch", "Rerun source workflow changed");
  const older = run.envelope.contractFingerprint !== descriptor.contractFingerprint || run.envelope.descriptorVersion !== descriptor.version;
  // Use the same authority disposition predicate as RunRecordService.read.
  const parkedAtCorrectedGate = source.gateCorrection !== undefined && run.lifecycle.state === "parked-gate"
    && String(run.lifecycle.gateId) === source.gateCorrection.gateId;
  if ((!parkedAtCorrectedGate && (run.lifecycle.state !== "terminal" || !["done", "failed", "interrupted", "cancelled"].includes(run.lifecycle.outcome)))
    || repositories.writeIntents.listAttemptingByItem({ workflowId: descriptor.id, itemId: run.envelope.itemId }).length > 0
    || repositories.writeIntents.listByRun(source.runId).some((intent) => intent.status === "parked")) {
    throw new RerunRefusedError("invalid-state", "Rerun requires a finished or gate-corrected source without uncertain writes");
  }
  if (older && repositories.writeIntents.listByRun(source.runId).some(intent => intent.status === "committed"
    && !descriptorRuntimeNodes(descriptor).some(node => node.kind === "transaction" && node.commit.uses.id === intent.taskId
      && intent.bindingProof.afterPrepareSpanPath === `${run.envelope.traceId}/${node.id}/prepare`))) {
    throw new RerunRefusedError("schema-mismatch", "Previous transaction warning evidence is incompatible");
  }
  const selectedKeys = source.selectedStepKeys;
  if (plannedLength !== undefined && plannedLength !== 1) throw new RerunRefusedError("invalid-state", "Rerun requires exactly one accepted submission");
  if (new Set(selectedKeys).size !== selectedKeys.length || selectedKeys.some((key) => !descriptor.timeline.some((step) => step.key === key))) {
    throw new RerunRefusedError("invalid-value", "Rerun selection is not eligible in this descriptor");
  }
  const interrupted = isInterruptedRerunSource(repositories, run);
  let continuation: RerunPlan["continuation"];
  if (interrupted) {
    if (source.failureCorrection !== undefined || source.gateCorrection !== undefined || (source.copiedFrom?.length ?? 0) > 0
      || (entry !== undefined && (entry.itemId !== run.envelope.itemId
        || canonicalJsonStringify(entry.rawInput) !== canonicalJsonStringify(run.input.raw)
        || canonicalJsonStringify(entry.input) !== canonicalJsonStringify({ ...run.input.parsed, schemaHash: entry.input.schemaHash })
        || canonicalJsonStringify(entry.workbookReferences ?? []) !== canonicalJsonStringify(run.input.workbookReferences ?? [])
        || canonicalJsonStringify(stepOmissions ?? []) !== canonicalJsonStringify(run.envelope.stepOmissions ?? [])))) {
      throw new RerunRefusedError("invalid-value", "Interrupted rerun requires the original run input and workbook references.");
    }
    const retained = planInterruptedRerun(repositories, descriptor, run, schemaReader);
    const retainedKeys = new Set(retained.retainedSteps.map(step => step.key));
    if (descriptor.timeline.some(step => !retainedKeys.has(step.key) && !selectedKeys.includes(step.key))) {
      throw new RerunRefusedError("invalid-value", "Keep unfinished steps selected to continue this run.");
    }
    if (retained.retainedSteps.some(step => !step.repeatable && selectedKeys.includes(step.key))) {
      throw new RerunRefusedError("invalid-value", "Interrupted rerun keeps completed delegated results.");
    }
    const repeat = new Set(retained.retainedSteps.filter(step => selectedKeys.includes(step.key)).map(step => step.key));
    const nodes = new Set(descriptor.timeline.filter(step => repeat.has(step.key)).flatMap(step => step.nodes.map(node => String(node.id))));
    continuation = RunContinuationSchema.parse({ ...retained.continuation,
      checkpoints: retained.continuation.checkpoints.filter(row => !nodes.has(row.nodeId)),
      gates: retained.continuation.gates.filter(row => !nodes.has(row.nodeId)) });
  } else {
    for (const step of projectStartSteps(descriptor)) {
      if (!selectedKeys.includes(step.key) && (step.control.state === "required"
        || (step.control.state === "omittable" && step.control.forces.some((key) => selectedKeys.includes(key))))) {
        throw new RerunRefusedError("invalid-value", "Rerun selection violates the workflow's required steps or omission cascade");
      }
    }
    if (selectedKeys.length === 0) throw new RerunRefusedError("invalid-value", "Select at least one step to rerun.");
  }
  if (!older && ((schemaReader?.({ kind: "run-input", id: run.envelope.runId }, run.input, run.input.parsed.schemaHash, deriveSchemaHash(descriptor.canonicalInput, "output")) ?? run.input.parsed.schemaHash) !== deriveSchemaHash(descriptor.canonicalInput, "output")
    || !descriptor.canonicalInput.safeParse(run.input.parsed.value).success)) {
    throw new RerunRefusedError("schema-mismatch", "Rerun source canonical input is invalid");
  }
  const checkpoints = repositories.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId)
    .filter((checkpoint) => checkpoint.runId === source.runId);
  const latest = new Map<string, (typeof checkpoints)[number]>();
  for (const checkpoint of checkpoints) {
    const node = descriptorRuntimeNodes(descriptor).find((candidate) => candidate.id === checkpoint.nodeId);
    const schema = node?.kind === "task" ? node.uses.output : node?.kind === "transaction" ? TransactionOutcomeSchema : undefined;
    if (checkpoint.workflowId !== descriptor.id || checkpoint.itemId !== run.envelope.itemId
      || checkpoint.attempt > run.envelope.attempt
      || (checkpoint.claimGeneration !== undefined && checkpoint.claimGeneration > run.claimGeneration)
      || checkpoint.descriptorVersion !== run.envelope.descriptorVersion || checkpoint.contractFingerprint !== run.envelope.contractFingerprint
      || (!older && (schema === undefined || (schemaReader?.({ kind: "task-output", id: checkpointRecordKey(checkpoint) }, checkpoint, checkpoint.output.schemaHash, deriveSchemaHash(schema, "output")) ?? checkpoint.output.schemaHash) !== deriveSchemaHash(schema, "output")
        || !schema.safeParse(checkpoint.output.value).success))) {
      throw new RerunRefusedError("schema-mismatch", "Rerun source checkpoint is invalid");
    }
    if (older && node?.kind !== "transaction" && TransactionOutcomeSchema.safeParse(checkpoint.output.value).success) {
      throw new RerunRefusedError("schema-mismatch", "Previous transaction warning evidence is incompatible");
    }
    if (node?.kind === "transaction") {
      try { projectTransactionOutcome(node.commit.uses, checkpoint.output.value, "Rerun warning source", { checkpoint, schemaReader }); }
      catch { throw new RerunRefusedError("schema-mismatch", "Rerun transaction proof is invalid"); }
    }
    const previous = latest.get(String(checkpoint.nodeId));
    if (previous === undefined || checkpoint.attempt > previous.attempt
      || (checkpoint.attempt === previous.attempt && (checkpoint.claimGeneration ?? 0) > (previous.claimGeneration ?? 0))) {
      latest.set(String(checkpoint.nodeId), checkpoint);
    }
  }
  const gates = repositories.gateResults.listByRun(source.runId).filter(gate => {
    if (gate.runId !== source.runId) throw new RerunRefusedError("schema-mismatch", "Rerun gate evidence is invalid");
    return !older || descriptorRuntimeNodes(descriptor).some(node => String(node.id) === String(gate.gateId));
  });
  for (const gate of gates) {
    const node = descriptorRuntimeNodes(descriptor).find((candidate) => String(candidate.id) === String(gate.gateId));
    if (!older && (node?.kind !== "gate" || (schemaReader?.({ kind: "gate-result", id: canonicalJsonStringify([gate.runId, gate.gateId]) }, gate, gate.result.schemaHash, deriveSchemaHash(node.result, "output")) ?? gate.result.schemaHash) !== deriveSchemaHash(node.result, "output")
      || !node.result.safeParse(gate.result.value).success)) throw new RerunRefusedError("schema-mismatch", "Rerun gate evidence is invalid");
  }
  const gateWasSkipped = recordedGateSkipLookup(repositories, descriptor, run);
  for (const checkpoint of latest.values()) {
    const node = descriptorRuntimeNodes(descriptor).find(node => node.id === checkpoint.nodeId);
    if (node?.kind === "transaction") validateRerunTransactionEvidence({ repositories, descriptor, run, node, checkpoint, checkpoints: latest, gates, schemaReader, gateWasSkipped });
  }
  for (const coordinate of source.copiedFrom ?? []) {
    const checkpoint = latest.get(coordinate.nodeId);
    const node = descriptorRuntimeNodes(descriptor).find((candidate) => candidate.id === coordinate.nodeId);
    const outputSchema = node?.kind === "task" ? node.uses.output : node?.kind === "transaction" ? TransactionOutcomeSchema : undefined;
    if (checkpoint === undefined || outputSchema === undefined || (!older && ((schemaReader?.({ kind: "task-output", id: checkpointRecordKey(checkpoint) }, checkpoint, checkpoint.output.schemaHash, deriveSchemaHash(outputSchema, "output")) ?? checkpoint.output.schemaHash) !== deriveSchemaHash(outputSchema, "output")
      || !outputSchema.safeParse(checkpoint.output.value).success))) {
      throw new RerunRefusedError("schema-mismatch", "copied-value source does not match its descriptor output");
    }
    const target = coordinate.targetStepKey === undefined ? entry?.rawInput
      : stepOmissions?.find((omission) => omission.workflow === undefined && omission.step === coordinate.targetStepKey)?.facts;

    if (checkpoint === undefined || checkpoint.contractFingerprint !== run.envelope.contractFingerprint
      || canonicalJsonStringify(field(checkpoint.output.value, coordinate.fieldPath))
        !== canonicalJsonStringify(field(target, coordinate.targetFieldPath))) {
      throw new RerunRefusedError("invalid-value", "copied value does not match its source coordinates");
    }
  }
  const selected = new Set(source.selectedStepKeys);
  const protectedBindings = retainedRunProtectedBindings(run);
  const nodes = new Set(descriptor.timeline.filter((step) => selected.has(step.key)).flatMap((step) => step.nodes.map((node) => String(node.id))));
  const warnings: RepeatWarning[] = [];
  for (const node of descriptorRuntimeNodes(descriptor)) {
    if (node.kind !== "transaction" || !nodes.has(String(node.id))
      || continuation?.checkpoints.some(row => row.nodeId === node.id)) continue;
    const outputs: Record<string, JsonValue> = {};
    const transactionCheckpoint = latest.get(node.id);
    let missingDependency = false;
    for (const dependency of node.dependsOn) {
      const dependencyNode = descriptorRuntimeNodes(descriptor).find(candidate => candidate.id === dependency);
      const checkpoint = latest.get(String(dependency));
      if (checkpoint !== undefined) {
        const schema = dependencyNode?.kind === "task" ? dependencyNode.uses.output
          : dependencyNode?.kind === "transaction" ? TransactionOutcomeSchema : undefined;
        if (schema === undefined || (schemaReader?.({ kind: "task-output", id: checkpointRecordKey(checkpoint) }, checkpoint, checkpoint.output.schemaHash, deriveSchemaHash(schema, "output")) ?? checkpoint.output.schemaHash) !== deriveSchemaHash(schema, "output")
          || !schema.safeParse(checkpoint.output.value).success) {
          throw new RerunRefusedError("schema-mismatch", "Previous transaction warning evidence is incompatible");
        }
        outputs[String(dependency)] = dependencyNode?.kind === "transaction"
          ? JsonValueSchema.parse(projectTransactionOutcome(dependencyNode.commit.uses, checkpoint.output.value, "Rerun warning dependency", { checkpoint, schemaReader })) : checkpoint.output.value;
      }
      else {
        const gate = gates.find((candidate) => String(candidate.gateId) === String(dependency));
        if (gate !== undefined) {
          if (dependencyNode?.kind !== "gate" || (schemaReader?.({ kind: "gate-result", id: canonicalJsonStringify([gate.runId, gate.gateId]) }, gate, gate.result.schemaHash, deriveSchemaHash(dependencyNode.result, "output")) ?? gate.result.schemaHash) !== deriveSchemaHash(dependencyNode.result, "output")
            || !dependencyNode.result.safeParse(gate.result.value).success) {
            throw new RerunRefusedError("schema-mismatch", "Previous transaction warning evidence is incompatible");
          }
          outputs[String(dependency)] = gate.result.value;
        } else {
          const delegated = rerunDelegationOutput(repositories, run, dependencyNode, false, schemaReader);
          if (delegated !== undefined) outputs[dependency] = delegated;
          else if (!gateWasSkipped(dependencyNode, transactionCheckpoint)
            && !orderOnlyOmission(descriptor.stepOmissions, run.envelope.stepOmissions, node.id, dependency)) missingDependency = true;
        }
      }
    }
    // Missing fresh upstream facts cannot authorize a repeat. Execution must
    // obtain renewed consent if its eventual natural key is not in this set.
    if (missingDependency) {
      if (transactionCheckpoint !== undefined || repositories.writeIntents.listByRun(source.runId)
        .some((intent) => intent.status === "committed" && intent.taskId === node.commit.uses.id && "bindingProof" in intent
          && intent.bindingProof.afterPrepareSpanPath === `${run.envelope.traceId}/${node.id}/prepare`)) {
        throw new RerunRefusedError("invalid-value", "Previous transaction warning evidence is unavailable");
      }
      continue;
    }
    const { system, key, digest } = entry === undefined
      ? boundNaturalKey(node, run.input.parsed.value, outputs, isRetiredRunInput(descriptor, run, schemaReader))
      : boundNaturalKey(node, entry.input.value, outputs, false);
    for (const intent of repositories.writeIntents.listByBusinessKey(system, digest)) {
      if (intent.status !== "committed" && intent.status !== "observed-present") continue;
      if (intent.taskId !== node.commit.uses.id || intent.system !== system || (("occurrence" in intent ? intent.occurrence?.businessKeyDigest : undefined) ?? intent.idempotencyKeyDigest) !== digest
        || (!("occurrence" in intent) || intent.occurrence === undefined) && intent.idempotencyKey !== key) throw new RerunRefusedError("schema-mismatch", "Rerun warning natural key is invalid");
      validateRerunWriteProof(node.commit.uses, intent, schemaReader);
      warnings.push(RepeatWarningSchema.parse({ nodeId: node.id, taskId: node.commit.uses.id, system, businessKeyDigest: digest,
        writeIntentId: intent.writeIntentId, evidenceDigest: repeatEvidenceDigest(intent, protectedBindings) }));
    }
  }
  warnings.sort((a, b) => a.nodeId.localeCompare(b.nodeId) || a.writeIntentId.localeCompare(b.writeIntentId));
  const protection = protectedBindings.length === 0 ? {} : { protectedBindings };
  const warningDigest = sha256Hex(`hrauto:rerun-warnings:v1\0${canonicalJsonStringify(valueFreeProtectedData({
    runId: source.runId, expectedVersion: source.expectedVersion, descriptorFingerprint: descriptor.contractFingerprint,
    selectedStepKeys: [...selected].sort(), warnings, ...protection,
  }, protectedBindings))}`);
  return RerunPlanSchema.parse({ source, warnings, warningDigest, ...protection,
    ...(continuation === undefined ? {} : { continuation }), ...(acknowledgment === undefined ? {} : { acknowledgment }) });
}
