/**
 * The Phase-1f fenced write sequencer — ref write-safety §3's seven-beat kernel write
 * sequence (D111), the D117 transaction-node semantics of ref workflow-model §3.1, and the
 * inline half of D118 recovery.
 *
 * One `executeTransaction` call owns the whole spine for one transaction node:
 *
 *   ① resolve + probe   — durable permanent-key lookup first, then the
 *                         policy-controlled live probe on a separate read lease
 *   ② prepare           — the exclusive transaction lease; prepare output is
 *                         preview data only and never feeds the commit input
 *   ③ binding proof     — kernel-owned fresh subject observation on the exact
 *                         staged page; no task callback can skip it
 *   ④ fence             — probe→fence budget + CAS of the permanent key to
 *                         `attempting`, durable BEFORE any click
 *   ⑤ external commit   — the commit impl runs with the unforgeable
 *                         `MutationCapability` this module alone can mint
 *   ⑥ capture / verify  — every completion arm parses through its proofSchema
 *   ⑦ atomic commit     — `executeSequencedWriteCommit`: the Phase-1c four-row
 *                         primitive, the `TransactionOutcome` checkpoint, and
 *                         the run transition in ONE outer authority transaction
 *
 * Fail-closed exits: an indeterminate pre-fence state refuses loudly (no fence,
 * no click); an indeterminate post-fence state durably parks the intent and the
 * run (`parked-write`) and raises `WriteParkedError`. Dry-run is a structurally
 * separate arm (`executeDryRun`) that stages and observes but can create no
 * intent, fence, or commit.
 */
import { z } from "zod";
import { TaskError } from "../base/errors.js";
import type { AnyTask, BrowserDriver, TaskLogger } from "../base/task.js";
import type { TaskStoreRegistry } from "../base/store.js";
import type { AnyWorkflowDescriptor } from "../base/workflow.js";
import { canonicalJsonStringify, JsonValueSchema } from "../domain/canonical-json.js";
import type { JsonValue } from "../domain/canonical-json.js";
import type { Clock } from "../domain/clock.js";
import type {
  AnyCommitTaskContract,
  AnyPrepareTaskContract,
  SubjectBindingSpec,
} from "../domain/contracts/base.js";
import type { IdFactory } from "../domain/identifiers.js";
import {
  ActorIdSchema,
  BrowserSystemIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  LeaseIdSchema,
  NodeIdSchema,
  OutboxIdSchema,
  PageStateIdSchema,
  TraceIdSchema,
  WriteAttemptIdSchema,
  WriteBindingProofIdSchema,
  WriteIntentIdSchema,
} from "../domain/ids.js";
import type { ActorId, BrowserSystemId, Fingerprint, TaskId } from "../domain/ids.js";
import { runClaim, RunRecordSchema, type RunRecord } from "../domain/run/record.js";
import { deriveSchemaHash } from "../domain/schema-bound-value.js";
import { sha256Hex } from "../domain/sha256.js";
import { idempotencyKeyDigestReference } from "../domain/redaction.js";
import {
  DataPointSchema,
  RecordedDataPointSchema,
} from "../domain/task-provenance.js";
import type { DataPoint, RecordedDataPoint } from "../domain/task-provenance.js";
import { assertMintedMutationCapability, mintMutationCapability } from "../base/mutation-capability.js";
import {
  BUILD_MANIFEST,
  resolveTaskImplFingerprint,
} from "../domain/workflow/build-manifest.js";
import {
  FactProvenanceSchema,
  RunCheckpointRecordSchema,
  type RunCheckpointRecord,
} from "../domain/workflow/checkpoint.js";
import type { RuntimeFlowNode } from "../domain/workflow/graph.js";
import {
  deriveIdempotencyKeyDigest,
  deriveWriteAuthorityReason,
  deriveWriteBindingProofDigest,
  IdempotencyKeySchema,
  probeVerdictSchema,
  SubjectEvidenceSchema,
  SubjectProofSchema,
  TransactionOutcomeSchema,
  UnscopedBindingProofSchema,
  WriteAttemptRecordSchema,
  WriteBindingProofSchema,
  WriteIntentRecordSchema,
  WriteSafetyAuthorityError,
  type WriteAuthorityReason,
  type WriteAuthorityReasonCode,
  type TransactionOutcome,
  type WriteBindingProof,
  type WriteIntentRecord,
} from "../domain/write-safety.js";
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";
import type { RunClaimToken } from "../infra/sqlite/run-store-contracts.js";
import {
  SequencedWriteCommitInputSchema,
  type AtomicWriteCommitReport,
  type SequencedWriteCommitStep,
  type WriteIntentParkCode,
} from "../infra/sqlite/write-commit-contracts.js";
import type { SessionNeed } from "../domain/session.js";
import type { MonotonicDeadlineScheduler } from "./deadline-scheduler.js";
import type { SpanEmitter } from "./span-emitter.js";
import { ExecutorSpanEventSchema } from "./span-emitter.js";
import { redactObservedDataPoints } from "./observed-data.js";
import { WriteParkedError } from "./run-executor.js";
import type { WriteSequencer, WriteSequencerContext } from "./run-executor.js";

/* ── the mutation capability — this module is the SOLE minting point ──────── */

/**
 * The WeakSet-backed registry moved to `src/base/mutation-capability.ts` in Phase 2, so
 * a `stores/**` driver can run the beat-⑤ verification before its click without
 * a layer inversion. THIS module remains the only permitted caller of
 * `mintMutationCapability`; `subject-before-fence` fails if any other module
 * names it. The verifier keeps its sequencer-scoped name here because that is
 * the import site every caller and test already knows.
 */
export { assertMintedMutationCapability as assertSequencerMintedMutationCapability };

/* ── typed failure surfaces ──────────────────────────────────────────────── */

// `WriteParkedError` moved to `run-executor.ts` with the `WriteSequencer` seam
// it belongs to: the sequencer raises it AFTER durably parking intent + run,
// and the interpreter's typed `parked-write` outcome arm consumes it. The
// re-export below keeps this module the natural import site for sequencer
// callers and tests.
export { WriteParkedError };

function authorityExceptionDetail(error: unknown): string {
  const lines: string[] = [];
  const append = (value: unknown, role: string, depth: number): void => {
    if (depth > 8) {
      lines.push(`${role}:depth-limit`);
      return;
    }
    if (value instanceof AggregateError) {
      lines.push(`${role}:${value.name}:${value.message}`);
      value.errors.forEach((entry, index) => append(entry, `${role}.errors[${String(index)}]`, depth + 1));
      if (value.cause !== undefined) append(value.cause, `${role}.cause`, depth + 1);
      return;
    }
    if (value instanceof Error) {
      lines.push(`${role}:${value.name}:${value.message}`);
      if (value.cause !== undefined) append(value.cause, `${role}.cause`, depth + 1);
      return;
    }
    lines.push(`${role}:non-error:${String(value)}`);
  };
  append(error, "primary", 0);
  return lines.join("\n");
}

function authorityReason(
  code: WriteAuthorityReasonCode,
  kind: WriteAuthorityReason["evidence"]["kind"],
  evidence: unknown,
): WriteAuthorityReason {
  const detail = kind === "exception"
    ? authorityExceptionDetail(evidence)
    : canonicalJsonStringify(evidence);
  return deriveWriteAuthorityReason(code, kind, detail);
}

/** The probe→fence budget elapsed: the staged page is discarded, nothing clicked. */
export class StagedPageDiscardedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StagedPageDiscardedError";
  }
}

/** Internal: the fence CAS lost — carries the winner for existing-branch routing. */
class FenceLostRaceError extends Error {
  readonly existing: WriteIntentRecord;

  constructor(existing: WriteIntentRecord) {
    super(`write fence lost the permanent-key race to intent ${existing.writeIntentId}`);
    this.name = "FenceLostRaceError";
    this.existing = existing;
  }
}

/** Internal: a post-fence failure that must durably park before resurfacing. */
class PostFenceWriteFailure extends Error {
  readonly writeIntentId: string;
  readonly generation: number;
  readonly intentVersion: number;
  readonly parkCode: WriteIntentParkCode;
  readonly authorityReason: WriteAuthorityReason;
  readonly operatorMessage: string;

  constructor(input: Readonly<{
    writeIntentId: string;
    generation: number;
    intentVersion: number;
    parkCode: WriteIntentParkCode;
    authorityReason: WriteAuthorityReason;
    message: string;
    operatorMessage?: string;
    cause?: unknown;
  }>) {
    super(input.message, input.cause === undefined ? undefined : { cause: input.cause });
    this.name = "PostFenceWriteFailure";
    this.writeIntentId = input.writeIntentId;
    this.generation = input.generation;
    this.intentVersion = input.intentVersion;
    this.parkCode = input.parkCode;
    this.authorityReason = input.authorityReason;
    this.operatorMessage = input.operatorMessage ?? input.message;
  }
}

/* ── injected seams ──────────────────────────────────────────────────────── */

/** The authority surface the sequencer needs; `AuthorityDatabase` satisfies it. */
export interface WriteSequencerAuthority {
  readonly authority: AuthorityRepositories;
  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
  commitWriteAttempt(input: unknown): AtomicWriteCommitReport;
}

/**
 * The session surface the sequencer needs; `WorkerSessionManager` satisfies it.
 *
 * D116 (ref clock-config-secrets §4): every `withDriver` lease requires the claimed run's
 * immutable `configFingerprint` to ALREADY be bound on this host — the host
 * refuses loudly otherwise. The sequencer itself never binds or releases:
 * `executeTransaction`/`executeDryRun` run inside the interpreter for a
 * claimed run, under the worker loop's `withBoundRunConfigFingerprint` window,
 * so this host must be the SAME `WorkerSessionManager` that loop binds.
 * Probe leases taken OUTSIDE a claimed run's worker-loop context (ref write-safety §4
 * recovery) bind the target run's retained fingerprint themselves — see
 * `createWriteRecoveryService`.
 */
export interface TransactionSessionHost {
  withDriver<Result>(
    need: SessionNeed,
    instance: string | undefined,
    signal: AbortSignal,
    operation: (driver: BrowserDriver) => Promise<Result>,
  ): Promise<Result>;
  withTransactionDriver<Result>(
    need: SessionNeed,
    instance: string | undefined,
    signal: AbortSignal,
    operation: (
      driver: BrowserDriver,
      ownership: Readonly<{ retainAfterFence(): void }>,
    ) => Promise<Result>,
  ): Promise<Result>;
  closeAll(reason: "parked"): Promise<void>;
}

export interface WriteSequencerHooks {
  afterSequencedStep?(step: SequencedWriteCommitStep): void;
}

export interface WriteSequencerDependencies {
  readonly stores: TaskStoreRegistry;
  readonly authority: WriteSequencerAuthority;
  readonly sessions: TransactionSessionHost;
  readonly emitter: SpanEmitter;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly scheduler: MonotonicDeadlineScheduler;
  /** Immutable per-invocation task bound (ref execution-and-sessions §5.5); no default, no opt-out. */
  readonly taskDeadlineMs: number;
  /** The acting operator identity from the config domain (ref clock-config-secrets); never fabricated. */
  readonly operator: unknown;
  readonly log: TaskLogger;
  /**
   * Task-impl fingerprint resolution for the transaction checkpoint. Defaults
   * to the checked-in build manifest; tests inject a fixed resolver for
   * synthetic contracts the manifest cannot know.
   */
  readonly resolveImplFingerprint?: (taskId: TaskId) => Fingerprint;
  readonly hooks?: WriteSequencerHooks;
}

export interface ProductionWriteSequencer extends WriteSequencer {
  executeDryRun(context: WriteSequencerContext): Promise<TransactionDryRunPreview>;
}

/* ── dry-run preview (ref workflow-model §3.1: prepare + observe, zero intent/fence) ─── */

/**
 * The schema itself lives in `src/domain/write-safety-primitives.ts` (D210):
 * the descriptor factory hashes it when a previewed run is terminalized, and a
 * descriptor closure may not reach `write-safety.ts`'s `node:crypto`. This
 * module stays its address for every existing caller.
 */
import {
  DryRunProbeObservationSchema,
  TransactionDryRunPreviewSchema,
  type TransactionDryRunPreview,
} from "../domain/write-safety-primitives.js";
export { TransactionDryRunPreviewSchema };
export type { TransactionDryRunPreview };

/* ── small helpers ───────────────────────────────────────────────────────── */

type TransactionRuntimeNode = Extract<RuntimeFlowNode, { kind: "transaction" }>;
type AttemptingIntent = Extract<WriteIntentRecord, { status: "attempting" }>;

const TRANSACTION_OUTCOME_SCHEMA_HASH = deriveSchemaHash(TransactionOutcomeSchema, "output");

function observeRaceLoser(error: unknown): void {
  void error;
}

function taskIndexOf(stores: TaskStoreRegistry): ReadonlyMap<string, AnyTask> {
  const index = new Map<string, AnyTask>();
  for (const store of stores.stores) {
    for (const task of Object.values(store.tasks)) index.set(task.contract.id, task);
  }
  return index;
}

function systemOf(taskId: string) {
  return BrowserSystemIdSchema.parse(taskId.slice(0, taskId.lastIndexOf("/")));
}

function readInputPath(value: unknown, path: string, owner: string): string {
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object" || !Object.hasOwn(current, segment)) {
      throw new Error(`${owner}: commit input has no value at subject path "${path}"`);
    }
    current = Reflect.get(current, segment);
  }
  return z.string().min(1).parse(current);
}

/**
 * Normalization per ref task-contract's match vocabulary. `eid` strips whitespace and
 * requires digits; `name` lowercases and collapses whitespace. The combined
 * `eid-and-name` match has no contract yet and refuses rather than guessing a
 * combined-value format.
 */
function normalizeSubjectIdentifier(
  identity: "eid" | "name" | "eid-and-name",
  raw: string,
  owner: string,
): string {
  if (identity === "eid") {
    const normalized = raw.replaceAll(/\s+/gu, "");
    if (!/^\d{6,10}$/.test(normalized)) {
      throw new Error(`${owner}: subject identifier does not normalize to an EID (6–10 digits)`);
    }
    return normalized;
  }
  if (identity === "name") {
    const normalized = raw.trim().toLowerCase().replaceAll(/\s+/gu, " ");
    if (normalized.length === 0) throw new Error(`${owner}: subject name is empty after normalization`);
    return normalized;
  }
  throw new Error(
    `${owner}: eid-and-name subject matching has no registered value format yet; `
    + "it lands with its first real contract rather than a guessed combination",
  );
}

function subjectBindingDigest(identifierKind: string, normalized: string): Fingerprint {
  return FingerprintSchema.parse(sha256Hex(`hrauto:subject-binding:v1\0${identifierKind}\0${normalized}`));
}

function displaySuffixOf(normalized: string): string {
  const raw = normalized.slice(-4).replaceAll(/[^A-Za-z0-9*@._-]/gu, "*");
  return raw.length >= 2 ? raw : `${raw}**`.slice(0, 2);
}

/**
 * Race an operation against an abort signal so a non-cooperative implementation
 * cannot occupy the worker; the settled loser is observed, never unhandled.
 */
async function raceAbortable<Result>(
  operation: Promise<Result>,
  signal: AbortSignal,
  label: string,
): Promise<Result> {
  operation.catch(observeRaceLoser);
  if (signal.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error(`${label} was aborted before it started`);
  }
  let removeAbort = (): void => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const listener = (): void => {
      reject(signal.reason instanceof Error ? signal.reason : new Error(`${label} was aborted`));
    };
    signal.addEventListener("abort", listener, { once: true });
    removeAbort = (): void => signal.removeEventListener("abort", listener);
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    removeAbort();
  }
}

const RunnableTaskSchema = z.custom<(args: {
  input: unknown;
  ctx: Readonly<Record<string, unknown>>;
}) => Promise<unknown>>((value) => typeof value === "function", "task implementation requires run");

/* ── bounded task invocation + the shared idempotency-probe read ─────────── */

export interface BoundedTaskDeps {
  readonly clock: Clock;
  readonly scheduler: MonotonicDeadlineScheduler;
  readonly taskDeadlineMs: number;
  readonly log: TaskLogger;
}

export interface BoundedTaskRecordBatch {
  readonly recordedAt: string;
  readonly points: readonly DataPoint[];
}

interface BoundedTaskResult {
  readonly raw: unknown;
  readonly recorded: readonly DataPoint[];
}

type BoundedTaskSettlement =
  | Readonly<{ state: "fulfilled"; result: BoundedTaskResult }>
  | Readonly<{ state: "rejected"; error: unknown }>;

interface BoundedTaskInvocation {
  /** The ordinary deadline/cancellation race used by non-fenced task lanes. */
  readonly bounded: Promise<BoundedTaskResult>;
  /** The callback itself, including a non-cooperative tail that ignores abort. */
  readonly settlement: Promise<BoundedTaskSettlement>;
}

function beginBoundedTask(
  deps: BoundedTaskDeps,
  taskId: TaskId,
  signal: AbortSignal,
  run: (
    innerSignal: AbortSignal,
    recordData: (point: DataPoint | readonly DataPoint[]) => void,
  ) => Promise<unknown>,
  onRecord?: (batch: BoundedTaskRecordBatch) => void,
): BoundedTaskInvocation {
  z.number().int().positive().parse(deps.taskDeadlineMs);
  const recorded: DataPoint[] = [];
  const recordData = (pointInput: DataPoint | readonly DataPoint[]): void => {
    const batch = Array.isArray(pointInput) ? pointInput : [pointInput];
    if (batch.length === 0) throw new Error(`task ${taskId} recordData batch cannot be empty`);
    const points = Object.freeze(batch.map((point) => DataPointSchema.parse(point)));
    recorded.push(...points);
    if (onRecord !== undefined) {
      // ONE wall-clock read per call. The sink reuses this instant for both
      // `ts` and `observedAt`; it never asks the clock again.
      const recordedAt = IsoInstantSchema.parse(deps.clock.now().toISOString());
      onRecord(Object.freeze({ recordedAt, points }));
    }
  };
  const controller = new AbortController();
  const forwardAbort = (): void => {
    controller.abort(signal.reason instanceof Error ? signal.reason : new Error(`${taskId} was aborted`));
  };
  if (signal.aborted) forwardAbort();
  signal.addEventListener("abort", forwardAbort, { once: true });
  const deadline = deps.scheduler.schedule(
    deps.clock.monotonicMs() + deps.taskDeadlineMs,
    () => {
      controller.abort(new Error(
        `${taskId} exceeded its immutable ${String(deps.taskDeadlineMs)}ms task deadline`,
      ));
    },
  );
  const operation = Promise.resolve().then(() => run(controller.signal, recordData));
  const settlement: Promise<BoundedTaskSettlement> = operation.then(
    (raw) => ({ state: "fulfilled", result: { raw, recorded } }),
    (error: unknown) => ({ state: "rejected", error }),
  );
  const bounded = (async (): Promise<BoundedTaskResult> => {
    try {
      const raw = await raceAbortable(
        operation,
        controller.signal,
        taskId,
      );
      return { raw, recorded };
    } finally {
      deadline.cancel();
      signal.removeEventListener("abort", forwardAbort);
    }
  })();
  return { bounded, settlement };
}

/** Every task invocation races a mandatory injected monotonic deadline (ref execution-and-sessions §5.5). */
export async function invokeBoundedTask(
  deps: BoundedTaskDeps,
  taskId: TaskId,
  signal: AbortSignal,
  run: (
    innerSignal: AbortSignal,
    recordData: (point: DataPoint | readonly DataPoint[]) => void,
  ) => Promise<unknown>,
  onRecord?: (batch: BoundedTaskRecordBatch) => void,
): Promise<BoundedTaskResult> {
  return await beginBoundedTask(
    deps,
    taskId,
    signal,
    run,
    onRecord,
  ).bounded;
}

function taskCtx(
  taskId: TaskId,
  signal: AbortSignal,
  recordData: (point: DataPoint | readonly DataPoint[]) => void,
  log: TaskLogger,
) {
  return {
    signal,
    log,
    fail: (code: string, message: string, options?: Readonly<{
      subject?: string; transient?: boolean; cause?: unknown;
    }>): never => {
      throw new TaskError(taskId, code, message, options);
    },
    recordData,
  } as const;
}

export interface ProbeReadDeps extends BoundedTaskDeps {
  readonly stores: TaskStoreRegistry;
  readonly sessions: Pick<TransactionSessionHost, "withDriver">;
}

/** The runtime probe verdict — the exact output of `probeVerdictSchema(proofSchema)`. */
export type RuntimeProbeVerdict = z.output<ReturnType<typeof probeVerdictSchema>>;

/**
 * The ref write-safety idempotency probe read (beat ① and §4 recovery): resolved from the
 * commit contract, run on its OWN read lease, and parsed through the exact
 * `ProbeVerdict(proofSchema)` — a probe that cannot state
 * present/absent/ambiguous/unknown has no fail-closed reading.
 */
export async function executeIdempotencyProbe(
  deps: ProbeReadDeps,
  input: Readonly<{
    commitContract: AnyCommitTaskContract;
    commitInput: unknown;
    instance: string;
    signal: AbortSignal;
    onRecord?: (taskId: TaskId, batch: BoundedTaskRecordBatch) => void;
  }>,
): Promise<z.output<ReturnType<typeof probeVerdictSchema>>> {
  const { commitContract } = input;
  const probeRef = commitContract.writeSafety.idempotency.probe;
  const probeTask = taskIndexOf(deps.stores).get(probeRef.taskId);
  if (probeTask === undefined) throw new Error(`no store implements idempotency probe ${probeRef.taskId}`);
  if (probeTask.contract.effect !== "read") {
    throw new Error(`idempotency probe ${probeRef.taskId} is not a read task`);
  }
  const need = probeTask.impl.sessions[0];
  if (need === undefined) {
    throw new Error(`idempotency probe ${probeRef.taskId} declares no browser session need`);
  }
  let probeInput: unknown;
  try {
    probeInput = probeTask.contract.input.parse(input.commitInput);
  } catch (error) {
    throw new Error(
      `idempotency probe ${probeRef.taskId} cannot bind the commit input; a dedicated probe input `
      + "binding has not been declared for this contract",
      { cause: error },
    );
  }
  const proofSchema = commitContract.writeSafety.completion.proofSchema;
  const raw = await deps.sessions.withDriver(need, input.instance, input.signal, async (driver) => {
    const { raw: output } = await invokeBoundedTask(deps, probeRef.taskId, input.signal, (innerSignal, recordData) => {
      const run = RunnableTaskSchema.parse(probeTask.impl.run);
      return run({
        input: probeInput,
        ctx: { ...taskCtx(probeRef.taskId, innerSignal, recordData, deps.log), driver },
      });
    }, input.onRecord === undefined ? undefined : (batch) => input.onRecord?.(probeRef.taskId, batch));
    return output;
  });
  try {
    return probeVerdictSchema(proofSchema).parse(probeTask.contract.output.parse(raw));
  } catch (error) {
    throw new Error(
      `idempotency probe ${probeRef.taskId} output does not parse as a ProbeVerdict; a probe that `
      + "cannot state present/absent/ambiguous/unknown has no fail-closed reading",
      { cause: error },
    );
  }
}

function requireApplied(outcome: { state: string; [key: string]: unknown }, what: string): void {
  if (outcome.state !== "applied") {
    const message = typeof outcome.message === "string" ? outcome.message : outcome.state;
    throw new Error(`${what} was not applied: ${message}`);
  }
}

/* ── the beat-⑦ outer bundle executor (ref dashboard-surfaces Phase-1f; D111) ────────────── */

export type SequencedRunTransition =
  | Readonly<{ kind: "advance-running"; claim: RunClaimToken }>
  | Readonly<{ kind: "resume-queued"; startAt: string }>;

export interface SequencedWriteCommitResult {
  readonly report: AtomicWriteCommitReport;
  readonly run: RunRecord;
}

/**
 * ONE outer authority transaction: revalidate the current run against the
 * bundle, run the narrow Phase-1c four-row primitive as an inner savepoint,
 * persist the schema-valid `TransactionOutcome` checkpoint, and transition the
 * run. It commits once or not at all; a failure after any step leaves the
 * intent `attempting` with no checkpoint, outbox, or run advance.
 */
export function executeSequencedWriteCommit(
  authority: WriteSequencerAuthority,
  input: unknown,
  transition: SequencedRunTransition,
  hooks?: WriteSequencerHooks,
): SequencedWriteCommitResult {
  const parsed = SequencedWriteCommitInputSchema.parse(input);
  const now = parsed.commit.confirmedAt;
  return authority.withAuthorityTransaction((repositories) => {
    const current = repositories.runs.get(parsed.run.runId);
    if (current === undefined) throw new Error(`run ${parsed.run.runId} does not exist`);
    if (current.version !== parsed.run.expectedVersion) {
      throw new Error(
        `run ${parsed.run.runId} is at version ${String(current.version)}, not `
        + `${String(parsed.run.expectedVersion)}; the beat-⑦ bundle is stale`,
      );
    }
    if (transition.kind === "advance-running") {
      if (parsed.run.claim !== undefined
        && (parsed.run.claim.workerId !== transition.claim.workerId
          || parsed.run.claim.claimGeneration !== transition.claim.claimGeneration)) {
        throw new Error(`run ${parsed.run.runId} beat-⑦ bundle claim disagrees with the transition claim`);
      }
      const held = runClaim(current);
      if (held === undefined
        || held.workerId !== transition.claim.workerId
        || held.claimGeneration !== transition.claim.claimGeneration) {
        throw new Error(
          `run ${parsed.run.runId} is no longer claimed by ${transition.claim.workerId} `
          + `at generation ${String(transition.claim.claimGeneration)}; refusing the beat-⑦ commit`,
        );
      }
      if (current.lifecycle.state !== "running") {
        throw new Error(`run ${parsed.run.runId} is ${current.lifecycle.state}; beat ⑦ requires a running claim holder`);
      }
    } else if (current.lifecycle.state !== "parked-write") {
      throw new Error(
        `run ${parsed.run.runId} is ${current.lifecycle.state}; a resume-queued beat-⑦ settlement `
        + "requires a parked-write run",
      );
    } else if (current.lifecycle.writeIntentId !== parsed.commit.writeIntentId
      || current.lifecycle.intentGeneration !== parsed.commit.generation) {
      throw new Error(
        `run ${parsed.run.runId} is parked on intent ${current.lifecycle.writeIntentId} `
        + `generation ${String(current.lifecycle.intentGeneration)}, not the settled `
        + `${parsed.commit.writeIntentId} generation ${String(parsed.commit.generation)}`,
      );
    }

    const report = authority.commitWriteAttempt(parsed.commit);
    hooks?.afterSequencedStep?.("commit-write-attempt");

    repositories.runCheckpoints.insert(parsed.checkpoint);
    hooks?.afterSequencedStep?.("transaction-checkpoint");

    let run: RunRecord;
    if (transition.kind === "advance-running") {
      if (current.lifecycle.state !== "running") throw new Error("unreachable: running was validated above");
      const outcome = repositories.runs.transition({
        runId: parsed.run.runId,
        expectedVersion: parsed.run.expectedVersion,
        claim: transition.claim,
        lifecycle: {
          state: "running",
          workerId: current.lifecycle.workerId,
          claimedAt: current.lifecycle.claimedAt,
          heartbeatAt: now,
          currentNodeId: NodeIdSchema.parse(parsed.checkpoint.nodeId),
        },
        now,
      });
      requireApplied(outcome, `beat-⑦ run advance for ${parsed.run.runId}`);
      if (outcome.state !== "applied") throw new Error("unreachable");
      run = outcome.run;
    } else {
      const outcome = repositories.runs.resume({
        runId: parsed.run.runId,
        expectedVersion: parsed.run.expectedVersion,
        startAt: NodeIdSchema.parse(transition.startAt),
        now,
      });
      requireApplied(outcome, `beat-⑦ run resume for ${parsed.run.runId}`);
      if (outcome.state !== "applied") throw new Error("unreachable");
      run = outcome.run;
    }
    hooks?.afterSequencedStep?.("run-transition");
    return Object.freeze({ report, run });
  });
}

/* ── outbox / checkpoint builders (shared with recovery + resolution) ────── */

export interface CommitSettlementIdentity {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly nodeId: string;
  readonly run: RunRecord;
  readonly intent: AttemptingIntent;
  readonly commitContract: AnyCommitTaskContract;
  readonly operator: ActorId;
  readonly implFingerprint: Fingerprint;
}

export interface CommittedSettlementInput extends CommitSettlementIdentity {
  readonly proofSource: "normal-output" | "recovery-probe" | "operator-attestation";
  readonly proofValue: JsonValue;
  readonly outputValue: JsonValue;
  readonly confirmedAt: string;
  readonly ids: IdFactory;
}

/**
 * Build the complete, mutually-bound beat-⑦ bundle for a committed settlement:
 * the durable `TransactionOutcome`, the ledger and same-trace terminal-span
 * outboxes, and the transaction checkpoint. Every cross-binding is validated by
 * `SequencedWriteCommitInputSchema` before any storage runs.
 */
export function buildCommittedSettlement(input: CommittedSettlementInput): {
  readonly commit: unknown;
  readonly checkpoint: RunCheckpointRecord;
  readonly outcome: TransactionOutcome;
} {
  const { intent, run, commitContract } = input;
  const envelope = run.envelope;
  const proofSchemaHash = deriveSchemaHash(commitContract.writeSafety.completion.proofSchema, "output");
  const outputSchemaHash = deriveSchemaHash(commitContract.output, "output");
  const confirmedAt = IsoInstantSchema.parse(input.confirmedAt);
  const instance = envelope.resolvedInstance[intent.system];
  if (instance === undefined) {
    throw new Error(
      `run ${envelope.runId} resolved no ${intent.system} instance at enqueue; a ledger entry cannot fabricate one`,
    );
  }
  const outcome = TransactionOutcomeSchema.parse({
    disposition: "committed",
    proofSource: input.proofSource,
    proof: { schemaHash: proofSchemaHash, value: input.proofValue },
    output: { schemaHash: outputSchemaHash, value: input.outputValue },
    confirmedAt,
  });
  const subject = intent.bindingProof.kind === "subject-match"
    ? { state: "present", value: intent.bindingProof.expected }
    : { state: "absent" };
  const completionKind = commitContract.writeSafety.completion.kind;
  const ledgerOutbox = {
    outboxId: OutboxIdSchema.parse(input.ids.uuid()),
    aggregate: { kind: "write-intent", writeIntentId: intent.writeIntentId, generation: intent.generation },
    payload: {
      kind: "ledger-entry",
      entry: {
        workflowId: intent.workflowId,
        itemId: intent.itemId,
        system: intent.system,
        idempotencyKey: intent.idempotencyKey,
        idempotencyKeyDigest: intent.idempotencyKeyDigest,
        writeIntentId: intent.writeIntentId,
        intentGeneration: intent.generation,
        proof: { schemaHash: proofSchemaHash, value: input.proofValue },
        completionKind,
        proofSource: input.proofSource,
        bindingProofDigest: intent.bindingProofDigest,
        subject,
        runId: envelope.runId,
        traceId: envelope.traceId,
        attempt: envelope.attempt,
        operator: input.operator,
        instance,
        configFingerprint: envelope.configFingerprint,
        dryRun: false,
        fencedAt: intent.fencedAt,
        confirmedAt,
        externalOccurredAt: { state: "absent" },
      },
    },
    projection: { state: "pending" },
    createdAt: confirmedAt,
  };
  const terminalSpanOutbox = {
    outboxId: OutboxIdSchema.parse(input.ids.uuid()),
    aggregate: { kind: "write-intent", writeIntentId: intent.writeIntentId, generation: intent.generation },
    payload: {
      kind: "write-committed-span",
      writeIntentId: intent.writeIntentId,
      intentGeneration: intent.generation,
      runId: envelope.runId,
      traceId: envelope.traceId,
      workflowId: intent.workflowId,
      itemId: intent.itemId,
      attempt: envelope.attempt,
      system: intent.system,
      idempotencyKey: intent.idempotencyKey,
      idempotencyKeyDigest: intent.idempotencyKeyDigest,
      bindingProofDigest: intent.bindingProofDigest,
      occurredAt: confirmedAt,
      outcome,
    },
    projection: { state: "pending" },
    createdAt: confirmedAt,
  };
  const checkpoint = buildTransactionCheckpoint(input, outcome, confirmedAt, input.proofSource);
  const commit = {
    writeIntentId: intent.writeIntentId,
    generation: intent.generation,
    completionProof: { schemaHash: proofSchemaHash, value: input.proofValue },
    confirmedAt,
    outcome,
    ledgerOutbox,
    terminalSpanOutbox,
  };
  return Object.freeze({ commit, checkpoint, outcome });
}

function buildTransactionCheckpoint(
  identity: CommitSettlementIdentity,
  outcome: TransactionOutcome,
  writtenAt: string,
  proofSource: string,
): RunCheckpointRecord {
  const envelope = identity.run.envelope;
  const instant = IsoInstantSchema.parse(writtenAt);
  const source = proofSource === "operator-attestation" ? "operator" : "live";
  const provenance = ["disposition", "proofSource", "proof", "output"].map((path) =>
    FactProvenanceSchema.parse({
      path,
      source,
      observedAt: instant,
      originalObservedAt: instant,
    }));
  return RunCheckpointRecordSchema.parse({
    workflowId: identity.descriptor.id,
    itemId: envelope.itemId,
    nodeId: identity.nodeId,
    attempt: envelope.attempt,
    // D214 — the execution that settled this write. A committed run holds a
    // claim by construction, so the generation is the row's own fact.
    claimGeneration: identity.run.claimGeneration,
    runId: envelope.runId,
    output: {
      schemaHash: TRANSACTION_OUTCOME_SCHEMA_HASH,
      value: JsonValueSchema.parse(outcome),
    },
    descriptorVersion: identity.descriptor.version,
    contractFingerprint: identity.descriptor.contractFingerprint,
    implFingerprint: identity.implFingerprint,
    provenance,
    writtenAt: instant,
  });
}

/* ── the sequencer ───────────────────────────────────────────────────────── */

export function createWriteSequencer(deps: WriteSequencerDependencies): ProductionWriteSequencer {
  const operator = ActorIdSchema.parse(deps.operator);
  const resolveImplFingerprint = deps.resolveImplFingerprint
    ?? ((taskId: TaskId) => resolveTaskImplFingerprint(BUILD_MANIFEST, taskId));
  z.number().int().positive().parse(deps.taskDeadlineMs);
  const taskIndex = taskIndexOf(deps.stores);
  const instant = () => IsoInstantSchema.parse(deps.clock.now().toISOString());

  function requireTask(taskId: string, role: string): AnyTask {
    const task = taskIndex.get(taskId);
    if (task === undefined) throw new Error(`no store implements ${role} task ${taskId}`);
    return task;
  }

  type TransactionTaskRole = "probe" | "prepare" | "commit" | "verify";

  const taskCtxCommon = (
    taskId: TaskId,
    signal: AbortSignal,
    recordData: (point: DataPoint | readonly DataPoint[]) => void,
  ) => taskCtx(taskId, signal, recordData, deps.log);

  function transactionTaskSpanPath(context: WriteSequencerContext, role: TransactionTaskRole): string {
    return `${TraceIdSchema.parse(context.run.envelope.traceId)}/${String(context.node.id)}/${role}`;
  }

  function emitObservedBatch(
    context: WriteSequencerContext,
    role: TransactionTaskRole,
    taskId: TaskId,
    batch: BoundedTaskRecordBatch,
  ): void {
    const envelope = context.run.envelope;
    const trace = TraceIdSchema.parse(envelope.traceId);
    const execution = {
      runId: envelope.runId,
      traceId: trace,
      attempt: envelope.attempt,
      workflowId: context.descriptor.id,
      nodeId: String(context.node.id),
      taskId,
    } as const;
    const points: readonly RecordedDataPoint[] = Object.freeze(batch.points.map((point) =>
      RecordedDataPointSchema.parse({ ...point, execution, recordedAt: batch.recordedAt })));
    const redacted = redactObservedDataPoints(taskId, points);
    deps.emitter.emit(ExecutorSpanEventSchema.parse({
      t: "data.observed",
      ts: batch.recordedAt,
      workflow: context.descriptor.id,
      runId: envelope.runId,
      attempt: envelope.attempt,
      traceId: trace,
      spanPath: transactionTaskSpanPath(context, role),
      parentSpanPath: trace,
      nodeId: String(context.node.id),
      taskId,
      observedAt: batch.recordedAt,
      points: redacted,
    }));
  }

  const invokeTransactionTask = (
    context: WriteSequencerContext,
    role: TransactionTaskRole,
    taskId: TaskId,
    signal: AbortSignal,
    run: (innerSignal: AbortSignal, recordData: (point: DataPoint | readonly DataPoint[]) => void) => Promise<unknown>,
  ) => invokeBoundedTask(
    deps,
    taskId,
    signal,
    run,
    (batch) => emitObservedBatch(context, role, taskId, batch),
  );

  function resolvedInstanceFor(context: WriteSequencerContext, system: string): string {
    const instance = context.run.envelope.resolvedInstance[BrowserSystemIdSchema.parse(system)];
    if (instance === undefined) {
      throw new Error(
        `run ${context.run.envelope.runId} resolved no ${system} instance at enqueue, `
        + "and this transaction needs one",
      );
    }
    return instance;
  }

  /** Beat ③ — kernel-owned fresh subject observation on the staged page. */
  async function buildBindingProof(input: Readonly<{
    driver: BrowserDriver;
    subject: SubjectBindingSpec;
    commitContract: AnyCommitTaskContract;
    commitInput: unknown;
    context: WriteSequencerContext;
    leaseId: string;
    stagedPageState: string;
    afterPrepareSpanPath: string;
  }>): Promise<WriteBindingProof> {
    const { subject, commitContract, context } = input;
    const envelope = context.run.envelope;
    const observedAt = instant();
    const base = {
      version: 1,
      proofId: WriteBindingProofIdSchema.parse(deps.ids.uuid()),
      runId: envelope.runId,
      attempt: envelope.attempt,
      leaseId: LeaseIdSchema.parse(input.leaseId),
      taskId: commitContract.id,
      pageStateId: PageStateIdSchema.parse(input.stagedPageState),
      observedAt,
      afterPrepareSpanPath: input.afterPrepareSpanPath,
    };
    if (subject.kind === "none") {
      if (subject.reviewedReasonId === undefined) {
        throw new Error(`${commitContract.id} unscoped commit carries no reviewed reason; refusing to fence`);
      }
      return WriteBindingProofSchema.parse(UnscopedBindingProofSchema.parse({
        ...base,
        kind: "unscoped",
        reviewedReasonId: subject.reviewedReasonId,
      }));
    }
    if (subject.kind === "artifact") {
      throw new Error(
        `${commitContract.id}: artifact subject binding lands with the first artifact commit store; `
        + "refusing to fence without a verified observation arm",
      );
    }
    const expectedRaw = readInputPath(input.commitInput, subject.expected.fromInput, commitContract.id);
    const expectedNormalized = normalizeSubjectIdentifier(subject.expected.identity, expectedRaw, commitContract.id);
    const reader: unknown = Reflect.get(input.driver, "read");
    if (typeof reader !== "function") {
      throw new Error(
        `${commitContract.id}: the ${input.driver.system} driver exposes no semantic read() for subject `
        + `observation ${subject.observe}; refusing to fence without a fresh observation`,
      );
    }
    let observedRaw: unknown;
    try {
      observedRaw = await raceAbortable(
        Promise.resolve().then((): Promise<unknown> => {
          const result: unknown = Reflect.apply(reader, input.driver, [subject.observe]);
          return Promise.resolve(result);
        }),
        context.signal,
        `${commitContract.id} subject observation`,
      );
    } catch (error) {
      throw new Error(
        `${commitContract.id}: subject observation ${subject.observe} failed on the staged page — `
        + "zero fence, zero click; inspect the bound observation and driver diagnostics",
        { cause: error },
      );
    }
    const observedText = z.string().min(1).parse(observedRaw);
    const observedNormalized = normalizeSubjectIdentifier(subject.expected.identity, observedText, commitContract.id);
    const identifierKind = subject.expected.identity === "name" ? "email" : "eid";
    const expectedEvidence = SubjectEvidenceSchema.parse({
      kind: "person",
      identifierKind: identifierKind === "eid" ? "eid" : "email",
      bindingDigest: subjectBindingDigest(subject.expected.identity, expectedNormalized),
      displaySuffix: displaySuffixOf(expectedNormalized),
    });
    const observedEvidence = SubjectEvidenceSchema.parse({
      kind: "person",
      identifierKind: identifierKind === "eid" ? "eid" : "email",
      bindingDigest: subjectBindingDigest(subject.expected.identity, observedNormalized),
      displaySuffix: displaySuffixOf(observedNormalized),
    });
    if (expectedNormalized !== observedNormalized) {
      throw new Error(
        `${commitContract.id}: staged-page subject does not match commit-input subject — subject mismatch, `
        + "zero fence, zero click; reopen the target and verify the run's subject binding",
      );
    }
    return WriteBindingProofSchema.parse(SubjectProofSchema.parse({
      ...base,
      kind: "subject-match",
      observationId: subject.observe,
      expected: expectedEvidence,
      observed: observedEvidence,
      match: "match",
    }));
  }

  /** The staged page-state identity the binding proof binds (see module NOTE). */
  function stagedPageStateOf(prepareOutput: unknown, prepareContract: AnyPrepareTaskContract): string {
    if (prepareOutput === null || typeof prepareOutput !== "object"
      || !Object.hasOwn(prepareOutput, "stagedPageState")) {
      throw new Error(
        `${prepareContract.id}: prepare output carries no "stagedPageState" page-state identity; `
        + "the binding proof cannot name the exact staged page, so the transaction refuses to fence",
      );
    }
    return PageStateIdSchema.parse(Reflect.get(prepareOutput, "stagedPageState"));
  }

  function emitTaskSpan(
    context: WriteSequencerContext,
    role: TransactionTaskRole,
    event: "span.started" | "span.ended",
    outcome?: "done" | "failed",
  ): void {
    const envelope = context.run.envelope;
    const trace = TraceIdSchema.parse(envelope.traceId);
    const spanPath = transactionTaskSpanPath(context, role);
    deps.emitter.emit(ExecutorSpanEventSchema.parse({
      t: event,
      kind: "task",
      ts: instant(),
      workflow: context.descriptor.id,
      runId: envelope.runId,
      attempt: envelope.attempt,
      traceId: trace,
      spanPath,
      parentSpanPath: trace,
      ...(event === "span.started" ? { name: role } : { outcome: outcome ?? "done" }),
    }));
  }

  function failureMessage(error: unknown): string {
    return error instanceof Error ? error.message : "non-Error thrown";
  }

  function containsSchemaFailure(error: unknown): boolean {
    if (error instanceof z.ZodError) return true;
    if (error instanceof AggregateError) {
      return error.errors.some((entry) => containsSchemaFailure(entry))
        || (error.cause !== undefined && containsSchemaFailure(error.cause));
    }
    return error instanceof Error && error.cause !== undefined && containsSchemaFailure(error.cause);
  }

  function aggregateSecondaryFailure(
    primary: unknown,
    secondary: unknown,
    label: string,
  ): AggregateError {
    return new AggregateError(
      [primary, secondary],
      `${label}: ${failureMessage(primary)}; secondary failure: ${failureMessage(secondary)}`,
      { cause: primary },
    );
  }

  /** Emit the failed terminal beat without ever replacing the task's primary failure. */
  function preserveTaskFailure(
    context: WriteSequencerContext,
    role: TransactionTaskRole,
    taskFailure: unknown,
  ): unknown {
    try {
      emitTaskSpan(context, role, "span.ended", "failed");
      return taskFailure;
    } catch (spanFailure) {
      return aggregateSecondaryFailure(
        taskFailure,
        spanFailure,
        `${role} task and failed-span emission both failed`,
      );
    }
  }

  /** Beat ① live probe on a separate read lease. */
  async function runLiveProbe(
    context: WriteSequencerContext,
    commitContract: AnyCommitTaskContract,
    commitInput: unknown,
  ): Promise<RuntimeProbeVerdict> {
    const instance = resolvedInstanceFor(context, systemOf(commitContract.id));
    emitTaskSpan(context, "probe", "span.started");
    try {
      const verdict = await executeIdempotencyProbe(deps, {
        commitContract,
        commitInput,
        instance,
        signal: context.signal,
        onRecord: (taskId, batch) => emitObservedBatch(context, "probe", taskId, batch),
      });
      emitTaskSpan(context, "probe", "span.ended", "done");
      return verdict;
    } catch (error) {
      throw preserveTaskFailure(context, "probe", error);
    }
  }

  /** Persist an already-present settlement (checkpoint + run advance, one txn). */
  function settleAlreadyPresent(input: Readonly<{
    context: WriteSequencerContext;
    commitContract: AnyCommitTaskContract;
    proofSource: "durable-intent" | "live-probe";
    proofValue: JsonValue;
    outputValue: JsonValue;
    recordObservedPresent?: unknown;
  }>): unknown {
    const { context, commitContract } = input;
    const envelope = context.run.envelope;
    const now = instant();
    const proofSchemaHash = deriveSchemaHash(commitContract.writeSafety.completion.proofSchema, "output");
    const outputSchemaHash = deriveSchemaHash(commitContract.output, "output");
    const outcome = TransactionOutcomeSchema.parse({
      disposition: "already-present",
      proofSource: input.proofSource,
      proof: { schemaHash: proofSchemaHash, value: input.proofValue },
      output: { schemaHash: outputSchemaHash, value: input.outputValue },
      observedAt: now,
    });
    const checkpoint = RunCheckpointRecordSchema.parse({
      workflowId: context.descriptor.id,
      itemId: envelope.itemId,
      nodeId: String(context.node.id),
      attempt: envelope.attempt,
      claimGeneration: context.run.claimGeneration,
      runId: envelope.runId,
      output: { schemaHash: TRANSACTION_OUTCOME_SCHEMA_HASH, value: JsonValueSchema.parse(outcome) },
      descriptorVersion: context.descriptor.version,
      contractFingerprint: context.descriptor.contractFingerprint,
      implFingerprint: resolveImplFingerprint(commitContract.id),
      provenance: ["disposition", "proofSource", "proof", "output"].map((path) =>
        FactProvenanceSchema.parse({ path, source: "live", observedAt: now, originalObservedAt: now })),
      writtenAt: now,
    });
    deps.authority.withAuthorityTransaction((repositories) => {
      if (input.recordObservedPresent !== undefined) {
        const recorded = repositories.writeIntents.recordObservedPresent(input.recordObservedPresent);
        if (recorded.state !== "recorded-observed-present") {
          throw new Error(
            `permanent key for ${commitContract.id} was claimed concurrently while recording a live-probe `
            + "present observation; refusing to settle over the race",
          );
        }
      }
      repositories.runCheckpoints.insert(checkpoint);
      const current = repositories.runs.get(envelope.runId);
      if (current === undefined) throw new Error(`run ${envelope.runId} disappeared during settlement`);
      if (current.lifecycle.state !== "running") {
        throw new Error(`run ${envelope.runId} is ${current.lifecycle.state}; an already-present settlement requires a running claim`);
      }
      const applied = repositories.runs.transition({
        runId: envelope.runId,
        expectedVersion: current.version,
        claim: context.claim,
        lifecycle: {
          state: "running",
          workerId: current.lifecycle.workerId,
          claimedAt: current.lifecycle.claimedAt,
          heartbeatAt: now,
          currentNodeId: context.node.id,
        },
        now,
      });
      requireApplied(applied, `already-present settlement for run ${envelope.runId}`);
    });
    return {
      disposition: "already-present",
      proofSource: input.proofSource,
      output: input.outputValue,
      proof: input.proofValue,
    };
  }

  /** Reuse a durable committed / observed-present permanent row (D18). */
  function reuseDurableIntent(
    context: WriteSequencerContext,
    commitContract: AnyCommitTaskContract,
    durable: WriteIntentRecord,
  ): unknown {
    const completion = commitContract.writeSafety.completion;
    const proofSchemaHash = deriveSchemaHash(completion.proofSchema, "output");
    const stored = durable.status === "committed"
      ? durable.completionProof
      : durable.status === "observed-present"
        ? durable.observedProof
        : undefined;
    if (stored === undefined) {
      throw new Error(`write intent ${durable.writeIntentId} is ${durable.status}; there is no proof to reuse`);
    }
    if (stored.schemaHash !== proofSchemaHash) {
      throw new Error(
        `write intent ${durable.writeIntentId} retains proof bound to schema ${stored.schemaHash.slice(0, 12)}…, `
        + `but ${commitContract.id} currently requires ${proofSchemaHash.slice(0, 12)}…; refusing to reuse drifted proof`,
      );
    }
    const proof = completion.proofSchema.parse(stored.value);
    const outputRaw: unknown = Reflect.apply(completion.outputFromProof, undefined, [proof]);
    const outputValue = JsonValueSchema.parse(commitContract.output.parse(outputRaw));
    return settleAlreadyPresent({
      context,
      commitContract,
      proofSource: "durable-intent",
      proofValue: JsonValueSchema.parse(proof),
      outputValue,
    });
  }

  /**
   * D314 — bind a replayed transaction checkpoint to the permanent key the
   * FRESH facts derive. The checkpoint carries the settlement's proof; the
   * durable intent found by the fresh key carries the proof of the write those
   * facts address. Equal bytes prove the replay is that write. Anything else —
   * no intent under the fresh key, an unfinished or parked intent, or a
   * different proof — is a fresh-fact mismatch and refuses by node name and
   * key digest reference, never by value.
   */
  function assertReplayMatchesFreshFacts(
    context: WriteSequencerContext,
    commitContract: AnyCommitTaskContract,
    stored: RunCheckpointRecord,
    system: BrowserSystemId,
    key: string,
    keyDigest: string,
  ): void {
    const outcome = TransactionOutcomeSchema.parse(stored.output.value);
    const durable = deps.authority.authority.writeIntents.findByPermanentKey(system, key);
    const reference = idempotencyKeyDigestReference(keyDigest);
    if (durable === undefined) {
      throw new Error(
        `transaction node "${context.node.id}" holds a completed settlement for item ${context.run.envelope.itemId}, `
        + `but the fresh facts derive ${reference}, which names no permanent write intent; refusing to relabel a `
        + "completed external write as the consequence of new facts (D314)",
      );
    }
    const durableProof = durable.status === "committed"
      ? durable.completionProof
      : durable.status === "observed-present"
        ? durable.observedProof
        : undefined;
    if (durableProof === undefined) {
      throw new Error(
        `transaction node "${context.node.id}" holds a completed settlement, but the fresh facts derive ${reference}, `
        + `whose permanent intent ${durable.writeIntentId} is ${durable.status}; an unfinished write follows the `
        + "recovery-probe path under its own run and is never reused as this node's settlement (D314)",
      );
    }
    if (canonicalJsonStringify(durableProof) !== canonicalJsonStringify(outcome.proof)) {
      throw new Error(
        `transaction node "${context.node.id}" holds a completed settlement whose proof is not the proof of the `
        + `write the fresh facts address (${reference}); refusing to relabel a completed external write as the `
        + "consequence of new facts (D314)",
      );
    }
  }

  /** Validate and replay this node's existing durable transaction checkpoint. */
  function replayCheckpoint(
    context: WriteSequencerContext,
    commitContract: AnyCommitTaskContract,
    stored: RunCheckpointRecord,
  ): unknown {
    if (stored.descriptorVersion !== context.descriptor.version
      || stored.contractFingerprint !== context.descriptor.contractFingerprint
      || stored.implFingerprint !== resolveImplFingerprint(commitContract.id)
      || stored.output.schemaHash !== TRANSACTION_OUTCOME_SCHEMA_HASH) {
      throw new Error(
        `transaction node "${context.node.id}" has a stored outcome from a drifted descriptor/impl; `
        + "a transaction checkpoint never replays across contract drift and never re-clicks — resolve the drift first",
      );
    }
    const outcome = TransactionOutcomeSchema.parse(stored.output.value);
    const completion = commitContract.writeSafety.completion;
    const proofSchemaHash = deriveSchemaHash(completion.proofSchema, "output");
    if (outcome.proof.schemaHash !== proofSchemaHash) {
      throw new Error(
        `transaction node "${context.node.id}" stored proof is bound to a different proof schema; refusing to replay`,
      );
    }
    const proof = completion.proofSchema.parse(outcome.proof.value);
    const output = commitContract.output.parse(outcome.output.value);
    return {
      disposition: outcome.disposition,
      proofSource: outcome.proofSource,
      output: JsonValueSchema.parse(output),
      proof: JsonValueSchema.parse(proof),
    };
  }

  /** Durably park intent then run; intent-first so the click stays blocked even if the run CAS races. */
  async function parkAfterFence(
    context: WriteSequencerContext,
    failure: PostFenceWriteFailure,
  ): Promise<void> {
    try {
      await deps.sessions.closeAll("parked");
    } catch (closeError) {
      deps.log.warn("browser close before write park failed; parking anyway", {
        writeIntentId: failure.writeIntentId,
        error: closeError instanceof Error ? closeError.message : "non-Error",
      });
    }
    const now = instant();
    deps.authority.withAuthorityTransaction((repositories) => {
      repositories.writeIntents.parkAttempt({
        writeIntentId: failure.writeIntentId,
        generation: failure.generation,
        expectedVersion: failure.intentVersion,
        code: failure.parkCode,
        message: failure.operatorMessage,
        authorityReason: failure.authorityReason,
        now,
      });
    });
    const envelope = context.run.envelope;
    deps.authority.withAuthorityTransaction((repositories) => {
      const current = repositories.runs.get(envelope.runId);
      if (current === undefined) throw new Error(`run ${envelope.runId} disappeared while parking`);
      if (current.lifecycle.state !== "running") {
        throw new Error(
          `run ${envelope.runId} is ${current.lifecycle.state}; the intent is parked but the run cannot `
          + "transition to parked-write from here",
        );
      }
      const applied = repositories.runs.transition({
        runId: envelope.runId,
        expectedVersion: current.version,
        claim: context.claim,
        lifecycle: {
          state: "parked-write",
          writeIntentId: WriteIntentIdSchema.parse(failure.writeIntentId),
          intentGeneration: failure.generation,
          parkedAt: now,
          code: failure.parkCode,
          message: failure.operatorMessage,
        },
        now,
      });
      requireApplied(applied, `parking run ${envelope.runId} on write intent ${failure.writeIntentId}`);
    });
  }

  /** Beat ⑥ — capture/verify: every completion arm parses through its proofSchema. */
  async function captureProof(input: Readonly<{
    context: WriteSequencerContext;
    commitContract: AnyCommitTaskContract;
    commitInput: unknown;
    driver: BrowserDriver;
    rawCommitOutput: unknown;
    intent: AttemptingIntent;
  }>): Promise<{ proofValue: JsonValue; outputValue: JsonValue }> {
    const { commitContract, intent } = input;
    const completion = commitContract.writeSafety.completion;
    const postFence = (
      parkCode: WriteIntentParkCode,
      message: string,
      authorityCode: WriteAuthorityReasonCode,
      evidenceKind: WriteAuthorityReason["evidence"]["kind"],
      evidence: unknown,
      cause?: unknown,
    ): PostFenceWriteFailure =>
      new PostFenceWriteFailure({
        writeIntentId: intent.writeIntentId,
        generation: intent.generation,
        intentVersion: intent.version,
        parkCode,
        message,
        authorityReason: authorityReason(authorityCode, evidenceKind, evidence),
        ...(cause === undefined ? {} : { cause }),
      });

    let outputValue: JsonValue;
    try {
      outputValue = JsonValueSchema.parse(commitContract.output.parse(input.rawCommitOutput));
    } catch (error) {
      throw postFence(
        "unknown",
        `${commitContract.id} clicked, but its output does not parse; the landing state is unknown`,
        "commit-output-schema-failure",
        "exception",
        error,
        error,
      );
    }

    if (completion.kind === "receipt") {
      try {
        const proofRaw: unknown = Reflect.apply(
          completion.proofFromOutput,
          undefined,
          [commitContract.output.parse(outputValue)],
        );
        return {
          proofValue: JsonValueSchema.parse(completion.proofSchema.parse(proofRaw)),
          outputValue,
        };
      } catch (error) {
        if (error instanceof PostFenceWriteFailure) throw error;
        throw postFence(
          "unknown",
          `${commitContract.id} clicked, but its receipt fails the proof schema — refusing to report success`,
          "commit-receipt-proof-schema-failure",
          "exception",
          error,
          error,
        );
      }
    }

    if (completion.kind === "upload-verify" && completion.unverifiableByPage !== undefined) {
      throw postFence(
        "operator-required",
        `${commitContract.id} clicked; this target is reviewed unverifiable-by-page `
        + `(${completion.unverifiableByPage.reason}) and always parks for manual confirmation`,
        "manual-confirmation-required",
        "authority-row",
        { reason: completion.unverifiableByPage.reason },
      );
    }

    let verdict: z.output<ReturnType<typeof probeVerdictSchema>>;
    let verifySpanStarted = false;
    try {
      const verifyTask = requireTask(completion.verify.taskId, `${completion.kind} verifier`);
      const verifyInput: unknown = verifyTask.contract.input.parse(input.commitInput);
      emitTaskSpan(input.context, "verify", "span.started");
      verifySpanStarted = true;
      const { raw } = await invokeTransactionTask(
        input.context,
        "verify",
        completion.verify.taskId,
        input.context.signal,
        (innerSignal, recordData) => {
          const run = RunnableTaskSchema.parse(verifyTask.impl.run);
          return run({
            input: verifyInput,
            ctx: { ...taskCtxCommon(completion.verify.taskId, innerSignal, recordData), driver: input.driver },
          });
        },
      );
      verdict = probeVerdictSchema(completion.proofSchema).parse(verifyTask.contract.output.parse(raw));
      emitTaskSpan(input.context, "verify", "span.ended", "done");
    } catch (error) {
      const preserved = verifySpanStarted
        ? preserveTaskFailure(input.context, "verify", error)
        : error;
      throw postFence(
        "unknown",
        `${completion.verify.taskId} could not set up or verify the landing state after the click`,
        "post-click-verifier-exception",
        "exception",
        preserved,
        preserved,
      );
    }
    if (verdict.state !== "present") {
      const parkCode: WriteIntentParkCode = verdict.state === "ambiguous" ? "ambiguous" : "unknown";
      throw postFence(
        parkCode,
        `${commitContract.id} clicked, but ${completion.verify.taskId} reports ${verdict.state}; `
        + "the landing state is indeterminate and needs the operator",
        verdict.state === "absent"
          ? "post-click-verifier-absent"
          : verdict.state === "ambiguous"
            ? "post-click-verifier-ambiguous"
            : "post-click-verifier-unknown",
        "probe",
        verdict,
      );
    }
    try {
      const proofRaw: unknown = Reflect.apply(completion.proofFromPresentProbe, undefined, [verdict]);
      return {
        proofValue: JsonValueSchema.parse(completion.proofSchema.parse(proofRaw)),
        outputValue,
      };
    } catch (error) {
      throw postFence(
        "unknown",
        `${commitContract.id} verify read returned present, but its proof fails the proof schema`,
        "post-click-present-proof-schema-failure",
        "exception",
        error,
        error,
      );
    }
  }

  /** Inline recovery for THIS run's own attempting intent (ref write-safety §4, D118). */
  async function recoverOwnAttemptingIntent(
    context: WriteSequencerContext,
    commitContract: AnyCommitTaskContract,
    commitInput: unknown,
    intent: AttemptingIntent,
  ): Promise<unknown> {
    let verdict: RuntimeProbeVerdict;
    try {
      verdict = await runLiveProbe(context, commitContract, commitInput);
    } catch (error) {
      const failure = new PostFenceWriteFailure({
        writeIntentId: intent.writeIntentId,
        generation: intent.generation,
        intentVersion: intent.version,
        parkCode: "unknown",
        message: `recovery probe for ${commitContract.id} failed; the target state remains unknown`,
        authorityReason: authorityReason("inline-recovery-probe-exception", "exception", error),
        cause: error,
      });
      await parkAfterFence(context, failure);
      throw new WriteParkedError({
        writeIntentId: failure.writeIntentId,
        intentGeneration: failure.generation,
        parkCode: failure.parkCode,
        message: failure.message,
        cause: failure,
      });
    }
    const completion = commitContract.writeSafety.completion;
    if (verdict.state === "present") {
      let proofValue: JsonValue;
      let outputValue: JsonValue;
      try {
        const proofRaw: unknown = Reflect.apply(completion.proofFromPresentProbe, undefined, [verdict]);
        const proof = completion.proofSchema.parse(proofRaw);
        const outputRaw: unknown = Reflect.apply(completion.outputFromProof, undefined, [proof]);
        proofValue = JsonValueSchema.parse(proof);
        outputValue = JsonValueSchema.parse(commitContract.output.parse(outputRaw));
      } catch (error) {
        const failure = new PostFenceWriteFailure({
          writeIntentId: intent.writeIntentId,
          generation: intent.generation,
          intentVersion: intent.version,
          parkCode: "present-proof-invalid",
          message: `recovery probe for ${commitContract.id} found the write present, but its proof cannot be `
            + "validated; a present we cannot validate is indeterminate, not done",
          authorityReason: authorityReason("inline-recovery-present-proof-schema-failure", "exception", error),
          cause: error,
        });
        await parkAfterFence(context, failure);
        throw new WriteParkedError({
          writeIntentId: failure.writeIntentId,
          intentGeneration: failure.generation,
          parkCode: failure.parkCode,
          message: failure.message,
          cause: failure,
        });
      }
      const settlement = buildCommittedSettlement({
        descriptor: context.descriptor,
        nodeId: String(context.node.id),
        run: context.run,
        intent,
        commitContract,
        operator,
        implFingerprint: resolveImplFingerprint(commitContract.id),
        proofSource: "recovery-probe",
        proofValue,
        outputValue,
        confirmedAt: instant(),
        ids: deps.ids,
      });
      executeSequencedWriteCommit(
        deps.authority,
        {
          run: { runId: context.run.envelope.runId, expectedVersion: currentRunVersion(context), claim: context.claim },
          checkpoint: settlement.checkpoint,
          commit: settlement.commit,
        },
        { kind: "advance-running", claim: context.claim },
        deps.hooks,
      );
      return {
        disposition: "committed",
        proofSource: "recovery-probe",
        output: settlement.outcome.output.value,
        proof: settlement.outcome.proof.value,
      };
    }
    // Absent, ambiguous, or unknown: the full D64/D69 stabilization machine is
    // the standalone recovery service's; inline recovery conservatively parks —
    // a park can only delay a retry, never authorize one.
    const parkCode: WriteIntentParkCode = verdict.state === "ambiguous" ? "ambiguous" : "unknown";
    const failure = new PostFenceWriteFailure({
      writeIntentId: intent.writeIntentId,
      generation: intent.generation,
      intentVersion: intent.version,
      parkCode,
      message: `recovery probe for ${commitContract.id} reports ${verdict.state} for `
        + `${idempotencyKeyDigestReference(intent.idempotencyKeyDigest)}; retry authority requires the ref write-safety `
        + "§4 settlement machine or the operator",
      authorityReason: authorityReason(
        verdict.state === "absent"
          ? "inline-recovery-absent"
          : verdict.state === "ambiguous"
            ? "inline-recovery-ambiguous"
            : "inline-recovery-unknown",
        "probe",
        verdict,
      ),
    });
    await parkAfterFence(context, failure);
    throw new WriteParkedError({
      writeIntentId: failure.writeIntentId,
      intentGeneration: failure.generation,
      parkCode: failure.parkCode,
      message: failure.message,
      cause: failure,
    });
  }

  function currentRunVersion(context: WriteSequencerContext): number {
    const current = deps.authority.authority.runs.get(context.run.envelope.runId);
    if (current === undefined) throw new Error(`run ${context.run.envelope.runId} disappeared from authority`);
    return current.version;
  }

  /**
   * A contract may supersede an earlier permanent-key shape without gaining
   * authority to reinterpret its immutable intents. Any old row is therefore
   * a stop, before a probe, browser lease, fence, or click.
   */
  function refuseRetiredPermanentKeys(
    commitContract: AnyCommitTaskContract,
    commitInput: unknown,
    system: z.output<typeof BrowserSystemIdSchema>,
    currentKey: string,
  ): void {
    const retired = commitContract.writeSafety.idempotency.retiredKeys;
    if (retired === undefined) return;
    const seen = new Set<string>([currentKey]);
    for (const entry of retired) {
      const raw: unknown = Reflect.apply(entry.key, undefined, [commitInput]);
      const key = IdempotencyKeySchema.parse(raw);
      if (seen.has(key)) {
        throw new Error(
          `${commitContract.id} declares duplicate current/retired permanent key material; refusing an ambiguous compatibility policy`,
        );
      }
      seen.add(key);
      const intent = deps.authority.authority.writeIntents.findByPermanentKey(system, key);
      if (intent === undefined) continue;
      const digest = deriveIdempotencyKeyDigest(system, key);
      throw new Error(
        `${commitContract.id} found immutable retired-key intent ${intent.writeIntentId} (${intent.status}) for `
        + `${idempotencyKeyDigestReference(digest)}; ${entry.reason}. Refusing before any probe, browser, fence, or click`,
      );
    }
  }

  async function executeTransaction(context: WriteSequencerContext): Promise<unknown> {
    const run = RunRecordSchema.parse(context.run);
    const node: TransactionRuntimeNode = context.node;
    const commitContract = node.commit.uses;
    const prepareContract = node.prepare.uses;
    const envelope = run.envelope;

    if (context.dryRun) {
      throw new TaskError(
        commitContract.id,
        "capability-unavailable",
        `transaction node "${node.id}" was asked for a dry run, and this is the arm that FENCES AND `
        + "CLICKS; the sequencer never substitutes a real write for a preview. The interpreter's "
        + "preview arm calls executeDryRun (zero intent, zero fence, zero commit) — D210. Reaching "
        + "here with dryRun means a caller routed a preview into the commit path.",
      );
    }
    // The run's OWN immutable envelope, not the caller's claim about it.
    // `context.dryRun` above is what the caller passed; the interpreter derives
    // it from this same field, so in production the two always agree. They are
    // still checked separately on purpose: a caller that passes `dryRun:false`
    // for a run the operator enqueued as a dry run would otherwise reach the
    // fence and click a REAL external write, and this is the one path in the
    // program where "the caller said so" is not good enough. Found 2026-08-04,
    // when a Phase-2 live lane claimed a leftover dry-run row and the kernel
    // had nothing of its own to refuse with. This subsumes the older
    // `node.dryRun === "unsupported"` arm: no node policy makes a real write
    // legal on a dry-run envelope.
    if (envelope.dryRun) {
      throw new TaskError(commitContract.id, "capability-unavailable",
        `run ${envelope.runId} was enqueued as a dry run; transaction node "${node.id}" refuses to fence or `
        + "click a real external write for it, whatever the caller passed — use executeDryRun");
    }

    /* stable commit input + key BEFORE any replay, probe or browser (ref workflow-model §3.1) */
    const commitInput: unknown = commitContract.input.parse(node.commit.bind(context.scope));
    const system = systemOf(commitContract.id);
    const keyRaw: unknown = Reflect.apply(commitContract.writeSafety.idempotency.key, undefined, [commitInput]);
    const key = IdempotencyKeySchema.parse(keyRaw);
    const keyDigest = deriveIdempotencyKeyDigest(system, key);

    /* step 0 — this node's settled outcome replays byte-exact, never re-clicks */
    const storedCheckpoint = deps.authority.authority.runCheckpoints.latest(
      context.descriptor.id,
      envelope.itemId,
      String(node.id),
    );
    if (storedCheckpoint !== undefined) {
      /*
       * D314 — a replayed settlement must still be THE write the fresh facts
       * address. A Restart-from-start attempt (and any resume whose
       * always-rerun ancestors moved) re-derives the commit input; if its
       * permanent key no longer names a committed / observed-present intent
       * whose proof is byte-exactly the proof this checkpoint carries, the run
       * refuses by name rather than relabelling an old write as the
       * consequence of new facts. Nothing is fenced or clicked on this path.
       */
      assertReplayMatchesFreshFacts(context, commitContract, storedCheckpoint, system, key, keyDigest);
      return replayCheckpoint(context, commitContract, storedCheckpoint);
    }
    refuseRetiredPermanentKeys(commitContract, commitInput, system, key);

    /* beat ① — durable permanent-key lookup, regardless of status/origin */
    const durable = deps.authority.authority.writeIntents.findByPermanentKey(system, key);
    let generation = 1;
    let refenceExpectedVersion: number | undefined;
    if (durable !== undefined) {
      if (durable.status === "committed" || durable.status === "observed-present") {
        return reuseDurableIntent(context, commitContract, durable);
      }
      if (durable.status === "attempting") {
        if (durable.runId === envelope.runId && durable.runAttempt === envelope.attempt) {
          return await recoverOwnAttemptingIntent(context, commitContract, commitInput, durable);
        }
        throw new Error(
          `another run (${durable.runId} attempt ${String(durable.runAttempt)}) is mid-submit for `
          + `${idempotencyKeyDigestReference(keyDigest)} — refusing to double-fence`,
        );
      }
      if (durable.status === "parked") {
        throw new Error(
          `write intent ${durable.writeIntentId} for ${idempotencyKeyDigestReference(keyDigest)} is parked (`
          + `${durable.parkedCode}); stored detail is retained only in authority. `
          + "only the typed operator resolutions may release it",
        );
      }
      // retryable — the next fence CASes a new generation with a FRESH proof.
      generation = durable.generation + 1;
      refenceExpectedVersion = durable.version;
    }

    /* beat ① — the policy-controlled live probe on a separate read lease */
    const mustProbe = node.probePolicy === "always"
      || durable !== undefined
      || envelope.attempt > 1;
    if (mustProbe) {
      let verdict: RuntimeProbeVerdict;
      try {
        verdict = await runLiveProbe(context, commitContract, commitInput);
      } catch (error) {
        throw new WriteSafetyAuthorityError(
          `pre-write probe for ${commitContract.id} ${idempotencyKeyDigestReference(keyDigest)} failed; `
            + "refusing to fence or click because the target state is unknown",
          authorityReason("prewrite-probe-exception", "exception", error),
          error,
        );
      }
      if (verdict.state === "present") {
        if (durable !== undefined) {
          throw new Error(
            `live probe found ${idempotencyKeyDigestReference(keyDigest)} present, but its permanent intent `
            + `${durable.writeIntentId} is `
            + `${durable.status}; a settled-absent key that now reads present needs the operator, not a guess`,
          );
        }
        const completion = commitContract.writeSafety.completion;
        const proofRaw: unknown = Reflect.apply(completion.proofFromPresentProbe, undefined, [verdict]);
        const proof = completion.proofSchema.parse(proofRaw);
        const outputRaw: unknown = Reflect.apply(completion.outputFromProof, undefined, [proof]);
        const outputValue = JsonValueSchema.parse(commitContract.output.parse(outputRaw));
        const now = instant();
        const observedPresentRecord = WriteIntentRecordSchema.parse({
          writeIntentId: deps.ids.uuid(),
          workflowId: context.descriptor.id,
          itemId: envelope.itemId,
          taskId: commitContract.id,
          system,
          idempotencyKey: key,
          idempotencyKeyDigest: keyDigest,
          generation: 1,
          status: "observed-present",
          observedProof: {
            schemaHash: deriveSchemaHash(completion.proofSchema, "output"),
            value: JsonValueSchema.parse(proof),
          },
          observedAt: now,
          version: 1,
          createdAt: now,
          updatedAt: now,
        });
        return settleAlreadyPresent({
          context,
          commitContract,
          proofSource: "live-probe",
          proofValue: JsonValueSchema.parse(proof),
          outputValue,
          recordObservedPresent: observedPresentRecord,
        });
      }
      if (verdict.state === "ambiguous" || verdict.state === "unknown") {
        const detail = verdict.state === "ambiguous"
          ? `found ${String(verdict.matches)} matches`
          : "is indeterminate";
        throw new WriteSafetyAuthorityError(
          `pre-write probe for ${commitContract.id} ${idempotencyKeyDigestReference(keyDigest)} ${detail}; `
          + "refusing to fence or click — "
          + "verify in the target system, then retry",
          authorityReason(
            verdict.state === "ambiguous" ? "prewrite-probe-ambiguous" : "prewrite-probe-unknown",
            "probe",
            verdict,
          ),
        );
      }
      if (verdict.evidence.idempotencyKeyDigest !== keyDigest) {
        throw new WriteSafetyAuthorityError(
          `pre-write probe absent evidence does not match ${idempotencyKeyDigestReference(keyDigest)}; `
          + "refusing to treat foreign evidence as absence",
          authorityReason("prewrite-probe-foreign-absence", "probe", verdict),
        );
      }
    }
    const probeCompletedMonotonicMs = deps.clock.monotonicMs();

    /* beats ② – ⑥ under ONE uninterrupted exclusive transaction lease */
    const commitTask = requireTask(commitContract.id, "commit");
    const prepareTask = requireTask(prepareContract.id, "prepare");
    if (commitTask.contract !== commitContract || prepareTask.contract !== prepareContract) {
      throw new Error(
        `store tasks for transaction "${node.id}" bind different contract objects than the descriptor imports`,
      );
    }
    const need = commitTask.impl.sessions[0];
    if (need === undefined || need.access !== "transaction") {
      throw new Error(`${commitContract.id} does not declare a transaction session need`);
    }
    const instance = resolvedInstanceFor(context, need.system);
    const trace = TraceIdSchema.parse(envelope.traceId);
    const afterPrepareSpanPath = `${trace}/${String(node.id)}/prepare`;

    interface LeasedCommitResult {
      readonly intent: AttemptingIntent;
      readonly proofValue: JsonValue;
      readonly outputValue: JsonValue;
    }

    let leased: LeasedCommitResult;
    let retainedIntent: AttemptingIntent | undefined;
    try {
      leased = await deps.sessions.withTransactionDriver(
        need,
        instance,
        context.signal,
        async (driver, ownership) => {
        const leaseId = deps.ids.uuid();

        /* beat ② — prepare stages the page; output is preview data only */
        emitTaskSpan(context, "prepare", "span.started");
        let prepareOutput: unknown;
        try {
          const prepareInput: unknown = prepareContract.input.parse(node.prepare.bind(context.scope));
          const { raw } = await invokeTransactionTask(
            context,
            "prepare",
            prepareContract.id,
            context.signal,
            (innerSignal, recordData) => {
              const runImpl = RunnableTaskSchema.parse(prepareTask.impl.run);
              return runImpl({
                input: prepareInput,
                ctx: { ...taskCtxCommon(prepareContract.id, innerSignal, recordData), driver },
              });
            },
          );
          prepareOutput = prepareContract.output.parse(raw);
          emitTaskSpan(context, "prepare", "span.ended", "done");
        } catch (error) {
          throw preserveTaskFailure(context, "prepare", error);
        }
        const stagedPageState = stagedPageStateOf(prepareOutput, prepareContract);

        /* beat ③ — kernel-owned fresh binding proof on this exact page */
        const bindingProof = await buildBindingProof({
          driver,
          subject: commitContract.subject,
          commitContract,
          commitInput,
          context,
          leaseId,
          stagedPageState,
          afterPrepareSpanPath,
        });
        const bindingProofDigest = FingerprintSchema.parse(deriveWriteBindingProofDigest(bindingProof));

        /* beat ④ — probe→fence budget, then the durable CAS before any click */
        const elapsedMs = deps.clock.monotonicMs() - probeCompletedMonotonicMs;
        if (elapsedMs > node.probeToFenceMaxMs) {
          throw new StagedPageDiscardedError(
            `transaction "${node.id}" probe aged ${String(elapsedMs)}ms, over its ${String(node.probeToFenceMaxMs)}ms `
            + "probe-to-fence budget; the staged page is discarded and nothing was clicked",
          );
        }
        // Open and fully validate the display beat BEFORE the authority fence.
        // The fence and commit-task span/data writes are flushed only AFTER the
        // task callback settles. `recordData` still validates and stamps each
        // call synchronously, but its fallible sink cannot occupy the durable
        // fence→external-click critical window.
        emitTaskSpan(context, "commit", "span.started");
        const fencedAt = instant();
        const deferredFenceEvent = ExecutorSpanEventSchema.parse({
          t: "transaction.fenced",
          ts: fencedAt,
          workflow: context.descriptor.id,
          runId: envelope.runId,
          attempt: envelope.attempt,
          traceId: trace,
          spanPath: transactionTaskSpanPath(context, "commit"),
          parentSpanPath: trace,
          node: String(node.id),
          taskId: commitContract.id,
        });
        const attemptId = WriteAttemptIdSchema.parse(deps.ids.uuid());
        const intentId = refenceExpectedVersion === undefined
          ? WriteIntentIdSchema.parse(deps.ids.uuid())
          : WriteIntentIdSchema.parse(durable === undefined ? deps.ids.uuid() : durable.writeIntentId);
        const intentRecord = WriteIntentRecordSchema.parse({
          writeIntentId: intentId,
          workflowId: context.descriptor.id,
          itemId: envelope.itemId,
          taskId: commitContract.id,
          system,
          idempotencyKey: key,
          idempotencyKeyDigest: keyDigest,
          currentAttemptId: attemptId,
          generation,
          runId: envelope.runId,
          runAttempt: envelope.attempt,
          bindingProof,
          bindingProofDigest,
          fencedAt,
          version: refenceExpectedVersion === undefined ? 1 : refenceExpectedVersion + 1,
          createdAt: durable === undefined ? fencedAt : durable.createdAt,
          updatedAt: fencedAt,
          status: "attempting",
        });
        const attemptRecord = WriteAttemptRecordSchema.parse({
          writeAttemptId: attemptId,
          writeIntentId: intentId,
          generation,
          runId: envelope.runId,
          runAttempt: envelope.attempt,
          leaseId: LeaseIdSchema.parse(leaseId),
          bindingProof,
          bindingProofDigest,
          fencedAt,
          outcome: { state: "attempting" },
          recordedAt: fencedAt,
        });
        let fencedRecord: WriteIntentRecord;
        if (context.signal.aborted) {
          throw context.signal.reason instanceof Error
            ? context.signal.reason
            : new Error(`${commitContract.id} was cancelled before its write fence`);
        }
        try {
          const resolution = refenceExpectedVersion === undefined
            ? deps.authority.authority.writeIntents.fenceAttempt({ intent: intentRecord, attempt: attemptRecord })
            : deps.authority.authority.writeIntents.refenceRetryable({
              expectedVersion: refenceExpectedVersion,
              intent: intentRecord,
              attempt: attemptRecord,
            });
          if (resolution.state === "existing") throw new FenceLostRaceError(resolution.intent);
          if (resolution.state !== "fenced") {
            throw new Error(
              `write fence for ${idempotencyKeyDigestReference(keyDigest)} reported ${resolution.state}; refusing to click`,
            );
          }
          fencedRecord = resolution.intent;
        } catch (error) {
          throw preserveTaskFailure(context, "commit", error);
        }
        if (fencedRecord.status !== "attempting") {
          // PermanentWriteResolutionSchema makes this unreachable for a real
          // authority repository. Keep the runtime check outside the pre-fence
          // catch so even a corrupt test double cannot run an emitter after it
          // claims to have won a fence.
          throw new PostFenceWriteFailure({
            writeIntentId: fencedRecord.writeIntentId,
            generation: fencedRecord.generation,
            intentVersion: fencedRecord.version,
            parkCode: "unknown",
            message: `write fence for ${idempotencyKeyDigestReference(keyDigest)} returned ${fencedRecord.status}, `
              + "not attempting; refusing to click",
            authorityReason: authorityReason(
              "write-fence-state-invalid",
              "fence",
              { state: fencedRecord.status, writeIntentId: fencedRecord.writeIntentId },
            ),
          });
        }
        const fenced: AttemptingIntent = fencedRecord;
        retainedIntent = fenced;
        ownership.retainAfterFence();

        /* beat ⑤ — the external commit under the minted capability */
        const capability = mintMutationCapability(fenced.generation, fenced.bindingProofDigest);
        const bufferedCommitObservations: BoundedTaskRecordBatch[] = [];
        let commitSettlement:
          | Readonly<{ state: "done"; raw: unknown }>
          | Readonly<{ state: "failed"; error: unknown }>;
        const commitInvocation = beginBoundedTask(
          deps,
          commitContract.id,
          context.signal,
          (innerSignal, recordData) => {
            const runImpl = RunnableTaskSchema.parse(commitTask.impl.run);
            return runImpl({
              input: commitInput,
              ctx: { ...taskCtxCommon(commitContract.id, innerSignal, recordData), driver, mutation: capability },
            });
          },
          (batch) => bufferedCommitObservations.push(batch),
        );
        try {
          const { raw } = await commitInvocation.bounded;
          commitSettlement = { state: "done", raw };
        } catch (boundedFailure) {
          // A deadline requests cancellation but cannot prove that an external
          // callback obeyed it. Keep the fenced intent and transaction lease
          // owned until the callback itself settles. If it never does, this
          // process never emits, parks, or closes; crash recovery owns the
          // durable `attempting` intent instead of racing detached I/O.
          const operationSettlement = await commitInvocation.settlement;
          const failure = operationSettlement.state === "rejected"
            && operationSettlement.error !== boundedFailure
            ? aggregateSecondaryFailure(
              operationSettlement.error,
              boundedFailure,
              `${commitContract.id} task failed after its bounded invocation also failed`,
            )
            : boundedFailure;
          commitSettlement = { state: "failed", error: failure };
        }

        let emissionFailure: Readonly<{ error: unknown }> | undefined;
        try {
          // This is the first fallible emit after the authority fence, and the
          // commit callback has already settled. A task may legally record a
          // staged/page fact before it calls its driver: buffering keeps that
          // record-time callback from stranding a fenced-but-unclicked write.
          deps.emitter.emit(deferredFenceEvent);
          for (const batch of bufferedCommitObservations) {
            emitObservedBatch(context, "commit", commitContract.id, batch);
          }
          emitTaskSpan(
            context,
            "commit",
            "span.ended",
            commitSettlement.state === "done" ? "done" : "failed",
          );
        } catch (error) {
          emissionFailure = { error };
        }

        const postFenceTaskFailure = (
          detail: string,
          reasonCode: WriteAuthorityReasonCode,
          cause: unknown,
        ): PostFenceWriteFailure =>
          // The click may or may not have fired: post-fence uncertainty parks.
          new PostFenceWriteFailure({
            writeIntentId: fenced.writeIntentId,
            generation: fenced.generation,
            intentVersion: fenced.version,
            parkCode: "unknown",
            message: `${detail}; whether the external write landed is unknown: ${failureMessage(cause)}`,
            operatorMessage: `${detail}; whether the external write landed is unknown`,
            authorityReason: authorityReason(reasonCode, "exception", cause),
            cause,
          });
        if (commitSettlement.state === "failed" && emissionFailure !== undefined) {
          const combined = aggregateSecondaryFailure(
            commitSettlement.error,
            emissionFailure.error,
            `${commitContract.id} task and post-settlement observation emission both failed`,
          );
          throw postFenceTaskFailure(
            `${commitContract.id} threw after the fence and its observation writer also failed`,
            "post-fence-commit-and-observation-exception",
            combined,
          );
        }
        if (emissionFailure !== undefined) {
          throw postFenceTaskFailure(
            `${commitContract.id} settled after the fence, then its observation writer threw`,
            "post-fence-observation-exception",
            emissionFailure.error,
          );
        }
        if (commitSettlement.state === "failed") {
          throw postFenceTaskFailure(
            `${commitContract.id} threw after the fence`,
            containsSchemaFailure(commitSettlement.error)
              ? "commit-output-schema-failure"
              : "post-fence-commit-exception",
            commitSettlement.error,
          );
        }
        const rawCommitOutput = commitSettlement.raw;

        /* beat ⑥ — capture/verify on the retained transaction page */
        const captured = await captureProof({
          context,
          commitContract,
          commitInput,
          driver,
          rawCommitOutput,
          intent: fenced,
        });
        return { intent: fenced, proofValue: captured.proofValue, outputValue: captured.outputValue };
        },
      );
    } catch (error) {
      if (error instanceof PostFenceWriteFailure) {
        await parkAfterFence(context, error);
        throw new WriteParkedError({
          writeIntentId: error.writeIntentId,
          intentGeneration: error.generation,
          parkCode: error.parkCode,
          message: error.message,
          cause: error,
        });
      }
      if (retainedIntent !== undefined) {
        const failure = new PostFenceWriteFailure({
          writeIntentId: retainedIntent.writeIntentId,
          generation: retainedIntent.generation,
          intentVersion: retainedIntent.version,
          parkCode: "unknown",
          message: `${commitContract.id} transaction lease failed after the fence; whether the external write landed `
            + `is unknown: ${failureMessage(error)}`,
          operatorMessage: `${commitContract.id} transaction lease failed after the fence; whether the external write landed is unknown`,
          authorityReason: authorityReason("post-fence-session-exception", "session", authorityExceptionDetail(error)),
          cause: error,
        });
        await parkAfterFence(context, failure);
        throw new WriteParkedError({
          writeIntentId: failure.writeIntentId,
          intentGeneration: failure.generation,
          parkCode: failure.parkCode,
          message: failure.message,
          cause: failure,
        });
      }
      if (error instanceof FenceLostRaceError) {
        // The staged page is already poison-closed. Route the race winner:
        // committed / observed-present reuses its proof; anything else refuses.
        const winner = error.existing;
        if (winner.status === "committed" || winner.status === "observed-present") {
          return reuseDurableIntent(context, commitContract, winner);
        }
        throw new Error(
          `write fence for ${idempotencyKeyDigestReference(keyDigest)} lost the race to intent `
          + `${winner.writeIntentId} (${winner.status}); `
          + "the staged page was discarded and nothing was clicked",
          { cause: error },
        );
      }
      throw error;
    }

    /* beat ⑦ — ONE outer authority transaction over the whole bundle */
    const settlement = buildCommittedSettlement({
      descriptor: context.descriptor,
      nodeId: String(node.id),
      run,
      intent: leased.intent,
      commitContract,
      operator,
      implFingerprint: resolveImplFingerprint(commitContract.id),
      proofSource: "normal-output",
      proofValue: leased.proofValue,
      outputValue: leased.outputValue,
      confirmedAt: instant(),
      ids: deps.ids,
    });
    executeSequencedWriteCommit(
      deps.authority,
      {
        run: { runId: envelope.runId, expectedVersion: currentRunVersion(context), claim: context.claim },
        checkpoint: settlement.checkpoint,
        commit: settlement.commit,
      },
      { kind: "advance-running", claim: context.claim },
      deps.hooks,
    );
    return {
      disposition: "committed",
      proofSource: "normal-output",
      output: settlement.outcome.output.value,
      proof: settlement.outcome.proof.value,
    };
  }

  /**
   * D215 — the preview runs beat ① FIRST, because the real path does.
   *
   * `executeDryRun` used to evaluate `prepare` with no probe, so it rehearsed a
   * path the real run would never take: separations' `clear-pending` sweep
   * refused in prepare for the ordinary subject — one with no pending
   * transaction — while the real run's probe settles that subject
   * `already-present` before a page is ever staged. Chunk 6b hit it on the FIRST
   * real subject; a rehearsal that fails where the performance succeeds is a
   * false rehearsal.
   *
   * Everything here is read-only by construction: the durable lookup is a SELECT,
   * the probe is the same read-lease probe the real path runs, and the
   * `already-present` arm REPORTS the settlement the real path would reach
   * without calling `settleAlreadyPresent` — no checkpoint, no observed-present
   * intent row, no run transition. Every arm the real path refuses on
   * (`attempting`, `parked`, ambiguous, unknown, foreign absent evidence, and a
   * present read over a settled-absent durable row) refuses here too, with the
   * same reason: a preview that answered where the real run stops is the same
   * defect from the other side.
   */
  async function executeDryRun(context: WriteSequencerContext): Promise<TransactionDryRunPreview> {
    const node = context.node;
    const commitContract = node.commit.uses;
    const prepareContract = node.prepare.uses;
    const envelope = context.run.envelope;
    if (node.dryRun !== "stop-after-prepare") {
      throw new TaskError(commitContract.id, "capability-unavailable",
        `transaction node "${node.id}" declares dryRun:"${node.dryRun}"; there is no preview arm to run`);
    }
    const commitInput: unknown = commitContract.input.parse(node.commit.bind(context.scope));
    const completion = commitContract.writeSafety.completion;
    const proofSchemaHash = deriveSchemaHash(completion.proofSchema, "output");
    const outputSchemaHash = deriveSchemaHash(commitContract.output, "output");
    const system = systemOf(commitContract.id);
    const keyRaw: unknown = Reflect.apply(commitContract.writeSafety.idempotency.key, undefined, [commitInput]);
    const key = IdempotencyKeySchema.parse(keyRaw);
    const keyDigest = deriveIdempotencyKeyDigest(system, key);
    refuseRetiredPermanentKeys(commitContract, commitInput, system, key);

    /** The settlement the real path would reuse — DERIVED, never fabricated. */
    const presentFromProof = (proofRaw: unknown): Readonly<{ proof: JsonValue; output: JsonValue }> => {
      const proof = completion.proofSchema.parse(proofRaw);
      const outputRaw: unknown = Reflect.apply(completion.outputFromProof, undefined, [proof]);
      return Object.freeze({
        proof: JsonValueSchema.parse(proof),
        output: JsonValueSchema.parse(commitContract.output.parse(outputRaw)),
      });
    };

    /* beat ① — the durable permanent-key lookup, before any browser */
    const durable = deps.authority.authority.writeIntents.findByPermanentKey(system, key);
    if (durable !== undefined) {
      if (durable.status === "attempting") {
        throw new Error(
          `preview of "${node.id}" found ${idempotencyKeyDigestReference(keyDigest)} mid-submit under run `
          + `${durable.runId} attempt `
          + `${String(durable.runAttempt)}; a preview may not run recovery, and reporting a settlement `
          + "it did not observe would be the fabrication D144 refuses",
        );
      }
      if (durable.status === "parked") {
        throw new Error(
          `preview of "${node.id}" found ${idempotencyKeyDigestReference(keyDigest)} parked `
          + `(${durable.parkedCode}); stored detail is retained only in authority. `
          + "only the typed operator resolutions may release it, so there is nothing to rehearse",
        );
      }
      if (durable.status === "committed" || durable.status === "observed-present") {
        const stored = durable.status === "committed" ? durable.completionProof : durable.observedProof;
        if (stored.schemaHash !== proofSchemaHash) {
          throw new Error(
            `preview of "${node.id}": write intent ${durable.writeIntentId} retains proof bound to schema `
            + `${stored.schemaHash.slice(0, 12)}…, and ${commitContract.id} currently requires `
            + `${proofSchemaHash.slice(0, 12)}…; refusing to rehearse a drifted proof`,
          );
        }
        const settled = presentFromProof(stored.value);
        return TransactionDryRunPreviewSchema.parse({
          kind: "transaction-dry-run-preview",
          nodeId: String(node.id),
          probe: {
            state: "durable-intent",
            status: durable.status,
            proof: { schemaHash: proofSchemaHash, value: settled.proof },
            output: { schemaHash: outputSchemaHash, value: settled.output },
          },
          outcome: { state: "already-present", proofSource: "durable-intent" },
          observedAt: instant(),
        });
      }
      // retryable — the real path re-fences after a fresh probe, so the preview
      // goes on to that probe exactly as the real path does.
    }

    /* beat ① — the policy-controlled live probe, on its own read lease */
    const mustProbe = node.probePolicy === "always"
      || durable !== undefined
      || envelope.attempt > 1;
    let probe: z.input<typeof DryRunProbeObservationSchema>;
    if (!mustProbe) {
      probe = { state: "not-required", reason: "policy-retries-and-recovery-only" };
    } else {
      let verdict: RuntimeProbeVerdict;
      try {
        verdict = await runLiveProbe(context, commitContract, commitInput);
      } catch (error) {
        throw new WriteSafetyAuthorityError(
          `preview probe for ${commitContract.id} ${idempotencyKeyDigestReference(keyDigest)} failed; `
            + "the preview refuses because the real run could not prove a safe target state",
          authorityReason("preview-probe-exception", "exception", error),
          error,
        );
      }
      if (verdict.state === "ambiguous" || verdict.state === "unknown") {
        const detail = verdict.state === "ambiguous"
          ? `found ${String(verdict.matches)} matches`
          : "is indeterminate";
        throw new WriteSafetyAuthorityError(
          `preview probe for ${commitContract.id} ${idempotencyKeyDigestReference(keyDigest)} ${detail}; `
          + "the real run would refuse to "
          + "fence or click here, so the preview refuses too rather than staging a page it could not use",
          authorityReason(
            verdict.state === "ambiguous" ? "preview-probe-ambiguous" : "preview-probe-unknown",
            "probe",
            verdict,
          ),
        );
      }
      if (verdict.state === "present") {
        if (durable !== undefined) {
          throw new Error(
            `preview probe found ${idempotencyKeyDigestReference(keyDigest)} present, but its permanent intent `
            + `${durable.writeIntentId} is `
            + `${durable.status}; a settled-absent key that now reads present needs the operator, not a guess`,
          );
        }
        const settled = presentFromProof(verdict.proof);
        return TransactionDryRunPreviewSchema.parse({
          kind: "transaction-dry-run-preview",
          nodeId: String(node.id),
          probe: {
            state: "present",
            proof: { schemaHash: proofSchemaHash, value: settled.proof },
            output: { schemaHash: outputSchemaHash, value: settled.output },
          },
          outcome: { state: "already-present", proofSource: "live-probe" },
          observedAt: instant(),
        });
      }
      if (verdict.evidence.idempotencyKeyDigest !== keyDigest) {
        throw new WriteSafetyAuthorityError(
          `preview probe absent evidence does not match ${idempotencyKeyDigestReference(keyDigest)}; `
          + "refusing to treat foreign evidence as absence",
          authorityReason("preview-probe-foreign-absence", "probe", verdict),
        );
      }
      probe = { state: "absent", evidence: verdict.evidence };
    }

    /* the staged rehearsal — reached only when the real run would fence */
    const prepareTask = requireTask(prepareContract.id, "prepare");
    const commitTask = requireTask(commitContract.id, "commit");
    const need = commitTask.impl.sessions[0];
    if (need === undefined) throw new Error(`${commitContract.id} declares no transaction session need`);
    const instance = resolvedInstanceFor(context, need.system);
    return deps.sessions.withDriver(need, instance, context.signal, async (driver) => {
      const prepareInput: unknown = prepareContract.input.parse(node.prepare.bind(context.scope));
      emitTaskSpan(context, "prepare", "span.started");
      let prepareOutput: unknown;
      try {
        const { raw } = await invokeTransactionTask(
          context,
          "prepare",
          prepareContract.id,
          context.signal,
          (innerSignal, recordData) => {
            const runImpl = RunnableTaskSchema.parse(prepareTask.impl.run);
            return runImpl({
              input: prepareInput,
              ctx: { ...taskCtxCommon(prepareContract.id, innerSignal, recordData), driver },
            });
          },
        );
        prepareOutput = prepareContract.output.parse(raw);
        emitTaskSpan(context, "prepare", "span.ended", "done");
      } catch (error) {
        throw preserveTaskFailure(context, "prepare", error);
      }
      const stagedPageState = stagedPageStateOf(prepareOutput, prepareContract);
      const observedAt = instant();
      const subjectSpec = commitContract.subject;
      type PreviewOutcome = z.input<typeof TransactionDryRunPreviewSchema>["outcome"];
      let subject: Extract<PreviewOutcome, { state: "would-prepare" }>["subject"];
      if (subjectSpec.kind === "none") {
        subject = { state: "unscoped", reviewedReasonId: subjectSpec.reviewedReasonId ?? "unscoped" };
      } else {
        try {
          const proof = await buildBindingProof({
            driver,
            subject: subjectSpec,
            commitContract,
            commitInput,
            context,
            leaseId: deps.ids.uuid(),
            stagedPageState,
            afterPrepareSpanPath: `${TraceIdSchema.parse(context.run.envelope.traceId)}/${String(node.id)}/prepare`,
          });
          if (proof.kind !== "subject-match") throw new Error("person subject produced a non-subject proof");
          subject = { state: "match", evidence: proof.expected };
        } catch (error) {
          throw new Error(
            `dry-run subject observation for "${node.id}" did not match; the real write would refuse to fence: `
            + `${error instanceof Error ? error.message : "non-Error"}`,
            { cause: error },
          );
        }
      }
      return TransactionDryRunPreviewSchema.parse({
        kind: "transaction-dry-run-preview",
        nodeId: String(node.id),
        probe,
        outcome: {
          state: "would-prepare",
          prepare: {
            schemaHash: deriveSchemaHash(prepareContract.output, "output"),
            value: JsonValueSchema.parse(prepareOutput),
          },
          subject,
        },
        observedAt,
      });
    });
  }

  return Object.freeze({ executeTransaction, executeDryRun });
}
