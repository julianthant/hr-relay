/**
 * The ONE command kernel — D113 (ref dashboard-surfaces §Phase-1f authority, §2.4; ref guards-and-tests §3.9).
 *
 * Every control surface — dashboard, CLI, gate resolvers, recovery — mutates
 * authority through exactly this dispatcher. It is exhaustive over the closed
 * family/action registry: Phase-1f activates start-run, the worker/browser arms,
 * run retry/cancel/bump/rename plus typed write resolution, gate resolution,
 * and the revision-bound settings-file authority. Every deferred arm stays schema-recognized and returns
 * `rejected{code:"capability-unavailable"}` computed with ZERO authority side
 * effects — no journal row, no audit row, no generation advance.
 *
 * **Atomicity model.** An active command runs in ONE outer authority
 * transaction: journal insert, arm effects, and the audit record commit
 * together or not at all. The settings arm additionally writes a durable
 * prepare record before replacing its file and reconciles that record against
 * the exact journal outcome after commit or process loss.
 * A typed refusal (`rejected`/`conflict`) is raised as
 * a `CommandRefusal`, which unwinds the whole transaction — ref dashboard-surfaces's Phase-1f
 * ratification is explicit that drift, expiry, a spent plan, target lookup
 * failure, or a run-insert failure "rolls back plan consumption, command
 * application, supersession, and every proposed run" — and the typed result is
 * returned to the caller with no partial state. Replay of a journaled command
 * returns the recorded result; a same-id different-content replay fails loud.
 *
 * CAS is enforced only for the real race families (cancel-tree, gate
 * resolution, write recovery; edit-vs-resume is a later arm). Every other arm
 * retains the observed version for audit but validates CURRENT authority
 * instead of rejecting on version drift alone.
 */
import { lifecycleCommandId, type RunMutationOutcome, type RunRecordService } from "./run-record-service.js";
import type { RunExistence, RunRecordRefusal } from "../domain/authority.js";
import { RuntimeConfigClaimTokenSchema } from "../domain/config/runtime-generation.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { descriptorRuntimeNodes, workflowPlanning, type AnyWorkflowDescriptor } from "../base/workflow.js";
import {
  activeRunsForItem,
  fanOutQueuedRuns,
  requireApplied,
  runTarget,
  type TargetReference,
  type VersionChange,
} from "./run-fan-out.js";
import {
  assessVersionBump,
  deriveArchivedRunRecord,
  describeBlocker,
  resolveBumpEffect,
  type ArchiveSnapshotSource,
} from "../services/archive/archive-service.js";
import {
  CURRENT_ARCHIVE_SCHEMA_GENERATION,
  VersionBumpApplicationSchema,
  VersionBumpPlanSchema,
  versionBumpPlanFingerprint,
  type WorkflowVersionIdentity,
} from "../domain/archive/model.js";
import { VersionPlanStorageRecordSchema } from "../infra/sqlite/storage-records.js";
import { buildRerunPlan, RerunRefusedError } from "../services/start/rerun.js";
import { planStart } from "../services/start/plan.js";
import type { ArtifactRef } from "../domain/artifacts.js";
import type { Clock } from "../domain/clock.js";
import {
  COMMAND_FAMILY_REGISTRY,
  CommandRequestSchema,
  CommandResultSchema,
  deriveSettingsCommandFingerprint,
  markSettingsCommand,
  type CommandAuditRecord,
  type CommandRejectionCodeSchema,
  type CommandRequest,
  type CommandResult,
} from "../domain/commands.js";
import { deriveItemId, type IdFactory } from "../domain/identifiers.js";
import {
  CommandIdSchema,
  FingerprintSchema,
  IsoInstantSchema,
  ItemIdSchema,
  WorkerIdSchema,
} from "../domain/ids.js";
import { SettingsApplyRefusalSchema } from "../domain/config/settings.js";
import {
  IntakeParseSchema,
  resolveInspectSelection,
  type IntakeLayout,
} from "../domain/intake/parse.js";
import { deriveIntakeEnqueuePlan } from "../domain/intake/enqueue.js";
import { confirmBinding } from "../domain/intake/mapping.js";
import type { IntakeProjection } from "../domain/intake/projection.js";
import { validateIntakeRows } from "../domain/intake/validate.js";
import { deepFreeze } from "../domain/immutability.js";
import { isTerminalRunState, RunRecordSchema, type RunRecord } from "../domain/run/record.js";
import { isLiveWorker } from "../domain/run/worker.js";
import { workerPoolVersion } from "../domain/run/worker-pool.js";
import { deriveSchemaHash, SchemaBoundCanonicalValueSchema } from "../domain/schema-bound-value.js";
import type { WriteIntentRecord } from "../domain/write-safety.js";
import type { AuthorityRepositories } from "../infra/sqlite/authority-database.js";
import { dryRunRefusalMessage, resolveInstances, supportsDryRun } from "../services/start/plan.js";
import {
  type ExplorerEditApplyRequest,
  ExplorerEditApplyResultSchema,
  type ExplorerEditApplyResult,
} from "../domain/dashboard/explorer.js";
import {
  ProtectedSettingsReadbackSchema,
  type ProtectedSettingsReadback,
} from "../domain/config/protected-settings.js";

/* ── the Phase-1f arm partition (ref dashboard-surfaces §Phase-1f authority) ─────────────── */

const PHASE1_ACTIVE = {
  start: ["start-run"],
  "worker-browser": [
    "plan-worker-count",
    "spawn-worker",
    "stop-worker",
    "pause-worker",
    "resume-worker",
    "refresh-browser",
    "reopen-browser",
  ],
  run: [
    "retry",
    // D314: Restart from start — the second ordinary recovery choice.
    "restart",
    "cancel",
    "bump",
    "rename",
    "delete",
    "resolve-write-present",
    "resolve-write-absent",
  ],
  gate: ["resolve-gate"],
  // 2i-B: the notification inbox lifecycle over D134/D138's durable rows.
  notification: ["notification-read", "notification-unread", "notification-snooze"],
  // D170 (2i-E1): the five non-enqueue intake arms over the durable session.
  // D171 (2i-E2) adds the sixth: the manifest commit and the run fan-out.
  intake: [
    "inspect-intake",
    "confirm-intake-mapping",
    "correct-intake-row",
    "exclude-intake-row",
    "validate-intake",
    "enqueue-intake-manifest",
  ],
  settings: ["apply-settings", "apply-protected-settings"],
  // D179 (2i-G): the D80 archive model — plan, apply, relaunch.
  "version-archive": ["plan-version-bump", "apply-version-bump", "relaunch-archived-run", "delete-archived-run"],
  explorer: ["apply-explorer-edit"],
} as const;

const PHASE1_DEFERRED = {
  intake: [],
  settings: [],
  "version-archive": [],
  run: [],
  notification: [],
} as const;

export const PHASE1_ACTIVE_COMMAND_ARMS = deepFreeze(PHASE1_ACTIVE);
export const PHASE1_DEFERRED_COMMAND_ARMS = deepFreeze(PHASE1_DEFERRED);

function armActions(partition: Readonly<Record<string, readonly string[]>>, family: string): readonly string[] {
  const actions = Object.hasOwn(partition, family) ? partition[family] : undefined;
  if (actions === undefined) return [];
  return actions;
}

/* The partition must cover D95 exactly, in both directions, before any command
 * can dispatch. A family/action the registry knows but neither list carries —
 * or one both carry — is a contract bug, not a runtime state. */
for (const { family, actions } of COMMAND_FAMILY_REGISTRY) {
  const active = armActions(PHASE1_ACTIVE, family);
  const deferred = armActions(PHASE1_DEFERRED, family);
  const combined = [...active, ...deferred];
  if (combined.length !== actions.length
    || new Set(combined).size !== combined.length
    || actions.some((action) => !combined.includes(action))) {
    throw new Error(`D113 command arm partition does not cover family ${family} exactly`);
  }
}

const DEFERRED_ARM_KEYS: ReadonlySet<string> = new Set(
  Object.entries(PHASE1_DEFERRED as Readonly<Record<string, readonly string[]>>).flatMap(([family, actions]) =>
    actions.map((action) => `${family}/${action}`)),
);

/* ── injected seams ──────────────────────────────────────────────────────── */

export interface CommandAuthority {
  withAuthorityTransaction<Result>(work: (repositories: AuthorityRepositories) => Result): Result;
}

export interface WorkflowDescriptorResolver {
  resolve(workflowId: string): AnyWorkflowDescriptor | undefined;
}

/**
 * The ref write-safety §4.1 seam. The kernel owns everything up to it — command schema,
 * idempotency, run CAS, the parked-write state, and the intent-generation lock
 * — and the write sequencer owns the intent/attempt/outbox/run mutations
 * behind it (beat ⑦ for confirmed-present; retryable + evidence for
 * confirmed-absent). It executes INSIDE the kernel's authority transaction and
 * must return the updated run; a throw unwinds the whole command.
 */
type RunCommand = Extract<CommandRequest, { family: "run" }>;
type RunBasicCommand = Extract<RunCommand, { type: "retry" | "restart" | "cancel" | "bump" }>;
/** D314 — the two recovery verbs share the basic run command shape; `executeRetry` reads `type` to choose the mode. */
type RunRecoveryCommand = RunBasicCommand;
type IntakeCommand = Extract<CommandRequest, { family: "intake" }>;
type NotificationCommand = Extract<CommandRequest, { family: "notification" }>;
export type SettingsCommand = Extract<CommandRequest, { family: "settings" }>;
type RunRenameCommand = Extract<RunCommand, { type: "rename" }>;
type RunDeleteCommand = Extract<RunCommand, { type: "delete" }>;
type WriteResolutionCommand = Extract<RunCommand, { type: "resolve-write-present" | "resolve-write-absent" }>;

export interface ExplorerEditExecutor {
  reconcilePending(
    input: ExplorerEditApplyRequest,
    findOutcome: (commandId: string) => Readonly<{
      request: CommandRequest | undefined;
      audit: CommandAuditRecord | undefined;
    }>,
  ): void;
  apply(input: ExplorerEditApplyRequest): Readonly<{
    result: ExplorerEditApplyResult;
    finalizeAfterCommit?: () => void;
  }>;
}

export interface WriteResolutionContext {
  readonly command: WriteResolutionCommand;
  readonly run: RunRecord;
  readonly intent: WriteIntentRecord;
  readonly now: string;
}

export const WriteResolutionOutcomeSchema = z.strictObject({ run: RunRecordSchema });

export interface WriteResolutionExecutor {
  resolvePresent(repositories: AuthorityRepositories, context: WriteResolutionContext): unknown;
  resolveAbsent(repositories: AuthorityRepositories, context: WriteResolutionContext): unknown;
}

const SettingsApplicationRefusalSchemas = SettingsApplyRefusalSchema.options;

export const OrdinarySettingsApplicationOutcomeSchema = z.union([
  z.strictObject({
    state: z.literal("applied"),
    revision: z.number().int().positive(),
    settingsFingerprint: FingerprintSchema,
    rollback: z.custom<() => void>((value) => typeof value === "function"),
    commit: z.custom<() => void>((value) => typeof value === "function"),
  }),
  ...SettingsApplicationRefusalSchemas,
]);

export const ProtectedSettingsApplicationOutcomeSchema = z.union([
  z.strictObject({
    state: z.literal("applied"),
    readback: ProtectedSettingsReadbackSchema,
    rollback: z.custom<() => void>((value) => typeof value === "function"),
    commit: z.custom<() => void>((value) => typeof value === "function"),
  }),
  ...SettingsApplicationRefusalSchemas,
]);

export interface SettingsApplicationExecutor {
  reconcilePending(
    repositories: AuthorityRepositories,
    command: SettingsCommand,
  ): z.infer<typeof SettingsApplyRefusalSchema> | undefined;
  apply(command: SettingsCommand, repositories: AuthorityRepositories): unknown;
  reconcileReplay(repositories: AuthorityRepositories, command: SettingsCommand): unknown;
}

const OrdinarySettingsReplayVerificationSchema = z.strictObject({
  revision: z.number().int().positive(),
  settingsFingerprint: FingerprintSchema,
});

const ProtectedSettingsReplayVerificationSchema = ProtectedSettingsReadbackSchema;

/**
 * Explorer recovery observes the existing journal/audit pair through its
 * command owner, just like settings recovery below. It exposes no mutation
 * or inferred outcome: the file store still proves the exact claim and bytes.
 * The caller retains its authority transaction across both reads.
 */
export function createExplorerCommandJournal(
  authority: Pick<AuthorityRepositories, "commands" | "commandAudits">,
): Readonly<{ findOutcome: Parameters<ExplorerEditExecutor["reconcilePending"]>[1] }> {
  return Object.freeze({
    findOutcome(commandIdInput: string) {
      const commandId = CommandIdSchema.parse(commandIdInput);
      return {
        request: authority.commands.get(commandId),
        audit: authority.commandAudits.findByCommand(commandId),
      };
    },
  });
}

/**
 * The worker/browser process seam. Worker leases and their durable directives
 * are authority the kernel writes directly; launching a worker process,
 * reconciling a planned worker count, and refreshing/reopening a live
 * worker-owned browser session are process effects the supervisor owns. The
 * kernel validates the target against authority first, and a thrown executor
 * error unwinds the command.
 */
export interface WorkerRuntimeContext {
  readonly command: Extract<CommandRequest, { family: "worker-browser" }>;
  readonly now: string;
}

export const WorkerRuntimeAcknowledgementSchema = z.strictObject({ state: z.literal("accepted") });

export const WorkerPlanAcknowledgementSchema = z.strictObject({
  state: z.literal("accepted"),
  /** The exact worker ids the plan reconciles toward; never an empty guess. */
  workerIds: z.array(WorkerIdSchema).min(1),
});

/**
 * A pool stop's acknowledgement MUST carry the durable directive write's own
 * lease versions, reported by the graceful-stop channel that performed the
 * write. The audit records exactly these — never `lease.version` read back at
 * journal time, which would absorb unrelated lease bumps (a worker heartbeat
 * landing between the write and phase C) into this command's claimed change.
 */
export const WorkerStopPoolAcknowledgementSchema = z.strictObject({
  state: z.literal("accepted"),
  directiveLeaseVersions: z.strictObject({
    before: z.number().int().positive(),
    after: z.number().int().positive(),
  }).superRefine((versions, context) => {
    if (versions.after !== versions.before + 1) {
      context.addIssue({
        code: "custom",
        message: `a lease directive write bumps its version by exactly one; before ${String(versions.before)} → `
          + `after ${String(versions.after)} is not one write`,
      });
    }
  }),
});

export interface WorkerRuntimeExecutor {
  planWorkerCount(context: WorkerRuntimeContext): unknown;
  spawnWorker(context: WorkerRuntimeContext): unknown;
  refreshBrowser(context: WorkerRuntimeContext): unknown;
  reopenBrowser(context: WorkerRuntimeContext): unknown;
}

/**
 * The ASYNC pool seam (ref execution-and-sessions §11, D271) — worker-loop's
 * `WorkerPoolRuntimeExecutor`, restated here structurally because worker-loop
 * type-imports this module and the reverse import would be a cycle. Every
 * method settles only after the supervisor's process effect settled: birth is
 * proved against the durable lease before a spawn acknowledges, a stop's
 * durable directive has landed before a stop acknowledges, and a thrown
 * effect rejects the command instead of acknowledging it.
 *
 * The method names are deliberately DISTINCT from `WorkerRuntimeExecutor`'s:
 * squeezing this async seam through the synchronous interface is a compile
 * error, never a mis-wire that abandons the effect's promise.
 */
export interface WorkerPoolRuntimeSeam {
  planPoolWorkerCount(context: WorkerRuntimeContext): Promise<unknown>;
  spawnPoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
  refreshPoolBrowser(context: WorkerRuntimeContext): Promise<unknown>;
  reopenPoolBrowser(context: WorkerRuntimeContext): Promise<unknown>;
  stopPoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
  pausePoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
  resumePoolWorker(context: WorkerRuntimeContext): Promise<unknown>;
}

/**
 * EXPLICIT adoption of the async pool seam. A composition that launches real
 * worker processes passes `{ pool: createWorkerPoolRuntimeExecutor(supervisor) }`
 * — worker-browser commands then settle ONLY through `executeWorkerPool`, and
 * the synchronous `execute` path refuses them by name. The wrapper object is
 * the explicit act: the pool executor can never be mistaken for (or silently
 * squeezed through) the synchronous Phase-1 seam.
 */
export interface WorkerPoolRuntimeAdoption {
  readonly pool: WorkerPoolRuntimeSeam;
}

/**
 * Ref data-intake-and-edit-data §2.2's re-derivation seam (D170).
 *
 * Rows and detected columns are a pure function of the immutable artifact plus
 * the sheet/header selection, so the kernel re-derives them instead of reading
 * a stored copy — but it cannot import a spreadsheet parser (that lives in
 * `src/stores/**`, which `core` may not reach) and its authority transaction is
 * synchronous, so the parse is PREPARED by the caller and read back here by the
 * exact key the CURRENT session names. A key nobody prepared throws: the kernel
 * never binds a column against a guessed layout.
 */
export interface IntakeParser {
  parse(request: Readonly<{ artifact: ArtifactRef; sheet: string; headerRowIndex: number | null }>): unknown;
}

/**
 * Ref data-intake-and-edit-data §1's spreadsheet-capable declaration, resolved per workflow. A
 * workflow with no projection has no bindable target fields, and every arm
 * that would need one refuses by name rather than mapping against an invented
 * target set.
 */
export interface IntakeProjectionResolver {
  resolve(workflowId: string): IntakeProjection | undefined;
}

/**
 * The config identity a run enqueued by THIS process is stamped with (D171).
 *
 * `start-run` copies it from the start plan, which the planning service stamped
 * from the same resolved config; `retry` copies it from the run it retries. An
 * intake fan-out has neither — the command IS the plan — so the composition
 * root supplies its own resolved identity, and the kernel proves it against the
 * stored `config_snapshots` row before stamping a single envelope with it. A
 * caller-claimed config identity would be exactly the unverified value this
 * tree bans; an unproved one would leave a run claiming a snapshot nobody can
 * read back.
 */
export interface RunConfigIdentity {
  readonly configFingerprint: string;
  readonly configSnapshotId: string;
}

export interface CommandKernelDependencies {
  readonly authority: CommandAuthority;
  readonly lifecycle: RunRecordService;
  readonly clock: Clock;
  readonly ids: IdFactory;
  /**
   * The RUNNING app build (D179). Every run this kernel enqueues is stamped
   * with it, and an application-scope version bump verifies the operator's
   * claimed scope against it rather than trusting the command's own text.
   */
  readonly appVersion: string;
  readonly descriptors: WorkflowDescriptorResolver;
  readonly writeResolution: WriteResolutionExecutor;
  /** The synchronous Phase-1 executor, or the explicit async pool adoption — never both. */
  readonly workerRuntime: WorkerRuntimeExecutor | WorkerPoolRuntimeAdoption;
  readonly intakeParser: IntakeParser;
  readonly intakeProjections: IntakeProjectionResolver;
  readonly configIdentity: RunConfigIdentity;
  /** The strict settings-file CAS executor. An active settings command cannot exist without it. */
  readonly settings?: SettingsApplicationExecutor;
  /**
   * D179: the final projected row/detail/failure for a run a version bump is
   * about to archive. The kernel cannot build these — the projection is a
   * server read model, not authority — so the archived record freezes the SAME
   * payloads the live surfaces were rendering, rather than a second derivation
   * of them.
   */
  readonly archiveSnapshots: ArchiveSnapshotSource;
  /** D283: durable Explorer apply, composed behind the ONE command journal. */
  readonly explorerEdits?: ExplorerEditExecutor;
}

export interface CommandKernel {
  execute(input: unknown): CommandResult;
  /**
   * The ASYNC door for the worker-browser family (W3): request →
   * supervisor.execute → validated acknowledgement → settled reply. With a
   * `WorkerPoolRuntimeAdoption` composed, worker-browser commands settle ONLY
   * here (the sync path refuses them); with the sync Phase-1 runtime composed
   * this settles through the same synchronous flow as `execute`. Any other
   * family throws — this door widens nothing.
   */
  executeWorkerPool(input: unknown): Promise<CommandResult>;
}

/* ── internals ───────────────────────────────────────────────────────────── */

/**
 * A typed non-applied outcome. Throwing it unwinds the authority transaction —
 * every partial arm effect rolls back — while the caller still receives the
 * exact typed result instead of an exception.
 */
class CommandRefusal extends Error {
  readonly result: CommandResult;

  constructor(result: unknown) {
    const parsed = CommandResultSchema.parse(result);
    if (parsed.state !== "conflict" && parsed.state !== "rejected" && parsed.state !== "confirmation-required") {
      throw new Error("a command refusal cannot carry an applied result");
    }
    super(`command ${parsed.commandId} ${parsed.state}: ${parsed.message}`);
    this.name = "CommandRefusal";
    this.result = parsed;
  }
}

interface CommandApplication {
  readonly result: CommandResult;
  readonly versionChanges: readonly VersionChange[];
  readonly affectedDependencyIds: readonly string[];
  /** Compensation for the settings file if the surrounding authority transaction fails. */
  readonly rollback?: () => void;
  /** Releases settings-file authority only after the surrounding transaction commits. */
  readonly commit?: () => void;
  readonly settingsCurrent?: Readonly<{
    revision: number;
    settingsFingerprint: string;
    commandFingerprint: string;
  }>;
  readonly protectedSettingsCurrent?: Readonly<{
    revision: number;
    commandFingerprint: string;
    entries: readonly Readonly<{ name: string; valueId: string; updatedAt: string }>[];
  }>;
  readonly finalizeAfterCommit?: () => void;
}

function workerPoolTarget(workflowId: string): TargetReference {
  return { family: "worker-pool", workflowId };
}

function workerTarget(workerId: string): TargetReference {
  return { family: "worker-browser", workerId };
}

function reject(request: CommandRequest, code: string, message: string): never {
  throw new CommandRefusal({ state: "rejected", commandId: request.commandId, code, message });
}

/**
 * The same typed rejection, reachable from an EXECUTOR the kernel calls through
 * one of its seams (D245).
 *
 * `createWriteResolutionExecutor.resolvePresent` is the only caller today, and
 * it needs it for one specific thing: a confirmed-present proof that does not
 * bind to the commit contract's schema, or does not parse through it, is an
 * ordinary operator mistake — the surface's own client-side check cannot cover
 * a `.refine()`, and the schema can move between the serve and the send. Left
 * as a thrown `Error` it reached the dialog as an uncoded transport failure,
 * which is the one arm that surface reserves for "the server never answered".
 * `executeResolveGate` already answers `schema-mismatch` for the identical
 * situation one command over; this makes the write resolution match it.
 *
 * It is deliberately NOT a general escape hatch: the code is the closed wire
 * enum, and the executor stays free to `throw` for the things that are genuinely
 * inconsistent storage rather than a bad answer.
 */
export function rejectCommandRequest(
  request: CommandRequest,
  code: z.infer<typeof CommandRejectionCodeSchema>,
  message: string,
): never {
  reject(request, code, message);
}

function conflict(request: CommandRequest, currentVersion: number, message: string): never {
  throw new CommandRefusal({ state: "conflict", commandId: request.commandId, currentVersion, message });
}

function applied(
  request: CommandRequest,
  affectedTargets: readonly TargetReference[],
  versionChanges: readonly VersionChange[],
  affectedDependencyIds: readonly string[] = [],
  rollback?: () => void,
  commit?: () => void,
  settingsResult?: Readonly<
    | { kind: "ordinary"; revision: number; settingsFingerprint: string }
    | { kind: "protected"; readback: ProtectedSettingsReadback }
  >,
): CommandApplication {
  return Object.freeze({
    result: CommandResultSchema.parse({
      state: "applied",
      commandId: request.commandId,
      affectedTargets,
      ...(settingsResult?.kind === "ordinary" ? {
        restartRequired: true,
        settingsRevision: settingsResult.revision,
        settingsFingerprint: settingsResult.settingsFingerprint,
      } : settingsResult?.kind === "protected" ? {
        restartRequired: false,
        revision: settingsResult.readback.revision,
        entries: settingsResult.readback.entries,
      } : {}),
    }),
    versionChanges,
    affectedDependencyIds,
    ...(rollback === undefined ? {} : { rollback }),
    ...(commit === undefined ? {} : { commit }),
  });
}

export function deriveGateResultCheckpointFingerprint(result: unknown): string {
  const parsed = SchemaBoundCanonicalValueSchema.parse(result);
  return FingerprintSchema.parse(createHash("sha256")
    .update("hrauto:gate-result-checkpoint:v1\0")
    .update(canonicalJsonStringify(parsed))
    .digest("hex"));
}

function resolveDescriptorOrReject(
  dependencies: CommandKernelDependencies,
  request: CommandRequest,
  workflowId: string,
): AnyWorkflowDescriptor {
  const descriptor = dependencies.descriptors.resolve(workflowId);
  if (descriptor === undefined) {
    reject(request, "target-not-found", `workflow ${workflowId} is not registered; the command names an unknown target`);
  }
  return descriptor;
}

function requireDescriptorMatchesEnvelope(
  request: CommandRequest,
  descriptor: AnyWorkflowDescriptor,
  run: RunRecord,
): void {
  if (descriptor.version !== run.envelope.descriptorVersion
    || descriptor.contractFingerprint !== run.envelope.contractFingerprint) {
    reject(
      request,
      "schema-mismatch",
      `run ${run.envelope.runId} was enqueued under ${run.envelope.workflow} v${String(run.envelope.descriptorVersion)} `
      + `(${run.envelope.contractFingerprint.slice(0, 12)}…) but the registered descriptor is `
      + `v${String(descriptor.version)} (${descriptor.contractFingerprint.slice(0, 12)}…); re-plan instead of acting on a drifted contract`,
    );
  }
}

function requireRun(
  repositories: AuthorityRepositories,
  request: CommandRequest,
  runId: string,
): RunRecord {
  if (repositories.deletedRuns.get(runId) !== undefined) reject(request, "target-deleted", "run was deleted");
  const run = repositories.runs.get(runId);
  if (run === undefined) reject(request, "target-not-found", `run ${runId} does not exist`);
  return run;
}


function runtimeToken(repositories: AuthorityRepositories) {
  const active = repositories.runtimeConfig.get();
  if (active === undefined) throw new Error("operator lifecycle command has no active runtime config");
  return RuntimeConfigClaimTokenSchema.parse({ generation: active.generation, settingsRevision: active.settingsRevision,
    settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint });
}

function lifecycleRefusal(request: CommandRequest, refusal: RunRecordRefusal): never {
  switch (refusal.reason) {
    case "conflict": return conflict(request, refusal.currentVersion, "run version changed");
    case "schema-mismatch": return reject(request, "schema-mismatch", "run schema or archive digest changed");
    case "source-deleted": case "tombstoned": return reject(request, "target-deleted", "run was deleted");
    case "policy-refused": return reject(request, "policy-refused", "run policy refuses this operation");
    case "runtime-stale": return reject(request, "schema-mismatch", "runtime configuration changed");
    case "workflow-unregistered": return reject(request, "target-not-found", "workflow is not registered");
    case "illegal-transition": return reject(request, "invalid-state", refusal.message);
    case "owned-by-worker": case "heartbeat-live": case "invalid-state": case "not-terminal":
    case "already-archived": case "is-member": case "tree-non-terminal": case "use-archive-door":
      return reject(request, "invalid-state", `run lifecycle refused: ${refusal.reason}`);
    case "parent-missing": case "retry-of-missing": case "identity-conflict": case "cursor-stale":
    case "lost": case "replay-divergent": case "retention-not-due": case "none-eligible": case "worker-busy":
      throw new Error(`unexpected operator lifecycle refusal: ${refusal.reason}`);
  }
}

function lifecycleRun(request: CommandRequest, outcome: RunMutationOutcome | RunExistence): RunRecord {
  if (outcome.state === "refused") lifecycleRefusal(request, outcome.refusal);
  if (outcome.state === "deleted") reject(request, "target-deleted", "run was deleted");
  if (outcome.state === "absent") reject(request, "target-not-found", "run does not exist");
  if ((outcome.state === "applied" || outcome.state === "applied-already") && "run" in outcome) return outcome.run;
  throw new Error(`unexpected operator lifecycle result: ${outcome.state}`);
}

/* ── the arms ────────────────────────────────────────────────────────────── */

function executeStartRun(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<CommandRequest, { family: "start" }>,
  now: string,
): CommandApplication {
  const descriptor = resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
  const plan = repositories.startPlans.get(request.target.startPlanId);
  if (plan === undefined) {
    reject(request, "target-not-found", `start plan ${request.target.startPlanId} does not exist; plan before starting`);
  }
  if (plan.workflowId !== request.target.workflowId) {
    reject(
      request,
      "invalid-state",
      `start plan ${plan.startPlanId} was planned for ${plan.workflowId}, not ${request.target.workflowId}`,
    );
  }
  if (descriptor.version !== plan.descriptorVersion
    || descriptor.contractFingerprint !== plan.descriptorFingerprint) {
    reject(
      request,
      "schema-mismatch",
      `start plan ${plan.startPlanId} was planned against ${plan.workflowId} v${String(plan.descriptorVersion)} `
      + `but the registered descriptor is v${String(descriptor.version)}; re-plan before starting`,
    );
  }
  const currentIngressHash = deriveSchemaHash(descriptor.input, "input");
  const currentCanonicalHash = deriveSchemaHash(descriptor.canonicalInput, "output");
  if (currentIngressHash !== plan.ingressSchemaHash || currentCanonicalHash !== plan.canonicalInputSchemaHash) {
    reject(
      request,
      "schema-mismatch",
      `start plan ${plan.startPlanId} was planned against a different ingress/canonical schema for ${plan.workflowId}; re-plan before starting`,
    );
  }

  if (plan.planned.some((entry) => entry.runId !== undefined || entry.traceId !== undefined)) {
    reject(request, "replan-required", "legacy plan reserved lifecycle identities; replan before submitting");
  }
  if (plan.rerun !== undefined) {
    let current;
    try {
      current = buildRerunPlan(repositories, descriptor, plan.rerun.source, plan.planned, plan.rerun.acknowledgment, plan.stepOmissions);
    } catch (error) {
      if (!(error instanceof RerunRefusedError)) throw error;
      reject(request, error.code === "source-stale" ? "replan-required" : error.code, error.message);
    }
    if (canonicalJsonStringify(current) !== canonicalJsonStringify(plan.rerun)
      || (current.warnings.length > 0 && current.acknowledgment !== current.warningDigest)) {
      throw new CommandRefusal(CommandResultSchema.parse({ state: "confirmation-required", commandId: request.commandId,
        warningDigest: current.warningDigest, message: "Confirm the current repeat warning before final submission" }));
    }
  }

  const consumption = repositories.startPlans.consume({
    startPlanId: request.target.startPlanId,
    expectedVersion: request.target.expectedVersion,
    commandId: request.commandId,
    descriptorFingerprint: request.payload.descriptorFingerprint,
    configFingerprint: request.payload.configFingerprint,
    ingressSchemaHash: request.payload.ingressSchemaHash,
    canonicalInputSchemaHash: request.payload.canonicalInputSchemaHash,
    inputFingerprint: request.payload.inputFingerprint,
    now,
  });
  if (consumption.state === "refused") {
    if (consumption.code === "version-mismatch") conflict(request, plan.version, consumption.message);
    if (consumption.code === "fingerprint-mismatch") reject(request, "schema-mismatch", consumption.message);
    reject(request, "invalid-state", consumption.message);
  }
  if (consumption.state !== "consumed") {
    throw new Error(
      `start plan ${plan.startPlanId} reported ${consumption.state} for a first execution of command ${request.commandId}; `
      + "an unjournaled command cannot have consumed a plan",
    );
  }

  const startReference: TargetReference = {
    family: "start",
    workflowId: request.target.workflowId,
    startPlanId: request.target.startPlanId,
    expectedVersion: request.target.expectedVersion,
  };
  const affectedTargets: TargetReference[] = [startReference];
  const versionChanges: VersionChange[] = [{
    target: startReference,
    before: request.target.expectedVersion,
    after: consumption.plan.version,
  }];

  const fanOut = fanOutQueuedRuns(
    repositories,
    dependencies.lifecycle,
    (message, refusal) => refusal === undefined ? reject(request, "policy-refused", message) : lifecycleRefusal(request, refusal),
    descriptor,
    {
      commandId: request.commandId, actorId: request.requestedBy,
      ...(plan.rerun === undefined ? {} : { sourceBound: { ...plan.rerun, confirmationCommandId: request.commandId } }),
      workflow: plan.workflowId,
      descriptorVersion: plan.descriptorVersion,
      contractFingerprint: plan.descriptorFingerprint,
      ...(plan.requestedInstance === undefined ? {} : { requestedInstance: plan.requestedInstance }),
      resolvedInstance: plan.resolvedInstance,
      configFingerprint: plan.configFingerprint,
      configSnapshotId: plan.configSnapshotId,
      shape: plan.shape,
      priority: plan.priority,
      dryRun: plan.dryRun,
      ...(plan.browserMode === undefined ? {} : { browserMode: plan.browserMode }),
      ...(plan.captureBrowserScreenshots === undefined
        ? {}
        : { captureBrowserScreenshots: plan.captureBrowserScreenshots }),
      ...(plan.stepOmissions === undefined ? {} : { stepOmissions: plan.stepOmissions }),
      ingressSchemaHash: plan.ingressSchemaHash,
      appVersion: dependencies.appVersion,
      // D269: the start is the session; the plan and the operator are its origin.
      session: {
        sessionId: dependencies.ids.uuid(),
        origin: { kind: "start-plan", startPlanId: plan.startPlanId, actorId: request.requestedBy },
      },
    },
    plan.planned.map((planned) => ({
      itemId: planned.itemId,
      title: planned.title, subtitle: planned.subtitle,
      ...(plan.rerun === undefined || repositories.runs.get(plan.rerun.source.runId)?.envelope.itemId !== planned.itemId
        ? {} : { retryOf: plan.rerun.source.runId }),
      matchKey: planned.matchKey,
      rawInput: planned.rawInput,
      parsedInput: planned.input,
    })),
    now,
    `plan ${plan.startPlanId}`,
  );

  return applied(
    request,
    [...affectedTargets, ...fanOut.affectedTargets],
    [...versionChanges, ...fanOut.versionChanges],
  );
}

/**
 * D314 — the two ordinary recovery choices share one door. `retry` (Resume from
 * checkpoints) mints the item's next attempt and lets the executor replay valid
 * checkpoint ancestors; `restart` (Restart from start) mints the same next
 * attempt with `recovery: "restart-from-start"`, so every read and computation
 * executes again while a completed external write is reused, never repeated.
 * Both preserve the logical item, canonical input, omission bundle, dry-run
 * flag and trace lineage; neither is a start with different input.
 */
function executeRetry(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: RunRecoveryCommand,
  _now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  if (current.lifecycle.state === "parked-write") {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is parked on write intent ${current.lifecycle.writeIntentId}; `
      + "a parked unknown write uses resolve-write-present/resolve-write-absent, never generic retry",
    );
  }
  if (!isTerminalRunState(current.lifecycle)) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; only a terminal run can be retried`,
    );
  }
  if (current.envelope.parent !== undefined) {
    reject(
      request,
      "policy-refused",
      `run ${request.target.runId} is a delegated child of ${current.envelope.parent.runId}; `
      + "child retries route through their delegation edge policy, not generic retry",
    );
  }
  const descriptor = resolveDescriptorOrReject(dependencies, request, current.envelope.workflow);
  requireDescriptorMatchesEnvelope(request, descriptor, current);
  if (descriptor.enqueue === "reject-active") {
    const active = activeRunsForItem(repositories, current.envelope.workflow, current.envelope.itemId);
    if (active.length > 0) {
      reject(
        request,
        "policy-refused",
        `${current.envelope.workflow} item ${current.envelope.itemId} already has an active run `
        + `(${active[0].envelope.traceId}); it must settle before a retry starts`,
      );
    }
  }

  const planning = workflowPlanning(descriptor);
  const value = current.input.parsed?.value;
  if (value === undefined) throw new Error("retry source lacks canonical input");
  const record = lifecycleRun(request, dependencies.lifecycle[request.type === "restart" ? "restart" : "retry"]({
    commandId: lifecycleCommandId(`operator-${request.type}`, request.commandId),
    runId: current.envelope.runId, expectedVersion: request.target.expectedVersion,
    runtimeConfig: runtimeToken(repositories), appVersion: dependencies.appVersion,
  }, descriptor, { title: planning.title(value), subtitle: planning.subtitle(value), actorId: request.requestedBy }));
  return applied(request, [runTarget(record.envelope.runId), runTarget(request.target.runId)], [
    { target: runTarget(record.envelope.runId), before: 0, after: record.version },
  ]);

}

interface CancelTarget {
  readonly run: RunRecord;
  readonly dependencyId?: string;
}

/**
 * D246 — CANCEL IS REFUSED WHILE A FENCED WRITE IS STILL UNRESOLVED.
 *
 * Ref write-safety §4.1 has always said cancel "cannot alter the intent", and that
 * sentence is right. What it did not say is what happens NEXT: a cancelled run
 * is terminal, `executeWriteResolution` refuses anything that is not
 * `parked-write`, and `buildParkedWritePayload` throws for any other lifecycle
 * — so the moment the cancel lands, BOTH typed resolutions become unreachable
 * and the durable record reads "this run is over" about a real HR write nobody
 * settled. Cancel was not altering the intent; it was ORPHANING it.
 *
 * So the refusal is at the door rather than at the exit. It is the same shape
 * the rest of this program already takes on an unresolved possible-submit —
 * D118's claim sweeper refuses to requeue a run holding an `attempting` intent,
 * D200 refuses to start over a `claimed` row that holds one, D179's archive
 * `apply` refuses a plan whose candidate could still be mid-submit — and it
 * loses nothing: cancel stays available the instant the write is answered.
 *
 * BOTH unresolved statuses are refused. `parked` is the state the operator can
 * see; `attempting` is the one they cannot, and it is strictly worse, because a
 * run that is not `parked-write` serves no parked-write section at all — a
 * cancel there would strand an intent with no surface that even mentions it.
 *
 * The scan covers EVERY target in the cascade, not just the run the operator
 * named: a cancelled parent whose child holds a fenced write orphans that
 * write exactly the same way, and ref dashboard-surfaces §2.4's tree rule is already that an
 * unusable tree cancels NOTHING.
 */
function refuseCancelOverUnresolvedWrite(
  repositories: AuthorityRepositories,
  request: RunBasicCommand,
  targets: readonly CancelTarget[],
): void {
  for (const target of targets) {
    const runId = target.run.envelope.runId;
    for (const intent of repositories.writeIntents.listByRun(runId)) {
      if (intent.status !== "attempting" && intent.status !== "parked") continue;
      const scope = runId === request.target.runId
        ? `run ${runId}`
        : `run ${runId}, a cascade-cancelled member of ${request.target.runId},`;
      reject(
        request,
        "invalid-state",
        `${scope} holds ${intent.system} write intent ${intent.writeIntentId} at generation `
        + `${String(intent.generation)}, which is ${intent.status}: a real HR transaction was fenced and `
        + "nobody has said whether it landed. Cancelling would settle the run terminal and take both of "
        + "ref write-safety §4.1's typed resolutions off the surface with it, so nothing was cancelled. Record the "
        + "write present or absent first, then cancel.",
      );
    }
  }
}

function executeCancel(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: RunBasicCommand,
  now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before cancelling a tree`,
    );
  }
  if (isTerminalRunState(current.lifecycle)) {
    reject(request, "invalid-state", `run ${request.target.runId} is already terminal; there is nothing to cancel`);
  }

  // The tree comes from authority alone. A child whose delegation edge cannot
  // be resolved makes the tree inconsistent, and an inconsistent tree cancels
  // NOTHING — the whole transaction unwinds (ref dashboard-surfaces §2.4 Cancel).
  const targets: CancelTarget[] = [{ run: current }];
  const dependencyIds: string[] = [];
  const visited = new Set<string>([current.envelope.runId]);
  const walk = (parent: RunRecord): void => {
    const edges = repositories.dependencies.listByParentRun(parent.envelope.runId);
    for (const child of repositories.runs.listChildren(parent.envelope.runId)) {
      const childRunId = child.envelope.runId;
      if (visited.has(childRunId)) {
        throw new Error(`run ${childRunId} appears twice in the dependency tree under ${request.target.runId}`);
      }
      visited.add(childRunId);
      const edge = edges.find((candidate) => candidate.childRunId === childRunId);
      if (edge === undefined) {
        throw new Error(
          `run ${childRunId} is a child of ${parent.envelope.runId} but has no dependency edge in authority; `
          + "the tree is inconsistent, so no target was cancelled",
        );
      }
      if (edge.policy.cascadeCancel !== "cascade") continue;
      dependencyIds.push(edge.dependencyId);
      if (!isTerminalRunState(child.lifecycle)) targets.push({ run: child, dependencyId: edge.dependencyId });
      walk(child);
    }
  };
  walk(current);
  refuseCancelOverUnresolvedWrite(repositories, request, targets);

  const affectedTargets: TargetReference[] = [];
  const versionChanges: VersionChange[] = [];
  for (const target of [...targets].reverse()) {
    const outcome = dependencies.lifecycle.transition({
      commandId: lifecycleCommandId("operator-cancel", { commandId: request.commandId, runId: target.run.envelope.runId }),
      runId: target.run.envelope.runId,
      expectedVersion: target.run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: now },
    });
    const cancelled = lifecycleRun(request, outcome);
    affectedTargets.push(runTarget(target.run.envelope.runId));
    versionChanges.push({
      target: runTarget(target.run.envelope.runId),
      before: target.run.version,
      after: cancelled.version,
    });
  }
  return applied(request, affectedTargets, versionChanges, dependencyIds);
}

/**
 * D308 — delete means delete.
 *
 * The operator's ruling (2026-09-01): *"some runs were just error runs … I
 * should be able to delete normal runs like this and archived runs."* A
 * terminal queue run leaves authority with every row it owns — results,
 * checkpoints, failures, receipts, diagnostics, and its WRITE LEDGER — behind
 * one insert-only tombstone. What this arm decides, and the repository does
 * not, is admission over the TREE: every delegated child must be terminal, and
 * the leaves go first so no `parent_run_id` is left pointing at nothing.
 *
 * Two refusals are the kernel's own. A non-terminal run cannot be deleted —
 * cancel it first, which is the one door that settles a run — and an ARCHIVED
 * run is refused here by name: its door is `delete-archived-run`, which cites
 * the archive record's content digest, so an operator deleting from the
 * Archive can never remove a record other than the one on their screen.
 *
 * What is knowingly given up: the run's `write_intents` rows carry the
 * permanent idempotency keys that stop the same live write from being
 * submitted twice. Deleting a run that WROTE releases those keys. The confirm
 * copy says so; this arm does not second-guess a ruling that was given twice.
 */
function executeDelete(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: RunDeleteCommand,
  _now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before deleting it`,
    );
  }
  if (!isTerminalRunState(current.lifecycle)) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; only a terminal run can be deleted — cancel it first`,
    );
  }
  if (repositories.archivedRuns.isArchived(current.envelope.runId)) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is archived; delete it from the Archive, which cites the record it removes`,
    );
  }
  // A delegated member is one leaf of its group's manifest. Deleting it alone
  // would leave that manifest naming a run nobody holds; the group anchor is
  // the door, and it takes the whole tree leaves-first.
  if (current.envelope.parent !== undefined) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is a delegated member of run ${current.envelope.parent.runId}; delete the group`,
    );
  }
  const order = deleteTreeOrder(repositories, request, current);
  const outcome = dependencies.lifecycle.delete({ commandId: lifecycleCommandId("operator-delete", request.commandId),
    runId: current.envelope.runId, expectedVersion: request.target.expectedVersion });
  if (outcome.state === "refused") lifecycleRefusal(request, outcome.refusal);
  if (outcome.state !== "deleted" && outcome.state !== "applied-already") throw new Error(`delete: ${outcome.state}`);
  return applied(request, order.map((run) => runTarget(run.envelope.runId)), []);
}

/**
 * Leaves first, the target last. Every run in the tree must be terminal: a
 * running child under a failed parent is work in flight, and deleting its
 * parent would orphan it. An inconsistent tree (a child without its edge)
 * refuses the whole delete, exactly as `executeCancel` refuses the cancel.
 */
function deleteTreeOrder(
  repositories: AuthorityRepositories,
  request: CommandRequest,
  root: RunRecord,
): readonly RunRecord[] {
  const order: RunRecord[] = [];
  const visited = new Set<string>([root.envelope.runId]);
  const walk = (parent: RunRecord): void => {
    const edges = repositories.dependencies.listByParentRun(parent.envelope.runId);
    for (const child of repositories.runs.listChildren(parent.envelope.runId)) {
      const childRunId = child.envelope.runId;
      if (visited.has(childRunId)) {
        throw new Error(`run ${childRunId} appears twice in the dependency tree under ${root.envelope.runId}`);
      }
      visited.add(childRunId);
      if (!edges.some((candidate) => candidate.childRunId === childRunId)) {
        throw new Error(
          `run ${childRunId} is a child of ${parent.envelope.runId} but has no dependency edge in authority; `
          + "the tree is inconsistent, so nothing was deleted",
        );
      }
      if (!isTerminalRunState(child.lifecycle)) {
        reject(
          request,
          "invalid-state",
          `run ${root.envelope.runId} has a delegated child ${childRunId} that is ${child.lifecycle.state}; `
          + "every member must be terminal before the tree can be deleted",
        );
      }
      walk(child);
      order.push(child);
    }
  };
  walk(root);
  order.push(root);
  return order;
}

function executeBump(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: RunBasicCommand,
  _now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  /*
   * D233's rule, applied to the one arm the presentation fix did not reach:
   * every run verb CASes THE CALLER'S value. This function used to pass
   * `current.version` — its own re-read, one line above — into the store's
   * `expectedVersion`, which is a compare-and-swap against a value that cannot
   * have moved and therefore a CAS that cannot fail.
   *
   * The blast radius is genuinely smaller than rename's: a stale bump reorders
   * a queued run's claim and is refused outright once the run has left
   * `queued`. That is an argument for the fix being cheap, not for skipping it
   * — "one CAS rule with no exceptions" is the property that makes the
   * discipline checkable, and an exception nobody can see is how the
   * presentation hole survived from Phase 1c.
   *
   * It is checked BEFORE the lifecycle precondition, matching `executeCancel`:
   * a caller holding yesterday's version does not get to learn today's
   * lifecycle from the refusal it gets.
   */
  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before bumping it`,
    );
  }
  if (current.lifecycle.state !== "queued") {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; the scheduler supports no cooperative yield, `
      + "so only a queued run's claim order can be bumped",
    );
  }
  if (current.envelope.priority === "interactive") {
    return applied(request, [runTarget(request.target.runId)], []);
  }
  const outcome = dependencies.lifecycle.transition({
    commandId: lifecycleCommandId("operator-bump", request.commandId),
    priority: "interactive",
    runId: request.target.runId,
    expectedVersion: request.target.expectedVersion,
  });
  requireApplied(outcome, `bumping run ${request.target.runId}`);
  return applied(request, [runTarget(request.target.runId)], [{
    target: runTarget(request.target.runId),
    before: current.version,
    after: current.version + 1,
  }]);
}

/**
 * Ref data-intake-and-edit-data §6 (D166): the Edit-Data save. Fail-closed by construction — an
 * unknown or raced state rejects; the resume claim is the fence and the
 * resume WINS; every patch path must be descriptor-allowlisted; and the
 * whole post-patch output must re-parse through the producing contract's
 * full output schema BEFORE anything durable moves. The accepted patches
 * ride `envelope.injected` and become authority only when a resume replays
 * the checkpoint through the same applier.
 */
function intakeTarget(intakeSessionId: string): TargetReference {
  return { family: "intake", intakeSessionId };
}

/**
 * 2i-B: the inbox lifecycle over D134/D138's durable rows. Read-state and
 * snooze are INDEPENDENT axes — marking read preserves the snooze, snoozing
 * preserves the read state — and a snoozed row still folds durably; snooze
 * only suppresses delivery (ref dashboard-surfaces §2.6, D138).
 */
function executeNotification(
  repositories: AuthorityRepositories,
  request: NotificationCommand,
  now: string,
): CommandApplication {
  const current = repositories.notifications.get(request.target.notificationId);
  if (current === undefined) {
    reject(request, "target-not-found", `notification ${request.target.notificationId} does not exist`);
  }
  if (current.actorId !== request.target.actorId) {
    reject(
      request,
      "invalid-state",
      `notification ${request.target.notificationId} belongs to ${current.actorId}, not ${request.target.actorId}`,
    );
  }
  if (current.trigger === "backfill-gap") {
    reject(
      request,
      "policy-refused",
      "a pinned backfill gap cannot be marked read, marked unread, or snoozed; resnapshot and reconcile the affected work",
    );
  }
  if (current.version !== request.target.expectedVersion) {
    reject(
      request,
      "invalid-state",
      `notification ${request.target.notificationId} moved to version ${String(current.version)} `
      + `(you loaded ${String(request.target.expectedVersion)}); reload the inbox`,
    );
  }
  if (request.type === "notification-snooze" && Date.parse(request.payload.until) <= Date.parse(now)) {
    reject(request, "invalid-state", "a snooze must end in the future");
  }
  repositories.notifications.updateState({
    notificationId: request.target.notificationId,
    expectedVersion: current.version,
    status: request.type === "notification-read"
      ? "read"
      : request.type === "notification-unread"
        ? "unread"
        : current.status,
    snooze: request.type === "notification-snooze"
      ? { state: "snoozed", until: request.payload.until }
      : current.snooze,
    updatedAt: now,
  });
  const target: TargetReference = { family: "notification", notificationId: request.target.notificationId };
  return applied(request, [target], [{
    target,
    before: current.version,
    after: current.version + 1,
  }]);
}

/**
 * Ref data-intake-and-edit-data §2.2 (D170): the five non-enqueue intake arms over the durable
 * session. The ROUTE creates a session — there is deliberately no open arm —
 * and every arm here only MUTATES one, under the repository's version CAS.
 *
 * Three rules run through all five:
 *
 * 1. **The layout is re-derived, never trusted from the request.** A binding
 *    names a column that must be present in THESE bytes under THIS header row,
 *    and `confirm-intake-mapping` additionally proves the caller's
 *    `headerFingerprint` is the fingerprint the file actually presents — a
 *    mapping grid built against a layout that has since moved cannot confirm.
 * 2. **Any change to the mapping unvalidates the session.** A validation is an
 *    assertion about a specific `(layout, bindings, corrections, exclusions)`;
 *    leaving `validated` standing after one of them moves would let a stale
 *    verdict gate an enqueue.
 * 3. **A layout change discards the operator's row-level decisions.** A
 *    correction and an exclusion both name a source row, and a source row means
 *    nothing once the header row or the sheet moves under it. Dropping them
 *    loudly is the only alternative to silently re-pointing them at whoever now
 *    occupies row 17.
 *
 * D171 adds the sixth arm, `enqueue-intake-manifest`, which is the irreversible
 * one: it re-derives the plan, gates on ref data-intake-and-edit-data §5's `enqueueReadiness`, mints
 * the immutable manifest and fans out one run per valid row — all inside the
 * one authority transaction with the session's CAS to `enqueued`, so a refusal
 * on the last row leaves no manifest, no run and no state change.
 */
function executeIntake(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: IntakeCommand,
  now: string,
): CommandApplication {
  const sessionId = request.target.intakeSessionId;
  const current = repositories.intakeSessions.get(sessionId);
  if (current === undefined) reject(request, "target-not-found", `intake session ${sessionId} does not exist`);
  if (request.type !== "enqueue-intake-manifest"
    && current.state !== "mapping" && current.state !== "validated") {
    reject(
      request,
      "invalid-state",
      `intake session ${sessionId} is ${current.state}; only an open session accepts mapping commands`,
    );
  }

  const target = intakeTarget(sessionId);
  const noOp = (): CommandApplication => applied(request, [target], []);
  const applyUpdate = (next: unknown): CommandApplication => {
    const updated = repositories.intakeSessions.update(next);
    return applied(request, [target], [{ target, before: current.version, after: updated.version }]);
  };

  const requireProjection = (): IntakeProjection => {
    const projection = dependencies.intakeProjections.resolve(current.workflow);
    if (projection === undefined) {
      reject(
        request,
        "policy-refused",
        `workflow ${current.workflow} declares no intake projection; it is not spreadsheet-capable, `
        + "so no column can be bound to it",
      );
    }
    return projection;
  };

  const parseAt = (sheet: string, headerRowIndex: number | null) => {
    const parse = IntakeParseSchema.parse(dependencies.intakeParser.parse({
      artifact: current.artifact,
      sheet,
      headerRowIndex,
    }));
    if (parse.state === "refused") {
      reject(
        request,
        "invalid-state",
        `intake session ${sessionId} cannot read its source (${parse.code}): ${parse.message}`,
      );
    }
    return parse;
  };

  /**
   * Every arm but `inspect-intake` acts on the session's SETTLED selection.
   * A null header row is refused rather than re-discovered: a binding minted
   * against a row the session never recorded would name columns the session
   * cannot describe, and its own schema refuses that pairing outright.
   */
  const currentLayout = (): IntakeLayout => {
    const headerRowIndex = current.headerRowIndex;
    if (headerRowIndex === null) {
      reject(
        request,
        "invalid-state",
        `intake session ${sessionId} has no settled header row on sheet ${JSON.stringify(current.sheet)}; `
        + "choose one with inspect-intake before mapping",
      );
    }
    const parse = parseAt(current.sheet, headerRowIndex);
    if (parse.layout === null) {
      throw new Error(
        `intake session ${sessionId} names header row ${String(headerRowIndex)} on sheet `
        + `${JSON.stringify(current.sheet)}, but the parser settled no layout for it`,
      );
    }
    return parse.layout;
  };

  const boundedSourceRow = (layout: IntakeLayout, sourceRow: number): void => {
    if (sourceRow > layout.rows.length) {
      reject(
        request,
        "invalid-state",
        `source row ${String(sourceRow)} is beyond the ${String(layout.rows.length)} data rows sheet `
        + `${JSON.stringify(current.sheet)} holds under header row ${String(layout.headerRowIndex)}`,
      );
    }
  };

  switch (request.type) {
    case "inspect-intake": {
      const selection = resolveInspectSelection(current, request.payload);
      const parse = parseAt(selection.sheet, selection.headerRowIndex);
      // Discovery settles the header row when the operator has not chosen one,
      // so the settled index is the parse's, never the request's.
      const settled = parse.layout === null ? null : parse.layout.headerRowIndex;
      if (selection.sheet === current.sheet && settled === current.headerRowIndex) return noOp();
      return applyUpdate({
        ...current,
        sheet: selection.sheet,
        headerRowIndex: settled,
        bindings: [],
        corrections: [],
        exclusions: [],
        state: "mapping",
        validation: { state: "none" },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "confirm-intake-mapping": {
      const projection = requireProjection();
      const layout = currentLayout();
      if (layout.headerFingerprint !== request.payload.headerFingerprint) {
        reject(
          request,
          "schema-mismatch",
          `this file's layout is ${layout.headerFingerprint.slice(0, 12)}…, not the `
          + `${request.payload.headerFingerprint.slice(0, 12)}… the confirmation was built against; `
          + "reload the mapping grid before confirming a binding",
        );
      }
      if (projection.target(request.payload.targetFieldId) === undefined) {
        reject(
          request,
          "invalid-state",
          `${current.workflow} does not declare intake target ${request.payload.targetFieldId}`,
        );
      }
      const column = layout.columns.find((entry) => entry.sourceColumnId === request.payload.sourceColumnId);
      if (column === undefined) {
        reject(
          request,
          "invalid-state",
          `no column with id ${request.payload.sourceColumnId} is present in this file under header row `
          + `${String(layout.headerRowIndex)}`,
        );
      }
      const held = current.bindings.find((entry) => entry.targetFieldId === request.payload.targetFieldId);
      if (held !== undefined && held.sourceColumnId === request.payload.sourceColumnId) return noOp();
      // THE one mint (ref data-intake-and-edit-data §2.5). It re-proves both checks above against the
      // projection and the detected columns; a suggestion cannot reach it.
      const binding = confirmBinding({
        projection,
        detected: layout.columns,
        targetFieldId: request.payload.targetFieldId,
        sourceColumnId: request.payload.sourceColumnId,
        confirmedAt: now,
      });
      return applyUpdate({
        ...current,
        bindings: [
          ...current.bindings.filter((entry) => entry.targetFieldId !== binding.targetFieldId),
          binding,
        ].sort((left, right) => left.targetFieldId.localeCompare(right.targetFieldId)),
        state: "mapping",
        validation: { state: "none" },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "correct-intake-row": {
      const projection = requireProjection();
      const layout = currentLayout();
      boundedSourceRow(layout, request.payload.sourceRow);
      if (projection.target(request.payload.field) === undefined) {
        reject(
          request,
          "invalid-state",
          `${current.workflow} does not declare intake target ${request.payload.field}`,
        );
      }
      if (!current.bindings.some((entry) => entry.targetFieldId === request.payload.field)) {
        reject(
          request,
          "invalid-state",
          `${request.payload.field} has no bound column, so there is no cell to correct; `
          + "bind a column first",
        );
      }
      const held = current.corrections.find((entry) =>
        entry.sourceRow === request.payload.sourceRow && entry.field === request.payload.field);
      if (held !== undefined && held.correctedValue === request.payload.correctedValue) return noOp();
      return applyUpdate({
        ...current,
        corrections: [
          ...current.corrections.filter((entry) =>
            entry.sourceRow !== request.payload.sourceRow || entry.field !== request.payload.field),
          {
            sourceRow: request.payload.sourceRow,
            field: request.payload.field,
            correctedValue: request.payload.correctedValue,
            correctedAt: now,
          },
        ],
        state: "mapping",
        validation: { state: "none" },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "exclude-intake-row": {
      const layout = currentLayout();
      boundedSourceRow(layout, request.payload.sourceRow);
      const held = current.exclusions.find((entry) => entry.sourceRow === request.payload.sourceRow);
      if (held !== undefined) {
        if (held.reason === request.payload.reason) return noOp();
        reject(
          request,
          "invalid-state",
          `source row ${String(request.payload.sourceRow)} is already excluded (${held.reason}); `
          + "an exclusion records the reason it was made with",
        );
      }
      return applyUpdate({
        ...current,
        exclusions: [
          ...current.exclusions,
          { sourceRow: request.payload.sourceRow, reason: request.payload.reason, excludedAt: now },
        ].sort((left, right) => left.sourceRow - right.sourceRow),
        state: "mapping",
        validation: { state: "none" },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "validate-intake": {
      const projection = requireProjection();
      const descriptor = resolveDescriptorOrReject(dependencies, request, current.workflow);
      const layout = currentLayout();
      const planning = workflowPlanning(descriptor);
      // The pass is RUN and its dispositions are deliberately NOT stored: they
      // are a pure function of the retained inputs plus this exact `readAt`, so
      // a stored copy could only drift, while running it here is what proves
      // the mapping can be applied to these bytes at all — a bound column that
      // vanished throws now rather than at enqueue.
      validateIntakeRows({
        workflow: current.workflow,
        sourceSha256: current.artifact.sha256,
        projection,
        detected: layout.columns,
        bindings: current.bindings,
        rows: layout.rows,
        constants: current.constants,
        corrections: current.corrections,
        excludedRows: current.exclusions.map((entry) => entry.sourceRow),
        readAt: now,
        deriveItemId: (parsedInput) =>
          ItemIdSchema.parse(deriveItemId(current.workflow, planning.matchKey(parsedInput))),
      });
      return applyUpdate({
        ...current,
        state: "validated",
        validation: { state: "validated", validatedAt: now, readAt: now },
        updatedAt: now,
        version: current.version + 1,
      });
    }

    case "enqueue-intake-manifest": {
      if (current.state === "enqueued") {
        reject(
          request,
          "invalid-state",
          `intake session ${sessionId} already enqueued as manifest ${String(current.intakeManifestId)}; `
          + "a manifest fans out exactly once",
        );
      }
      if (current.state !== "validated" || current.validation.state !== "validated") {
        reject(
          request,
          "invalid-state",
          `intake session ${sessionId} is ${current.state}; the pre-run rejection review is mandatory `
          + "(ref data-intake-and-edit-data §5) — validate this mapping, review what it rejects, then run",
        );
      }
      // The ONLY intake arm that CASes. The five mapping arms validate current
      // authority instead, but this one turns a reviewed plan into real HR runs:
      // if anything moved since the operator read the reject list, they are
      // enqueueing a plan they never saw.
      if (current.version !== request.target.expectedVersion) {
        conflict(
          request,
          current.version,
          `intake session ${sessionId} is at version ${String(current.version)}, not `
          + `${String(request.target.expectedVersion)}; the plan you reviewed has moved — reload before running`,
        );
      }
      const sourceName = current.sourceName;
      if (sourceName === undefined) {
        reject(
          request,
          "invalid-state",
          `intake session ${sessionId} retains no source file name, so its manifest could not name the file `
          + "it ran; re-upload the file to start a session that does",
        );
      }
      const reservedManifestId = current.reservedManifestId;
      if (reservedManifestId === undefined) {
        reject(
          request,
          "invalid-state",
          `intake session ${sessionId} predates reserved manifest identities and cannot enqueue without one`,
        );
      }
      const projection = requireProjection();
      const descriptor = resolveDescriptorOrReject(dependencies, request, current.workflow);
      if (request.payload.dryRun && !supportsDryRun(descriptor)) {
        reject(request, "policy-refused", dryRunRefusalMessage(descriptor));
      }
      const layout = currentLayout();
      const planning = workflowPlanning(descriptor);
      const canonicalInputSchemaHash = deriveSchemaHash(descriptor.canonicalInput, "output");
      // Re-derived against the RETAINED `readAt`, so the manifest this writes is
      // the plan the operator reviewed — never one the clock moved underneath.
      const plan = deriveIntakeEnqueuePlan({
        session: {
          workflow: current.workflow,
          artifact: current.artifact,
          sourceName,
          sheet: current.sheet,
          bindings: current.bindings,
          constants: current.constants,
          corrections: current.corrections,
          exclusions: current.exclusions,
          readAt: current.validation.readAt,
        },
        projection,
        layout,
        manifestId: reservedManifestId,
        createdAt: now,
        workflowContractFingerprint: descriptor.contractFingerprint,
        canonicalInputSchemaHash,
        deriveItemId: (parsedInput) =>
          ItemIdSchema.parse(deriveItemId(current.workflow, planning.matchKey(parsedInput))),
      });
      if (!plan.readiness.ready) {
        const rows = plan.readiness.unresolvedRows;
        reject(
          request,
          "policy-refused",
          `${plan.readiness.message} [${plan.readiness.reason}${rows.length === 0 ? "" : `: source rows ${rows.join(", ")}`}]`,
        );
      }

      // The stamped config identity must be a snapshot a reader can fetch back.
      // A run naming a snapshot authority does not hold could never be replayed
      // against the config it actually ran under.
      const { configFingerprint, configSnapshotId } = dependencies.configIdentity;
      const snapshot = repositories.configSnapshots.get(configSnapshotId);
      if (snapshot === undefined) {
        throw new Error(
          `intake session ${sessionId} cannot enqueue: authority holds no config snapshot ${configSnapshotId}`,
        );
      }
      if (snapshot.fingerprint !== configFingerprint) {
        throw new Error(
          `intake session ${sessionId} cannot enqueue: config snapshot ${configSnapshotId} holds fingerprint `
          + `${snapshot.fingerprint.slice(0, 12)}…, not the ${configFingerprint.slice(0, 12)}… this process resolved`,
        );
      }

      const stored = repositories.intakeManifests.insert(plan.manifest);
      if (stored.state !== "inserted") {
        throw new Error(
          `intake session ${sessionId} minted manifest id ${plan.manifest.manifestId}, which already exists; `
          + "refusing to adopt it",
        );
      }

      const fanOut = fanOutQueuedRuns(
        repositories,
        dependencies.lifecycle,
        (message, refusal) => refusal === undefined ? reject(request, "policy-refused", message) : lifecycleRefusal(request, refusal),
        descriptor,
        {
          commandId: request.commandId, actorId: request.requestedBy,
          workflow: current.workflow,
          descriptorVersion: descriptor.version,
          contractFingerprint: descriptor.contractFingerprint,
          resolvedInstance: resolveInstances(descriptor, undefined),
          configFingerprint,
          configSnapshotId,
          // Ref data-intake-and-edit-data §5's coordinator/member fan-out has no runtime yet (nothing
          // mints an `operation` run), so each row is an independent `single`
          // run and the MANIFEST is what joins them — which is the artefact the
          // section makes "42 rows ran" checkable with anyway.
          shape: "single",
          // A spreadsheet fan-out is the definition of bulk, and this is a
          // server stamp rather than a caller claim (ref dashboard-surfaces §1.1).
          priority: "bulk",
          dryRun: request.payload.dryRun,
          ingressSchemaHash: deriveSchemaHash(descriptor.input, "input"),
          appVersion: dependencies.appVersion,
          // D269: the manifest's whole fan-out is ONE session; the manifest and
          // the operator who enqueued it are its origin.
          session: {
            sessionId: dependencies.ids.uuid(),
            origin: {
              kind: "intake-manifest",
              intakeManifestId: plan.manifest.manifestId,
              actorId: request.requestedBy,
            },
          },
        },
        plan.manifest.validRows.map((row) => {
          let canonicalInput: unknown;
          try {
            // D62: the manifest's stored value is re-read through the
            // descriptor's CURRENT canonical schema, never its ingress parser.
            canonicalInput = planning.parseCanonicalInput(row.parsedInput);
          } catch (error) {
            throw new Error(
              `intake manifest ${plan.manifest.manifestId} source row ${String(row.sourceRow)} does not satisfy `
              + `${current.workflow}'s canonical input schema; nothing was enqueued`,
              { cause: error },
            );
          }
          return {
            itemId: row.itemId,
            title: planning.title(row.parsedInput), subtitle: planning.subtitle(row.parsedInput),
            matchKey: planning.matchKey(row.parsedInput),
            // The manifest's own stored value IS this run's ingress: it is what
            // intake submitted, and `validRows[].inputHash` pins its bytes.
            rawInput: row.parsedInput,
            parsedInput: { schemaHash: canonicalInputSchemaHash, value: canonicalInput },
          };
        }),
        now,
        `intake manifest ${plan.manifest.manifestId}`,
      );

      const updated = repositories.intakeSessions.update({
        ...current,
        state: "enqueued",
        intakeManifestId: plan.manifest.manifestId,
        updatedAt: now,
        version: current.version + 1,
      });
      return applied(
        request,
        [target, ...fanOut.affectedTargets],
        [{ target, before: current.version, after: updated.version }, ...fanOut.versionChanges],
      );
    }
  }
}

/**
 * The one presentation verb: `rename`.
 *
 * D234 retired `hide`/`unhide` on the operator's ruling that the queue's model
 * is runs and ARCHIVED runs, with no third hidden class, so this arm no longer
 * has a set of verbs to spell a refusal for and the copy is a constant. If a
 * second presentation verb is ever ratified, the refusal copy goes back to a
 * compiler-checked table keyed on the parameter type — a ternary chain there
 * is how `retry` ends up told to "refresh before renaming it".
 */
function executePresentation(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: RunRenameCommand,
  _now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  /*
   * D233 — CAS THE CALLER'S VALUE, like every other run verb (cancel, bump,
   * write resolution, gate).
   *
   * This arm used to pass `current.version` — its OWN re-read — into the
   * store's `expectedVersion`, which is a compare-and-swap against a value
   * read one line earlier and therefore a CAS that cannot fail. So a stale
   * `Rename` from a tab left open since yesterday applied silently instead of
   * answering `conflict`, and the operator was told "Recorded."
   *
   * It was written that way on a true premise about the verbs D234 has since
   * retired: hiding changes no outcome, task, checkpoint, intent or evidence,
   * so a late one was harmless. RENAME is where that stops being true — a name
   * is a value the operator AUTHORED, and applying yesterday's name over
   * today's silently discards somebody's edit and reports success.
   */
  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before renaming it — the name you are `
      + "holding may not be the name it has",
    );
  }
  const outcome = dependencies.lifecycle.transition({
    commandId: lifecycleCommandId("operator-rename", request.commandId),
    runId: request.target.runId,
    expectedVersion: request.target.expectedVersion,
    displayName: request.payload.displayName,
  });
  lifecycleRun(request, outcome);
  return applied(request, [runTarget(request.target.runId)], [{
    target: runTarget(request.target.runId),
    before: current.version,
    after: current.version + 1,
  }]);
}

function executeWriteResolution(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: WriteResolutionCommand,
  now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before resolving the write`,
    );
  }
  if (current.lifecycle.state !== "parked-write") {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; only a parked-write run has a write to resolve`,
    );
  }
  if (current.lifecycle.writeIntentId !== request.target.writeIntentId
    || current.lifecycle.intentGeneration !== request.target.intentGeneration) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is parked on intent ${current.lifecycle.writeIntentId} `
      + `generation ${String(current.lifecycle.intentGeneration)}, not `
      + `${request.target.writeIntentId} generation ${String(request.target.intentGeneration)}; `
      + "the resolution is stale",
    );
  }
  const intent = repositories.writeIntents.get(request.target.writeIntentId);
  if (intent === undefined) {
    throw new Error(
      `run ${request.target.runId} is parked on write intent ${request.target.writeIntentId}, `
      + "which does not exist in authority; refusing to resolve against an inconsistent store",
    );
  }
  if (intent.status !== "attempting" && intent.status !== "parked") {
    reject(
      request,
      "invalid-state",
      `write intent ${request.target.writeIntentId} is ${intent.status}; a ${intent.status} intent has no operator resolution`,
    );
  }
  if (intent.runId !== request.target.runId) {
    throw new Error(
      `run ${request.target.runId} is parked on write intent ${request.target.writeIntentId}, `
      + `but that intent belongs to run ${intent.runId}; refusing to resolve against an inconsistent store`,
    );
  }
  if (intent.generation !== request.target.intentGeneration) {
    reject(
      request,
      "invalid-state",
      `write intent ${request.target.writeIntentId} is at generation ${String(intent.generation)}, not `
      + `${String(request.target.intentGeneration)}; the resolution is stale`,
    );
  }

  const context: WriteResolutionContext = Object.freeze({ command: request, run: current, intent, now });
  const raw = request.type === "resolve-write-present"
    ? dependencies.writeResolution.resolvePresent(repositories, context)
    : dependencies.writeResolution.resolveAbsent(repositories, context);
  const outcome = WriteResolutionOutcomeSchema.parse(raw);
  if (outcome.run.envelope.runId !== request.target.runId) {
    throw new Error(
      `write resolution for run ${request.target.runId} returned run ${outcome.run.envelope.runId}; `
      + "the executor resolved a different target",
    );
  }
  return applied(request, [runTarget(request.target.runId)], [{
    target: runTarget(request.target.runId),
    before: current.version,
    after: outcome.run.version,
  }]);
}

function executeResolveGate(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<CommandRequest, { family: "gate" }>,
  now: string,
): CommandApplication {
  const current = requireRun(repositories, request, request.target.runId);
  if (current.version !== request.target.expectedVersion) {
    conflict(
      request,
      current.version,
      `run ${request.target.runId} is at version ${String(current.version)}, not `
      + `${String(request.target.expectedVersion)}; refresh before resolving the gate`,
    );
  }
  if (current.lifecycle.state !== "parked-gate") {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is ${current.lifecycle.state}; only a parked-gate run has a gate to resolve`,
    );
  }
  if (current.lifecycle.gateId !== request.target.gateId) {
    reject(
      request,
      "invalid-state",
      `run ${request.target.runId} is parked on gate ${current.lifecycle.gateId}, not ${request.target.gateId}`,
    );
  }
  const descriptor = resolveDescriptorOrReject(dependencies, request, current.envelope.workflow);
  requireDescriptorMatchesEnvelope(request, descriptor, current);
  const node = descriptorRuntimeNodes(descriptor)
    .find((candidate) => candidate.kind === "gate" && String(candidate.id) === String(request.target.gateId));
  if (node === undefined || node.kind !== "gate") {
    throw new Error(
      `run ${request.target.runId} is parked on gate ${request.target.gateId}, which ${descriptor.id} does not declare; `
      + "the stored park is inconsistent with the descriptor",
    );
  }
  const expectedSchemaHash = deriveSchemaHash(node.result, "output");
  if (request.payload.result.schemaHash !== expectedSchemaHash) {
    reject(
      request,
      "schema-mismatch",
      `gate ${request.target.gateId} result is bound to schema ${request.payload.result.schemaHash.slice(0, 12)}…, `
      + `but the descriptor's exact gate schema is ${expectedSchemaHash.slice(0, 12)}…`,
    );
  }
  const parsedValue = node.result.safeParse(request.payload.result.value);
  if (!parsedValue.success) {
    reject(
      request,
      "schema-mismatch",
      `gate ${request.target.gateId} result does not parse through the descriptor's exact gate schema: `
      + `${parsedValue.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  const result = { schemaHash: expectedSchemaHash, value: parsedValue.data };
  const stored = repositories.gateResults.insert({
    runId: request.target.runId,
    gateId: request.target.gateId,
    commandId: request.commandId,
    expectedVersion: request.target.expectedVersion,
    resolvedBy: request.requestedBy,
    resolvedAt: now,
    checkpointFingerprint: deriveGateResultCheckpointFingerprint(result),
    result,
  });
  if (stored.state !== "inserted") {
    throw new Error(
      `gate ${request.target.gateId} on run ${request.target.runId} already holds a stored result `
      + "while the run is still parked; the store is inconsistent",
    );
  }
  const resumed = dependencies.lifecycle.transition({
    commandId: lifecycleCommandId("operator-gate", request.commandId),
    lifecycle: { state: "queued" },
    runId: request.target.runId,
    expectedVersion: current.version,
  });
  lifecycleRun(request, resumed);
  const gateReference: TargetReference = {
    family: "gate",
    runId: request.target.runId,
    gateId: request.target.gateId,
  };
  return applied(request, [gateReference, runTarget(request.target.runId)], [{
    target: gateReference,
    before: current.version,
    after: current.version + 1,
  }]);
}

type WorkerBrowserCommand = Extract<CommandRequest, { family: "worker-browser" }>;

/**
 * The synchronous Phase-1 executor, required. A kernel that adopted the async
 * pool seam refuses the synchronous worker-browser path BY NAME — running a
 * pool effect here would either abandon its promise or fabricate an
 * acknowledgement the process never proved.
 */
function syncWorkerRuntime(dependencies: CommandKernelDependencies): WorkerRuntimeExecutor {
  const runtime = dependencies.workerRuntime;
  if ("pool" in runtime) {
    throw new Error(
      "this kernel adopted the async worker pool seam; worker-browser commands settle only through "
      + "executeWorkerPool, never the synchronous execute path",
    );
  }
  return runtime;
}

/**
 * D269 (ref execution-and-sessions §11.5): the two pool-targeted arms CAS
 * against the durable POOL version — the row's, or 0 for a workflow nobody
 * has planned — before anything else is consulted. A stale basis is a
 * `conflict` naming the current version, so a control can re-read the pool
 * block and try again with a true number; it is never guessed past.
 */
function checkWorkerPoolVersion(
  repositories: AuthorityRepositories,
  request: CommandRequest,
  workflowId: string,
  expectedVersion: number,
): number {
  const current = workerPoolVersion(repositories.workerPools.get(workflowId));
  if (current !== expectedVersion) {
    conflict(
      request,
      current,
      `worker pool ${workflowId} is at version ${String(current)}`
      + `${current === 0 ? " (no worker count has been planned for it yet)" : ""}, not `
      + `${String(expectedVersion)}; re-read the pool before planning or spawning against it`,
    );
  }
  return current;
}

function executeWorkerBrowser(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: WorkerBrowserCommand,
  now: string,
): CommandApplication {
  const context: WorkerRuntimeContext = Object.freeze({ command: request, now });
  const workerRuntime = syncWorkerRuntime(dependencies);
  const checkPoolVersion = (workflowId: string, expectedVersion: number): number =>
    checkWorkerPoolVersion(repositories, request, workflowId, expectedVersion);
  switch (request.type) {
    case "plan-worker-count": {
      resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
      const poolVersion = checkPoolVersion(request.target.workflowId, request.target.expectedVersion);
      // The runtime seam is consulted BEFORE the declaration is written: today
      // it refuses any count but one (P3 replaces that with a reconciliation),
      // and a throw here unwinds the whole command, so the pool never records
      // a count the runtime refused to acknowledge.
      const acknowledgement = WorkerPlanAcknowledgementSchema.parse(
        workerRuntime.planWorkerCount(context),
      );
      const planned = repositories.workerPools.plan({
        workflow: request.target.workflowId,
        expectedVersion: request.target.expectedVersion,
        desiredWorkers: request.payload.desiredWorkers,
        requestedBy: request.requestedBy,
        now,
      });
      requireApplied(planned, `planning worker pool ${request.target.workflowId}`);
      return applied(
        request,
        [
          workerPoolTarget(request.target.workflowId),
          ...acknowledgement.workerIds.map((workerId) => workerTarget(workerId)),
        ],
        [{ target: workerPoolTarget(request.target.workflowId), before: poolVersion, after: poolVersion + 1 }],
      );
    }
    case "spawn-worker": {
      resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
      checkPoolVersion(request.target.workflowId, request.target.expectedVersion);
      const existing = repositories.workerLeases.get(request.payload.workerId);
      if (existing !== undefined && isLiveWorker(existing)) {
        reject(
          request,
          "invalid-state",
          `worker ${request.payload.workerId} already holds a live lease in state ${existing.lifecycle.state}; `
          + "a second process may not answer to the same worker id",
        );
      }
      WorkerRuntimeAcknowledgementSchema.parse(workerRuntime.spawnWorker(context));
      return applied(request, [workerTarget(request.payload.workerId)], []);
    }
    case "stop-worker":
    case "pause-worker":
    case "resume-worker": {
      const lease = repositories.workerLeases.get(request.target.workerId);
      if (lease === undefined) {
        reject(request, "target-not-found", `worker lease ${request.target.workerId} does not exist`);
      }
      if (!isLiveWorker(lease)) {
        reject(
          request,
          "invalid-state",
          `worker ${request.target.workerId} lease is ${lease.lifecycle.state}; `
          + "a stopped worker starts a new lease generation instead of taking directives",
        );
      }
      const directive = request.type === "stop-worker" ? "stop" : request.type === "pause-worker" ? "pause" : "run";
      const outcome = repositories.workerLeases.control({
        workerId: request.target.workerId,
        expectedVersion: lease.version,
        control: {
          directive,
          requestedAt: now,
          requestedBy: request.requestedBy,
          ...(request.reason === undefined ? {} : { reason: request.reason }),
        },
        now,
      });
      requireApplied(outcome, `${request.type} directive on worker ${request.target.workerId}`);
      return applied(request, [workerTarget(request.target.workerId)], [{
        target: workerTarget(request.target.workerId),
        before: lease.version,
        after: lease.version + 1,
      }]);
    }
    case "refresh-browser":
    case "reopen-browser": {
      const lease = repositories.workerLeases.get(request.target.workerId);
      if (lease === undefined) {
        reject(request, "target-not-found", `worker lease ${request.target.workerId} does not exist`);
      }
      if (!isLiveWorker(lease)) {
        reject(
          request,
          "invalid-state",
          `worker ${request.target.workerId} lease is ${lease.lifecycle.state}; `
          + "it owns no live browser session to act on",
        );
      }
      const acknowledgement = request.type === "refresh-browser"
        ? workerRuntime.refreshBrowser(context)
        : workerRuntime.reopenBrowser(context);
      WorkerRuntimeAcknowledgementSchema.parse(acknowledgement);
      return applied(request, [workerTarget(request.target.workerId)], []);
    }
  }
}

/* ── the async worker-pool door (W3, ref execution-and-sessions §11/D271) ── */

/**
 * The adopted pool seam, or undefined for a sync Phase-1 composition. An
 * object carrying BOTH shapes is refused at kernel creation — a dependency
 * that could satisfy either seam would make "which path runs this command"
 * a matter of property-check ordering instead of composition.
 */
function adoptedWorkerPool(
  runtime: WorkerRuntimeExecutor | WorkerPoolRuntimeAdoption,
): WorkerPoolRuntimeSeam | undefined {
  const pool = "pool" in runtime ? runtime.pool : undefined;
  if (pool !== undefined && ("planWorkerCount" in runtime || "spawnWorker" in runtime)) {
    throw new Error(
      "the worker runtime dependency carries BOTH the synchronous Phase-1 executor and an async pool "
      + "adoption; exactly one seam must be composed",
    );
  }
  return pool;
}

/**
 * Read-only preconditions for one worker-browser command, inside a
 * transaction that writes NOTHING: the process effect has not run yet, so
 * there is no authority fact to record — a refusal here reaches no target.
 * Returns the validated CAS basis (the pool row's version for the two
 * pool-targeted arms, the lease's version otherwise).
 */
function validateWorkerPoolCommand(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: WorkerBrowserCommand,
): number {
  switch (request.type) {
    case "plan-worker-count": {
      resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
      return checkWorkerPoolVersion(repositories, request, request.target.workflowId, request.target.expectedVersion);
    }
    case "spawn-worker": {
      resolveDescriptorOrReject(dependencies, request, request.target.workflowId);
      const version = checkWorkerPoolVersion(
        repositories, request, request.target.workflowId, request.target.expectedVersion,
      );
      const existing = repositories.workerLeases.get(request.payload.workerId);
      if (existing !== undefined && isLiveWorker(existing)) {
        reject(
          request,
          "invalid-state",
          `worker ${request.payload.workerId} already holds a live lease in state ${existing.lifecycle.state}; `
          + "a second process may not answer to the same worker id",
        );
      }
      return version;
    }
    case "stop-worker":
    case "pause-worker":
    case "resume-worker": {
      const lease = repositories.workerLeases.get(request.target.workerId);
      if (lease === undefined) {
        reject(request, "target-not-found", `worker lease ${request.target.workerId} does not exist`);
      }
      if (!isLiveWorker(lease)) {
        reject(
          request,
          "invalid-state",
          `worker ${request.target.workerId} lease is ${lease.lifecycle.state}; `
          + "a stopped worker starts a new lease generation instead of taking directives",
        );
      }
      return lease.version;
    }
    case "refresh-browser":
    case "reopen-browser": {
      const lease = repositories.workerLeases.get(request.target.workerId);
      if (lease === undefined) {
        reject(request, "target-not-found", `worker lease ${request.target.workerId} does not exist`);
      }
      if (!isLiveWorker(lease)) {
        reject(
          request,
          "invalid-state",
          `worker ${request.target.workerId} lease is ${lease.lifecycle.state}; `
          + "it owns no live browser session to act on",
        );
      }
      return lease.version;
    }
  }
}

type WorkerPoolSettledAcknowledgement =
  | Readonly<{ kind: "plan"; workerIds: readonly string[] }>
  | Readonly<{ kind: "stop"; directiveLeaseVersions: Readonly<{ before: number; after: number }> }>
  | Readonly<{ kind: "control" }>;

/**
 * Await the pool effect and zod-parse the SETTLED value — never a pending
 * promise, never an unparsed shape. A thrown effect propagates and unwinds
 * the command before any authority fact is written.
 */
async function settleWorkerPoolEffect(
  pool: WorkerPoolRuntimeSeam,
  request: WorkerBrowserCommand,
  context: WorkerRuntimeContext,
): Promise<WorkerPoolSettledAcknowledgement> {
  switch (request.type) {
    case "plan-worker-count": {
      const acknowledgement = WorkerPlanAcknowledgementSchema.parse(await pool.planPoolWorkerCount(context));
      return { kind: "plan", workerIds: acknowledgement.workerIds };
    }
    case "spawn-worker":
      WorkerRuntimeAcknowledgementSchema.parse(await pool.spawnPoolWorker(context));
      return { kind: "control" };
    case "stop-worker": {
      const acknowledgement = WorkerStopPoolAcknowledgementSchema.parse(await pool.stopPoolWorker(context));
      return { kind: "stop", directiveLeaseVersions: acknowledgement.directiveLeaseVersions };
    }
    case "pause-worker":
      WorkerRuntimeAcknowledgementSchema.parse(await pool.pausePoolWorker(context));
      return { kind: "control" };
    case "resume-worker":
      WorkerRuntimeAcknowledgementSchema.parse(await pool.resumePoolWorker(context));
      return { kind: "control" };
    case "refresh-browser":
      WorkerRuntimeAcknowledgementSchema.parse(await pool.refreshPoolBrowser(context));
      return { kind: "control" };
    case "reopen-browser":
      WorkerRuntimeAcknowledgementSchema.parse(await pool.reopenPoolBrowser(context));
      return { kind: "control" };
  }
}

/**
 * Authority facts AFTER the validated acknowledgement. The plan arm writes the
 * desired count from the REQUEST under its original CAS basis — the ack path
 * carries process facts and workerIds, never a count to persist — and the stop
 * arm writes nothing: its durable directive landed through the supervisor's
 * injected graceful-stop channel during the effect, so this transaction only
 * verifies the durable record matches what was acknowledged.
 */
function applyWorkerPoolCommand(
  repositories: AuthorityRepositories,
  request: WorkerBrowserCommand,
  now: string,
  basisVersion: number,
  acknowledgement: WorkerPoolSettledAcknowledgement,
): CommandApplication {
  switch (request.type) {
    case "plan-worker-count": {
      if (acknowledgement.kind !== "plan") {
        throw new Error("plan-worker-count settled without a plan acknowledgement; the pool seam is inconsistent");
      }
      const planned = repositories.workerPools.plan({
        workflow: request.target.workflowId,
        expectedVersion: request.target.expectedVersion,
        desiredWorkers: request.payload.desiredWorkers,
        requestedBy: request.requestedBy,
        now,
      });
      if (planned.state !== "applied") {
        // A cross-process writer moved the pool between this command's
        // phase-A CAS and this transaction (the in-process serialization only
        // covers commands THIS kernel runs). The refusal is typed AND tells
        // the operator the truth about the half that cannot roll back: the
        // process effect already ran.
        conflict(
          request,
          planned.currentVersion,
          `worker pool ${request.target.workflowId} moved to version ${String(planned.currentVersion)} while this `
          + "plan's process effects were executing; the acknowledged reconciliation — including any excess-member "
          + "graceful stop it initiated — has ALREADY executed and stands; re-read the pool before planning again",
        );
      }
      return applied(
        request,
        [
          workerPoolTarget(request.target.workflowId),
          ...acknowledgement.workerIds.map((workerId) => workerTarget(workerId)),
        ],
        [{ target: workerPoolTarget(request.target.workflowId), before: basisVersion, after: basisVersion + 1 }],
      );
    }
    case "spawn-worker":
      // The child's own birth lease IS the authority fact, written by the
      // worker process and proved by the supervisor before it acknowledged.
      return applied(request, [workerTarget(request.payload.workerId)], []);
    case "stop-worker": {
      if (acknowledgement.kind !== "stop") {
        throw new Error("stop-worker settled without a stop acknowledgement; the pool seam is inconsistent");
      }
      const lease = repositories.workerLeases.get(request.target.workerId);
      if (lease === undefined) {
        throw new Error(
          `worker lease ${request.target.workerId} vanished after its stop settled; the durable record is inconsistent`,
        );
      }
      if (lease.control.directive !== "stop" || lease.control.requestedAt !== now) {
        throw new Error(
          `stop-worker for ${request.target.workerId} settled, but authority shows directive `
          + `${lease.control.directive} requested at ${lease.control.requestedAt}, not the acknowledged stop `
          + `at the command's now ${now}; refusing to audit an effect the durable record does not show`,
        );
      }
      // The audited change is the directive WRITE's own before/after (the
      // channel that performed it reported them through the acknowledgement)
      // — never `basisVersion → lease.version`, which would fold unrelated
      // lease bumps landed since into this command's claimed change.
      return applied(request, [workerTarget(request.target.workerId)], [{
        target: workerTarget(request.target.workerId),
        before: acknowledgement.directiveLeaseVersions.before,
        after: acknowledgement.directiveLeaseVersions.after,
      }]);
    }
    case "pause-worker":
    case "resume-worker": {
      const lease = repositories.workerLeases.get(request.target.workerId);
      if (lease === undefined) {
        throw new Error(
          `worker lease ${request.target.workerId} vanished after its ${request.type} was attested; `
          + "the durable record is inconsistent",
        );
      }
      if (!isLiveWorker(lease)) {
        reject(
          request,
          "invalid-state",
          `worker ${request.target.workerId} lease is ${lease.lifecycle.state}; `
          + "a stopped worker starts a new lease generation instead of taking directives",
        );
      }
      const directive = request.type === "pause-worker" ? "pause" : "run";
      const outcome = repositories.workerLeases.control({
        workerId: request.target.workerId,
        expectedVersion: lease.version,
        control: {
          directive,
          requestedAt: now,
          requestedBy: request.requestedBy,
          ...(request.reason === undefined ? {} : { reason: request.reason }),
        },
        now,
      });
      requireApplied(outcome, `${request.type} directive on worker ${request.target.workerId}`);
      return applied(request, [workerTarget(request.target.workerId)], [{
        target: workerTarget(request.target.workerId),
        before: lease.version,
        after: lease.version + 1,
      }]);
    }
    case "refresh-browser":
    case "reopen-browser":
      return applied(request, [workerTarget(request.target.workerId)], []);
  }
}

/**
 * The B→C crash window's honest recovery (a stop only): the crashed delivery's
 * effect is DURABLE — the lease's `control` carries the stop directive the
 * command initiated — but no journal row was written, so without this arm
 * every re-delivery re-consults the supervisor, which rightly refuses (a stop
 * already in flight, or, after a BFF restart, a child it never spawned), and
 * command authority never records a stop that in fact happened.
 *
 * A lease whose control already carries THIS command's stop identity —
 * directive `stop`, the command's exact `requestedBy` and `reason`, an
 * instant not after this delivery's `now` — is replayable evidence of that
 * effect, and the command settles FROM it: journaled and audited applied,
 * with no version change claimed (this delivery wrote nothing, and the
 * original write's versions died with the crashed process). The directive's
 * `requestedAt` cannot be matched to anything this delivery knows — it was
 * minted from the crashed delivery's phase-A clock — so the identity match is
 * actor + reason, exact.
 *
 * The evidence binds only while the target is still live (`isLiveWorker` —
 * a crashed B→C delivery's target is still live, at worst `stopping`): a
 * DEAD lease's directive is the record of a stop that already completed, not
 * of this command's effect, and converging on it would journal "applied" for
 * a command that stopped nothing. A dead lease falls through to the sync
 * path's own typed stopped-worker refusal.
 *
 * On a live lease the directive is a stop IN FLIGHT, so an identity
 * near-miss has exactly one honest answer: a typed refusal NAMING the
 * drifted field (actor, reason, or a postdated `requestedAt`). Falling
 * through instead would hand the command to the supervisor, whose refusal
 * ("a stop is already in flight", or after a restart "never spawned") names
 * none of the mismatch and leaves the drift illegible.
 */
function settleStopFromDurableEvidence(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<WorkerBrowserCommand, { type: "stop-worker" | "pause-worker" | "resume-worker" }>,
  now: string,
): CommandResult | undefined {
  if (request.type !== "stop-worker") {
    throw new Error(`settleStopFromDurableEvidence received a ${request.type} command; only a stop has durable directive evidence`);
  }
  const lease = repositories.workerLeases.get(request.target.workerId);
  if (lease === undefined) return undefined;
  const { control } = lease;
  if (control.directive !== "stop") return undefined;
  if (!isLiveWorker(lease)) return undefined;
  const describeReason = (reason: string | undefined): string =>
    reason === undefined ? "no reason" : `reason "${reason}"`;
  if (control.requestedBy !== request.requestedBy) {
    reject(
      request,
      "invalid-state",
      `worker ${request.target.workerId}'s durable stop directive was `
      + `requested by ${control.requestedBy}, not ${request.requestedBy}; `
      + "a stop is already in flight under a different actor",
    );
  }
  if (control.reason !== request.reason) {
    reject(
      request,
      "invalid-state",
      `worker ${request.target.workerId}'s durable stop directive names `
      + `${describeReason(control.reason)}, not ${describeReason(request.reason)}; `
      + "a stop is already in flight for a different reason",
    );
  }
  if (Date.parse(control.requestedAt) > Date.parse(now)) {
    reject(
      request,
      "invalid-state",
      `worker ${request.target.workerId}'s durable stop directive is postdated: `
      + `its requestedAt ${control.requestedAt} is after this delivery's now ${now}, `
      + "so it cannot be this command's own crashed effect",
    );
  }
  const journal = repositories.commands.insert(request);
  if (journal.state === "existing") {
    throw new Error(
      `stop-worker ${request.commandId} was journaled while its own settle transaction held the authority `
      + "store; the journal is inconsistent",
    );
  }
  const application = applied(request, [workerTarget(request.target.workerId)], []);
  repositories.commandAudits.insert({
    auditId: dependencies.ids.uuid(),
    request,
    result: application.result,
    completedAt: now,
    versionChanges: application.versionChanges,
    affectedDependencyIds: application.affectedDependencyIds,
  });
  return application.result;
}

/**
 * The three-phase pool flow. The authority transaction is synchronous and the
 * pool effect is not, so the flow splits: (A) a read-only transaction settles
 * replay (and, for a stop, the crashed-delivery evidence settle above) and
 * validates the target — a refusal here reaches no target; (B) the effect is
 * awaited OUTSIDE any transaction and its settled value parsed; (C) one
 * transaction journals the command, writes the authority facts the
 * acknowledged effect justifies, and audits the result. The caller holds the
 * per-workflow serialization across all three phases.
 */
async function executeWorkerPoolCommand(
  dependencies: CommandKernelDependencies,
  pool: WorkerPoolRuntimeSeam,
  request: WorkerBrowserCommand,
): Promise<CommandResult> {
  const pre = dependencies.authority.withAuthorityTransaction((repositories) => {
    const now = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
    if (repositories.commands.get(request.commandId) !== undefined) {
      return { kind: "replay" as const, result: replay(dependencies, repositories, request, now) };
    }
    if (request.type === "stop-worker") {
      const settled = settleStopFromDurableEvidence(dependencies, repositories, request, now);
      if (settled !== undefined) return { kind: "settled" as const, result: settled };
    }
    if (request.type === "plan-worker-count" || request.type === "spawn-worker" || request.type === "resume-worker") {
      repositories.runtimeConfig.requireSettingsCurrent();
    }
    return {
      kind: "proceed" as const,
      now,
      basisVersion: validateWorkerPoolCommand(dependencies, repositories, request),
    };
  });
  if (pre.kind !== "proceed") return pre.result;
  const context: WorkerRuntimeContext = Object.freeze({ command: request, now: pre.now });
  const acknowledgement = await settleWorkerPoolEffect(pool, request, context);
  return dependencies.authority.withAuthorityTransaction((repositories) => {
    if (request.type === "plan-worker-count" || request.type === "spawn-worker" || request.type === "resume-worker") {
      repositories.runtimeConfig.requireSettingsCurrent();
    }
    const journal = repositories.commands.insert(request);
    if (journal.state === "existing") return replay(dependencies, repositories, request, pre.now);
    const application = applyWorkerPoolCommand(
      repositories, request, pre.now, pre.basisVersion, acknowledgement,
    );
    repositories.commandAudits.insert({
      auditId: dependencies.ids.uuid(),
      request,
      result: application.result,
      completedAt: pre.now,
      versionChanges: application.versionChanges,
      affectedDependencyIds: application.affectedDependencyIds,
    });
    return application.result;
  });
}

/**
 * The workflow that owns a pool command's target — the serialization unit for
 * the async door. Worker-targeted arms derive it from the canonical pool
 * identity `<workflowId>-worker-<n>` (the exact pattern worker-loop's
 * `poolWorkerId` mints; restated here because a value import of worker-loop
 * would be a module cycle). A worker id outside that shape serializes under
 * its own key, which is provably sufficient: a plan's roster only ever names
 * canonical pool members, so no workflow-scoped command can touch it.
 */
function workerPoolSerializationKey(request: WorkerBrowserCommand): string {
  switch (request.type) {
    case "plan-worker-count":
    case "spawn-worker":
      return `worker-pool:${request.target.workflowId}`;
    case "stop-worker":
    case "pause-worker":
    case "resume-worker":
    case "refresh-browser":
    case "reopen-browser": {
      const match = /^(?<workflowId>.+)-worker-[1-9]\d*$/.exec(request.target.workerId);
      const workflowId = match?.groups?.["workflowId"];
      return workflowId === undefined
        ? `worker-browser:${request.target.workerId}`
        : `worker-pool:${workflowId}`;
    }
  }
}


/* ── version-archive: the D80 archive model (D179) ───────────────────────── */

type VersionArchiveCommand = Extract<CommandRequest, { family: "version-archive" }>;

/**
 * A relaunch mints its plan and consumes it inside ONE transaction, so the TTL
 * never expires in practice. It is stated rather than omitted because the plan
 * row is durable and a reader must be able to see what window it was minted
 * for.
 */
const RELAUNCH_PLAN_TTL_MS = 60_000;

function versionPlanTarget(versionPlanId: string): TargetReference {
  return { family: "version-archive", versionPlanId };
}

/**
 * The registry's identity for a workflow. `undefined` means the descriptor is
 * no longer registered — a real state for an application-scope sweep, and a
 * refusal for a workflow-scope one, because there is nothing to bump TO.
 */
function currentIdentityOf(
  dependencies: CommandKernelDependencies,
  workflowId: string,
): WorkflowVersionIdentity | undefined {
  const descriptor = dependencies.descriptors.resolve(workflowId);
  if (descriptor === undefined) return undefined;
  return {
    workflowId: descriptor.id,
    descriptorVersion: descriptor.version,
    contractFingerprint: descriptor.contractFingerprint,
  } as WorkflowVersionIdentity;
}

function assessOrReject(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: VersionArchiveCommand,
  scope: Extract<VersionArchiveCommand, { type: "plan-version-bump" }>["target"]["scope"],
): ReturnType<typeof assessVersionBump> {
  try {
    return assessVersionBump(
      {
        repositories,
        currentIdentity: (workflowId) => currentIdentityOf(dependencies, workflowId),
        appVersion: dependencies.appVersion,
      },
      scope,
    );
  } catch (error) {
    reject(request, "target-not-found", error instanceof Error ? error.message : String(error));
  }
}

function executeVersionBumpPlan(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<VersionArchiveCommand, { type: "plan-version-bump" }>,
  now: string,
): CommandApplication {
  const { scope } = request.target;
  // The operator's claimed application version is checked against the build
  // that is actually running. A scope nobody can verify is a scope that could
  // archive every run on the strength of a typo.
  if (scope.kind === "application" && scope.applicationVersion !== dependencies.appVersion) {
    reject(
      request,
      "invalid-state",
      `an application-scope bump must name the RUNNING build (${dependencies.appVersion}); `
      + `this plan names ${scope.applicationVersion}`,
    );
  }
  const assessment = assessOrReject(dependencies, repositories, request, scope);
  /**
   * D274: the run sets the plan records are the ones its KIND will act on. A
   * major plan lists what apply will archive and what will refuse it; a minor
   * plan lists neither, because a minor bump archives nothing and cannot be
   * blocked — recording the assessment's raw lists on it would be a review
   * copy that lies about the sweep it reviews.
   */
  const effect = resolveBumpEffect(request.payload.changeRecord.kind, assessment);
  const versionPlanId = dependencies.ids.uuid();
  const plan = VersionBumpPlanSchema.parse({
    archiveSchemaGeneration: CURRENT_ARCHIVE_SCHEMA_GENERATION,
    versionPlanId,
    scope,
    targetVersion: request.payload.targetVersion,
    changeFingerprint: request.payload.changeFingerprint,
    // Charter §25's change record, authored by the person making the change.
    // It rides the PLAN, so the fingerprint the operator's apply cites back
    // covers the words as well as the run sets — an apply cannot rewrite the
    // reason it was reviewed under.
    changeRecord: request.payload.changeRecord,
    observedAppVersion: dependencies.appVersion,
    observedIdentities: assessment.identities,
    candidates: effect.candidates,
    // Charter §25: the flow LISTS the runs that block it. A plan is minted
    // even when it cannot be applied, because the list is the thing the
    // operator needs in order to clear it. (For a MINOR bump the list is
    // empty by D274's definition, not by observation.)
    blockers: effect.blockers,
    plannedBy: request.requestedBy,
    plannedAt: now,
  });
  const stored = repositories.versionPlans.insert(VersionPlanStorageRecordSchema.parse({
    versionPlanId,
    version: 1,
    planFingerprint: versionBumpPlanFingerprint(plan),
    state: "planned",
    plan,
    createdAt: now,
  }));
  if (stored.state !== "inserted") {
    throw new Error(`version plan ${versionPlanId} collided with an existing plan; refusing to reuse it`);
  }
  return applied(request, [versionPlanTarget(versionPlanId)], []);
}

function executeVersionBumpApply(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<VersionArchiveCommand, { type: "apply-version-bump" }>,
  now: string,
): CommandApplication {
  const stored = repositories.versionPlans.get(request.target.versionPlanId);
  if (stored === undefined) {
    reject(request, "target-not-found", `version plan ${request.target.versionPlanId} does not exist; plan before applying`);
  }
  const { plan } = stored;

  /**
   * D274 branches every archive/blocker decision on the bump KIND, and the
   * kind lives on the plan's change record — never on the apply request, so a
   * kind cannot be rewritten between review and apply (the plan fingerprint
   * covers it). A generation-1 plan predates the change record entirely: it
   * declares NO kind, and guessing one — major would archive runs nobody
   * reviewed for archival, minor would silently downgrade a sweep to a no-op —
   * is exactly the substitution fail-loud forbids.
   */
  if (plan.changeRecord === undefined) {
    reject(
      request,
      "policy-refused",
      `version plan ${plan.versionPlanId} predates charter §25's change record and declares no bump kind `
      + "(major archives and can be blocked; minor archives nothing and cannot be — D274); re-plan so the "
      + "kind is reviewed",
    );
  }
  const bumpKind = plan.changeRecord.kind;

  /**
   * Drift, checked BEFORE anything is archived: the plan is a review copy of
   * what the registry looked like, and applying it against a registry that has
   * moved would sweep runs the operator never saw the shape of.
   */
  if (plan.observedAppVersion !== dependencies.appVersion) {
    reject(
      request,
      "policy-refused",
      `version plan ${plan.versionPlanId} was reviewed under app build ${plan.observedAppVersion}; `
      + `this process is ${dependencies.appVersion}. Re-plan against the build you are applying from.`,
    );
  }
  const assessment = assessOrReject(dependencies, repositories, request, plan.scope);
  const planned = canonicalJsonStringify(plan.observedIdentities);
  const current = canonicalJsonStringify(assessment.identities);
  if (planned !== current) {
    reject(
      request,
      "policy-refused",
      `version plan ${plan.versionPlanId} was reviewed against ${planned} but the registry now serves ${current}; `
      + "re-plan before applying",
    );
  }

  /**
   * Charter §25's non-negotiable, and it is checked HERE — inside the applying
   * transaction — not against the plan's own list. A run that went queued
   * between planning and applying is exactly the possible-submit this refusal
   * exists to keep out of an archive. D274 scopes it to the bump's KIND: a
   * minor bump archives nothing, so `resolveBumpEffect` gives it no blockers
   * and no candidates and nothing can refuse it here.
   */
  const effect = resolveBumpEffect(bumpKind, assessment);
  if (effect.blockers.length > 0) {
    reject(
      request,
      "active-version-blockers",
      `${String(effect.blockers.length)} prior-version run(s) are not terminal and must be settled first: `
      + `${effect.blockers.map(describeBlocker).join(", ")}`,
    );
  }

  const consumption = repositories.versionPlans.consume({
    versionPlanId: request.target.versionPlanId,
    expectedVersion: request.target.expectedVersion,
    planFingerprint: request.payload.planFingerprint,
    now,
  });
  if (consumption.state === "refused") {
    if (consumption.code === "version-mismatch") conflict(request, stored.version, consumption.message);
    if (consumption.code === "fingerprint-mismatch") reject(request, "schema-mismatch", consumption.message);
    reject(request, "invalid-state", consumption.message);
  }
  if (consumption.state !== "consumed") {
    throw new Error(
      `version plan ${plan.versionPlanId} reported ${consumption.state} for a first execution of command `
      + `${request.commandId}; an unjournaled command cannot have applied a plan`,
    );
  }

  const applicationId = dependencies.ids.uuid();
  const archivedRunIds = effect.candidates.map(({ runId }) => runId);
  repositories.versionBumpApplications.insert(VersionBumpApplicationSchema.parse({
    archiveSchemaGeneration: CURRENT_ARCHIVE_SCHEMA_GENERATION,
    applicationId,
    versionPlanId: plan.versionPlanId,
    scope: plan.scope,
    targetVersion: plan.targetVersion,
    changeFingerprint: plan.changeFingerprint,
    appliedAppVersion: dependencies.appVersion,
    appliedIdentities: assessment.identities,
    archivedRunIds,
    // Verbatim from the reviewed plan. Re-authoring it at apply would let the
    // recorded reason differ from the one the plan fingerprint covers.
    changeRecord: plan.changeRecord,
    appliedBy: request.requestedBy,
    appliedAt: now,
  }));

  const affectedTargets: TargetReference[] = [versionPlanTarget(plan.versionPlanId)];
  for (const candidate of effect.candidates) {
    const run = repositories.runs.get(candidate.runId);
    if (run === undefined) {
      throw new Error(`run ${candidate.runId} vanished between assessment and archival inside one transaction`);
    }
    const drift = assessment.driftByRunId.get(candidate.runId);
    if (drift === undefined) {
      throw new Error(`run ${candidate.runId} was assessed as prior-version with no recorded drift`);
    }
    // ONE lookup, both frozen facts (D179 label, D242 code). Resolving twice
    // would let a registry that moved between the two calls freeze a label
    // beside a blank code — a half-resolved descriptor the record refuses.
    const registered = dependencies.descriptors.resolve(candidate.workflowId);
    lifecycleRun(request, dependencies.lifecycle.archive({
      commandId: lifecycleCommandId("operator-archive", { commandId: request.commandId, runId: run.envelope.runId }),
      expectedVersion: run.version, archive: deriveArchivedRunRecord({
      repositories,
      run,
      snapshot: dependencies.archiveSnapshots.snapshot(candidate.runId),
      applicationId,
      drift,
      archivedBy: request.requestedBy,
      archivedAt: now,
      workflowLabel: registered?.label,
      workflowCode: registered?.code,
    }) }));
    affectedTargets.push(runTarget(candidate.runId));
  }

  return applied(request, affectedTargets, [{
    target: versionPlanTarget(plan.versionPlanId),
    before: request.target.expectedVersion,
    after: consumption.plan.version,
  }]);
}

/**
 * D308 — the Archive's delete door. The archived record's content digest is
 * cited exactly as a relaunch cites it (ref frontend-backend-integration §5):
 * a mismatch means the operator is looking at a different record than the one
 * their command names, and nothing is removed. The retained `tasks` row and
 * everything under it go with the archive record; the tombstone records the
 * `archive` origin.
 */
function executeArchivedRunDelete(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<VersionArchiveCommand, { type: "delete-archived-run" }>,
  _now: string,
): CommandApplication {
  const archived = repositories.archivedRuns.get(request.target.archivedRunId);
  if (archived === undefined) {
    reject(request, "target-not-found", `archived run ${request.target.archivedRunId} is not in the archive`);
  }
  if (archived.contentDigest !== request.target.archiveFingerprint) {
    reject(
      request,
      "schema-mismatch",
      `archived run ${archived.runId} holds content digest ${archived.contentDigest.slice(0, 12)}…, `
      + `not the ${request.target.archiveFingerprint.slice(0, 12)}… this delete cited`,
    );
  }
  const retained = requireRun(repositories, request, archived.runId);
  const order = deleteTreeOrder(repositories, request, retained);
  const outcome = dependencies.lifecycle.deleteArchived({ commandId: lifecycleCommandId("operator-delete-archive", request.commandId),
    runId: archived.runId, contentDigest: request.target.archiveFingerprint });
  if (outcome.state === "refused") lifecycleRefusal(request, outcome.refusal);
  if (outcome.state !== "deleted" && outcome.state !== "applied-already") throw new Error(`archive delete: ${outcome.state}`);
  return applied(request, order.map((run) => runTarget(run.envelope.runId)), []);
}

function executeArchivedRunRelaunch(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: Extract<VersionArchiveCommand, { type: "relaunch-archived-run" }>,
  now: string,
): CommandApplication {
  const archived = repositories.archivedRuns.get(request.target.archivedRunId);
  if (archived === undefined) {
    reject(request, "target-not-found", `archived run ${request.target.archivedRunId} is not in the archive`);
  }
  // ref frontend-backend-integration §5's "integrity": a relaunch cites the exact bytes it read. A
  // mismatch means the operator is looking at a different record than the one
  // their command names.
  if (archived.contentDigest !== request.target.archiveFingerprint) {
    reject(
      request,
      "schema-mismatch",
      `archived run ${archived.runId} holds content digest ${archived.contentDigest.slice(0, 12)}…, `
      + `not the ${request.target.archiveFingerprint.slice(0, 12)}… this relaunch cited`,
    );
  }
  const descriptor = dependencies.descriptors.resolve(archived.workflowId);
  if (descriptor === undefined) {
    reject(
      request,
      "policy-refused",
      `${archived.workflowId} is no longer registered; an archived run can only be relaunched on a CURRENT `
      + "version, and there is none",
    );
  }

  /**
   * Charter §25: a relaunch is a FRESH run on the current version, planned
   * from the archived RAW submission through today's ingress and canonical
   * schemas. It is never a resume, and it never replays the archived canonical
   * value — that value was validated by a schema which has, by definition,
   * since moved.
   */
  let record;
  try {
    record = planStart(
      {
        authority: { authority: { runs: repositories.runs } },
        clock: dependencies.clock,
        ids: dependencies.ids,
        planTtlMs: RELAUNCH_PLAN_TTL_MS,
      },
      {
        descriptor,
        submissions: [archived.input.raw],
        dryRun: false,
        priority: "interactive",
        shape: "single",
        configFingerprint: dependencies.configIdentity.configFingerprint,
        configSnapshotId: dependencies.configIdentity.configSnapshotId,
        plannedBy: request.requestedBy,
      },
    );
  } catch (error) {
    reject(
      request,
      "policy-refused",
      `archived run ${archived.runId}'s input cannot be planned against the current ${archived.workflowId}: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (record.planned.length !== 1) {
    reject(
      request,
      "policy-refused",
      `archived run ${archived.runId} could not be relaunched: `
      + `${record.refused.map((refusal) => `${refusal.code} — ${refusal.message}`).join("; ")}`,
    );
  }
  const created = repositories.startPlans.create(record);
  if (created.state !== "inserted") {
    throw new Error(`relaunch of ${archived.runId} minted start plan ${record.startPlanId}, which already exists`);
  }
  const consumption = repositories.startPlans.consume({
    startPlanId: record.startPlanId,
    expectedVersion: record.version,
    commandId: request.commandId,
    descriptorFingerprint: record.descriptorFingerprint,
    configFingerprint: record.configFingerprint,
    ingressSchemaHash: record.ingressSchemaHash,
    canonicalInputSchemaHash: record.canonicalInputSchemaHash,
    inputFingerprint: record.inputFingerprint,
    now,
  });
  if (consumption.state !== "consumed") {
    throw new Error(
      `relaunch of ${archived.runId} could not consume the plan it just minted (${consumption.state}); `
      + "the durable record is inconsistent",
    );
  }

  const fanOut = fanOutQueuedRuns(
    repositories,
    dependencies.lifecycle,
    (message, refusal) => refusal === undefined ? reject(request, "policy-refused", message) : lifecycleRefusal(request, refusal),
    descriptor,
    {
      commandId: request.commandId, actorId: request.requestedBy,
      relaunch: { archivedRunId: archived.runId, contentDigest: archived.contentDigest },
      workflow: record.workflowId,
      descriptorVersion: record.descriptorVersion,
      contractFingerprint: record.descriptorFingerprint,
      resolvedInstance: record.resolvedInstance,
      configFingerprint: record.configFingerprint,
      configSnapshotId: record.configSnapshotId,
      shape: record.shape,
      priority: record.priority,
      dryRun: record.dryRun,
      ...(record.browserMode === undefined ? {} : { browserMode: record.browserMode }),
      ...(record.captureBrowserScreenshots === undefined
        ? {}
        : { captureBrowserScreenshots: record.captureBrowserScreenshots }),
      ...(record.stepOmissions === undefined ? {} : { stepOmissions: record.stepOmissions }),
      ingressSchemaHash: record.ingressSchemaHash,
      appVersion: dependencies.appVersion,
      // D269: a relaunch is a dashboard-started group of one, and the archived
      // run it relaunches is the origin the session names.
      session: {
        sessionId: dependencies.ids.uuid(),
        origin: { kind: "archive-relaunch", archivedRunId: archived.runId, actorId: request.requestedBy },
      },
    },
    record.planned.map((entry) => ({
      itemId: entry.itemId,
      title: entry.title, subtitle: entry.subtitle,
      matchKey: entry.matchKey,
      rawInput: entry.rawInput,
      parsedInput: entry.input,
    })),
    now,
    `relaunch of archived run ${archived.runId}`,
  );

  return applied(request, fanOut.affectedTargets, fanOut.versionChanges);
}

function executeVersionArchive(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: VersionArchiveCommand,
  now: string,
): CommandApplication {
  switch (request.type) {
    case "plan-version-bump": return executeVersionBumpPlan(dependencies, repositories, request, now);
    case "apply-version-bump": return executeVersionBumpApply(dependencies, repositories, request, now);
    case "relaunch-archived-run": return executeArchivedRunRelaunch(dependencies, repositories, request, now);
    case "delete-archived-run": return executeArchivedRunDelete(dependencies, repositories, request, now);
  }
}

function executeSettings(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: SettingsCommand,
): CommandApplication {
  if (dependencies.settings === undefined) {
    throw new Error(
      `settings/${request.type} reached a composition with no settings application executor`,
    );
  }
  const requireExpectedRevision = (
    outcomeRevision: number,
    rollback: () => void,
  ): void => {
    const expectedNextRevision = request.target.expectedRevision + 1;
    if (outcomeRevision === expectedNextRevision) return;
    const primary = new Error(
      `settings executor advanced revision ${String(request.target.expectedRevision)} to ${String(outcomeRevision)}; `
      + `exactly ${String(expectedNextRevision)} was required`,
    );
    try {
      rollback();
    } catch (rollbackError) {
      throw new AggregateError(
        [primary, rollbackError],
        `settings command ${request.commandId} returned an invalid revision and rollback also failed`,
        { cause: rollbackError },
      );
    }
    throw primary;
  };
  if (request.type === "apply-settings") {
    const outcome = OrdinarySettingsApplicationOutcomeSchema.parse(
      dependencies.settings.apply(request, repositories),
    );
    if (outcome.state === "conflict") conflict(request, outcome.currentRevision, outcome.message);
    if (outcome.state === "rejected") reject(request, outcome.code, outcome.message);
    requireExpectedRevision(outcome.revision, outcome.rollback);
    const target = { family: "settings" as const, revision: outcome.revision };
    const application = applied(
      request,
      [target],
      [{ target, before: request.target.expectedRevision, after: outcome.revision }],
      [],
      outcome.rollback,
      outcome.commit,
      { kind: "ordinary", revision: outcome.revision, settingsFingerprint: outcome.settingsFingerprint },
    );
    return Object.freeze({
      ...application,
      settingsCurrent: Object.freeze({
        revision: outcome.revision,
        settingsFingerprint: outcome.settingsFingerprint,
        commandFingerprint: deriveSettingsCommandFingerprint(request),
      }),
    });
  }
  const outcome = ProtectedSettingsApplicationOutcomeSchema.parse(
    dependencies.settings.apply(request, repositories),
  );
  if (outcome.state === "conflict") conflict(request, outcome.currentRevision, outcome.message);
  if (outcome.state === "rejected") reject(request, outcome.code, outcome.message);
  requireExpectedRevision(outcome.readback.revision, outcome.rollback);
  const target = { family: "protected-settings" as const, revision: outcome.readback.revision };
  const application = applied(
    request,
    [target],
    [{ target, before: request.target.expectedRevision, after: outcome.readback.revision }],
    [],
    outcome.rollback,
    outcome.commit,
    { kind: "protected", readback: outcome.readback },
  );
  return Object.freeze({
    ...application,
    protectedSettingsCurrent: Object.freeze({
      revision: outcome.readback.revision,
      commandFingerprint: deriveSettingsCommandFingerprint(request),
      entries: Object.entries(outcome.readback.entries).flatMap(([name, entry]) =>
        entry.present ? [{ name, valueId: entry.valueId, updatedAt: entry.updatedAt }] : []),
    }),
  });
}

function executeExplorerEdit(
  dependencies: CommandKernelDependencies,
  request: Extract<CommandRequest, { family: "explorer" }>,
): CommandApplication {
  const executor = dependencies.explorerEdits;
  if (executor === undefined) {
    throw new Error("explorer/apply-explorer-edit is active but no Explorer edit executor is composed");
  }
  const execution = executor.apply(request);
  const outcome = ExplorerEditApplyResultSchema.parse(execution.result);
  if (outcome.state === "conflict") {
    conflict(request, outcome.currentOverrideRevision, outcome.message);
  }
  if (outcome.state === "refused") {
    reject(request, "policy-refused", outcome.message);
  }
  if (outcome.state === "code-change-required") {
    reject(request, "policy-refused", outcome.brief.reason);
  }
  const override = outcome.override;
  if (String(override.workflowId) !== String(request.target.workflowId)
    || override.descriptorVersion !== request.target.expectedVersion
    || override.contractFingerprint !== request.target.contractFingerprint
    || override.revision !== request.target.expectedOverrideRevision + 1
    || canonicalJsonStringify(override) !== canonicalJsonStringify(outcome.readback)) {
    throw new Error(
      `Explorer edit executor returned a readback that does not exactly advance command ${request.commandId}'s target`,
    );
  }
  const target: TargetReference = {
    family: "explorer",
    workflowId: override.workflowId,
    revision: override.revision,
  };
  const application = applied(request, [target], [{
    target,
    before: request.target.expectedOverrideRevision,
    after: override.revision,
  }]);
  return Object.freeze({
    ...application,
    ...(execution.finalizeAfterCommit === undefined
      ? {}
      : { finalizeAfterCommit: execution.finalizeAfterCommit }),
  });
}

/* ── dispatch, journal, and replay ───────────────────────────────────────── */

function dispatchActive(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: CommandRequest,
  now: string,
): CommandApplication {
  switch (request.family) {
    case "start":
      repositories.runtimeConfig.requireSettingsCurrent();
      return executeStartRun(dependencies, repositories, request, now);
    case "worker-browser":
      if (request.type === "plan-worker-count" || request.type === "spawn-worker" || request.type === "resume-worker") {
        repositories.runtimeConfig.requireSettingsCurrent();
      }
      return executeWorkerBrowser(dependencies, repositories, request, now);
    case "gate":
      return executeResolveGate(dependencies, repositories, request, now);
    case "run": {
      switch (request.type) {
        case "retry":
        case "restart":
          repositories.runtimeConfig.requireSettingsCurrent();
          return executeRetry(dependencies, repositories, request, now);
        case "cancel": return executeCancel(dependencies, repositories, request, now);
        case "delete": return executeDelete(dependencies, repositories, request, now);
        case "bump": return executeBump(dependencies, repositories, request, now);
        case "rename": return executePresentation(dependencies, repositories, request, now);
        case "resolve-write-present":
        case "resolve-write-absent":
          return executeWriteResolution(dependencies, repositories, request, now);
      }
      break;
    }
    case "notification":
      return executeNotification(repositories, request, now);
    case "intake":
      if (request.type === "enqueue-intake-manifest") {
        repositories.runtimeConfig.requireSettingsCurrent();
      }
      return executeIntake(dependencies, repositories, request, now);
    case "version-archive":
      if (request.type === "relaunch-archived-run") {
        repositories.runtimeConfig.requireSettingsCurrent();
      }
      return executeVersionArchive(dependencies, repositories, request, now);
    case "explorer":
      return executeExplorerEdit(dependencies, request);
    case "settings":
      return executeSettings(dependencies, repositories, request);
  }
  throw new Error("command dispatch fell through an exhaustive family/action switch");
}

function replay(
  dependencies: CommandKernelDependencies,
  repositories: AuthorityRepositories,
  request: CommandRequest,
  now: string,
): CommandResult {
  const audit = repositories.commandAudits.findByCommand(request.commandId);
  if (audit === undefined) {
    throw new Error(
      `command ${request.commandId} is journaled but has no recorded outcome; refusing to guess what it did`,
    );
  }
  if (audit.result.state !== "applied") {
    throw new Error(
      `command ${request.commandId} recorded outcome ${audit.result.state}; only applied commands are journaled`,
    );
  }
  if (request.family === "start") {
    // D109: the recorded result is returned only after every binding has
    // revalidated against the pre-consume revision the confirmation carried.
    const revalidation = repositories.startPlans.consume({
      startPlanId: request.target.startPlanId,
      expectedVersion: request.target.expectedVersion,
      commandId: request.commandId,
      descriptorFingerprint: request.payload.descriptorFingerprint,
      configFingerprint: request.payload.configFingerprint,
      ingressSchemaHash: request.payload.ingressSchemaHash,
      canonicalInputSchemaHash: request.payload.canonicalInputSchemaHash,
      inputFingerprint: request.payload.inputFingerprint,
      now,
    });
    if (revalidation.state !== "already-consumed") {
      throw new Error(
        `replay of start command ${request.commandId} could not revalidate plan `
        + `${request.target.startPlanId} (${revalidation.state}); the durable record is inconsistent`,
      );
    }
  }
  let settingsVerification:
    | Readonly<{ kind: "ordinary"; value: z.infer<typeof OrdinarySettingsReplayVerificationSchema> }>
    | Readonly<{ kind: "protected"; value: z.infer<typeof ProtectedSettingsReplayVerificationSchema> }>
    | undefined;
  if (request.family === "settings") {
    if (dependencies.settings === undefined) {
      throw new Error(
        `settings/${request.type} replay reached a composition with no settings application executor`,
      );
    }
    const verified = request.type === "apply-settings"
      ? OrdinarySettingsReplayVerificationSchema.parse(
          dependencies.settings.reconcileReplay(repositories, request),
        )
      : ProtectedSettingsReplayVerificationSchema.parse(
          dependencies.settings.reconcileReplay(repositories, request),
        );
    const expectedRevision = request.target.expectedRevision + 1;
    if (verified.revision !== expectedRevision) {
      throw new Error(
        `settings replay ${request.commandId} verified revision ${String(verified.revision)}; `
        + `exactly ${String(expectedRevision)} was required`,
      );
    }
    settingsVerification = request.type === "apply-settings"
      ? { kind: "ordinary", value: verified as z.infer<typeof OrdinarySettingsReplayVerificationSchema> }
      : { kind: "protected", value: verified as z.infer<typeof ProtectedSettingsReplayVerificationSchema> };
  }
  return CommandResultSchema.parse({
    state: "already-applied",
    commandId: request.commandId,
    affectedTargets: audit.result.affectedTargets,
    ...(settingsVerification?.kind === "ordinary" ? {
      restartRequired: true,
      settingsRevision: settingsVerification.value.revision,
      settingsFingerprint: settingsVerification.value.settingsFingerprint,
    } : settingsVerification?.kind === "protected" ? {
      restartRequired: false,
      revision: settingsVerification.value.revision,
      entries: settingsVerification.value.entries,
    } : {}),
  });
}

export function createCommandKernel(dependencies: CommandKernelDependencies): CommandKernel {
  // Validated ONCE at composition: a dependency satisfying both seams is a
  // wiring ambiguity, refused before any command can reach it.
  const pool = adoptedWorkerPool(dependencies.workerRuntime);
  /**
   * Per-workflow FIFO serialization across the pool door's WHOLE A→C flow.
   * Phase A's CAS runs in its own transaction and phase B's process effect
   * outside any transaction, so two in-flight commands could otherwise both
   * validate against the same basis and both run process effects — the
   * loser's durable side effects (a stop directive, an armed escalation for
   * a member the winning plan still desires) standing while its phase C
   * rolls back without a journal trace. Serialized, the loser's phase A sees
   * the winner's version and refuses TYPED, before any effect is initiated.
   *
   * An in-process mutex is a real serialization here because exactly one BFF
   * process owns the worker supervisor: `composeDashboardRuntime` takes the
   * exclusive `server` process lock before composing it, so every pool-effect
   * initiator runs through this kernel. A cross-PROCESS authority writer is
   * still possible and surfaces as the typed phase-C conflict instead.
   */
  const poolCommandTails = new Map<string, Promise<void>>();
  const withPoolCommandSerialization = async (
    key: string,
    work: () => Promise<CommandResult>,
  ): Promise<CommandResult> => {
    const previous = poolCommandTails.get(key);
    let release: () => void = () => undefined;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    poolCommandTails.set(key, current);
    if (previous !== undefined) await previous;
    try {
      return await work();
    } finally {
      if (poolCommandTails.get(key) === current) poolCommandTails.delete(key);
      release();
    }
  };
  const executeSync = (request: CommandRequest): CommandResult => {
      if (DEFERRED_ARM_KEYS.has(`${request.family}/${request.type}`)) {
        // Computed purely: no journal row, no audit row, no generation advance.
        return CommandResultSchema.parse({
          state: "rejected",
          commandId: request.commandId,
          code: "capability-unavailable",
          message: `${request.family}/${request.type} is schema-recognized but its owning later milestone `
            + "has not activated it; no authority state was changed",
        });
      }
      let rollback: (() => void) | undefined;
      let commit: (() => void) | undefined;
      let finalizeAfterCommit: (() => void) | undefined;
      try {
        const result = dependencies.authority.withAuthorityTransaction((repositories) => {
          const now = IsoInstantSchema.parse(dependencies.clock.now().toISOString());
          if (request.family === "explorer") {
            const executor = dependencies.explorerEdits;
            if (executor === undefined) {
              throw new Error("explorer/apply-explorer-edit is active but no Explorer edit executor is composed");
            }
            executor.reconcilePending(
              request,
              createExplorerCommandJournal(repositories).findOutcome,
            );
          }
          if (request.family === "settings") {
            const executor = dependencies.settings;
            if (executor === undefined) {
              throw new Error(
                `settings/${request.type} reached a composition with no settings application executor`,
              );
            }
            const refusal = executor.reconcilePending(repositories, request);
            if (refusal !== undefined) {
              return CommandResultSchema.parse({
                ...SettingsApplyRefusalSchema.parse(refusal),
                commandId: request.commandId,
              });
            }
          }
          const journalRequest = request.family === "settings" ? markSettingsCommand(request) : request;
          const journal = repositories.commands.insert(journalRequest);
          if (journal.state === "existing") return replay(dependencies, repositories, request, now);
          const application = dispatchActive(dependencies, repositories, request, now);
          rollback = application.rollback;
          commit = application.commit;
          const auditId = dependencies.ids.uuid();
          repositories.commandAudits.insert({
            auditId,
            request: journalRequest,
            result: application.result,
            completedAt: now,
            versionChanges: application.versionChanges,
            affectedDependencyIds: application.affectedDependencyIds,
          });
          if (application.settingsCurrent !== undefined) {
            repositories.settingsCurrent.advance({
              ...application.settingsCurrent,
              commandId: request.commandId,
              auditId,
              committedAt: now,
            });
          }
          if (application.protectedSettingsCurrent !== undefined) {
            repositories.protectedSettingsCurrent.advanceInTransaction({
              ...application.protectedSettingsCurrent,
              commandId: request.commandId,
              auditId,
              committedAt: now,
            });
          }
          finalizeAfterCommit = application.finalizeAfterCommit;
          return application.result;
        });
        const committedSettings = commit;
        rollback = undefined;
        commit = undefined;
        committedSettings?.();
        finalizeAfterCommit?.();
        return result;
      } catch (error) {
        if (rollback !== undefined && request.family === "settings") {
          // A transaction wrapper may report an error after durable COMMIT.
          // Only proved journal absence permits compensation; an uncertain
          // inspection leaves file exclusion/evidence intact for reconciliation.
          let committed: CommandResult | undefined;
          try {
            committed = dependencies.authority.withAuthorityTransaction((repositories) => {
              const journaled = repositories.commands.get(request.commandId);
              if (journaled === undefined) return undefined;
              const journalRequest = markSettingsCommand(request);
              if (canonicalJsonStringify(journaled) !== canonicalJsonStringify(journalRequest)) {
                throw new Error(`settings command ${request.commandId} has a different durable envelope`);
              }
              return replay(dependencies, repositories, request, dependencies.clock.now().toISOString());
            });
          } catch (reconciliationError) {
            throw new AggregateError(
              [error, reconciliationError],
              `settings command ${request.commandId} failed and its durable outcome could not be reconciled; rollback refused`,
              { cause: reconciliationError },
            );
          }
          if (committed !== undefined) return committed;
        }
        // A typed refusal already unwound the transaction — every partial arm
        // effect, the journal row included, rolled back. Anything else stays a
        // thrown structured error; the kernel never converts an unknown
        // failure into a plausible typed result.
        if (rollback !== undefined) {
          try {
            rollback();
          } catch (rollbackError) {
            throw new AggregateError(
              [error, rollbackError],
              `command ${request.commandId} failed and its settings-file rollback also failed`,
              { cause: rollbackError },
            );
          }
        }
        if (error instanceof CommandRefusal) return error.result;
        throw error;
      }
  };
  return Object.freeze({
    execute(input: unknown): CommandResult {
      return executeSync(CommandRequestSchema.parse(input));
    },
    async executeWorkerPool(input: unknown): Promise<CommandResult> {
      const request = CommandRequestSchema.parse(input);
      if (request.family !== "worker-browser") {
        throw new Error(
          `executeWorkerPool settles only worker-browser commands; received ${request.family}/${request.type}`,
        );
      }
      if (pool === undefined) return executeSync(request);
      try {
        return await withPoolCommandSerialization(
          workerPoolSerializationKey(request),
          () => executeWorkerPoolCommand(dependencies, pool, request),
        );
      } catch (error) {
        // Typed refusals from phases A and C become their exact typed results;
        // a thrown effect (phase B) stays a thrown structured error — the
        // kernel never converts an unproved process effect into a plausible
        // typed outcome.
        if (error instanceof CommandRefusal) return error.result;
        throw error;
      }
    },
  });
}
import { canonicalJsonStringify } from "../domain/canonical-json.js";
