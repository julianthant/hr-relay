import { readRunCheckpoint } from "../../runtime/checkpoints/run-checkpoint-reader.js";
import { AuthenticatedRunContinuation } from "../../runtime/checkpoints/run-continuation-delegation.js";
import { delegationEvidenceOutput } from "../../../models/run/result.js";
import { readContinuationGate, validateRunContinuation } from "../../runtime/checkpoints/run-continuation.js";
import { captureRunContinuation, continuationEvidenceDigest } from "../../runtime/checkpoints/run-continuation.js";
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

export function validateCompletedTransactionContinuations(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor,
  run: RunRecord, input: JsonValue = run.input.parsed.value): ReadonlySet<string> {
  const continuation = captureRunContinuation(repositories, run);
  const sources = new Map([run, ...validateRunContinuation(repositories, run.envelope)].map(source => [source.envelope.runId, source]));
  const ownedIntents = [...sources.values()].flatMap(source => repositories.writeIntents.listByRun(source.envelope.runId));
  const nodes = descriptorRuntimeNodes(descriptor);
  const completed = new Set<string>();
  const scopeFor = (source: RunRecord, dependsOn: readonly string[], value: JsonValue, historical = false) => {
    const outputs: Record<string, JsonValue> = {};
    for (const dependency of dependsOn) {
      const own = repositories.runCheckpoints.listByAttempt(source.envelope.workflow, source.envelope.itemId, dependency, source.envelope.attempt)
        .filter(row => row.runId === source.envelope.runId).at(-1);
      const checkpoint = own ?? (source.envelope.continuation === undefined ? undefined : readRunCheckpoint(repositories, source.envelope, dependency, true));
      const node = nodes.find(candidate => candidate.id === dependency);
      if (checkpoint !== undefined) {
        const schema = node?.kind === "task" ? node.uses.output : node?.kind === "transaction" ? TransactionOutcomeSchema : undefined;
        if (schema === undefined || checkpoint.output.schemaHash !== deriveSchemaHash(schema, "output") || !schema.safeParse(checkpoint.output.value).success) {
          throw new RerunRefusedError("schema-mismatch", "Saved transaction dependency is incompatible.");
        }
        outputs[dependency] = node?.kind === "transaction" ? JsonValueSchema.parse(projectTransactionOutcome(node.commit.uses, checkpoint.output.value, "Transaction continuation")) : checkpoint.output.value;
      } else {
        if (node?.kind === "child-run") {
          const child = AuthenticatedRunContinuation.authenticate(repositories, source.envelope).dependency(dependency, String(node.edgeId), historical);
          if (child === undefined) throw new RerunRefusedError("invalid-value", "Saved transaction child dependency is unavailable.");
          outputs[dependency] = JsonValueSchema.parse(delegationEvidenceOutput(child, node.target.result));
          continue;
        }
        const gate = readContinuationGate(repositories, source.envelope, dependency);
        if (gate === undefined || node?.kind !== "gate" || gate.result.schemaHash !== deriveSchemaHash(node.result, "output") || !node.result.safeParse(gate.result.value).success) {
          throw new RerunRefusedError("invalid-value", "Saved transaction dependency is unavailable.");
        }
        outputs[dependency] = gate.result.value;
      }
    }
    const configuration: Record<string, JsonValue> = {};
    const keys = descriptor.operationDisplay?.capability === "complete" ? descriptor.operationDisplay.transforms
      .flatMap(transform => transform.inputs.flatMap(source => source.value.kind === "configuration" ? [source.value.key] : [])) : [];
    if (keys.length > 0) {
      const snapshot = repositories.configSnapshots.get(source.envelope.configSnapshotId);
      if (snapshot === undefined || snapshot.fingerprint !== source.envelope.configFingerprint
        || sha256Hex(canonicalJsonStringify(snapshot.config)) !== snapshot.fingerprint) throw new RerunRefusedError("schema-mismatch", "Saved transaction configuration is unavailable.");
      for (const key of keys) configuration[key] = field(snapshot.config, key);
    }
    return { input: value, outputs, configuration: Object.freeze(configuration), protectedInputBindings: retainedRunProtectedBindings(source) };
  };
  for (const node of nodes) {
    if (node.kind !== "transaction") continue;
    const reference = continuation.checkpoints.find(row => row.nodeId === node.id);
    const committed = ownedIntents.filter(intent => intent.status === "committed" && intent.taskId === node.commit.uses.id
        && sources.get(intent.runId)?.envelope.traceId + `/${node.id}/prepare` === intent.bindingProof.afterPrepareSpanPath);
    if (reference === undefined) {
      if (committed.length > 0) throw new RerunRefusedError("invalid-value", "Completed transaction checkpoint is unavailable.");
      continue;
    }
    const checkpoint = repositories.runCheckpoints.get(run.envelope.workflow, run.envelope.itemId, node.id, reference.attempt, reference.claimGeneration);
    const original = sources.get(reference.runId);
    if (checkpoint === undefined || checkpoint.runId !== reference.runId || original === undefined || continuationEvidenceDigest(checkpoint) !== reference.digest) {
      throw new RerunRefusedError("invalid-value", "Completed transaction checkpoint cannot be authenticated.");
    }
    if (checkpoint.descriptorVersion !== descriptor.version || checkpoint.contractFingerprint !== descriptor.contractFingerprint
      || checkpoint.output.schemaHash !== deriveSchemaHash(TransactionOutcomeSchema, "output")) throw new RerunRefusedError("schema-mismatch", "Completed transaction contract changed.");
    const parsed = TransactionOutcomeSchema.safeParse(checkpoint.output.value);
    if (!parsed.success) throw new RerunRefusedError("schema-mismatch", "Completed transaction outcome is invalid.");
    const outcome = parsed.data;
    try { projectTransactionOutcome(node.commit.uses, checkpoint.output.value, "Transaction continuation"); }
    catch { throw new RerunRefusedError("schema-mismatch", "Completed transaction proof or output schema changed."); }
    const prior = scopeFor(original, node.dependsOn, original.input.parsed.value, true), current = scopeFor(run, node.dependsOn, input);
    const mappings = (scope: typeof current) => ({ prepare: node.prepare.uses.input.parse(node.prepare.bind(scope)), commit: node.commit.uses.input.parse(node.commit.bind(scope)) });
    const priorMappings = mappings(prior), currentMappings = mappings(current);
    if (canonicalJsonStringify(priorMappings) !== canonicalJsonStringify(currentMappings)) throw new RerunRefusedError("invalid-value", "Completed transaction mapped input changed.");
    const system = BrowserSystemIdSchema.parse(node.commit.uses.id.split("/")[0]);
    const key = IdempotencyKeySchema.parse(Reflect.apply(node.commit.uses.writeSafety.idempotency.key, undefined, [currentMappings.commit]));
    const siblings = repositories.writeIntents.listByBusinessKey(system, deriveIdempotencyKeyDigest(system, key));
    if (committed.some(intent => intent.status === "committed" && intent.runId === reference.runId && intent.runAttempt === reference.attempt && intent.occurrence !== undefined)) {
      throw new RerunRefusedError("invalid-state", "Predecessor repeat-occurrence transaction replay is unsupported.");
    }
    if (siblings.some(intent => intent.status !== "committed" && intent.status !== "observed-present")) throw new RerunRefusedError("invalid-state", "Transaction business key has unresolved writes.");
    const durable = repositories.writeIntents.findByPermanentKey(system, key);
    const proof = durable?.status === "committed" ? durable.completionProof : durable?.status === "observed-present" ? durable.observedProof : undefined;
    if (durable?.taskId !== node.commit.uses.id || proof === undefined || canonicalJsonStringify(proof) !== canonicalJsonStringify(outcome.proof)) {
      throw new RerunRefusedError("invalid-value", "Completed transaction lacks its exact natural-key settlement proof.");
    }
    completed.add(String(node.id));
  }
  return completed;
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
  source: RerunSource, planned: readonly PlannedRun[], acknowledgment?: string, stepOmissions?: StepOmissions): RerunPlan {
  return buildWarnings(repositories, descriptor, source, planned[0], acknowledgment, stepOmissions, planned.length);
}

/** Uses retained canonical input only to identify previous submissions; never creates a plan. */
export function previewRerunWarnings(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor,
  source: RerunSource): RerunPlan {
  return buildWarnings(repositories, descriptor, source);
}

function buildWarnings(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor,
  source: RerunSource, entry?: PlannedRun, acknowledgment?: string, stepOmissions?: StepOmissions, plannedLength?: number): RerunPlan {
  if (repositories.deletedRuns.get(source.runId) !== undefined) throw new RerunRefusedError("target-deleted", "Rerun source was deleted");
  const run = repositories.runs.get(source.runId);
  if (run === undefined) throw new RerunRefusedError("target-not-found", "Rerun source does not exist");
  if (run.version !== source.expectedVersion) throw new RerunRefusedError("source-stale", "Rerun source revision changed; replan");
  if (run.envelope.workflow !== descriptor.id) throw new RerunRefusedError("schema-mismatch", "Rerun source workflow changed");
  const older = run.envelope.contractFingerprint !== descriptor.contractFingerprint || run.envelope.descriptorVersion !== descriptor.version;
  if (older) throw new RerunRefusedError("schema-mismatch", "Completed steps require the original workflow contract.");
  // Use the same authority disposition predicate as RunRecordService.read.
  if (run.lifecycle.state !== "terminal" || run.lifecycle.outcome !== "failed"
    || repositories.writeIntents.listAttemptingByItem({ workflowId: descriptor.id, itemId: run.envelope.itemId }).length > 0
    || repositories.writeIntents.listByRun(source.runId).some((intent) => intent.status === "parked")) {
    throw new RerunRefusedError("invalid-state", "Rerun requires a failed source without uncertain writes");
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
  if (!older && (run.input.parsed.schemaHash !== deriveSchemaHash(descriptor.canonicalInput, "output")
    || !descriptor.canonicalInput.safeParse(run.input.parsed.value).success)) {
    throw new RerunRefusedError("schema-mismatch", "Rerun source canonical input is invalid");
  }
  const retainedSources = new Map([run, ...validateRunContinuation(repositories, run.envelope)].map(source => [source.envelope.runId, source]));
  const checkpoints = run.envelope.continuation === undefined
    ? repositories.runCheckpoints.listByItem(descriptor.id, run.envelope.itemId).filter(checkpoint => checkpoint.runId === run.envelope.runId)
    : descriptorRuntimeNodes(descriptor).flatMap(node => {
    const checkpoint = readRunCheckpoint(repositories, run.envelope, String(node.id), true);
    return checkpoint === undefined ? [] : [checkpoint];
  });
  const latest = new Map<string, (typeof checkpoints)[number]>();
  for (const checkpoint of checkpoints) {
    const checkpointSource = retainedSources.get(checkpoint.runId);
    if (checkpointSource === undefined) throw new RerunRefusedError("schema-mismatch", "Rerun checkpoint source is unavailable");
    const node = descriptorRuntimeNodes(descriptor).find((candidate) => candidate.id === checkpoint.nodeId);
    const schema = node?.kind === "task" ? node.uses.output : node?.kind === "transaction" ? TransactionOutcomeSchema : undefined;
    if (checkpoint.workflowId !== descriptor.id || checkpoint.itemId !== run.envelope.itemId
      || checkpoint.attempt > checkpointSource.envelope.attempt
      || (checkpoint.claimGeneration !== undefined && checkpoint.claimGeneration > checkpointSource.claimGeneration)
      || checkpoint.descriptorVersion !== run.envelope.descriptorVersion || checkpoint.contractFingerprint !== run.envelope.contractFingerprint
      || (!older && (schema === undefined || checkpoint.output.schemaHash !== deriveSchemaHash(schema, "output")
        || !schema.safeParse(checkpoint.output.value).success))) {
      throw new RerunRefusedError("schema-mismatch", "Rerun source checkpoint is invalid");
    }
    if (older && node?.kind !== "transaction" && TransactionOutcomeSchema.safeParse(checkpoint.output.value).success) {
      throw new RerunRefusedError("schema-mismatch", "Previous transaction warning evidence is incompatible");
    }
    if (node?.kind === "transaction") {
      try { projectTransactionOutcome(node.commit.uses, checkpoint.output.value, "Rerun warning source"); }
      catch { throw new RerunRefusedError("schema-mismatch", "Rerun transaction proof is invalid"); }
    }
    const previous = latest.get(String(checkpoint.nodeId));
    if (previous === undefined || checkpoint.attempt > previous.attempt
      || (checkpoint.attempt === previous.attempt && (checkpoint.claimGeneration ?? 0) > (previous.claimGeneration ?? 0))) {
      latest.set(String(checkpoint.nodeId), checkpoint);
    }
  }
  const gates = descriptorRuntimeNodes(descriptor).flatMap(node => { const gate = readContinuationGate(repositories, run.envelope, String(node.id)); return gate === undefined ? [] : [gate]; }).filter(gate => {
    if (!retainedSources.has(gate.runId)) throw new RerunRefusedError("schema-mismatch", "Rerun gate evidence is invalid");
    return !older || descriptorRuntimeNodes(descriptor).some(node => String(node.id) === String(gate.nodeId));
  });
  for (const gate of gates) {
    const node = descriptorRuntimeNodes(descriptor).find((candidate) => String(candidate.id) === String(gate.nodeId));
    if (!older && (node?.kind !== "gate" || gate.result.schemaHash !== deriveSchemaHash(node.result, "output")
      || !node.result.safeParse(gate.result.value).success)) throw new RerunRefusedError("schema-mismatch", "Rerun gate evidence is invalid");
  }
  for (const coordinate of source.copiedFrom ?? []) {
    const checkpoint = latest.get(coordinate.nodeId);
    const node = descriptorRuntimeNodes(descriptor).find((candidate) => candidate.id === coordinate.nodeId);
    const outputSchema = node?.kind === "task" ? node.uses.output : node?.kind === "transaction" ? TransactionOutcomeSchema : undefined;
    if (checkpoint === undefined || outputSchema === undefined || (!older && (checkpoint.output.schemaHash !== deriveSchemaHash(outputSchema, "output")
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
  const completedTransactions = validateCompletedTransactionContinuations(repositories, descriptor, run, entry?.input.value ?? run.input.parsed.value);
  const warnings: RepeatWarning[] = [];
  for (const node of descriptorRuntimeNodes(descriptor)) {
    if (node.kind !== "transaction" || !nodes.has(String(node.id))) continue;
    if (completedTransactions.has(String(node.id))) continue;
    const outputs: Record<string, JsonValue> = {};
    for (const dependency of node.dependsOn) {
      const checkpoint = latest.get(String(dependency));
      if (checkpoint !== undefined) {
        const dependencyNode = descriptorRuntimeNodes(descriptor).find(candidate => candidate.id === dependency);
        const schema = dependencyNode?.kind === "task" ? dependencyNode.uses.output
          : dependencyNode?.kind === "transaction" ? TransactionOutcomeSchema : undefined;
        if (schema === undefined || checkpoint.output.schemaHash !== deriveSchemaHash(schema, "output")
          || !schema.safeParse(checkpoint.output.value).success) {
          throw new RerunRefusedError("schema-mismatch", "Previous transaction warning evidence is incompatible");
        }
        outputs[String(dependency)] = checkpoint.output.value;
      }
      else {
        const gate = gates.find((candidate) => String(candidate.nodeId) === String(dependency));
        if (gate !== undefined) {
          const dependencyNode = descriptorRuntimeNodes(descriptor).find(candidate => String(candidate.id) === String(dependency));
          if (dependencyNode?.kind !== "gate" || gate.result.schemaHash !== deriveSchemaHash(dependencyNode.result, "output")
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
