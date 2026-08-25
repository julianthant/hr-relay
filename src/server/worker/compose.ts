/**
 * The Phase-1f worker composition value: one workflow-scoped browser worker
 * (ref execution-and-sessions §3) assembled from the landed seams and run to a report.
 *
 * It lives in `src/server/` — beside the dashboard composition — because the
 * layer matrix places `server` with `control` ABOVE `core`: this file imports
 * the workflow registry, so it cannot sit in `core/runtime-composition.ts`
 * without a layer inversion. The CLI's `worker` command receives this function
 * through the same injected-seam door the `dashboard` command uses.
 *
 * What it composes, exactly:
 * - the isolation-config state root's `AuthorityDatabase` (claims, leases,
 *   checkpoints, write intents — the one authority);
 * - the `WORKFLOW_MODULES` registry (the descriptor is resolved from
 *   `SERVER_REGISTRY`, never re-derived) and the task-store registry;
 * - the real `PlaywrightWorkerSessionFactory` under the worker-loop-owned
 *   `WorkerSessionManager` (test seam: `sessionFactory`);
 * - the JSONL span writer as the loop's required `SpanEmitter`;
 * - the ref write-safety write sequencer through the loop's `writeSequencerFor` seam, so
 *   its driver leases come from the exact manager the loop's D116 window binds;
 * - one real monotonic deadline scheduler shared by task deadlines, browser
 *   close proofs, idle waits, heartbeats, and the D118 sweep cadence;
 * - the durable worker lease: started before the first claim (a second process
 *   on the same worker id refuses), heartbeated with the TRUE busy/idle state
 *   read from run authority, directive-polled between items, and settled
 *   `stopped` with the honest reason;
 * - the D162 capability wiring (ref data-intake-and-edit-data §4.11): the content-addressed artifact
 *   writer under the isolation-pinned artifact root, and the admitted-provider
 *   wiring — adapter registry, `providerAdmissions` authority repository, the
 *   `configSnapshots` repository the executor reads each run's RETAINED
 *   snapshot from, and the admission id factory. The executor mints admitted
 *   clients per invocation; this root only supplies the kernel's ingredients.
 *
 * Deliberately NOT composed here (each fails loud at its own seam):
 * - the `ChildRunExecutor` delegation seam has no Phase-1 implementation — a
 *   child-run node terminalizes `capability-unavailable` in the interpreter;
 * - the artifact sink projector (D164): no production descriptor declares a
 *   projection yet, and the workbook path is the consuming migration's fact;
 * - automated ref write-safety recovery PROBES: the D118 sweep below routes an expired
 *   claim with an unfinished `attempting` intent to the parked/unclaimable
 *   state and reports it; the typed §4.1 operator resolutions (command kernel)
 *   remain the only release paths in this process.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TaskLogger } from "../../base/task.js";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import { DESCRIPTORS, SERVER_REGISTRY } from "../../control/workflow-registry.js";
import type {
  MonotonicDeadlineHandle,
  MonotonicDeadlineScheduler,
} from "../../core/deadline-scheduler.js";
import type { ProviderAdapterRegistry } from "../../core/provider-admission.js";
import type { RunProviderWiring } from "../../core/run-executor.js";
import {
  poolWorkerId,
  runWorkerLoop,
  type WorkerLoopReport,
} from "../../core/worker-loop.js";
import { composeDuoCeremonyGateFactory } from "../../core/duo-ceremony-gate.js";
import type { DuoCeremonyGateFactory } from "../../core/duo-ceremony-gate.js";
import type { WorkerBrowserSessionFactory } from "../../core/worker-sessions.js";
import { createWriteSequencer } from "../../core/write-sequencer.js";
import { systemClock, type Clock } from "../../domain/clock.js";
import { resolveConfigWithProvenance } from "../../domain/config/resolve.js";
import { systemIdFactory, type IdFactory } from "../../domain/identifiers.js";
import {
  LOCAL_OPERATOR_ACTOR_ID,
  PositiveIntSchema,
  ProviderAdmissionIdSchema,
  WorkflowIdSchema,
} from "../../domain/ids.js";
import type { PositiveInt } from "../../domain/ids.js";
import type { WorkerId, WorkflowId } from "../../domain/ids.js";
import type { WorkerDirective, WorkerLeaseRecord } from "../../domain/run/worker.js";
import {
  configResolutionEnvironment,
  optionalSecretFamily,
  providerModelChain,
} from "../../domain/secrets.js";
import { createContentAddressedArtifactWriter } from "../../infra/artifacts/content-addressed-artifact-writer.js";
import { PlaywrightWorkerSessionFactory } from "../../infra/browser/browser-session-factory.js";
import { createSpanJsonlWriter } from "../../infra/events/span-jsonl-writer.js";
import {
  createCensusGeocodeAdapter,
  createNominatimGeocodeAdapter,
} from "../../infra/providers/geocode-adapters.js";
import { createGeminiOcrExtractAdapter } from "../../infra/providers/gemini-ocr-extract.js";
import { createProviderPool } from "../../infra/providers/provider-pool.js";
import { createTimeoutDeadlineScheduler } from "../scheduling/timeout-deadline-scheduler.js";
import { AuthorityDatabase } from "../../infra/sqlite/index.js";
import { acquireRuntimeProcessLock } from "../../infra/sqlite/runtime-process-locks.js";
import { taskStoreRegistry } from "../../stores/index.js";

/**
 * Cadence defaults. Refs execution-and-sessions/write-safety pin the PROTOCOL (heartbeat renewal, bounded
 * re-poll, recovery-before-requeue) but no numbers, so these are named,
 * overridable composition choices rather than contract values:
 * - heartbeat every 5s renews the run claim and the worker lease;
 * - a claim or lease whose heartbeat is 60s old (12 missed beats) is dead;
 * - the D118 sweep runs on a 30s cadence AND once at boot, BEFORE the first
 *   claim, because recovery has scheduling priority over claim expiry.
 *
 * D200: the boot beat is staleness-gated like every other, so it cannot reach a
 * row this worker id owns with a heartbeat younger than 60s — a crash-restart
 * inside that window. The startup SELF-sweep beside the lease start covers
 * exactly that gap and is not a cadence question at all: it fires once, scoped
 * to this worker id, on the strength of the lease this process just won.
 */
export const WORKER_HEARTBEAT_INTERVAL_MS = 5_000;
export const WORKER_CLAIM_STALE_AFTER_MS = 60_000;
export const WORKER_SWEEP_INTERVAL_MS = 30_000;

/**
 * Ref data-intake-and-edit-data §4.11 (D161): neither repo's `.env` names an OCR model chain, so the
 * composition root names the model EXPLICITLY with provenance — legacy
 * `provider-limits.ts` priority-1 tier-1 — rather than minting a default
 * inside the secrets reader. An operator `OCR_GEMINI_MODELS` chain, when
 * present, takes precedence below.
 */
export const OCR_GEMINI_MODEL_ID = "gemini-3-flash-preview";

/**
 * The one real timer behind the kernel's scheduler port. It MOVED to
 * `src/infra/scheduling/` at D178 — the dashboard process needs it too, for
 * ref operator-trust §4.4's admitted advisory — and is re-exported here so every existing
 * caller keeps its import.
 */
export { createTimeoutDeadlineScheduler };

/** Structured stdout logging for the worker CLI process (never `console.*`). */
export function lineTaskLogger(write: (line: string) => void, clock: Clock): TaskLogger {
  const emit = (level: "debug" | "info" | "warn") =>
    (message: string, fields?: Readonly<Record<string, string | number | boolean>>): void => {
      write(JSON.stringify({ ts: clock.now().toISOString(), level, message, ...fields }));
    };
  return Object.freeze({ debug: emit("debug"), info: emit("info"), warn: emit("warn") });
}

export interface WorkerCliArguments {
  readonly workflowId: WorkflowId;
  readonly poolIndex: PositiveInt;
  /** `--drain`: claim until the queue is idle once, then exit (harness mode). */
  readonly drain: boolean;
}

/** `worker <workflow-id> --pool-index <positive-int> [--drain]` — anything else refuses by name. */
export function parseWorkerArguments(args: readonly string[]): WorkerCliArguments {
  const [first, ...rest] = args;
  if (first === undefined) {
    throw new Error(
      `the worker command needs a workflow id; registered: ${DESCRIPTORS.map(({ id }) => id).join(", ")}`,
    );
  }
  const workflowId = WorkflowIdSchema.parse(first);
  if (SERVER_REGISTRY[workflowId] === undefined) {
    throw new Error(
      `workflow ${workflowId} is not registered; registered: ${DESCRIPTORS.map(({ id }) => id).join(", ")}`,
    );
  }
  let drain = false;
  let poolIndex: PositiveInt | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--drain") {
      if (drain) throw new Error("duplicate worker flag: --drain");
      drain = true;
      continue;
    }
    if (flag === "--pool-index") {
      if (poolIndex !== undefined) throw new Error("duplicate worker flag: --pool-index");
      const raw = rest[index + 1];
      if (raw === undefined || raw.startsWith("--")) {
        throw new Error("worker --pool-index requires a positive integer value");
      }
      if (!/^[1-9]\d*$/u.test(raw)) {
        throw new Error(`worker --pool-index must be a positive integer; received ${raw}`);
      }
      poolIndex = PositiveIntSchema.parse(Number(raw));
      index += 1;
      continue;
    }
    throw new Error(`unknown worker flag: ${String(flag)} (supported: --pool-index <positive-int>, --drain)`);
  }
  if (poolIndex === undefined) {
    throw new Error("the worker command requires --pool-index <positive-int>; no pool index may be guessed");
  }
  return Object.freeze({ workflowId, poolIndex, drain });
}

export interface WorkerComposeInput {
  readonly isolation: RuntimeIsolation;
  /** Raw CLI args after `worker` — see `parseWorkerArguments`. */
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  /** Where the isolation state root resolves from; defaults to `process.cwd()`. */
  readonly repoRoot?: string;
  readonly processId?: number;
  /** Test seam over the concrete Playwright factory; production omits it. */
  readonly sessionFactory?: WorkerBrowserSessionFactory;
  /**
   * Test seam over the Duo ceremony lease gate factory (D267); production
   * omits it and resolves the credential identity at boot. The seam exists
   * for the same reason `sessionFactory` does: a composition test has no
   * credential file, and a fixture gate is still a REAL gate over authority.
   */
  readonly duoCeremony?: DuoCeremonyGateFactory;
  /** Test seam over SIGINT/SIGTERM; production wires the real signals. */
  readonly stopSignal?: AbortSignal;
  readonly log?: TaskLogger;
  readonly heartbeatIntervalMs?: number;
  readonly sweepIntervalMs?: number;
  readonly claimStaleAfterMs?: number;
  /** Structured line sink for the default logger; defaults to stdout. */
  readonly write?: (line: string) => void;
}

interface WorkerMaintenance {
  stop(): void;
  /** The first background failure, retained so the caller re-throws it loudly. */
  failure(): unknown;
}

/**
 * The lease-heartbeat + D118-sweep ticker. Every beat re-reads the lease (a
 * missing lease or an advanced generation means this process is fenced and
 * must stop), reports the TRUE busy/idle lifecycle from run authority, and on
 * the sweep cadence routes expired claims through the store's D118-aware
 * sweeper — an unfinished `attempting` intent parks/reports, never requeues.
 */
function startWorkerMaintenance(input: Readonly<{
  database: AuthorityDatabase;
  scheduler: MonotonicDeadlineScheduler;
  clock: Clock;
  workerId: WorkerId;
  leaseGeneration: number;
  heartbeatIntervalMs: number;
  sweepIntervalMs: number;
  claimStaleAfterMs: number;
  log: TaskLogger;
  onFailure: (error: Error) => void;
}>): WorkerMaintenance {
  const { database, clock, log } = input;
  let stopped = false;
  let failure: unknown;
  let handle: MonotonicDeadlineHandle = { cancel: (): void => undefined };
  let nextSweepAtMonotonicMs = clock.monotonicMs();

  const requireOwnLiveLease = (): WorkerLeaseRecord => {
    const lease = database.authority.workerLeases.get(input.workerId);
    if (lease === undefined) {
      throw new Error(`worker ${input.workerId} lease disappeared from authority; this process must stop`);
    }
    if (lease.leaseGeneration !== input.leaseGeneration) {
      throw new Error(
        `worker ${input.workerId} lease generation advanced to ${String(lease.leaseGeneration)} `
        + `(this process holds ${String(input.leaseGeneration)}); a newer start fenced this process out`,
      );
    }
    if (lease.lifecycle.state === "stopped") {
      throw new Error(
        `worker ${input.workerId} lease was stopped (${lease.lifecycle.reason}) while this process ran; `
        + "refusing to heartbeat a settled lease",
      );
    }
    return lease;
  };

  const sweep = (now: string): void => {
    const staleBefore = new Date(clock.nowMs() - input.claimStaleAfterMs).toISOString();
    // Recovery is not workflow-scoped by nature (ref execution-and-sessions §3): sweep every
    // workflow's expired claims, not just this worker's.
    const outcomes = database.authority.runs.sweepExpiredClaims({ staleBefore, now });
    for (const outcome of outcomes) {
      if (outcome.state === "recovery-required") {
        log.warn(
          "D118: expired claim owns an unfinished attempting write intent; routed to ref write-safety recovery, "
          + "unclaimable until a typed resolution",
          {
            runId: outcome.run.envelope.runId,
            writeIntentId: outcome.writeIntentId,
            intentGeneration: outcome.intentGeneration,
            parked: outcome.parked,
          },
        );
        continue;
      }
      log.info("expired claim requeued", {
        runId: outcome.run.envelope.runId,
        workflow: outcome.run.envelope.workflow,
      });
    }
    for (const expired of database.authority.workerLeases.sweepExpired({ staleBefore, now })) {
      log.warn("worker lease expired and was stopped by the sweep", {
        workerId: expired.workerId,
        workflow: expired.workflow,
      });
    }
  };

  const tick = (): void => {
    if (stopped || failure !== undefined) return;
    try {
      const now = clock.now().toISOString();
      const lease = requireOwnLiveLease();
      const active = database.authority.runs.listByWorker(input.workerId).find((run) =>
        (run.lifecycle.state === "claimed"
          || run.lifecycle.state === "validating"
          || run.lifecycle.state === "running")
        && run.lifecycle.workerId === input.workerId);
      const reported = database.authority.workerLeases.reportLifecycle({
        workerId: input.workerId,
        leaseGeneration: input.leaseGeneration,
        lifecycle: active === undefined
          ? { state: "idle", startedAt: lease.lifecycle.startedAt, heartbeatAt: now }
          : {
            state: "busy",
            startedAt: lease.lifecycle.startedAt,
            heartbeatAt: now,
            runId: active.envelope.runId,
          },
        now,
      });
      if (reported.state !== "applied") {
        throw new Error(`worker ${input.workerId} lease heartbeat reported ${reported.state}: ${reported.message}`);
      }
      if (clock.monotonicMs() >= nextSweepAtMonotonicMs) {
        sweep(now);
        nextSweepAtMonotonicMs = clock.monotonicMs() + input.sweepIntervalMs;
      }
    } catch (error) {
      // Retained AND surfaced through onFailure — a broken heartbeat/sweep is
      // a stop condition (the `failure` field gates every later tick), never
      // a silently skipped beat.
      failure = error;
      input.onFailure(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    handle = input.scheduler.schedule(clock.monotonicMs() + input.heartbeatIntervalMs, tick);
  };
  // The first beat runs SYNCHRONOUSLY: recovery has scheduling priority over
  // claim expiry (ref write-safety §4), so the boot sweep must precede the first claim.
  tick();

  return Object.freeze({
    stop: (): void => {
      stopped = true;
      handle.cancel();
    },
    failure: (): unknown => failure,
  });
}

export async function composeWorkerRuntime(input: WorkerComposeInput): Promise<WorkerLoopReport> {
  const { workflowId, poolIndex, drain } = parseWorkerArguments(input.args);
  const clock = input.clock ?? systemClock;
  const ids = input.ids ?? systemIdFactory;
  const repoRoot = input.repoRoot ?? process.cwd();
  const write = input.write ?? ((line: string): void => {
    process.stdout.write(`${line}\n`);
  });
  const log = input.log ?? lineTaskLogger(write, clock);
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? WORKER_HEARTBEAT_INTERVAL_MS;
  const sweepIntervalMs = input.sweepIntervalMs ?? WORKER_SWEEP_INTERVAL_MS;
  const claimStaleAfterMs = input.claimStaleAfterMs ?? WORKER_CLAIM_STALE_AFTER_MS;

  const module = SERVER_REGISTRY[workflowId];
  if (module === undefined) throw new Error(`workflow ${workflowId} is not registered`);
  const descriptor = module.descriptor;
  const workerId = poolWorkerId(workflowId, poolIndex);

  const env = input.env ?? configResolutionEnvironment();
  const resolved = resolveConfigWithProvenance(env, {}, clock);
  const stateRoot = join(repoRoot, input.isolation.stateRoot);
  mkdirSync(stateRoot, { recursive: true });
  /**
   * D181: the `workers` role lock, taken before the database opens. The
   * authority worker LEASE is the richer fence and stays the one that decides
   * who may claim runs; this file lock answers a question the lease cannot,
   * because `cli storage restore` must know whether a worker is running at a
   * moment when the authority database may be unreadable.
   */
  const processLock = acquireRuntimeProcessLock(
    { processLockRoot: join(repoRoot, input.isolation.processLockRoot), name: "workers", pid: input.processId ?? process.pid },
    clock,
  );
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "rebuild-worker" },
    clock,
  );

  const scheduler = createTimeoutDeadlineScheduler(clock);
  const sessionFactory = input.sessionFactory ?? new PlaywrightWorkerSessionFactory({
    config: resolved.config,
    isolation: input.isolation,
    clock,
    scheduler,
    newSessionId: () => ids.uuid(),
  });
  const emitter = createSpanJsonlWriter({ stateRoot, clock });
  // D267 (ref execution-and-sessions §10): the per-credential Duo ceremony
  // lease, keyed on the credential identity resolved ONCE here — an
  // unresolvable identity refuses the whole worker at boot.
  const duoCeremony = input.duoCeremony ?? composeDuoCeremonyGateFactory({
    config: resolved.config,
    leases: database.authority.duoCeremonyLeases,
    clock,
    scheduler,
  });

  // D162 (ref data-intake-and-edit-data §4.11): ctx.artifacts' writer, shared with the OCR adapter's
  // page reads. The artifact root is the isolation-pinned literal.
  const artifacts = createContentAddressedArtifactWriter({
    workspaceRoot: repoRoot,
    artifactRoot: input.isolation.artifactRoot,
  });

  // D165: the production pool. Model tiers are the OUTER order (legacy
  // provider-limits' priority tiers) and keys rotate WITHIN a tier, so an
  // exhaustion answer advances to the next key before falling down a model
  // tier. No key still composes an EMPTY ocr.extract slot: admission answers
  // a declaring run `adapter-unavailable` loudly instead of this root
  // guessing. The keyless public geocoders always compose.
  const geminiKeys = optionalSecretFamily("geminiApiKeys", env);
  const chain = providerModelChain("geminiApiKeys", env);
  const ocrModels = chain.length > 0 ? chain : [OCR_GEMINI_MODEL_ID];
  const ocrChildren = ocrModels.flatMap((modelId) =>
    geminiKeys.map((apiKey, keyIndex) => ({
      label: `gemini-key${String(keyIndex + 1)}/${modelId}`,
      adapter: createGeminiOcrExtractAdapter({ apiKey, modelId, artifacts, clock }),
    })));
  const adapters: ProviderAdapterRegistry = Object.freeze({
    ...(ocrChildren.length === 0 ? {} : { "ocr.extract": createProviderPool("ocr.extract", ocrChildren) }),
    "geocode.census": createCensusGeocodeAdapter({ clock }),
    "geocode.nominatim": createNominatimGeocodeAdapter({ clock }),
  });
  if (ocrChildren.length === 0) {
    log.warn(
      "no GEMINI_API_KEY in the environment: the ocr.extract pool is not composed, and a run "
      + "declaring that capability is denied adapter-unavailable by admission",
    );
  }
  const providers: RunProviderWiring = Object.freeze({
    adapters,
    repository: database.authority.providerAdmissions,
    configSnapshots: database.authority.configSnapshots,
    idFactory: Object.freeze({
      next: () => ProviderAdmissionIdSchema.parse(ids.uuid()),
    }),
  });

  const stopController = new AbortController();
  const forwardStop = (reason: string) => (): void => {
    stopController.abort(new Error(reason));
  };
  const onSigint = forwardStop(`worker ${workerId} received SIGINT`);
  const onSigterm = forwardStop(`worker ${workerId} received SIGTERM`);
  const externalStop = input.stopSignal;
  const onExternalStop = (): void => {
    stopController.abort(externalStop?.reason instanceof Error
      ? externalStop.reason
      : new Error(`worker ${workerId} received its injected stop signal`));
  };
  if (externalStop !== undefined) {
    if (externalStop.aborted) onExternalStop();
    else externalStop.addEventListener("abort", onExternalStop, { once: true });
  } else {
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);
  }

  try {
    const now = clock.now().toISOString();
    /**
     * Reclaim before acquiring. A worker that dies without settling (SIGKILL,
     * OOM, power loss) leaves a live lease behind, and only a RUNNING worker's
     * maintenance ticker sweeps expired leases — so without this pass the
     * first `start` below refuses forever and the workflow is bricked with no
     * operator path back. The sweep is the same one the ticker runs, at the
     * same staleness threshold (12 missed heartbeats), so a genuinely live
     * second process is still refused: its lease heartbeat is seconds old and
     * cannot be swept. Nothing is assumed about the dead process — the sweep
     * settles the lease it can PROVE is stale, and the new lease takes a fresh
     * generation that fences any revenant.
     */
    for (const expired of database.authority.workerLeases.sweepExpired({
      staleBefore: new Date(clock.nowMs() - claimStaleAfterMs).toISOString(),
      now,
    })) {
      log.warn("stale worker lease reclaimed before start; its process never settled", {
        workerId: expired.workerId,
        workflow: expired.workflow,
      });
    }
    const started = database.authority.workerLeases.start({
      workerId,
      workflow: workflowId,
      processId: input.processId ?? process.pid,
      requestedBy: LOCAL_OPERATOR_ACTOR_ID,
      now,
    });
    if (started.state !== "started") {
      throw new Error(
        `worker ${workerId} cannot start: ${started.message}; a second process may not answer to the same worker id`,
      );
    }
    const leaseGeneration = started.lease.leaseGeneration;

    /**
     * D200 — the startup SELF-sweep, before the first claim.
     *
     * `claimNext` refuses while this worker id still owns a non-terminal run
     * (ref execution-and-sessions §0.3, "one worker, one active item"), and the D118 sweep that
     * would release it lives inside the maintenance ticker of a RUNNING worker.
     * That ticker's first beat already runs before the loop starts, but it is
     * staleness-gated: a worker that dies and restarts inside
     * `claimStaleAfterMs` leaves its own row with a heartbeat NEWER than
     * `staleBefore`, the sweep skips it, and the first poll throws
     * `worker … already holds active run …`. Today that clears only by starting
     * a different workflow's worker or cancelling the run — neither of which is
     * a recovery path.
     *
     * The lease `start` above is what licenses the stronger predicate. It
     * succeeded, so no other process holds this worker id: any row still under
     * it belongs to a process that is gone, whatever its heartbeat says. That
     * is a fact about THIS worker id only, which is why the scope is the
     * request's `workerId` rather than a widened `staleBefore` — widening the
     * threshold would sweep live sibling workers' fresh claims.
     *
     * It is the SAME sweeper, so D118 routing is not re-implemented: a run with
     * an unfinished `attempting` write intent parks (`parked-write`) or stays
     * unclaimable, and NEVER requeues.
     */
    for (const outcome of database.authority.runs.sweepExpiredClaims({ workerId, now })) {
      if (outcome.state === "requeued") {
        log.warn("orphaned claim released before the first poll; its worker never settled", {
          workerId,
          runId: outcome.run.envelope.runId,
          workflow: outcome.run.envelope.workflow,
        });
        continue;
      }
      log.warn("orphaned claim routed to ref write-safety recovery before the first poll", {
        workerId,
        runId: outcome.run.envelope.runId,
        writeIntentId: outcome.writeIntentId,
        parked: outcome.parked,
        // NOT `message`: `lineTaskLogger` spreads fields over the log line, so a
        // field named `message` silently replaces the line's own text.
        reason: outcome.message,
      });
    }
    /*
     * A `claimed`/`validating` row holding an attempting intent has no legal
     * parked-write edge, so no sweep may release it — only ref write-safety §4.1's typed
     * operator resolutions can. Say so HERE, naming the run, instead of letting
     * the first poll throw `already holds active run` with no reason attached.
     */
    const stillHeld = database.authority.runs.listByWorker(workerId)
      .filter(({ lifecycle }) => lifecycle.state === "claimed"
        || lifecycle.state === "validating"
        || lifecycle.state === "running");
    const wedged = stillHeld[0];
    if (wedged !== undefined) {
      throw new Error(
        `worker ${workerId} cannot start: the startup sweep could not release run `
        + `${wedged.envelope.runId} (${wedged.envelope.workflow}), which is still ${wedged.lifecycle.state} `
        + "under this worker id. A run holding an unfinished `attempting` write intent has no legal "
        + "release edge from that state — ref write-safety §4.1's typed operator resolutions "
        + "(resolve-write-present / resolve-write-absent) are the only paths out, and they need a human "
        + "to look in the target system first",
      );
    }

    // Recovery has scheduling priority over claim expiry (ref write-safety §4): one
    // D118-aware sweep runs BEFORE the first claim, then rides the cadence.
    const maintenance = startWorkerMaintenance({
      database,
      scheduler,
      clock,
      workerId,
      leaseGeneration,
      heartbeatIntervalMs,
      sweepIntervalMs,
      claimStaleAfterMs,
      log,
      onFailure: (error) => stopController.abort(error),
    });

    const controlPoll = (): WorkerDirective => {
      const lease = database.authority.workerLeases.get(workerId);
      if (lease === undefined) {
        throw new Error(`worker ${workerId} lease disappeared; refusing to claim without lease authority`);
      }
      if (lease.leaseGeneration !== leaseGeneration) {
        throw new Error(
          `worker ${workerId} lease generation advanced to ${String(lease.leaseGeneration)}; `
          + "this process is fenced and must not claim",
        );
      }
      return lease.control.directive;
    };

    let report: WorkerLoopReport;
    try {
      report = await runWorkerLoop({
        workflowId,
        workerId,
        descriptor,
        stores: taskStoreRegistry,
        authority: database,
        sessionFactory,
        emitter,
        clock,
        ids,
        scheduler,
        taskDeadlineMs: resolved.config.timeouts.taskMs,
        sessionAcquireMs: resolved.config.timeouts.sessionAcquireMs,
        duoCeremony,
        heartbeatIntervalMs,
        idleRepollMs: resolved.config.daemon.idleRepollMs,
        log,
        stopSignal: stopController.signal,
        exitWhenIdle: drain,
        controlPoll,
        providers,
        artifacts,
        writeSequencerFor: (sessions) => createWriteSequencer({
          stores: taskStoreRegistry,
          authority: database,
          sessions,
          emitter,
          clock,
          ids,
          scheduler,
          taskDeadlineMs: resolved.config.timeouts.taskMs,
          operator: LOCAL_OPERATOR_ACTOR_ID,
          log,
        }),
      });
    } catch (loopError) {
      maintenance.stop();
      settleLease(database, clock, workerId, leaseGeneration, "crashed", loopError, log);
      throw loopError;
    }
    maintenance.stop();
    const background = maintenance.failure();
    if (background !== undefined) {
      // The loop settled because maintenance aborted it; the background error
      // is the real cause and must not be flattened into an "abandoned" report.
      settleLease(database, clock, workerId, leaseGeneration, "crashed", background, log);
      throw background instanceof Error
        ? background
        : new Error("worker maintenance failed with a non-Error value", { cause: background });
    }
    settleLease(
      database,
      clock,
      workerId,
      leaseGeneration,
      report.stopped === "stop-directive" ? "operator" : "shutdown",
      undefined,
      log,
    );
    return report;
  } finally {
    if (externalStop !== undefined) externalStop.removeEventListener("abort", onExternalStop);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
    database.close();
    processLock.release();
  }
}

/**
 * Write the honest terminal lease state. When settling AFTER a failure the
 * write error is aggregated with the original — never swallowed, never
 * allowed to mask what actually broke.
 */
function settleLease(
  database: AuthorityDatabase,
  clock: Clock,
  workerId: WorkerId,
  leaseGeneration: number,
  reason: "operator" | "shutdown" | "crashed",
  original: unknown,
  log: TaskLogger,
): void {
  const now = clock.now().toISOString();
  try {
    const lease = database.authority.workerLeases.get(workerId);
    if (lease === undefined) throw new Error(`worker ${workerId} lease disappeared before it could settle`);
    if (lease.leaseGeneration !== leaseGeneration || lease.lifecycle.state === "stopped") {
      // A newer generation or the expiry sweep already owns/settled this lease;
      // writing over it would falsify authority. Loud, structured, and only a
      // report — the caller's own failure (if any) still propagates.
      log.warn("worker lease was already settled or re-owned; leaving it untouched", {
        workerId,
        heldGeneration: leaseGeneration,
        currentGeneration: lease.leaseGeneration,
        currentState: lease.lifecycle.state,
      });
      return;
    }
    const settled = database.authority.workerLeases.reportLifecycle({
      workerId,
      leaseGeneration,
      lifecycle: {
        state: "stopped",
        startedAt: lease.lifecycle.startedAt,
        stoppedAt: now,
        reason,
      },
      now,
    });
    if (settled.state !== "applied") {
      throw new Error(`worker ${workerId} lease settle reported ${settled.state}: ${settled.message}`);
    }
  } catch (settleError) {
    if (original !== undefined) {
      throw new AggregateError(
        [original, settleError],
        `worker ${workerId} failed AND its lease could not settle as ${reason}`,
        { cause: settleError },
      );
    }
    throw settleError;
  }
}
