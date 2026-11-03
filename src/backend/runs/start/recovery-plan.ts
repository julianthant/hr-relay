import { assertCanonicalRunCommandScope } from "../../storage/sqlite/command-record-row.js";
import { authenticateRootRun } from "../../storage/sqlite/delegation-root-authority.js";
import { prepareDelegationRetry } from "../../storage/sqlite/delegation-authority.js";
import { lifecycleCommandId } from "../../../rules/identity/identifiers.js";
import { CanonicalRecoverRunRequestSchema, CanonicalRetrySourceRequestSchema } from "../../storage/sqlite/run-store-contracts.js";
import { readRunCheckpoint } from "../../runtime/checkpoints/run-checkpoint-reader.js";
import { AuthenticatedRunContinuation } from "../../storage/sqlite/run-continuation-delegation.js";
import { delegationEvidenceOutput } from "../../../models/run/result.js";
import { readContinuationGate, validateRunContinuation, RunContinuationRefusedError } from "../../storage/sqlite/run-continuation.js";
import { captureRunContinuation, continuationEvidenceDigest } from "../../storage/sqlite/run-continuation.js";
import { evaluateNodeCondition } from "../../../models/workflow/node-condition.js";
import { RerunRefusedError, validateRerunSourcePlan } from "./rerun.js";
import { RunRecoveryPlanSchema } from "../../../models/run/recovery-plan.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { retainedRunProtectedBindings } from "../../../models/write-safety/protected-input.js";
import { TransactionOutcomeSchema } from "../../../rules/write-safety/write-safety-primitives.js";
import { projectTransactionOutcome } from "../../../models/workflow/graph.js";
import { canonicalJsonStringify, JsonValueSchema, type JsonValue } from "../../../rules/validation/canonical-json.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { deriveIdempotencyKeyDigest, IdempotencyKeySchema } from "../../../rules/write-safety/write-safety.js";
import { BrowserSystemIdSchema } from "../../../rules/identity/ids.js";

function field(value: unknown, path: string): JsonValue {
  let current: unknown = value;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, part))
      throw new RerunRefusedError("invalid-value", "Recovery configuration coordinates do not resolve.");
    current = Reflect.get(current, part);
  }
  return JsonValueSchema.parse(current);
}

export function assertRunRecoveryCommandScope(repositories: AuthorityRepositories, sourceCommandId: string | undefined) {
  if (sourceCommandId === undefined) throw new RunContinuationRefusedError("run-recovery-command-scope-unavailable");
  const source = repositories.commands.get(sourceCommandId);
  if (source?.family !== "run" || source.type !== "recover-run") throw new RunContinuationRefusedError("run-recovery-command-scope-unavailable");
  try { assertCanonicalRunCommandScope(repositories, source); }
  catch (cause) { throw new RunContinuationRefusedError("run-recovery-command-scope-unavailable", { cause }); }
  return source;
}

export function planRunRecovery(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor, run: RunRecord, sourceCommandId?: string) {
  assertRunRecoveryCommandScope(repositories, sourceCommandId);
  return planCheckpointContinuation(repositories, descriptor, run, "recover");
}

export function planDelegatedRetry(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor, run: RunRecord, sourceCommandId: string | undefined,
  continuationOwner?: NonNullable<Parameters<typeof prepareDelegationRetry>[2]["continuationOwner"]>) {
  if (sourceCommandId === undefined) throw new RunContinuationRefusedError("delegation-retry-source-unavailable");
  if (continuationOwner !== undefined) {
    prepareDelegationRetry(repositories, run, { sourceCommandId, continuationOwner,
      commandId: lifecycleCommandId("continuation-child-retry", { ownerRunId: continuationOwner.runId, previousRunId: run.envelope.runId }) });
    return planCheckpointContinuation(repositories, descriptor, run, "recover");
  }
  const source = repositories.commands.get(sourceCommandId);
  if (run.envelope.parent === undefined || source?.family !== "run" || source.type !== "retry"
    || source.target.runId !== run.envelope.runId || source.target.expectedVersion !== run.version) throw new RunContinuationRefusedError("delegation-retry-source-unavailable");
  assertCanonicalRunCommandScope(repositories, source);
  return planCheckpointContinuation(repositories, descriptor, run, "delegated-retry");
}

function planCheckpointContinuation(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor, run: RunRecord, intent: "recover" | "delegated-retry") {
  const current = repositories.runs.get(run.envelope.runId);
  if (current === undefined || repositories.deletedRuns.get(run.envelope.runId) !== undefined
    || canonicalJsonStringify(current) !== canonicalJsonStringify(run))
    throw new RerunRefusedError("source-stale", "Checkpoint recovery source authority changed.");
  if (run.lifecycle.state !== "terminal" || !["failed", "interrupted", ...(intent === "delegated-retry" ? ["cancelled"] : [])].includes(run.lifecycle.outcome))
    throw new RerunRefusedError("invalid-state", "Checkpoint recovery requires a failed or interrupted source.");
  if (run.envelope.workflow !== descriptor.id || run.envelope.descriptorVersion !== descriptor.version
    || run.envelope.contractFingerprint !== descriptor.contractFingerprint)
    throw new RerunRefusedError("schema-mismatch", "Checkpoint recovery requires the original workflow contract.");
  if (run.input.parsed.schemaHash !== deriveSchemaHash(descriptor.canonicalInput, "output")
    || !descriptor.canonicalInput.safeParse(run.input.parsed.value).success)
    throw new RerunRefusedError("schema-mismatch", "Checkpoint recovery source input is incompatible.");
  const origin = run.sessionId === undefined || run.envelope.parent !== undefined ? undefined
    : repositories.lifecycleJournal.findRunOrigin(run.envelope.runId);
  const native = origin?.operation === "recover" ? CanonicalRecoverRunRequestSchema.parse(origin.request)
    : origin?.operation === "retry" || origin?.operation === "restart" ? CanonicalRetrySourceRequestSchema.parse(origin.request) : undefined;
  if (native?.sourceCommandId !== undefined) {
    try { authenticateRootRun(repositories, run); }
    catch (cause) { throw new RunContinuationRefusedError("run-recovery-source-origin-unavailable", { cause }); }
  } else validateRerunSourcePlan(repositories, run);
  const members = repositories.runs.listByItem({ workflow: descriptor.id, itemId: run.envelope.itemId });
  if (repositories.writeIntents.listAttemptingByItem({ workflowId: descriptor.id, itemId: run.envelope.itemId }).length > 0
    || members.some(member => repositories.writeIntents.listByRun(member.envelope.runId)
      .some(intent => intent.status === "attempting" || intent.status === "parked")))
    throw new RerunRefusedError("invalid-state", "Checkpoint recovery cannot reuse uncertain write authority.");
  const active = repositories.runtimeConfig.get();
  if (active === undefined || active.configFingerprint !== run.envelope.configFingerprint)
    throw new RerunRefusedError("schema-mismatch", "Checkpoint recovery requires the original runtime fingerprint.");
  validateCompletedTransactionContinuations(repositories, descriptor, run);
  return RunRecoveryPlanSchema.parse({ kind: "checkpoint-recovery",
    source: { runId: run.envelope.runId, expectedVersion: run.version, attempt: run.envelope.attempt,
      inputDigest: continuationEvidenceDigest(run.input) },
    descriptorVersion: descriptor.version, descriptorFingerprint: descriptor.contractFingerprint,
    configSnapshotId: run.envelope.configSnapshotId, configFingerprint: run.envelope.configFingerprint,
    continuation: captureRunContinuation(repositories, run) });
}

export function validateCompletedTransactionContinuations(repositories: AuthorityRepositories, descriptor: AnyWorkflowDescriptor,
  run: RunRecord, input: JsonValue = run.input.parsed.value): ReadonlySet<string> {
  const continuation = captureRunContinuation(repositories, run);
  const sources = new Map([run, ...validateRunContinuation(repositories, run.envelope)].map(source => [source.envelope.runId, source]));
  const ownedIntents = [...sources.values()].flatMap(source => repositories.writeIntents.listByRun(source.envelope.runId));
  const nodes = descriptorRuntimeNodes(descriptor);
  const completed = new Set<string>();
  const scopeFor = (source: RunRecord, dependsOn: readonly string[], value: JsonValue, historical = false): {
    input: JsonValue; outputs: Record<string, JsonValue>; configuration: Readonly<Record<string, JsonValue>>;
    protectedInputBindings: ReturnType<typeof retainedRunProtectedBindings>;
  } => {
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
        if (gate === undefined && (node?.kind === "task" || node?.kind === "gate" && node.resolvedBy === "operator") && node.when !== undefined
          && !evaluateNodeCondition(node.when, scopeFor(source, node.dependsOn, value, historical))) continue;
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
