import { sanitizeDebugText } from "../../logs/debug-events.js";
import { readFileSync as readBuildFile } from "node:fs";
import { appendEmergencyFault, withEmergencyTimelineWriter, importEmergencyFaults } from "../../logs/emergency-faults.js";
import { admitDirectWorker, admitSupervisedWorker } from "../../storage/sqlite/worker-slots.js";
import { z } from "zod";
import { WorkerPoolMemberSchema } from "../../../models/run/worker-slot.js";
import { CommandIdSchema, WorkerIdSchema } from "../../../rules/identity/ids.js";
import { composeRuntimePreflight } from "../preflight/runtime-admission.js";
import type { RuntimePreflightRunnerFactory } from "../preflight/runtime-runners.js";
import { claimWithPreflight } from "../preflight/worker-admission.js";
import { createWorkerBrowserControl } from "../../runtime/workers/worker-browser-control.js";
import { selectRunRuntime } from "../../runs/settings/run-settings.js";
import { createRunResourcesFactory, type BrowserProfileAuthority } from "./worker/run-resources.js";
import { bindFailureCapture } from "../../runs/lifecycle/failure-resolution.js";
import { createCredentialStore } from "../../storage/configuration/credential-store.js";
import { requireRuntimeAdmission, type RuntimeAdmission } from "../../storage/admission/admission.js";
import { hostConfigFacts } from "../../../models/config/host-display.js";

import { RunRecordService, workerRunLifecyclePort, requireLifecycleApplied, sweepWorkerClaims, type WorkerRunLifecyclePort } from "../../runs/lifecycle/run-record-service.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { TaskLogger } from "../../../workflow-kit/task.js";
import { workflowProjections } from "../../../workflow-kit/workflow.js";
import type { WorkflowModule } from "../../../workflow-kit/workflow-definition.js";
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";
import { DESCRIPTORS, SERVER_REGISTRY } from "../registries/workflow-registry.js";
import type { MonotonicDeadlineHandle, MonotonicDeadlineScheduler } from "../../runtime/scheduling/deadline-scheduler.js";
import { runWorkerLoop, type WorkerLoopReport } from "../../runtime/workers/worker-loop.js";
import type { DuoCeremonyGateFactory } from "../../runtime/gates/duo-ceremony-gate.js";
import type { WorkerBrowserSessionFactory } from "../../runtime/workers/worker-sessions.js";
import { createWriteSequencer } from "../../runtime/writes/write-sequencer.js";
import { createGateSourceRuntime, type GateSourcePort } from "../../runtime/gates/gate-source-runtime.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";
import { resolveConfigWithProvenance } from "../config/resolve.js";
import { systemIdFactory, type IdFactory } from "../../../rules/identity/identifiers.js";
import { LOCAL_OPERATOR_ACTOR_ID, PositiveIntSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import type { PositiveInt } from "../../../rules/identity/ids.js";
import type { WorkerId, WorkflowId } from "../../../rules/identity/ids.js";
import type { WorkerDirective, WorkerLeaseRecord } from "../../../models/run/worker.js";
import { assertNoMigratedEnvironmentKeys } from "../../../models/config/secrets.js";
import { hostAwareResolutionEnvironment } from "../../../models/config/secrets.js";
import { probePrimaryDisplay } from "../host/primary-display.js";
import { createContentAddressedArtifactWriter } from "../../storage/artifacts/content-addressed-artifact-writer.js";
import { createDiagnosticCaptureService } from "../../logs/diagnostics/diagnostic-capture.js";
import { createRunBrowserScreenshotCapture, createRunDiagnosticCapture } from "../../logs/diagnostics/run-diagnostic-capture.js";
import { withCurrentSettings, createCredentialSecretSource, readSettings, requireCurrentSettings } from "../../runtime/settings/settings-runtime.js";
import { createTimelineEmitter } from "../../storage/events/timeline-emitter.js";
import { createDebugEventWriter } from "../../logs/debug-events.js";
import { createNoteTimelineWriter } from "../../storage/events/note-timeline-writer.js";


import { createTimeoutDeadlineScheduler } from "../../runtime/scheduling/timeout-deadline-scheduler.js";
import { AuthorityDatabase } from "../../storage/sqlite/index.js";
import { assertWorkerProcessCustody, bindWorkerProcessAdmission, type ProcessIdentityObserver, type RuntimeProcessLockHandle } from "../../storage/sqlite/runtime-process-locks.js";
import { taskStoreRegistry } from "../registries/task-registry.js";

// Cadences are composition choices; the contracts constrain renewal and recovery ordering, not numeric defaults.
export const WORKER_HEARTBEAT_INTERVAL_MS = 5_000;
export const WORKER_CLAIM_STALE_AFTER_MS = 60_000;
export const WORKER_SWEEP_INTERVAL_MS = 30_000;

export { createTimeoutDeadlineScheduler };

/** Structured stdout logging for the worker CLI process (never `console.*`). */
export function lineTaskLogger(write: (line: string) => void, clock: Clock): TaskLogger {
  const emit = (level: "debug" | "info" | "warn") =>
    (message: string, fields?: Readonly<Record<string, string | number | boolean>>): void => {
      const safeFields = Object.fromEntries(Object.entries(fields ?? {}).filter(([key]) => !/password|token|cookie|authorization|privatekey|challenge|signature/iu.test(key))
        .map(([key, value]) => [key, typeof value === "string" ? sanitizeDebugText(value) : value]));
      write(JSON.stringify({ ts: clock.now().toISOString(), level, message: sanitizeDebugText(message), ...safeFields }));
    };
  return Object.freeze({ debug: emit("debug"), info: emit("info"), warn: emit("warn") });
}

export interface WorkerCliArguments {
  readonly workflowId: WorkflowId;
  readonly poolIndex: PositiveInt;
  /** `--drain`: claim until the queue is idle once, then exit (harness mode). */
  readonly drain: boolean;
  readonly launch?: Readonly<{ workerId: WorkerId; ordinal: PositiveInt; membershipRevision: PositiveInt; commandId: string }>;
}

/** `worker <workflow-id> --pool-index <positive-int> [--drain]` — anything else refuses by name. */
export function parseWorkerArguments(args: readonly string[], scenarioStepProofId?: WorkflowId): WorkerCliArguments {
  const [first, ...rest] = args;
  if (first === undefined) {
    throw new Error(
      `the worker command needs a workflow id; registered: ${DESCRIPTORS.map(({ id }) => id).join(", ")}`,
    );
  }
  const workflowId = WorkflowIdSchema.parse(first);
  if (SERVER_REGISTRY[workflowId] === undefined && workflowId !== scenarioStepProofId) {
    throw new Error(
      `workflow ${workflowId} is not registered; registered: ${DESCRIPTORS.map(({ id }) => id).join(", ")}`,
    );
  }
  let drain = false;
  let poolIndex: PositiveInt | undefined;
  const launchFields = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (flag === "--drain") {
      if (drain) throw new Error("duplicate worker flag: --drain");
      drain = true;
      continue;
    }
    if (flag === "--worker-id" || flag === "--ordinal" || flag === "--membership-revision" || flag === "--launch-command-id") {
      if (launchFields.has(flag)) throw new Error(`duplicate worker flag: ${flag}`);
      const raw = rest[index + 1];
      if (raw === undefined || raw.startsWith("--")) throw new Error(`worker ${flag} requires its admitted value`);
      launchFields.set(flag, raw); index += 1; continue;
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
      const numeric = Number(raw);
      if (!Number.isSafeInteger(numeric)) {
        throw new Error(`worker --pool-index must be a positive safe integer; received ${raw}`);
      }
      poolIndex = PositiveIntSchema.refine(value => value <= 3, "worker pool index cannot exceed three").parse(numeric);
      index += 1;
      continue;
    }
    throw new Error(`unknown worker flag: ${String(flag)} (supported: --pool-index <positive-int>, --drain)`);
  }
  if (poolIndex === undefined) {
    throw new Error("the worker command requires --pool-index <positive-int>; no pool index may be guessed");
  }
  if (launchFields.size === 0) return Object.freeze({ workflowId, poolIndex, drain });
  const launch = z.strictObject({ workerId: WorkerIdSchema, ordinal: PositiveIntSchema,
    membershipRevision: PositiveIntSchema, commandId: CommandIdSchema }).parse({
    workerId: launchFields.get("--worker-id"), ordinal: Number(launchFields.get("--ordinal")),
    membershipRevision: Number(launchFields.get("--membership-revision")), commandId: launchFields.get("--launch-command-id") });
  WorkerPoolMemberSchema.parse({ workflowId, poolIndex, workerId: launch.workerId, ordinal: launch.ordinal, membershipRevision: launch.membershipRevision });
  return Object.freeze({ workflowId, poolIndex, drain, launch });
}

export interface WorkerComposeInput {
  readonly takeInitialCustody?: () => RuntimeProcessLockHandle | undefined;
  readonly admission?: RuntimeAdmission;
  readonly preflightRunnerFactory?: RuntimePreflightRunnerFactory;
  readonly isolation: RuntimeIsolation;
  /** Raw CLI args after `worker` — see `parseWorkerArguments`. */
  readonly args: readonly string[];
  /** Isolated dry-run-scenario proof; ordinary workers resolve only the active registry. */
  readonly scenarioStepProofModule?: WorkflowModule;
  readonly env?: NodeJS.ProcessEnv;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  /** Where the isolation state root resolves from; defaults to `process.cwd()`. */
  readonly repoRoot?: string;
  readonly processId?: number;
  /** Test seam for synthetic process ids; production always observes the OS. */
  readonly processIdentityObserver?: ProcessIdentityObserver;
  /** Test seam for proving process-record cleanup when authority open fails. */
  readonly openDatabase?: (
    options: Readonly<{ path: string; busyTimeoutMs: number; migrationOwner: string }>,
    clock: Clock,
  ) => AuthorityDatabase;
  /** Test seam for proving process-record cleanup when database close fails. */
  readonly closeDatabase?: (database: AuthorityDatabase) => void;
  /** Test-only observation/crash hooks for the settings exclusion boundary. */
  /** Test seam over the concrete Playwright factory; production omits it. */
  readonly sessionFactory?: WorkerBrowserSessionFactory;
  readonly createSessionFactory?: (profiles: BrowserProfileAuthority) => WorkerBrowserSessionFactory;
  /** Registered non-operator gate sources; production workflows without a provider fail at the gate. */
  readonly gateSourcePorts?: readonly GateSourcePort[];
  // Tests may inject the ceremony factory without configuring live credential identity.
  readonly duoCeremony?: DuoCeremonyGateFactory;
  /** Test seam over SIGINT/SIGTERM; production wires the real signals. */
  readonly stopSignal?: AbortSignal;
  readonly log?: TaskLogger;
  readonly heartbeatIntervalMs?: number;
  readonly sweepIntervalMs?: number;
  readonly claimStaleAfterMs?: number;
  // Runs inside the authority transaction after lease inspection and before claim admission.
  readonly afterClaimAdmissionCheck?: () => void;
  /** Structured line sink for the default logger; defaults to stdout. */
  readonly write?: (line: string) => void;
}

interface WorkerMaintenance {
  stop(): void;
  /** The first background failure, retained so the caller re-throws it loudly. */
  failure(): unknown;
}


function startWorkerMaintenance(input: Readonly<{
  database: AuthorityDatabase;
  lifecycle: WorkerRunLifecyclePort;
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
    const outcomes = sweepWorkerClaims(database, input.lifecycle, { staleBefore, now });
    for (const outcome of outcomes) {
      if (outcome.state === "recovery-required") {
        log.warn(
          "expired claim owns an unfinished attempting write intent; routed to ref write-safety recovery, "
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
      const run = requireLifecycleApplied(outcome);
      log.info("expired claim settled", {
        runId: run.envelope.runId,
        workflow: run.envelope.workflow,
        state: run.lifecycle.state,
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
          ? lease.control.directive === "pause"
            ? { state: "paused", startedAt: lease.lifecycle.startedAt, heartbeatAt: now, pausedAt: lease.lifecycle.state === "paused" ? lease.lifecycle.pausedAt : now }
            : { state: "idle", startedAt: lease.lifecycle.startedAt, heartbeatAt: now }
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
  const admission = requireRuntimeAdmission(input.admission);
  const { workflowId, poolIndex, drain, launch } = parseWorkerArguments(
    input.args, input.scenarioStepProofModule?.descriptor.id,
  );
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

  const scenarioModule = input.scenarioStepProofModule;
  if (scenarioModule !== undefined && (scenarioModule.role.kind !== "chunk-harness" || !drain)) {
    throw new Error("scenario step proof requires a chunk harness and a draining worker");
  }
  const module = SERVER_REGISTRY[workflowId]
    ?? (scenarioModule?.descriptor.id === workflowId ? scenarioModule : undefined);
  if (module === undefined) throw new Error(`workflow ${workflowId} is not registered`);
  const descriptor = module.descriptor;
  const resolveDescriptor = (id: string) => SERVER_REGISTRY[id]?.descriptor
    ?? (scenarioModule?.descriptor.id === id ? scenarioModule.descriptor : undefined);



  const env = input.env ?? hostAwareResolutionEnvironment(probePrimaryDisplay);
  assertNoMigratedEnvironmentKeys(env);
  const hostFacts = hostConfigFacts(env);
  const stateRoot = admission.stateRoot;
  mkdirSync(stateRoot, { recursive: true });
  const processLockRoot = join(repoRoot, input.isolation.processLockRoot);
  const authorityPath = join(stateRoot, "state.db");
  const initialCustody = input.takeInitialCustody?.();
  const bound = bindWorkerProcessAdmission({ processLockRoot, authorityPath, pid: input.processId ?? process.pid,
    ...(initialCustody === undefined ? {} : { initialCustody }),
    ...(launch === undefined ? {} : { workerId: launch.workerId }), clock,
    hooks: { observeProcessIdentity: input.processIdentityObserver },
    open: () => {
      admission.assertAuthorityDatabase(authorityPath);
      try {
        return (input.openDatabase ?? ((options, openClock) => AuthorityDatabase.open(admission, options, openClock)))(
        { path: authorityPath, busyTimeoutMs: 5000, migrationOwner: "rebuild-worker" }, clock);
      } catch (error) {
        appendEmergencyFault({ stateRoot, build: z.object({ version: z.string() }).parse(JSON.parse(readBuildFile(join(repoRoot, "package.json"), "utf8"))).version, code: "DATABASE_WRITER_UNAVAILABLE", error: error instanceof Error ? error : new Error("Database writer unavailable"), now: clock.now() });
        throw error;
      }
    },
    close: input.closeDatabase ?? (value => value.close()),
    admit: (database, acquisitionId) => database.withAuthorityTransaction(repositories => {
      readSettings(repositories);
      if (launch === undefined) {
        const before = repositories.workerPools.get(workflowId);
        return admitDirectWorker(repositories, { commandId: ids.uuid(), workflow: workflowId, poolIndex,
          expectedPoolVersion: before?.version ?? 0, processId: input.processId ?? process.pid,
          processAcquisitionId: acquisitionId, authorityPath, processLockRoot, now: clock.now().toISOString() }, ids.uuid()).workerId;
      }
      return admitSupervisedWorker(repositories, { member: { workflowId, poolIndex, workerId: launch.workerId,
        ordinal: launch.ordinal, membershipRevision: launch.membershipRevision }, commandId: launch.commandId, now: clock.now().toISOString() });
    }),
  });
  const { value: database, workerId, processLock } = bound;
  let runtimeError: unknown;
  const cleanupErrors: unknown[] = [];
  let runtimeReport: WorkerLoopReport | undefined;

  importEmergencyFaults(stateRoot, database.authority.timelineEvents);
  const loggingRepository = withEmergencyTimelineWriter(database.authority.timelineEvents, { stateRoot, clock, build: z.object({ version: z.string() }).parse(JSON.parse(readBuildFile(join(repoRoot, "package.json"), "utf8"))).version });
  const debugEvents = createDebugEventWriter({ repository: loggingRepository, clock, build: z.object({ version: z.string() }).parse(JSON.parse(readBuildFile(join(repoRoot, "package.json"), "utf8"))).version });
  const taskNotes = createNoteTimelineWriter({ repository: loggingRepository, clock });
  const protectedAuthority = createCredentialStore({ admission, stateRoot });
  const protectedSecrets = createCredentialSecretSource(protectedAuthority);
  const runRecordService = new RunRecordService({ database, clock, ids,
    publishQueued: () => { throw new Error("worker port cannot create runs"); },
  });
  const lifecycle = workerRunLifecyclePort(runRecordService);
  const gateSources = createGateSourceRuntime({
    database,
    lifecycle: runRecordService,
    descriptors: { resolve: resolveDescriptor },
    ports: input.gateSourcePorts ?? [],
    clock,
  });
  const runtimePreflight = composeRuntimePreflight({ admission, database, clock, repoRoot, isolation: input.isolation,
    descriptors: { resolve: resolveDescriptor }, descriptorSetHash: descriptor.contractFingerprint,
    protectedSecrets, environment: env,
    ...(input.preflightRunnerFactory === undefined ? {} : { runnerFactory: input.preflightRunnerFactory }) });
  let resolved: ReturnType<typeof resolveConfigWithProvenance>;
  try {
      const persistedSettings = database.withAuthorityTransaction((repositories) =>
      readSettings(repositories));
    resolved = resolveConfigWithProvenance(persistedSettings.settings, hostFacts, clock,
      { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot });

    const settingsExpectation = Object.freeze({
      revision: persistedSettings.revision,
      settingsFingerprint: persistedSettings.settingsFingerprint,
    });
    database.withAuthorityTransaction((repositories) =>
      withCurrentSettings(repositories, settingsExpectation, () => {
        requireCurrentSettings(persistedSettings, repositories);
        return repositories.runtimeConfig.requireActive({
          settingsRevision: persistedSettings.revision,
          settingsFingerprint: persistedSettings.settingsFingerprint,
          configFingerprint: resolved.fingerprint,
        });
      }));
    const scope = runtimePreflight.currentScope();
    await runtimePreflight.admission.prepare(scope, input.stopSignal ?? new AbortController().signal);
    runtimePreflight.admission.assertReady(runtimePreflight.currentScope());
  } catch (bootError) {
    const bootAndCleanupErrors: unknown[] = [bootError];
    let databaseClosure: "unproven" | "proven" = "unproven";
    try {
      (input.closeDatabase ?? ((opened) => opened.close()))(database);
      databaseClosure = "proven";
    } catch (error) {
      bootAndCleanupErrors.push(error);
    }
    if (databaseClosure === "proven") {
      try {
        processLock.release();
      } catch (error) {
        bootAndCleanupErrors.push(error);
      }
    }
    if (bootAndCleanupErrors.length > 1) {
      throw new AggregateError(
        bootAndCleanupErrors,
        `worker ${workerId} settings generation refusal could not release composed resources`,
        { cause: bootError },
      );
    }
    throw bootError;
  }

  const scheduler = createTimeoutDeadlineScheduler(clock);
  const emitter = createTimelineEmitter({ repository: loggingRepository, clock });

  const artifacts = createContentAddressedArtifactWriter({
    admission,
  });
  // The root initializes at construction; a worker never runs a task before it exists.
  await artifacts.ready;
  const diagnosticService = createDiagnosticCaptureService({
    artifacts,
    authority: database.authority,
    clock,
    ids,
  });
  const diagnostics = bindFailureCapture(createRunDiagnosticCapture({ service: diagnosticService }));
  const browserScreenshotCapture = createRunBrowserScreenshotCapture({ service: diagnosticService });

  const resources = createRunResourcesFactory({processLockRoot:join(repoRoot,input.isolation.processLockRoot),preflight:runtimePreflight,authority:database.authority,artifacts,clock,ids,isolation:input.isolation,protectedSecrets,scheduler,environment:env,
    onDebug: (category, debugWorkerId, event) => {
      debugEvents.emit({ category, ...event }, { kind: "worker", workerId: debugWorkerId });
    },
    assertProfileOwner: requestedWorkerId => {
      if (requestedWorkerId !== workerId) throw new Error("browser-profile-worker-owner-mismatch");
      assertWorkerProcessCustody({ processLockRoot, acquisitionId: z.uuid().parse(processLock.acquisitionId),
        pid: input.processId ?? process.pid, workerId, authorityPath }, { observeProcessIdentity: input.processIdentityObserver });
    },
    ...(input.sessionFactory === undefined ? {} : {sessionFactory:input.sessionFactory}),
    ...(input.createSessionFactory === undefined ? {} : {createSessionFactory:input.createSessionFactory}),
    ...(input.duoCeremony === undefined ? {} : {duoCeremony:input.duoCeremony})});
  const baselineResources = resources.baseline(resolved.config);

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
    // Sweep expired leases before acquiring; a dead worker cannot run its maintenance ticker.
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
      browserSystems: workflowProjections(descriptor).systems,
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


    for (const outcome of sweepWorkerClaims(database, lifecycle, { workerId, now })) {
      if (outcome.state !== "recovery-required") {
        const run = requireLifecycleApplied(outcome);
        log.warn("orphaned claim released before the first poll; its worker never settled", {
          workerId,
          runId: run.envelope.runId,
          workflow: run.envelope.workflow,
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
    // An attempting intent under a claimed or validating run requires typed operator recovery.
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


    const maintenance = startWorkerMaintenance({
      database,
      lifecycle,
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
    let stopGateSources: () => Promise<void> = async () => undefined;
    try {
      stopGateSources = await gateSources.start(stopController.signal);
      report = await runWorkerLoop({
        workflowId,
        workerId,
        descriptor,
        stores: taskStoreRegistry,
        authority: database,
        lifecycle,
        gateSources,
        sessionFactory: baselineResources.sessionFactory,
        emitter,
        clock,
        ids,
        scheduler,
        taskDeadlineMs: resolved.config.timeouts.taskMs,
        sessionAcquireMs: resolved.config.timeouts.sessionAcquireMs,
        defaultBrowserMode: resolved.config.browser.headless ? "headless" : "headed",
        duoCeremony: baselineResources.duoCeremony,
        heartbeatIntervalMs,
        idleRepollMs: resolved.config.daemon.idleRepollMs,
        log,
        taskNotes,
        confirmedActionAppend: event => {
          const authority = database.authority.runs.get(event.action.runId);
          if (authority === undefined) throw new Error("confirmed-action-run-authority-missing");
          taskNotes.emitConfirmedAction(event, authority);
        },
        stopSignal: stopController.signal,
        exitWhenIdle: drain,
        controlPoll,
        browserControl: createWorkerBrowserControl({ database, workerId, leaseGeneration, clock, signal: stopController.signal }),
        browserObservation: observation => { database.authority.workerControls.observe({ ...observation, leaseGeneration }); },
        configFingerprint: resolved.fingerprint,
        // The SQLite claim transaction fences settings and runtime tokens; the filesystem check fences its inode.
        claimNext: (request) => claimWithPreflight({ preflight: runtimePreflight, signal: stopController.signal,
          claim: admit => database.withAuthorityTransaction((repositories) => {
          const directive = controlPoll();
          // A directive can arrive from another process after the loop's poll.
          // Refuse this claim and let the next loop turn observe pause/stop.
          if (directive !== "run") return { state: "refused" as const, refusal: { reason: "none-eligible" as const } };
          input.afterClaimAdmissionCheck?.();
          const control = repositories.workerControls.list().find(record => record.auditedAt === undefined
            && (record.request.type === "refresh-browser" || record.request.type === "reopen-browser")
            && record.request.target.workerId === workerId && record.request.target.controlBasis?.leaseGeneration === leaseGeneration);
          if (control !== undefined) return { state: "refused" as const, refusal: { reason: "none-eligible" as const } };
          const outcome = lifecycle.claimNext({ commandId: request.commandId,
            workflow: request.workflow, workerId: request.workerId, runtimeConfig: selectRunRuntime(repositories) }, admit);
          if (outcome.state === "refused" && outcome.refusal.reason !== "none-eligible") requireLifecycleApplied(outcome);
          return outcome;
        }) }),
        providers: baselineResources.providers,
        resourcesForRun: resources.forRun,
        idleCadence: () => resolveConfigWithProvenance(readSettings(database.authority).settings,hostFacts,clock,
          { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot }).config.daemon.idleRepollMs,
        artifacts,
        writeSequencerFor: (sessions, taskDeadlineMs) => createWriteSequencer({
          stores: taskStoreRegistry,
          authority: database,
        lifecycle,
          sessions,
          emitter,
          clock,
          ids,
          scheduler,
          taskDeadlineMs,
          operator: LOCAL_OPERATOR_ACTOR_ID,
          log,
        }),
        diagnostics,
        browserScreenshotCapture,
      });
    } catch (loopError) {
      await stopGateSources();
      maintenance.stop();
      settleLease(database, clock, workerId, leaseGeneration, "crashed", loopError, log);
      throw loopError;
    }
    await stopGateSources();
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
    runtimeReport = report;
  } catch (error) {
    runtimeError = error;
  } finally {
    try { await resources.stop(); } catch (error) { cleanupErrors.push(error); }
    if (externalStop !== undefined) externalStop.removeEventListener("abort", onExternalStop);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  }
  let databaseClosureProven = false;
  try {
    (input.closeDatabase ?? ((opened) => opened.close()))(database);
    databaseClosureProven = true;
  } catch (error) {
    cleanupErrors.push(error);
  }
  // Release the process record only after proven database closure; a throwing close is no stop proof.
  if (databaseClosureProven) {
    try {
      processLock.release();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (cleanupErrors.length === 1 && runtimeError === undefined) throw cleanupErrors[0];
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      runtimeError === undefined ? cleanupErrors : [runtimeError, ...cleanupErrors],
      `worker ${workerId} failed while releasing composed resources`,
      { cause: cleanupErrors.at(-1) },
    );
  }
  if (runtimeError !== undefined) {
    if (runtimeError instanceof Error) throw runtimeError;
    throw new Error(`worker ${workerId} failed with a non-Error value`, { cause: runtimeError });
  }
  if (runtimeReport === undefined) throw new Error(`worker ${workerId} produced no report`);
  return runtimeReport;
}


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
      // An advanced generation owns the lease; never overwrite its settlement.
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
