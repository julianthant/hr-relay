import { readContinuationGate, readRunCheckpoint, retainedCheckpoint, validateRunContinuation } from "../../storage/sqlite/run-continuation.js";
import { checkpointRecordKey, type RunCheckpointRecord } from "../../../models/workflow/checkpoint.js";
import type { EvidenceSchemaReader } from "../../../models/storage/evidence-schema-admission.js";
import { retainedRunProtectedBindings, hasProtectedTransactionInput } from "../../../models/write-safety/protected-input.js";
import { repeatOccurrenceKey } from "../../../models/run/rerun.js";
// Resolve only the same workflow, node, schemas, permanent key and binding proof; whole-closure identity is sufficient, not necessary.
import { z } from "zod";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../../rules/validation/canonical-json.js";
import type { JsonValue } from "../../../rules/validation/canonical-json.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { idempotencyKeyDigestReference } from "../../../rules/redaction/redaction.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { BrowserSystemIdSchema, FingerprintSchema } from "../../../rules/identity/ids.js";
import {
  deriveIdempotencyKeyDigest,
  IdempotencyKeySchema,
  type WriteIntentRecord,
} from "../../../rules/write-safety/write-safety.js";
import type { RunRecord } from "../../../models/run/record.js";
import { projectTransactionOutcome, type RuntimeFlowNode, type RuntimeScope } from "../../../models/workflow/graph.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";
import { currentBuildId } from "../build-id.js";

export type TransactionRuntimeNode = Extract<RuntimeFlowNode, { kind: "transaction" }>;

/** The durable-state readers a binding evaluation needs; nothing writes here. */
export type WriteBindingRepositories = Pick<AuthorityRepositories, "runCheckpoints" | "gateResults">;


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
  commitTaskId: string,
  nodeId?: string,
): TransactionRuntimeNode | undefined {
  return descriptorRuntimeNodes(descriptor).find((candidate): candidate is TransactionRuntimeNode =>
    candidate.kind === "transaction" && candidate.commit.uses.id === commitTaskId
      && (nodeId === undefined || candidate.id === nodeId));
}

// Rebuild commit input from durable input and dependency outputs; its permanent key must match the fenced intent.
export function rebuildCommitInput(
  repositories: WriteBindingRepositories,
  descriptor: AnyWorkflowDescriptor,
  node: TransactionRuntimeNode,
  run: RunRecord,
  intent: WriteIntentRecord,
): unknown {
  let commitInput: unknown;
  try {
    commitInput = rebuildCommitInputWithoutFence(repositories, descriptor, node, run);
  } catch (error) {
    if (error instanceof WriteCommitInputRebuildError) throw error;
    throw new WriteCommitInputRebuildError(
      "schema-failure",
      "commit-input-rebuild-failed",
      error,
    );
  }
  const commitContract = node.commit.uses;
  let key: string;
  try {
    const keyRaw: unknown = Reflect.apply(commitContract.writeSafety.idempotency.key, undefined, [commitInput]);
    key = IdempotencyKeySchema.parse(keyRaw);
  } catch (error) {
    throw new WriteCommitInputRebuildError(
      "schema-failure",
      "commit-input-rebuild-failed",
      error,
    );
  }
  const digest = deriveIdempotencyKeyDigest(intent.system, key);
  const occurrence = intent.status === "observed-present" ? undefined : intent.occurrence;
  if (occurrence === undefined ? key !== intent.idempotencyKey || digest !== intent.idempotencyKeyDigest
    : digest !== occurrence.businessKeyDigest || occurrence.nodeId !== node.id
      || occurrence.taskId !== intent.taskId || occurrence.system !== intent.system
      || intent.idempotencyKey !== repeatOccurrenceKey(digest, occurrence.confirmationCommandId, occurrence.nodeId)
      || intent.idempotencyKeyDigest !== deriveIdempotencyKeyDigest(intent.system, intent.idempotencyKey)) {
    throw new WriteCommitInputRebuildError(
      "key-drift",
      "permanent-key-binding-moved",
    );
  }
  return commitInput;
}

function rebuildCommitInputWithoutFence(
  repositories: WriteBindingRepositories,
  descriptor: AnyWorkflowDescriptor,
  node: TransactionRuntimeNode,
  run: RunRecord,
): unknown {
  const canonicalInput = descriptor.canonicalInput.parse(run.input.parsed.value);
  const outputs: Record<string, JsonValue> = {};
  const nodesById = new Map(descriptorRuntimeNodes(descriptor).map((candidate) => [String(candidate.id), candidate]));
  for (const dependency of node.dependsOn) {
    const dependencyNode = nodesById.get(String(dependency));
    if (dependencyNode === undefined) {
      throw new Error(`transaction "${node.id}" depends on unknown node "${dependency}"`);
    }
    if (dependencyNode.kind === "task") {
      const checkpoint = readRunCheckpoint(repositories, run.envelope, String(dependency), true);
      if (checkpoint === undefined) {
        throw new WriteCommitInputRebuildError(
          "missing-evidence",
          `task-checkpoint:${String(dependency)}`,
        );
      }
      outputs[String(dependency)] = JsonValueSchema.parse(checkpoint.output.value);
      continue;
    }
    if (dependencyNode.kind === "gate") {
      const stored = repositories.gateResults.get(`${run.envelope.runId}:${String(dependency)}`);
      if (stored === undefined) {
        throw new WriteCommitInputRebuildError(
          "missing-evidence",
          `gate-result:${String(dependency)}`,
        );
      }
      outputs[String(dependency)] = JsonValueSchema.parse(dependencyNode.result.parse(stored.result.value));
      continue;
    }
    throw new WriteCommitInputRebuildError(
      "missing-evidence",
      `unsupported-dependency:${dependencyNode.kind}:${String(dependency)}`,
    );
  }
  return bindCommitInput(node, run, JsonValueSchema.parse(canonicalInput), outputs);
}

function bindCommitInput(node: TransactionRuntimeNode, run: RunRecord, input: JsonValue, outputs: Record<string, JsonValue>): unknown {
  const scope: RuntimeScope = { input, outputs: Object.freeze(outputs), protectedInputBindings: retainedRunProtectedBindings(run) };
  return node.commit.uses.input.parse(node.commit.bind(scope));
}

type CheckpointReconstructionRepositories = WriteBindingRepositories
  & { readonly runs: Pick<AuthorityRepositories["runs"], "get">; readonly lifecycleJournal: Pick<AuthorityRepositories["lifecycleJournal"], "findContinuationIssue"> };

/** The commit input a transaction checkpoint settled, rebuilt only from its producer's retained facts up to that checkpoint. */
export function rebuildCheckpointCommitInput(
  repositories: CheckpointReconstructionRepositories,
  descriptor: AnyWorkflowDescriptor,
  node: TransactionRuntimeNode,
  producer: RunRecord,
  checkpoint: RunCheckpointRecord,
  schemaReader?: EvidenceSchemaReader,
): unknown {
  const { envelope } = producer;
  if (checkpoint.runId !== envelope.runId || checkpoint.workflowId !== envelope.workflow || checkpoint.itemId !== envelope.itemId
    || checkpoint.attempt !== envelope.attempt || checkpoint.nodeId !== String(node.id)) {
    throw new WriteCommitInputRebuildError("missing-evidence", "checkpoint-producer-mismatch");
  }
  const inputHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  if ((schemaReader?.({ kind: "run-input", id: envelope.runId }, producer.input, producer.input.parsed.schemaHash, inputHash) ?? producer.input.parsed.schemaHash) !== inputHash) {
    throw new WriteCommitInputRebuildError("schema-failure", "run-input");
  }
  const canonicalInput = JsonValueSchema.parse(descriptor.canonicalInput.parse(producer.input.parsed.value));
  const nodesById = new Map(descriptorRuntimeNodes(descriptor).map((candidate) => [String(candidate.id), candidate]));
  const admitted = (owner: Parameters<EvidenceSchemaReader>[0], source: unknown, stored: string, schema: z.ZodType) => {
    const current = deriveSchemaHash(schema, "output");
    if ((schemaReader?.(owner, source, stored, current) ?? stored) !== current) throw new WriteCommitInputRebuildError("schema-failure", `schema:${owner.id}`);
  };
  const outputs: Record<string, JsonValue> = {};
  for (const dependency of node.dependsOn.map(String)) {
    const dependencyNode = nodesById.get(dependency);
    if (dependencyNode?.kind === "gate") {
      const gate = readContinuationGate(repositories, envelope, dependency);
      if (gate === undefined) throw new WriteCommitInputRebuildError("missing-evidence", `gate-result:${dependency}`);
      admitted({ kind: "gate-result", id: canonicalJsonStringify([gate.runId, gate.gateId]) }, gate, gate.result.schemaHash, dependencyNode.result);
      outputs[dependency] = JsonValueSchema.parse(dependencyNode.result.parse(gate.result.value));
      continue;
    }
    if (dependencyNode?.kind !== "task" && dependencyNode?.kind !== "transaction") {
      throw new WriteCommitInputRebuildError("missing-evidence", `unsupported-dependency:${dependencyNode?.kind ?? "unknown"}:${dependency}`);
    }
    // Only the producer's rows written up to this checkpoint's claim, else its authenticated continuation reference.
    const own = repositories.runCheckpoints.listByAttempt(envelope.workflow, envelope.itemId, dependency, checkpoint.attempt)
      .filter(row => row.runId === envelope.runId && row.claimGeneration <= checkpoint.claimGeneration && row.writtenAt <= checkpoint.writtenAt)
      .sort((a, b) => a.claimGeneration - b.claimGeneration).at(-1);
    let row = own;
    if (row === undefined && envelope.continuation !== undefined) {
      validateRunContinuation(repositories, envelope);
      const reference = envelope.continuation.checkpoints.find(candidate => candidate.nodeId === dependency);
      if (reference !== undefined) row = retainedCheckpoint(repositories, envelope, reference);
    }
    if (row === undefined) throw new WriteCommitInputRebuildError("missing-evidence", `task-checkpoint:${dependency}`);
    if (dependencyNode.kind === "transaction") {
      outputs[dependency] = JsonValueSchema.parse(projectTransactionOutcome(dependencyNode.commit.uses, row.output.value, "Receipt write reconstruction",
        { checkpoint: row, ...(schemaReader === undefined ? {} : { schemaReader }) }));
      continue;
    }
    admitted({ kind: "task-output", id: checkpointRecordKey(row) }, row, row.output.schemaHash, dependencyNode.uses.output);
    dependencyNode.uses.output.parse(row.output.value);
    outputs[dependency] = JsonValueSchema.parse(row.output.value);
  }
  return bindCommitInput(node, producer, canonicalInput, outputs);
}

/** The exact permanent system and key a run settles a commit input under, including its acknowledged repeat occurrence. */
export function commitPermanentKey(node: TransactionRuntimeNode, commitInput: unknown, run: RunRecord): Readonly<{ system: string; key: string }> {
  const contract = node.commit.uses;
  const system = BrowserSystemIdSchema.parse(contract.id.slice(0, contract.id.lastIndexOf("/")));
  const naturalKey = IdempotencyKeySchema.parse(Reflect.apply(contract.writeSafety.idempotency.key, undefined, [commitInput]));
  const businessKeyDigest = deriveIdempotencyKeyDigest(system, naturalKey);
  const bound = run.envelope.sourceBound;
  const repeat = bound?.warnings.some((warning) => warning.nodeId === node.id && warning.taskId === contract.id
    && warning.system === system && warning.businessKeyDigest === businessKeyDigest) === true;
  return { system, key: bound !== undefined && repeat ? IdempotencyKeySchema.parse(repeatOccurrenceKey(businessKeyDigest, bound.confirmationCommandId, String(node.id))) : naturalKey };
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
  const sameBuild = stored === current && run.envelope.buildId === currentBuildId();
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
  const node = identityHeld ? lookupTransactionNode(descriptor, intent.taskId, intent.status === "observed-present" ? undefined : intent.occurrence?.nodeId) : undefined;

  if (!identityHeld) {
    for (const check of ["transaction-node", "canonical-input", "permanent-key-identity", "binding-proof-identity"] as const) {
      checks.push(skipped(check, checks[0]?.state === "moved" ? "workflow-identity" : "descriptor-version"));
    }
    return refuse(arm, stored, current, checks);
  }
  if (node === undefined) {
    checks.push(moved(
      "transaction-node",
      `this build declares no transaction node whose commit is ${intent.taskId}; the intent's target left the graph`,
    ));
    for (const check of ["canonical-input", "permanent-key-identity", "binding-proof-identity"] as const) {
      checks.push(skipped(check, "transaction-node"));
    }
    return refuse(arm, stored, current, checks);
  }
  checks.push(held("transaction-node", `node "${node.id}" still commits ${intent.taskId}`));

  if (sameBuild) {
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

  let keyFailure: WriteCommitInputRebuildFailure | undefined;
  try {
    rebuildCommitInput(input.repositories, descriptor, node, run, intent);
  } catch (error) {
    keyFailure = error instanceof WriteCommitInputRebuildError
      ? error.failure
      : WriteCommitInputRebuildFailureSchema.parse({
        category: "schema-failure",
        evidenceDigest: sha256Hex("commit-input-rebuild-failed"),
      });
  }
  if (keyFailure !== undefined) {
    checks.push(moved(
      "permanent-key-identity",
      `this build cannot re-derive intent ${intent.writeIntentId}'s fenced ${intent.system} `
      + `${idempotencyKeyDigestReference(intent.idempotencyKeyDigest, hasProtectedTransactionInput(run))} from the exact durable input; `
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
