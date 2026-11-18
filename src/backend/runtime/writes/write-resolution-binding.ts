import { originalCheckpoint, readContinuationGate, readRunCheckpoint } from "../../storage/sqlite/run-continuation.js";
import { runWorkbookReferenceTypeIds } from "../../../models/dashboard/workbooks.js";
import { loadCheckpoint } from "../../../models/workflow/checkpoint.js";
import { evaluateNodeCondition, nodeConditionDependency, type NodeCondition } from "../../../models/workflow/node-condition.js";
import { taskImplFingerprint } from "../../../workflow-kit/fingerprints.js";
import { retainedRunProtectedBindings, hasProtectedTransactionInput } from "../../../models/write-safety/protected-input.js";
import { repeatOccurrenceKey } from "../../../models/run/rerun.js";
// Resolve only the same workflow, node, schemas, permanent key and binding proof; whole-closure identity is sufficient, not necessary.
import { z } from "zod";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { idempotencyKeyDigestReference } from "../../../rules/redaction/redaction.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { FingerprintSchema } from "../../../rules/identity/ids.js";
import {
  deriveIdempotencyKeyDigest,
  IdempotencyKeySchema,
  type WriteIntentRecord,
} from "../../../rules/write-safety/write-safety.js";
import type { RunRecord } from "../../../models/run/record.js";
import type { RuntimeFlowNode, RuntimeScope } from "../../../models/workflow/graph.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { currentBuildId } from "../build-id.js";

export type TransactionRuntimeNode = Extract<RuntimeFlowNode, { kind: "transaction" }>;

/** The durable-state readers a binding evaluation needs; nothing writes here. */
export type WriteBindingRepositories = Pick<AuthorityRepositories, "runCheckpoints" | "gateResults" | "runs">;


export const WriteResolutionArmSchema = z.enum([
  "recovery-probe",
  "recheck",
  "operator-confirmed-absent",
]);
export type WriteResolutionArm = z.infer<typeof WriteResolutionArmSchema>;


export const WriteBindingCheckSchema = z.enum([
  "workflow-identity",
  "descriptor-version",
  "transaction-node",
  "canonical-input",
  "permanent-key-identity",
  "binding-proof-identity",
]);
export type WriteBindingCheck = z.infer<typeof WriteBindingCheckSchema>;

export const WriteCommitInputRebuildFailureSchema = z.strictObject({
  category: z.enum(["missing-evidence", "schema-failure", "key-drift"]),
  evidenceDigest: FingerprintSchema,
});
export type WriteCommitInputRebuildFailure = z.infer<typeof WriteCommitInputRebuildFailureSchema>;

export class WriteCommitInputRebuildError extends Error {
  readonly failure: WriteCommitInputRebuildFailure;

  constructor(category: WriteCommitInputRebuildFailure["category"], detail: string, cause?: unknown) {
    const evidenceDigest = FingerprintSchema.parse(sha256Hex(
      `hrauto:write-input-rebuild-failure:v1\0${category}\0${detail}`,
    ));
    super(`commit-input re-derivation refused (${category}; evidence ${evidenceDigest.slice(0, 12)}…)`,
      cause === undefined ? undefined : { cause });
    this.name = "WriteCommitInputRebuildError";
    this.failure = WriteCommitInputRebuildFailureSchema.parse({ category, evidenceDigest });
  }
}

class UnprovedRetiredTargetError extends WriteCommitInputRebuildError {
  constructor() {
    super("missing-evidence", "retired-key-without-full-target-proof");
  }
}

export const WriteBindingCheckResultSchema = z.strictObject({
  check: WriteBindingCheckSchema,
  // Not-evaluated means a prerequisite moved; it never counts as held.
  state: z.enum(["held", "moved", "not-evaluated"]),
  detail: z.string().min(1),
  rederiveFailure: WriteCommitInputRebuildFailureSchema.optional(),
});
export type WriteBindingCheckResult = z.infer<typeof WriteBindingCheckResultSchema>;

export type WriteResolutionBinding =
  | Readonly<{
    state: "identical";
    arm: WriteResolutionArm;
    contractFingerprint: string;
    checks: readonly WriteBindingCheckResult[];
    node: TransactionRuntimeNode;
  }>
  | Readonly<{
    state: "compatible";
    arm: WriteResolutionArm;
    storedContractFingerprint: string;
    currentContractFingerprint: string;
    checks: readonly WriteBindingCheckResult[];
    node: TransactionRuntimeNode;
  }>
  | Readonly<{
    state: "incompatible";
    arm: WriteResolutionArm;
    storedContractFingerprint: string;
    currentContractFingerprint: string;
    checks: readonly WriteBindingCheckResult[];
    /** The first check that moved — the headline of the refusal. */
    moved: WriteBindingCheck;
    message: string;
  }>;

export interface WriteResolutionBindingInput {
  readonly arm: WriteResolutionArm;
  readonly descriptor: AnyWorkflowDescriptor;
  readonly run: RunRecord;
  readonly intent: WriteIntentRecord;
  readonly repositories: WriteBindingRepositories;
}

/* ── node + commit-input reconstruction (shared with recovery) ───────────── */

function lookupTransactionNode(
  descriptor: AnyWorkflowDescriptor,
  intent: WriteIntentRecord,
  run: RunRecord,
): TransactionRuntimeNode | undefined {
  const nodeId = intent.status === "observed-present" ? undefined : intent.occurrence?.nodeId;
  return descriptorRuntimeNodes(descriptor).find((candidate): candidate is TransactionRuntimeNode => {
    if (candidate.kind !== "transaction" || candidate.commit.uses.id !== intent.taskId) return false;
    if (nodeId !== undefined && nodeId !== candidate.id) return false;
    return intent.status !== "parked" || !candidate.commit.uses.writeSafety.idempotency.retiredKeys?.length
      || intent.bindingProof.afterPrepareSpanPath === `${run.envelope.traceId}/${candidate.id}/prepare`;
  });
}

function sameContractAndBuild(descriptor: AnyWorkflowDescriptor, run: RunRecord): boolean {
  return descriptor.contractFingerprint === run.envelope.contractFingerprint && run.envelope.buildId === currentBuildId();
}

function matchesFencedKey(key: string, node: TransactionRuntimeNode, intent: WriteIntentRecord): boolean {
  const digest = deriveIdempotencyKeyDigest(intent.system, key);
  const occurrence = intent.status === "observed-present" ? undefined : intent.occurrence;
  if (occurrence === undefined) return key === intent.idempotencyKey && digest === intent.idempotencyKeyDigest;
  return digest === occurrence.businessKeyDigest && occurrence.nodeId === node.id
    && occurrence.taskId === intent.taskId && occurrence.system === intent.system
    && intent.idempotencyKey === repeatOccurrenceKey(digest, occurrence.confirmationCommandId, occurrence.nodeId)
    && intent.idempotencyKeyDigest === deriveIdempotencyKeyDigest(intent.system, intent.idempotencyKey);
}

function matchesRunConfirmation(
  run: RunRecord,
  node: TransactionRuntimeNode,
  intent: Extract<WriteIntentRecord, { status: "parked" }>,
): boolean {
  const { occurrence } = intent;
  const source = run.envelope.sourceBound;
  const businessKeyDigest = occurrence?.businessKeyDigest ?? intent.idempotencyKeyDigest;
  const consent = source?.warnings.find(warning => warning.nodeId === node.id && warning.taskId === intent.taskId
    && warning.system === intent.system && warning.businessKeyDigest === businessKeyDigest);
  if (occurrence === undefined) return consent === undefined;
  return source !== undefined && consent !== undefined && source.confirmationCommandId === occurrence.confirmationCommandId
    && source.warningDigest === occurrence.warningDigest && source.acknowledgment === occurrence.warningDigest
    && source.source.runId === occurrence.sourceRunId && source.source.expectedVersion === occurrence.sourceVersion
    && consent.writeIntentId === occurrence.writeIntentId && consent.evidenceDigest === occurrence.evidenceDigest;
}

// A retired rule can identify the old fence without identifying all rows it targeted.
export function rebuildCommitInput(
  repositories: WriteBindingRepositories,
  descriptor: AnyWorkflowDescriptor,
  node: TransactionRuntimeNode,
  run: RunRecord,
  intent: WriteIntentRecord,
  arm: WriteResolutionArm = "recovery-probe",
): unknown {
  try {
    const commitInput = rebuildCommitInputWithoutFence(repositories, descriptor, node, run);
    const policy = node.commit.uses.writeSafety.idempotency;
    const deriveKey = (rule: typeof policy.key) =>
      IdempotencyKeySchema.parse(Reflect.apply(rule, undefined, [commitInput]));
    const currentKey = deriveKey(policy.key);
    if (intent.status === "parked" && arm !== "recheck" && policy.retiredKeys?.length) {
      if (policy.retiredKeys.some(rule => matchesFencedKey(deriveKey(rule.key), node, intent))) {
        throw new UnprovedRetiredTargetError();
      }
      if (run.lifecycle.state === "parked-write" && !matchesRunConfirmation(run, node, intent)) {
        throw new WriteCommitInputRebuildError("key-drift", "parked-confirmation-binding-moved");
      }
    }
    if (!matchesFencedKey(currentKey, node, intent)) {
      throw new WriteCommitInputRebuildError("key-drift", "permanent-key-binding-moved");
    }
    return commitInput;
  } catch (error) {
    if (error instanceof WriteCommitInputRebuildError) throw error;
    throw new WriteCommitInputRebuildError(
      "schema-failure",
      "commit-input-rebuild-failed",
      error,
    );
  }
}

function rebuildCommitInputWithoutFence(
  repositories: WriteBindingRepositories,
  descriptor: AnyWorkflowDescriptor,
  node: TransactionRuntimeNode,
  run: RunRecord,
): unknown {
  const input = JsonValueSchema.parse(descriptor.canonicalInput.parse(run.input.parsed.value));
  const nodesById = new Map(descriptorRuntimeNodes(descriptor).map(candidate => [String(candidate.id), candidate]));

  function conditionHolds(when: NodeCondition): boolean {
    const source = nodeConditionDependency(when);
    const value = source === undefined ? undefined : dependencyOutput(source, true);
    return evaluateNodeCondition(when, {
      input, outputs: source !== undefined && value !== undefined ? { [source]: value } : {},
      references: runWorkbookReferenceTypeIds(run.input.workbookReferences),
    });
  }

  function dependencyOutput(id: string, conditionSource: boolean): JsonValue | undefined {
    const dependency = nodesById.get(id);
    if (dependency === undefined) throw new Error(`transaction "${node.id}" depends on unknown node "${id}"`);
    if (dependency.kind === "task") {
      const checkpoint = conditionSource ? originalCheckpoint(repositories, run, id, run.claimGeneration)
        : readRunCheckpoint(repositories, run.envelope, id, true);
      if (checkpoint === undefined) {
        if (conditionSource && dependency.when !== undefined && !conditionHolds(dependency.when)) return undefined;
        throw new WriteCommitInputRebuildError("missing-evidence", `task-checkpoint:${id}`);
      }
      if (!conditionSource) return JsonValueSchema.parse(checkpoint.output.value);
      const loaded = loadCheckpoint(checkpoint, {
        descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
        implFingerprint: taskImplFingerprint(dependency.uses), outputSchemaHash: deriveSchemaHash(dependency.uses.output, "output"),
      }, dependency.uses.output);
      if (!loaded.found) throw new WriteCommitInputRebuildError("schema-failure", `condition-checkpoint:${id}:${loaded.reason}`);
      return JsonValueSchema.parse(loaded.output);
    }
    if (dependency.kind === "gate") {
      const originalGraph = sameContractAndBuild(descriptor, run);
      const stored = originalGraph && run.envelope.continuation !== undefined
        ? readContinuationGate(repositories, run.envelope, id)
        : repositories.gateResults.get(`${run.envelope.runId}:${id}`);
      if (stored !== undefined) {
        if (conditionSource && (stored.nodeId !== dependency.id || stored.result.schemaHash !== deriveSchemaHash(dependency.result, "output"))) {
          throw new WriteCommitInputRebuildError("schema-failure", `condition-gate:${id}`);
        }
        return JsonValueSchema.parse(dependency.result.parse(stored.result.value));
      }
      // Only the original declaration can prove that this run never owed a gate result.
      if (dependency.resolvedBy === "operator" && dependency.when !== undefined && originalGraph
        && !conditionHolds(dependency.when)) return undefined;
      throw new WriteCommitInputRebuildError("missing-evidence", `gate-result:${id}`);
    }
    throw new WriteCommitInputRebuildError("missing-evidence", `unsupported-dependency:${dependency.kind}:${id}`);
  }

  const outputs: Record<string, JsonValue> = {};
  for (const dependency of node.dependsOn) {
    const value = dependencyOutput(String(dependency), false);
    if (value !== undefined) outputs[String(dependency)] = value;
  }
  const scope: RuntimeScope = { input, outputs: Object.freeze(outputs), protectedInputBindings: retainedRunProtectedBindings(run) };
  const commitContract = node.commit.uses;
  return commitContract.input.parse(node.commit.bind(scope));
}

/* ── the evaluation ──────────────────────────────────────────────────────── */

function held(check: WriteBindingCheck, detail: string): WriteBindingCheckResult {
  return WriteBindingCheckResultSchema.parse({ check, state: "held", detail });
}

function moved(
  check: WriteBindingCheck,
  detail: string,
  rederiveFailure?: WriteCommitInputRebuildFailure,
): WriteBindingCheckResult {
  return WriteBindingCheckResultSchema.parse({
    check,
    state: "moved",
    detail,
    ...(rederiveFailure === undefined ? {} : { rederiveFailure }),
  });
}

function skipped(check: WriteBindingCheck, because: WriteBindingCheck): WriteBindingCheckResult {
  return WriteBindingCheckResultSchema.parse({
    check,
    state: "not-evaluated",
    detail: `not evaluated: it needs ${because}, which moved`,
  });
}

const SHORT = 12;
function short(fingerprint: string): string {
  return `${fingerprint.slice(0, SHORT)}…`;
}


export function renderWriteBindingChecks(checks: readonly WriteBindingCheckResult[]): string {
  const label = (result: WriteBindingCheckResult) =>
    result.state === "held" ? "[held] " : result.state === "moved" ? "[MOVED]" : "[skip] ";
  return checks.map((result) => `  ${label(result)} ${result.check} — ${result.detail}`).join("\n");
}

export function evaluateWriteResolutionBinding(input: WriteResolutionBindingInput): WriteResolutionBinding {
  const { arm, descriptor, run, intent } = input;
  const stored = run.envelope.contractFingerprint;
  const current = descriptor.contractFingerprint;
  // Equal contracts prove equal code only under the same build; otherwise every identity check runs.
  const sameBuild = sameContractAndBuild(descriptor, run);
  const checks: WriteBindingCheckResult[] = [];

  checks.push(descriptor.id === run.envelope.workflow
    ? held("workflow-identity", `both name workflow ${descriptor.id}`)
    : moved("workflow-identity", `the run is a ${run.envelope.workflow} run and this descriptor is ${descriptor.id}`));

  checks.push(descriptor.version === run.envelope.descriptorVersion
    ? held("descriptor-version", `both are v${String(descriptor.version)}`)
    : moved(
      "descriptor-version",
      `the run was planned under v${String(run.envelope.descriptorVersion)} and this build declares `
      + `v${String(descriptor.version)}; a version bump declares that semantics moved`,
    ));

  const identityHeld = checks.every((result) => result.state === "held");
  const node = identityHeld ? lookupTransactionNode(descriptor, intent, run) : undefined;

  if (!identityHeld) {
    for (const check of ["transaction-node", "canonical-input", "permanent-key-identity", "binding-proof-identity"] as const) {
      checks.push(skipped(check, checks[0]?.state === "moved" ? "workflow-identity" : "descriptor-version"));
    }
    return refuse(arm, stored, current, checks);
  }
  if (node === undefined) {
    checks.push(moved(
      "transaction-node",
      `no transaction node in this build matches the intent's retained target for ${intent.taskId}`,
    ));
    for (const check of ["canonical-input", "permanent-key-identity", "binding-proof-identity"] as const) {
      checks.push(skipped(check, "transaction-node"));
    }
    return refuse(arm, stored, current, checks);
  }
  checks.push(held("transaction-node", `node "${node.id}" still commits ${intent.taskId}`));

  const hasRetiredKeys = (node.commit.uses.writeSafety.idempotency.retiredKeys?.length ?? 0) > 0;
  if (sameBuild && !(intent.status === "parked" && hasRetiredKeys)) {
    for (const check of ["canonical-input", "permanent-key-identity", "binding-proof-identity"] as const) {
      checks.push(held(check, `same contract and same build (${short(run.envelope.buildId)}); nothing could have moved`));
    }
    return Object.freeze({ state: "identical", arm, contractFingerprint: current, checks: Object.freeze(checks), node });
  }

  const currentInputHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  if (currentInputHash !== run.input.parsed.schemaHash) {
    checks.push(moved(
      "canonical-input",
      `the run's input snapshot is bound to canonical schema ${short(run.input.parsed.schemaHash)} and this build `
      + `parses ${short(currentInputHash)}; the stored input would have to be migrated first`,
    ));
    for (const check of ["permanent-key-identity", "binding-proof-identity"] as const) {
      checks.push(skipped(check, "canonical-input"));
    }
    return refuse(arm, stored, current, checks);
  }
  checks.push(held("canonical-input", `both bind canonical schema ${short(currentInputHash)}`));

  try {
    rebuildCommitInput(input.repositories, descriptor, node, run, intent, arm);
  } catch (error) {
    const keyFailure = error instanceof WriteCommitInputRebuildError
      ? error.failure
      : WriteCommitInputRebuildFailureSchema.parse({
        category: "schema-failure",
        evidenceDigest: sha256Hex("commit-input-rebuild-failed"),
      });
    const keyReference = idempotencyKeyDigestReference(intent.idempotencyKeyDigest, hasProtectedTransactionInput(run));
    checks.push(moved(
      "permanent-key-identity",
      error instanceof UnprovedRetiredTargetError
        ? `the fenced ${intent.system} ${keyReference} matches a retired rule. The retired key cannot prove the complete original target.`
          + " The intent stays parked for review."
        : `this build cannot re-derive intent ${intent.writeIntentId}'s fenced ${intent.system} ${keyReference} from the exact durable input; `
          + `${keyFailure.category} (evidence ${keyFailure.evidenceDigest.slice(0, 12)}…)`,
      keyFailure,
    ));
    checks.push(skipped("binding-proof-identity", "permanent-key-identity"));
    return refuse(arm, stored, current, checks);
  }
  checks.push(held(
    "permanent-key-identity",
    `this build re-derives the exact fenced ${intent.system} `
    + `${idempotencyKeyDigestReference(intent.idempotencyKeyDigest, hasProtectedTransactionInput(run))} from the run's durable input — the write still names the `
    + "same external transaction",
  ));

  if (!("bindingProof" in intent)) {
    checks.push(moved(
      "binding-proof-identity",
      `intent ${intent.writeIntentId} is ${intent.status} and retains no binding proof; only a fenced attempt resolves`,
    ));
    return refuse(arm, stored, current, checks);
  }
  const proof = intent.bindingProof;
  if (proof.taskId !== intent.taskId || proof.runId !== intent.runId) {
    checks.push(moved(
      "binding-proof-identity",
      `the retained binding proof is bound to task ${proof.taskId} on run ${proof.runId}, but the intent is `
      + `task ${intent.taskId} on run ${intent.runId}`,
    ));
    return refuse(arm, stored, current, checks);
  }
  checks.push(held(
    "binding-proof-identity",
    `the retained ${proof.kind} proof still parses and stays bound to ${intent.taskId} on run ${intent.runId}`,
  ));

  if (sameBuild) {
    return Object.freeze({ state: "identical", arm, contractFingerprint: current, checks: Object.freeze(checks), node });
  }
  return Object.freeze({
    state: "compatible",
    arm,
    storedContractFingerprint: stored,
    currentContractFingerprint: current,
    checks: Object.freeze(checks),
    node,
  });
}

function refuse(
  arm: WriteResolutionArm,
  stored: string,
  current: string,
  checks: readonly WriteBindingCheckResult[],
): WriteResolutionBinding {
  const first = checks.find((result) => result.state === "moved");
  if (first === undefined) throw new Error("a write-resolution refusal must name the check that moved");
  return Object.freeze({
    state: "incompatible",
    arm,
    storedContractFingerprint: stored,
    currentContractFingerprint: current,
    checks: Object.freeze([...checks]),
    moved: first.check,
    message: `refusing ${arm}: ${first.check} moved.\n`
      + `the run was planned under contract closure ${short(stored)} and this build is ${short(current)}, `
      + "so the closure hash alone proves nothing; each named check below was re-verified directly.\n"
      + `${renderWriteBindingChecks(checks)}\n`
      + `restore ${first.check} or re-plan the run — a parked real HR write is never resolved against a `
      + "target this build cannot prove is the same one",
  });
}


export function requireWriteResolutionBinding(
  input: WriteResolutionBindingInput,
): Readonly<{ node: TransactionRuntimeNode; binding: WriteResolutionBinding }> {
  const binding = evaluateWriteResolutionBinding(input);
  if (binding.state === "incompatible") throw new Error(binding.message);
  return Object.freeze({ node: binding.node, binding });
}
