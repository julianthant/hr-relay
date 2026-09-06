import { readRunCheckpoint } from "./run-checkpoint-reader.js";
import { repeatOccurrenceKey } from "../domain/run/rerun.js";
/**
 * D136 — what a parked write's resolvability actually binds to (ref write-safety §4.1).
 *
 * A parked write is the one state in this system deliberately designed to
 * survive ACROSS time and code change: it waits for a human to go look in the
 * target system, and humans are slow. Binding its resolvability to
 * `descriptor.contractFingerprint` — a hash of the descriptor's WHOLE source
 * closure — made it expire on any unrelated edit anywhere in that closure. The
 * person-lookup/Kuali closures span ~31 files, and one edit to
 * `src/domain/ids.ts` stranded a real parked Kuali intent permanently
 * (ref write-safety, "The parked intent from the failed attempt, and a drift finding").
 *
 * The fingerprint binding is not wrong, it is just the wrong GRAIN. Byte
 * identity of the closure is a *sufficient* proof that nothing semantic moved;
 * it is nowhere near necessary. This module states the necessary condition
 * directly: the exact semantic surface a resolution consumes, checked one named
 * check at a time.
 *
 * **May change** — anything in the closure that leaves all of the checks below
 * held: an unrelated module in the same import graph, comments, formatting, a
 * sibling workflow, a sibling node, an impl detail of a read task.
 *
 * **May not change** — the workflow id; the descriptor version (a bump is the
 * author's explicit statement that semantics moved, and is never re-derived
 * away here); the transaction node that commits this task; the canonical-input
 * schema the run's stored snapshot is bound to; the permanent key the current
 * build re-derives from the exact durable input (a different key names a
 * DIFFERENT external transaction — the single most dangerous drift there is);
 * and the retained binding proof's task/run identity.
 *
 * The completion PROOF rules are checked where the proof actually arrives —
 * `resolvePresent` compares the operator's attested `proof.schemaHash` against
 * the current `completion.proofSchema`, and recovery re-parses a present probe
 * through the current parsers and parks `present-proof-invalid` on failure.
 * Both are already loud; this module deliberately does not duplicate them.
 *
 * There is no waiver, no override flag, and no "force" arm. When a check moves
 * the refusal is final and names exactly what moved, because the honest repair
 * is to restore the semantics or re-plan the run — not to resolve a parked real
 * HR write against a target we can no longer prove is the same one.
 */
import { z } from "zod";
import { descriptorRuntimeNodes, type AnyWorkflowDescriptor } from "../base/workflow.js";
import { JsonValueSchema } from "../domain/canonical-json.js";
import type { JsonValue } from "../domain/canonical-json.js";
import { deriveSchemaHash } from "../domain/schema-bound-value.js";
import { idempotencyKeyDigestReference } from "../domain/redaction.js";
import { sha256Hex } from "../domain/sha256.js";
import { FingerprintSchema } from "../domain/ids.js";
import {
  deriveIdempotencyKeyDigest,
  IdempotencyKeySchema,
  type WriteIntentRecord,
} from "../domain/write-safety.js";
import type { RunRecord } from "../domain/run/record.js";
import type { RuntimeFlowNode, RuntimeScope } from "../domain/workflow/graph.js";
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";

export type TransactionRuntimeNode = Extract<RuntimeFlowNode, { kind: "transaction" }>;

/** The durable-state readers a binding evaluation needs; nothing writes here. */
export type WriteBindingRepositories = Pick<AuthorityRepositories, "runCheckpoints" | "gateResults">;

/**
 * Which ref write-safety arm is asking. The arm never relaxes a check — it only labels
 * the refusal, so an operator reading a rejected `resolve-write-absent` knows
 * which action was refused.
 */
export const WriteResolutionArmSchema = z.enum([
  "recovery-probe",
  "operator-confirmed-present",
  "operator-confirmed-absent",
]);
export type WriteResolutionArm = z.infer<typeof WriteResolutionArmSchema>;

/**
 * The named semantic checks, in evaluation order. Adding one is a contract
 * change (ref write-safety §4.1 owns the list); removing one weakens a real write guard.
 */
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
  /**
   * `held` — proved equivalent. `moved` — proved different (a refusal).
   * `not-evaluated` — a prerequisite check moved, so this one could not run;
   * it is NEVER reported as held, because "we could not look" and "we looked
   * and it matched" must stay distinguishable.
   */
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

export function findTransactionNodeByCommit(
  descriptor: AnyWorkflowDescriptor,
  commitTaskId: string,
): TransactionRuntimeNode {
  const node = lookupTransactionNode(descriptor, commitTaskId);
  if (node === undefined) {
    throw new Error(
      `${descriptor.id} v${String(descriptor.version)} declares no transaction node whose commit is `
      + `${commitTaskId}; the stored intent is inconsistent with the descriptor`,
    );
  }
  return node;
}

function lookupTransactionNode(
  descriptor: AnyWorkflowDescriptor,
  commitTaskId: string,
  nodeId?: string,
): TransactionRuntimeNode | undefined {
  return descriptorRuntimeNodes(descriptor).find((candidate): candidate is TransactionRuntimeNode =>
    candidate.kind === "transaction" && candidate.commit.uses.id === commitTaskId
      && (nodeId === undefined || candidate.id === nodeId));
}

/**
 * Rebuild the transaction node's exact commit input from DURABLE state: the
 * run's canonical input snapshot plus the node's declared dependency outputs
 * (task checkpoints and stored gate results). The rebuilt input must re-derive
 * the EXACT fenced idempotency key — any drift refuses loudly.
 */
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
      error instanceof Error ? `${error.name}:${error.message}` : `non-error:${String(error)}`,
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
      error instanceof Error ? `${error.name}:${error.message}` : `non-error:${String(error)}`,
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
      `derived:${digest};fenced:${intent.idempotencyKeyDigest}`,
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
  const scope: RuntimeScope = { input: JsonValueSchema.parse(canonicalInput), outputs: Object.freeze(outputs) };
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

/**
 * Render the whole check table, held rows included. An operator staring at a
 * refused resolution needs to see what was PROVED equivalent as much as what
 * moved — that is the difference between "the code drifted, here is the one
 * thing that matters" and "computer says no".
 */
export function renderWriteBindingChecks(checks: readonly WriteBindingCheckResult[]): string {
  const label = (result: WriteBindingCheckResult) =>
    result.state === "held" ? "[held] " : result.state === "moved" ? "[MOVED]" : "[skip] ";
  return checks.map((result) => `  ${label(result)} ${result.check} — ${result.detail}`).join("\n");
}

export function evaluateWriteResolutionBinding(input: WriteResolutionBindingInput): WriteResolutionBinding {
  const { arm, descriptor, run, intent } = input;
  const stored = run.envelope.contractFingerprint;
  const current = descriptor.contractFingerprint;
  const closureIdentical = stored === current;
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

  if (closureIdentical) {
    // Byte identity of the whole closure IS the proof; re-deriving the key
    // would only add failure modes (a pruned dependency checkpoint) to the
    // ordinary path, so the remaining checks are not run and say so.
    for (const check of ["canonical-input", "permanent-key-identity", "binding-proof-identity"] as const) {
      checks.push(held(check, `the contract closure is byte-identical (${short(current)}); nothing could have moved`));
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
        evidenceDigest: sha256Hex(error instanceof Error ? `${error.name}:${error.message}` : `non-error:${String(error)}`),
      });
  }
  if (keyFailure !== undefined) {
    checks.push(moved(
      "permanent-key-identity",
      `this build cannot re-derive intent ${intent.writeIntentId}'s fenced ${intent.system} `
      + `${idempotencyKeyDigestReference(intent.idempotencyKeyDigest)} from the exact durable input; `
      + `${keyFailure.category} (evidence ${keyFailure.evidenceDigest.slice(0, 12)}…)`,
      keyFailure,
    ));
    checks.push(skipped("binding-proof-identity", "permanent-key-identity"));
    return refuse(arm, stored, current, checks);
  }
  checks.push(held(
    "permanent-key-identity",
    `this build re-derives the exact fenced ${intent.system} `
    + `${idempotencyKeyDigestReference(intent.idempotencyKeyDigest)} from the run's durable input — the write still names the `
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

/**
 * The call-site form: return the transaction node when the binding holds, and
 * throw the full, legible check table when it does not.
 */
export function requireWriteResolutionBinding(
  input: WriteResolutionBindingInput,
): Readonly<{ node: TransactionRuntimeNode; binding: WriteResolutionBinding }> {
  const binding = evaluateWriteResolutionBinding(input);
  if (binding.state === "incompatible") throw new Error(binding.message);
  return Object.freeze({ node: binding.node, binding });
}
