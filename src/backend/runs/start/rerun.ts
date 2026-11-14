import { RETIRED_INPUT_GENERATIONS, type EvidenceSchemaReader } from "../../../models/storage/evidence-schema-admission.js";
import type { AnyCommitTaskContract } from "../../../models/task/task-contract.js";
import type { RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { GateResultRecord } from "../../../models/workflow/gates.js";
import type { RuntimeFlowNode } from "../../../models/workflow/graph.js";
import { checkpointRecordKey } from "../../../models/workflow/checkpoint.js";
import type { WriteIntentRecord } from "../../../rules/write-safety/write-safety.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { RerunPlanRefusalCode } from "../../../models/run/rerun.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { retainedRunProtectedBindings, valueFreeProtectedData } from "../../../models/write-safety/protected-input.js";
import { TransactionOutcomeSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import { projectTransactionOutcome } from "../../../models/workflow/graph.js";
import type { StepOmissions } from "../../../models/workflow/step-omission.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { BrowserSystemIdSchema } from "../../../rules/identity/ids.js";
import { RerunPlanSchema, RepeatWarningSchema, repeatEvidenceDigest, type RerunPlan, type RerunSource, type RepeatWarning } from "../../../models/run/rerun.js";
import type { PlannedRun } from "../../../models/run/start-plan.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { deriveIdempotencyKeyDigest, IdempotencyKeySchema } from "../../../rules/write-safety/write-safety.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { projectStartSteps } from "./step-selection.js";

export class RerunRefusedError extends Error {
  constructor(readonly code: RerunPlanRefusalCode, message: string) {
    super(message); this.name = "RerunRefusedError";
  }
}

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

export function validateRerunTransactionEvidence(input: Readonly<{
  repositories: AuthorityRepositories; descriptor: AnyWorkflowDescriptor; run: RunRecord;
  node: Extract<RuntimeFlowNode, { kind: "transaction" }>; checkpoint: RunCheckpointRecord;
  checkpoints: ReadonlyMap<string, RunCheckpointRecord>; gates: readonly GateResultRecord[]; schemaReader?: EvidenceSchemaReader;
}>) {
  const { repositories, descriptor, run, node, checkpoint, checkpoints, gates, schemaReader } = input;
  const currentInputHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  // A retired input stays history: it is bound below only to name the natural key, and every accepted write must carry this checkpoint's exact proof.
  if (!isRetiredRunInput(descriptor, run, schemaReader) && ((schemaReader?.({ kind: "run-input", id: run.envelope.runId }, run.input, run.input.parsed.schemaHash, currentInputHash) ?? run.input.parsed.schemaHash) !== currentInputHash
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
      if (gate === undefined) throw new RerunRefusedError("invalid-value", "Rerun transaction dependency is unavailable");
      if (dependency?.kind !== "gate" || (schemaReader?.({ kind: "gate-result", id: canonicalJsonStringify([gate.runId, gate.gateId]) }, gate,
        gate.result.schemaHash, deriveSchemaHash(dependency.result, "output")) ?? gate.result.schemaHash) !== deriveSchemaHash(dependency.result, "output")
        || !dependency.result.safeParse(gate.result.value).success) throw new RerunRefusedError("schema-mismatch", "Rerun transaction gate is invalid");
      outputs[id] = gate.result.value;
    }
  }
  const commitInput = node.commit.uses.input.parse(node.commit.bind({ input: run.input.parsed.value, outputs }));
  const key = IdempotencyKeySchema.parse(Reflect.apply(node.commit.uses.writeSafety.idempotency.key, undefined, [commitInput]));
  const system = BrowserSystemIdSchema.parse(node.commit.uses.id.split("/")[0]), digest = deriveIdempotencyKeyDigest(system, key);
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

export function validateRerunSourcePlan(repositories: AuthorityRepositories, run: RunRecord): void {
  if (run.sessionId === undefined) return;
  const session = repositories.runSessions.get(run.sessionId);
  if (session === undefined || session.workflow !== run.envelope.workflow) {
    throw new RerunRefusedError("schema-mismatch", "Rerun source session is missing or mismatched");
  }
  if (session.origin.kind !== "start-plan") return;
  const plan = repositories.startPlans.get(session.origin.startPlanId);
  if (plan === undefined || plan.workflowId !== run.envelope.workflow || plan.plannedBy !== session.origin.actorId
    || plan.descriptorVersion !== run.envelope.descriptorVersion || plan.descriptorFingerprint !== run.envelope.contractFingerprint
    || plan.configSnapshotId !== run.envelope.configSnapshotId || plan.configFingerprint !== run.envelope.configFingerprint
    || plan.consumedBy?.consumedAt !== session.startedAt
    || !plan.planned.some(entry => entry.itemId === run.envelope.itemId)) {
    throw new RerunRefusedError("schema-mismatch", "Rerun source start plan is missing or mismatched");
  }
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
  if (run.lifecycle.state !== "terminal" || !["done", "failed", "interrupted"].includes(run.lifecycle.outcome)
    || repositories.writeIntents.listAttemptingByItem({ workflowId: descriptor.id, itemId: run.envelope.itemId }).length > 0
    || repositories.writeIntents.listByRun(source.runId).some((intent) => intent.status === "parked")) {
    throw new RerunRefusedError("invalid-state", "Rerun requires a successful, failed or interrupted source without uncertain writes");
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
  for (const step of projectStartSteps(descriptor)) {
    if (!selectedKeys.includes(step.key) && (step.control.state === "required"
      || (step.control.state === "omittable" && step.control.forces.some((key) => selectedKeys.includes(key))))) {
      throw new RerunRefusedError("invalid-value", "Rerun selection violates the workflow's required steps or omission cascade");
    }
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
  for (const checkpoint of latest.values()) {
    const node = descriptorRuntimeNodes(descriptor).find(node => node.id === checkpoint.nodeId);
    if (node?.kind === "transaction") validateRerunTransactionEvidence({ repositories, descriptor, run, node, checkpoint, checkpoints: latest, gates, schemaReader });
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
      : stepOmissions?.find((omission) => omission.step === coordinate.targetStepKey)?.facts;

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
    if (node.kind !== "transaction" || !nodes.has(String(node.id))) continue;
    const outputs: Record<string, JsonValue> = {};
    for (const dependency of node.dependsOn) {
      const checkpoint = latest.get(String(dependency));
      if (checkpoint !== undefined) {
        const dependencyNode = descriptorRuntimeNodes(descriptor).find(candidate => candidate.id === dependency);
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
          const dependencyNode = descriptorRuntimeNodes(descriptor).find(candidate => String(candidate.id) === String(dependency));
          if (dependencyNode?.kind !== "gate" || (schemaReader?.({ kind: "gate-result", id: canonicalJsonStringify([gate.runId, gate.gateId]) }, gate, gate.result.schemaHash, deriveSchemaHash(dependencyNode.result, "output")) ?? gate.result.schemaHash) !== deriveSchemaHash(dependencyNode.result, "output")
            || !dependencyNode.result.safeParse(gate.result.value).success) {
            throw new RerunRefusedError("schema-mismatch", "Previous transaction warning evidence is incompatible");
          }
          outputs[String(dependency)] = gate.result.value;
        }
      }
    }
    // Missing fresh upstream facts cannot authorize a repeat. Execution must
    // obtain renewed consent if its eventual natural key is not in this set.
    if (node.dependsOn.some((dependency) => !Object.hasOwn(outputs, String(dependency)))) {
      if (latest.has(String(node.id)) || repositories.writeIntents.listByRun(source.runId)
        .some((intent) => intent.status === "committed" && intent.taskId === node.commit.uses.id)) {
        throw new RerunRefusedError("invalid-value", "Previous transaction warning evidence is unavailable");
      }
      continue;
    }
    const commitInput = node.commit.uses.input.parse(node.commit.bind({ input: entry?.input.value ?? run.input.parsed.value, outputs }));
    const key = IdempotencyKeySchema.parse(Reflect.apply(node.commit.uses.writeSafety.idempotency.key, undefined, [commitInput]));
    const system = BrowserSystemIdSchema.parse(node.commit.uses.id.split("/")[0]);
    const digest = deriveIdempotencyKeyDigest(system, key);
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
  return RerunPlanSchema.parse({ source, warnings, warningDigest, ...protection, ...(acknowledgment === undefined ? {} : { acknowledgment }) });
}
