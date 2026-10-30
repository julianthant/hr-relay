import { createNominatimGeocodeAdapter } from "../../processing/providers/geocode-adapters.js";
import { RuntimeLifetimeLock, WorkerRuntimeLifetimeLock } from "../../storage/admission/lifetime-lock.js";
import { AuthoritySourceClosureUnprovedError } from "../../storage/source-closure.js";
import { createChatGptAccountService } from "../../accounts/chatgpt-account-service.js";
import { createChatGptOcrAdapter, CHATGPT_OCR_MODEL } from "../../processing/providers/chatgpt-ocr-adapter.js";
import type { TaskStoreRegistry } from "../../../workflow-kit/task-registry.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { createDurableChildRunExecutor } from "../../runtime/execution/durable-child-executor.js";
import { runQueuedSpanEvent } from "../../runs/commands/run-queued-span.js";
import { isLiveWorker } from "../../../models/run/worker.js";
import { WorkerSessionClosureUnprovedError, withBoundRunConfigFingerprint } from "../../runtime/workers/worker-sessions.js";
import { sanitizeDebugText } from "../../../rules/redaction/redaction.js";
import { readFileSync as readBuildFile } from "node:fs";
import { appendEmergencyFault, withEmergencyTimelineWriter, importEmergencyFaults } from "../../logs/emergency-faults.js";
import { admitDirectWorker, admitSupervisedWorker } from "../../storage/sqlite/worker-slots.js";
import { z } from "zod";
import { workerPoolMember, WorkerPoolMemberSchema } from "../../../models/run/worker-slot.js";
import { ActorIdSchema, CommandIdSchema, WorkerIdSchema } from "../../../rules/identity/ids.js";
import { composeRuntimePreflight } from "../preflight/runtime-admission.js";
import type { RuntimePreflightRunnerFactory } from "../preflight/runtime-runners.js";
import { claimWithPreflight } from "../preflight/worker-admission.js";
import { createWorkerBrowserControl, createWorkerResetControl, createWorkerResetObserver } from "../../runtime/workers/worker-browser-control.js";
import { checkParkedWrite } from "../../runtime/writes/write-recovery.js";
import { WorkerControlRefusal } from "../../../models/run/worker-control.js";
import { selectRunRuntime } from "../../runs/settings/run-settings.js";
import { createRunResourcesFactory, type BrowserProfileAuthority } from "./worker/run-resources.js";
import { bindFailureCapture } from "../../runs/lifecycle/failure-resolution.js";
import { createCredentialStore } from "../../storage/configuration/credential-store.js";
import { captureSelectedProfileStorage, RuntimeCustodyUncertainError } from "./storage-compose.js";
import { assertProfileBrowserRoot } from "./profile-credential-inventory.js";
import { type RuntimeAdmission } from "../../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../../storage/admission/admission-identity.js";
import { hostConfigFacts } from "../../../models/config/host-display.js";

import { RunRecordService, workerRunLifecyclePort, requireLifecycleApplied } from "../../runs/lifecycle/run-record-service.js";
import { dirname, join } from "node:path";
import type { TaskLogger } from "../../../workflow-kit/task.js";
import { descriptorRuntimeNodes, workflowProjections, workflowTerminalResultExecution, type AnyWorkflowDescriptor } from "../../../workflow-kit/workflow.js";
import { BUILD_MANIFEST, resolveWorkflowFingerprint, resolveTaskImplFingerprint } from "../../../workflow-kit/validation/build-manifest.js";
import type { BuildManifest } from "../../../models/workflow/build-manifest.js";
import { compileWorkflow, type WorkflowModule } from "../../../workflow-kit/workflow-definition.js";
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";
import { DESCRIPTORS, SERVER_REGISTRY } from "../registries/workflow-registry.js";
import type { MonotonicDeadlineHandle, MonotonicDeadlineScheduler } from "../../runtime/scheduling/deadline-scheduler.js";
import { runWorkerLoop, type WorkerLoopReport } from "../../runtime/workers/worker-loop.js";
import type { DuoCeremonyGateFactory } from "../../runtime/gates/duo-ceremony-gate.js";
import type { WorkerBrowserSessionFactory, WorkerSessionManager } from "../../runtime/workers/worker-sessions.js";
import { createWriteSequencer } from "../../runtime/writes/write-sequencer.js";
import { createGateSourceRuntime, type GateSourcePort } from "../../runtime/gates/gate-source-runtime.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";
import { resolveConfigWithProvenance } from "../config/resolve.js";
import { systemIdFactory, type IdFactory } from "../../../rules/identity/identifiers.js";
import { LOCAL_OPERATOR_ACTOR_ID, PositiveIntSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import type { PositiveInt } from "../../../rules/identity/ids.js";
import type { WorkerId, WorkflowId, Fingerprint } from "../../../rules/identity/ids.js";
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
import { taskStoreRegistry } from "../registries/task-registry.js";

// Cadences are composition choices; the contracts constrain renewal and recovery ordering, not numeric defaults.
export const WORKER_HEARTBEAT_INTERVAL_MS = 5_000;

export { createTimeoutDeadlineScheduler };

export async function initializeFailedWorkerReset(input: Readonly<{
  database: AuthorityDatabase; commandId: string; leaseGeneration: number; descriptor: AnyWorkflowDescriptor;
  signal: AbortSignal; clock: Clock; scheduler: MonotonicDeadlineScheduler;
}>): Promise<void> {
  const { database, commandId, leaseGeneration, descriptor, signal, clock, scheduler } = input;
  while (database.authority.workerControls.get(commandId)?.effect === undefined) {
    const record = database.authority.workerControls.get(commandId);
    if (record?.lifecycle?.operation.kind !== "retry" || record.lifecycle.operation.mode !== "browserless"
      || record.lifecycle.lifetime.leaseGeneration + 1 !== leaseGeneration || signal.aborted
      || Date.parse(record.expiresAt) <= clock.nowMs()) throw new Error("worker-reset-replacement-start-milestone-unavailable");
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { timer.cancel(); reject(new Error("worker-reset-replacement-initialization-aborted", { cause: signal.reason })); };
      const timer = scheduler.schedule(clock.monotonicMs() + 50, () => { signal.removeEventListener("abort", onAbort); resolve(); });
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  if (signal.aborted) throw new Error("worker-reset-replacement-initialization-aborted", { cause: signal.reason });
  database.completeFailedWorkerReset(commandId, descriptor, clock.now().toISOString());
}

export async function initializeRetryWorker(input: Readonly<{
  database: AuthorityDatabase; commandId: string; leaseGeneration: number; descriptor: AnyWorkflowDescriptor;
  stores?: TaskStoreRegistry; configFingerprint: Fingerprint; sessions: WorkerSessionManager; signal: AbortSignal; clock: Clock; scheduler: MonotonicDeadlineScheduler;
}>): Promise<void> {
  const { database, commandId, leaseGeneration, descriptor, configFingerprint, sessions, signal, clock, scheduler } = input;
  const command = database.authority.workerControls.get(commandId);
  const binding = command?.lifecycle;
  if (command === undefined) throw new Error("worker-initialization-command-unavailable");
  if (binding?.operation.kind !== "retry") return;
  if (binding.member.workflowId !== descriptor.id || binding.operation.configSnapshotId !== database.authority.runtimeConfig.get()?.configSnapshotId || binding.operation.configFingerprint !== configFingerprint
    || binding.operation.descriptorVersion !== descriptor.version || binding.operation.contractFingerprint !== descriptor.contractFingerprint) throw new Error("worker-initialization-current-settings-changed");
  while (database.authority.workerControls.get(command.commandId)?.phase.state !== "succeeded") {
    if (signal.aborted) throw signal.reason;
    await new Promise<void>((resolve, reject) => {
      const onAbort = () => { handle.cancel(); reject(new Error("worker-initialization-aborted", { cause: signal.reason })); };
      const handle = scheduler.schedule(clock.monotonicMs() + 50, () => { signal.removeEventListener("abort", onAbort); resolve(); });
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
  if (signal.aborted) throw signal.reason;
  if (database.authority.workerControls.get(commandId)?.readiness?.state !== "initializing") throw new Error("worker-initialization-authority-unavailable");
  if (binding.operation.mode === "initialize") {
    await withBoundRunConfigFingerprint(sessions, binding.operation.configFingerprint, async () => {
      const contracts = new Set(workflowProjections(descriptor).contracts.map(contract => contract.id));
      const needs = (input.stores ?? taskStoreRegistry).stores.flatMap(store => Object.values(store.tasks).filter(task => contracts.has(task.contract.id)).flatMap(task => task.impl.sessions));
      const systems = new Set<string>();
      for (const need of needs) {
        if (systems.has(need.system)) continue;
        systems.add(need.system);
        await sessions.withDriver({ ...need, access: "read", session: "reuse-worker" }, "prod", signal, async () => undefined);
      }
    });
  }
  database.completeWorkerInitialization(command.commandId, leaseGeneration, descriptor, clock.now().toISOString());
}

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
function parseWorkerArgumentSyntax(args: readonly string[]): WorkerCliArguments {
  const [first, ...rest] = args;
  if (first === undefined) {
    throw new Error(
      `the worker command needs a workflow id; registered: ${DESCRIPTORS.map(({ id }) => id).join(", ")}`,
    );
  }
  const workflowId = WorkflowIdSchema.parse(first);
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
      poolIndex = PositiveIntSchema.parse(numeric);
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

export function parseWorkerArguments(args: readonly string[]): WorkerCliArguments {
  const parsed = parseWorkerArgumentSyntax(args);
  if (SERVER_REGISTRY[parsed.workflowId] === undefined) throw new Error(`workflow ${parsed.workflowId} is not registered`);
  return parsed;
}

export interface WorkerComposeInput {
  readonly lifetimeLock: RuntimeLifetimeLock | WorkerRuntimeLifetimeLock;
  readonly admission?: RuntimeAdmission;
  readonly preflightRunnerFactory?: RuntimePreflightRunnerFactory;
  readonly isolation: RuntimeIsolation;
  /** Raw CLI args after `worker` — see `parseWorkerArguments`. */
  readonly args: readonly string[];
  readonly executionRegistry?: Readonly<{
    resolve(workflowId: string): WorkflowModule | undefined;
    stores: TaskStoreRegistry;
    manifest: BuildManifest;
  }>;
  readonly env?: NodeJS.ProcessEnv;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  /** Where the isolation state root resolves from; defaults to `process.cwd()`. */
  readonly repoRoot?: string;
  /** Injects authority-open failure for cleanup checks. */
  readonly openDatabase?: (
    options: Readonly<{ path: string; busyTimeoutMs: number; migrationOwner: string }>,
    clock: Clock,
  ) => AuthorityDatabase;
  /** Injects authority-close failure for cleanup checks. */
  readonly closeDatabase?: (database: AuthorityDatabase) => void;
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
  scheduler: MonotonicDeadlineScheduler;
  clock: Clock;
  workerId: WorkerId;
  leaseGeneration: number;
  heartbeatIntervalMs: number;
  onFailure: (error: Error) => void;
}>): WorkerMaintenance {
  const { database, clock } = input;
  let stopped = false;
  let failure: unknown;
  let handle: MonotonicDeadlineHandle = { cancel: (): void => undefined };

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
      if (active !== undefined && (!('workerId' in active.lifecycle) || active.lifecycle.workerLifetime === undefined
        || active.lifecycle.workerLifetime.leaseGeneration !== input.leaseGeneration
        || active.lifecycle.workerLifetime.membershipRevision !== database.authority.workerSlots.get(input.workerId)?.membershipRevision)) throw new Error("worker-current-run-lifetime-unavailable");
      const initializing = database.authority.workerSlots.recovery(input.workerId) !== undefined
        || database.authority.workerControls.initializingForWorker(input.workerId, input.leaseGeneration) !== undefined
        || database.authority.workerControls.lifecycleForWorker(input.workerId)?.lifecycle?.operation.kind === "retry";
      const reported = database.authority.workerLeases.reportLifecycle({
        workerId: input.workerId,
        leaseGeneration: input.leaseGeneration,
        lifecycle: lease.lifecycle.state === "waiting"
          ? { ...lease.lifecycle, heartbeatAt: now }
          : active === undefined
          ? initializing ? { state: "starting", startedAt: lease.lifecycle.startedAt } : lease.control.directive === "pause"
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
    } catch (error) {

      failure = error;
      input.onFailure(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    handle = input.scheduler.schedule(clock.monotonicMs() + input.heartbeatIntervalMs, tick);
  };
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
  if (!(input.lifetimeLock instanceof RuntimeLifetimeLock) && !(input.lifetimeLock instanceof WorkerRuntimeLifetimeLock)) throw new Error("worker-runtime-lifetime-lock-required");
  input.lifetimeLock.assertHeld();
  let failedClosure: unknown;
  let closureFailed = false;
  try {
    return await composeOwnedWorkerRuntime(input, database => {
      try { (input.closeDatabase ?? (opened => opened.close()))(database); }
      catch (error) { closureFailed = true; failedClosure = error; throw error; }
    });
  } catch (error) {
    if (closureFailed) throw new RuntimeCustodyUncertainError([error, failedClosure]);
    throw error;
  }
}

async function composeOwnedWorkerRuntime(input: WorkerComposeInput, closeDatabase: NonNullable<WorkerComposeInput["closeDatabase"]>): Promise<WorkerLoopReport> {
  const env = input.env ?? hostAwareResolutionEnvironment(probePrimaryDisplay);
  assertNoMigratedEnvironmentKeys(env);
  const { workflowId, poolIndex, drain, launch } = input.executionRegistry === undefined
    ? parseWorkerArguments(input.args) : parseWorkerArgumentSyntax(input.args);
  const stores = input.executionRegistry?.stores ?? taskStoreRegistry;
  const buildManifest = input.executionRegistry?.manifest ?? BUILD_MANIFEST;
  const selectedRegistry = input.executionRegistry ?? { resolve: (id: string) => SERVER_REGISTRY[id], stores };
  const modules = new Map<string, WorkflowModule>();
  const resolveModule = (id: string): WorkflowModule | undefined => {
    const module = selectedRegistry.resolve(id), previous = modules.get(id);
    if (module === undefined) {
      if (previous !== undefined) throw new Error("worker-execution-registry-changed");
      return undefined;
    }
    if (module.descriptor.id !== id || previous !== undefined && previous !== module
      || module.stores.some(store => !stores.stores.includes(store))) throw new Error("worker-execution-registry-mismatch");
    if (compileWorkflow(module.definition, { manifest: buildManifest }).descriptor !== module.descriptor) {
      throw new Error("worker-execution-compiled-manifest-mismatch");
    }
    if (resolveWorkflowFingerprint(buildManifest, module.descriptor.id) !== module.descriptor.contractFingerprint) {
      throw new Error("worker-execution-manifest-mismatch");
    }
    for (const node of descriptorRuntimeNodes(module.descriptor)) {
      const contracts = node.kind === "task" ? [node.uses] : node.kind === "transaction" ? [node.prepare.uses, node.commit.uses] : [];
      const required = contracts.map(contract => contract.id);
      if (node.kind === "transaction") required.push(node.commit.uses.writeSafety.idempotency.probe.taskId);
      for (const taskId of required) {
        if (module.stores.flatMap(store => Object.values(store.tasks)).filter(task => task.contract.id === taskId).length !== 1) {
          throw new Error("worker-execution-task-store-mismatch");
        }
        resolveTaskImplFingerprint(buildManifest, taskId);
      }
    }
    modules.set(id, module);
    return module;
  };
  const module = resolveModule(workflowId);
  if (module === undefined) throw new Error(`workflow ${workflowId} is not registered`);
  const descriptor = module.descriptor;
  const systems = new Set(workflowProjections(descriptor).systems);
  const qualify = (producer: WorkflowModule, ancestry: readonly string[]): void => {
    if (ancestry.length >= 16 || ancestry.includes(producer.descriptor.id)) throw new Error("delegation-definition-cycle-or-depth");
    for (const node of descriptorRuntimeNodes(producer.descriptor)) {
      if (node.kind !== "child-run") continue;
      const target = resolveModule(node.target.id);
      if (target === undefined || deriveSchemaHash(target.descriptor.input, "input") !== deriveSchemaHash(node.target.input, "input")
        || workflowTerminalResultExecution(target.descriptor).schemaHash !== deriveSchemaHash(node.target.result, "output")) throw new Error("delegation-target-descriptor-unavailable");
      for (const system of workflowProjections(target.descriptor).systems) systems.add(system);
      qualify(target, [...ancestry, producer.descriptor.id]);
    }
  };
  qualify(module, []);
  const resolveDescriptor = (id: string) => resolveModule(id)?.descriptor;
  const machine = requireRuntimeAdmission(input.admission);
  if (machine.lifetime !== input.lifetimeLock) throw new Error("runtime-lifetime-admission-mismatch");
  const selected = captureSelectedProfileStorage(machine);
  const clock = input.clock ?? systemClock;
  const ids = input.ids ?? systemIdFactory;
  const repoRoot = input.repoRoot ?? process.cwd();
  const write = input.write ?? ((line: string): void => {
    process.stdout.write(`${line}\n`);
  });
  const log = input.log ?? lineTaskLogger(write, clock);
  const heartbeatIntervalMs = input.heartbeatIntervalMs ?? WORKER_HEARTBEAT_INTERVAL_MS;



  const hostFacts = hostConfigFacts(env);
  const stateRoot = dirname(selected.authorityPath);
  const authorityPath = selected.authorityPath;
  let issued: RuntimeAdmission | undefined;
  let protectedAuthority: ReturnType<typeof createCredentialStore>;
  try {
    selected.assertCurrent();
    issued = machine.admitProfile(machine.issueRegisteredProfileClaim(selected.profileId));
    protectedAuthority = createCredentialStore({ admission: issued, stateRoot, erasureJournalAdmission: machine,
      erasureJournalPath: join(machine.stateRoot, "machine", "erasures", `${selected.profileId}.json`) });
  } catch (error) {
    try { issued?.release(); }
    catch (closeError) { throw new RuntimeCustodyUncertainError([error, closeError]); }
    throw error;
  }
  const admission = issued;
  const assertCurrent = (): void => { selected.assertCurrent(); admission.assertProfileRuntime(); };
  const assertBrowserRoot = (root: string): void => { assertCurrent(); assertProfileBrowserRoot(admission, root); };
  let opened: AuthorityDatabase | undefined;
  const bound = (() => {
    try {
      assertCurrent();
      admission.assertAuthorityDatabase(authorityPath);
      try {
        opened = (input.openDatabase ?? ((options, openClock) => AuthorityDatabase.open(admission, options, openClock,
          undefined, undefined, undefined, protectedAuthority)))(
          { path: authorityPath, busyTimeoutMs: 5000, migrationOwner: "rebuild-worker" }, clock);
      } catch (error) {
        appendEmergencyFault({ stateRoot, build: z.object({ version: z.string() }).parse(JSON.parse(readBuildFile(join(repoRoot, "package.json"), "utf8"))).version,
          code: "DATABASE_WRITER_UNAVAILABLE", error: error instanceof Error ? error : new Error("Database writer unavailable"), now: clock.now() });
        throw error;
      }
      const database = opened;
      const workerId = database.withAuthorityTransaction(repositories => {
        assertCurrent();
        readSettings(repositories);
        if (launch === undefined) {
          const before = repositories.workerPools.get(workflowId);
          return admitDirectWorker(repositories, { commandId: ids.uuid(), workflow: workflowId, poolIndex,
            expectedPoolVersion: before?.version ?? 0, processId: process.pid, now: clock.now().toISOString() }, ids.uuid()).workerId;
        }
        return admitSupervisedWorker(repositories, { member: { workflowId, poolIndex, workerId: launch.workerId,
          ordinal: launch.ordinal, membershipRevision: launch.membershipRevision }, commandId: launch.commandId, now: clock.now().toISOString() });
      });
      return { database, workerId };
    } catch (error) {
      if (error instanceof AuthoritySourceClosureUnprovedError) throw new RuntimeCustodyUncertainError([error]);
      try { if (opened !== undefined) closeDatabase(opened); }
      catch (closeError) { throw new RuntimeCustodyUncertainError([error, closeError]); }
      try { admission.release(); }
      catch (releaseError) { throw new RuntimeCustodyUncertainError([error, releaseError]); }
      throw error;
    }
  })();
  const { database, workerId } = bound;
  let runtimeError: unknown;
  const cleanupErrors: unknown[] = [];
  let runtimeReport: WorkerLoopReport | undefined;
  let resources: ReturnType<typeof createRunResourcesFactory> | undefined;
  let ocrAccount: ReturnType<typeof createChatGptAccountService> | undefined;
  let accountClosureProven = true;
  let removeStopListeners: (() => void) | undefined;

  try {
  importEmergencyFaults(stateRoot, database.authority.timelineEvents);
  const loggingRepository = withEmergencyTimelineWriter(database.authority.timelineEvents, { stateRoot, clock, build: z.object({ version: z.string() }).parse(JSON.parse(readBuildFile(join(repoRoot, "package.json"), "utf8"))).version });
  const debugEvents = createDebugEventWriter({ repository: loggingRepository, clock, build: z.object({ version: z.string() }).parse(JSON.parse(readBuildFile(join(repoRoot, "package.json"), "utf8"))).version });
  const taskNotes = createNoteTimelineWriter({ repository: loggingRepository, clock });
  const protectedSecrets = createCredentialSecretSource({ read: () => { assertCurrent(); return protectedAuthority.read(); } });
  const executionDescriptor = resolveDescriptor;
  const runRecordService = new RunRecordService({ database, clock, ids, buildManifest,
    resolveDescriptor: executionDescriptor,
    publishQueued: (run, publication) => {
      if (publication === undefined) throw new Error("queued run is missing its publication context");
      emitter.emit(runQueuedSpanEvent({ run, ...publication, actorId: ActorIdSchema.parse(publication.actorId) }));
    },
  });
  const childRuns = createDurableChildRunExecutor({ authority: database,
    admission: { admitAndRelease: (context, plan) => runRecordService.admitDelegation(context, plan) },
    resolveTarget: id => {
      const target = executionDescriptor(id);
      if (target === undefined) throw new Error("delegation-target-descriptor-unavailable");
      return target;
    },
  });
  const lifecycle = workerRunLifecyclePort(runRecordService);
  const gateSources = createGateSourceRuntime({
    database,
    lifecycle: runRecordService,
    descriptors: { resolve: resolveDescriptor },
    ports: input.gateSourcePorts ?? [],
    clock,
  });
  const runtimePreflight = composeRuntimePreflight({ admission, credentials: protectedAuthority, database, clock, repoRoot, isolation: input.isolation,
    descriptors: { resolve: resolveDescriptor }, descriptorSetHash: descriptor.contractFingerprint,
    protectedSecrets, environment: env,
    ...(input.preflightRunnerFactory === undefined ? {} : { runnerFactory: input.preflightRunnerFactory }) });
  const persistedSettings = database.withAuthorityTransaction((repositories) =>
      readSettings(repositories));
  const resolved = resolveConfigWithProvenance(persistedSettings.settings, hostFacts, clock,
      { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot });
    assertBrowserRoot(resolved.config.paths.browserProfileRoot);

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

  ocrAccount = createChatGptAccountService({ admission, stateRoot, clock });
  accountClosureProven = false;
  const ocr = createChatGptOcrAdapter({ account: ocrAccount, artifacts, clock, model: CHATGPT_OCR_MODEL, assertCurrent });
  resources = createRunResourcesFactory({ocr,...(input.lifetimeLock instanceof RuntimeLifetimeLock ? {nominatim:createNominatimGeocodeAdapter({clock})} : {}),preflight:runtimePreflight,authority:database.authority,artifacts,clock,ids,isolation:input.isolation,protectedSecrets,scheduler,environment:env,
    assertBrowserRoot,
    onDebug: (category, debugWorkerId, event) => {
      debugEvents.emit({ category, ...event }, { kind: "worker", workerId: debugWorkerId });
    },
    assertProfileOwner: requestedWorkerId => {
      assertCurrent();
      if (requestedWorkerId !== workerId) throw new Error("browser-profile-worker-owner-mismatch");
      input.lifetimeLock.assertHeld();
      const lease = database.authority.workerLeases.get(workerId), member = database.authority.workerSlots.get(workerId);
      if (lease?.processId !== process.pid || lease.leaseGeneration !== workerLifetime.leaseGeneration
        || member?.membershipRevision !== workerLifetime.membershipRevision || member.retiredAt !== null
        || !isLiveWorker(lease)) throw new Error("browser-profile-worker-owner-mismatch");
    },
    ...(input.sessionFactory === undefined ? {} : {sessionFactory:input.sessionFactory}),
    ...(input.createSessionFactory === undefined ? {} : {createSessionFactory:input.createSessionFactory}),
    ...(input.duoCeremony === undefined ? {} : {duoCeremony:input.duoCeremony})});
  const ownedResources = resources;
  const baselineResources = ownedResources.baseline(resolved.config);

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
  }
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);

  removeStopListeners = () => {
    if (externalStop !== undefined) externalStop.removeEventListener("abort", onExternalStop);
    process.removeListener("SIGINT", onSigint);
    process.removeListener("SIGTERM", onSigterm);
  };
    const now = clock.now().toISOString();
    const started = database.authority.workerLeases.start({
      workerId,
      workflow: workflowId,
      browserSystems: [...systems],
      processId: process.pid,
      requestedBy: LOCAL_OPERATOR_ACTOR_ID,
      ...(launch === undefined ? {} : { commandId: launch.commandId }),
      now,
    });
    if (started.state !== "started") {
      throw new Error(
        `worker ${workerId} cannot start: ${started.message}; a second process may not answer to the same worker id`,
      );
    }
    const leaseGeneration = started.lease.leaseGeneration;
    const currentMember = database.authority.workerSlots.get(workerId);
    if (currentMember === undefined || currentMember.retiredAt !== null) throw new Error("worker-claim-membership-unavailable");
    const workerLifetime = { leaseGeneration, membershipRevision: currentMember.membershipRevision };
    const stillHeld = database.authority.runs.listByWorker(workerId)
      .filter(({ lifecycle }) => lifecycle.state === "claimed"
        || lifecycle.state === "validating"
        || lifecycle.state === "running");
    const wedged = stillHeld[0];
    if (wedged !== undefined) {
      throw new Error(
        `worker ${workerId} cannot start: the controller has not reconciled run `
        + `${wedged.envelope.runId} (${wedged.envelope.workflow}), which is still ${wedged.lifecycle.state} `
        + "under this worker id",
      );
    }


    const browserActivities = new Map<symbol, "acquiring" | "authenticating" | "closing">();
    const reportBrowserActivity = (): void => {
      const lease = database.authority.workerLeases.get(workerId);
      const member = database.authority.workerSlots.get(workerId);
      if (lease?.leaseGeneration !== leaseGeneration || member?.membershipRevision !== currentMember.membershipRevision
        || member.retiredAt !== null || !isLiveWorker(lease)) throw new Error("worker-browser-activity-lifetime-unavailable");
      const active = database.authority.runs.listByWorker(workerId).find(run => "workerId" in run.lifecycle);
      if (active !== undefined && (!("workerId" in active.lifecycle) || active.lifecycle.workerLifetime?.leaseGeneration !== leaseGeneration
        || active.lifecycle.workerLifetime.membershipRevision !== currentMember.membershipRevision)) throw new Error("worker-current-run-lifetime-unavailable");
      const activity = [...browserActivities.values()].at(-1);
      const now = clock.now().toISOString();
      const base = { startedAt: lease.lifecycle.startedAt, heartbeatAt: now };
      const initializing = database.authority.workerControls.initializingForWorker(workerId, leaseGeneration) !== undefined;
      const settling = database.authority.workerControls.resetForWorker(workerId, leaseGeneration) !== undefined
        || database.authority.workerControls.lifecycleForWorker(workerId)?.lifecycle?.operation.kind === "remove";
      const lifecycle = activity === undefined && settling && lease.lifecycle.state === "waiting"
        ? { ...lease.lifecycle, heartbeatAt: now }
        : activity !== undefined ? { state: "waiting", ...base, activity,
        ...(active === undefined ? {} : { runId: active.envelope.runId }) }
        : active !== undefined ? { state: "busy", ...base, runId: active.envelope.runId }
        : initializing ? { state: "starting", startedAt: lease.lifecycle.startedAt }
        : lease.control.directive === "pause" ? { state: "paused", ...base, pausedAt: lease.lifecycle.state === "paused" ? lease.lifecycle.pausedAt : now }
        : { state: "idle", ...base };
      const reported = database.authority.workerLeases.reportLifecycle({ workerId, leaseGeneration, lifecycle, now });
      if (reported.state !== "applied") throw new Error("worker-browser-activity-lifetime-unavailable");
    };
    const maintenance = startWorkerMaintenance({
      database,
      scheduler,
      clock,
      workerId,
      leaseGeneration,
      heartbeatIntervalMs,
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
    const resetObserver = createWorkerResetObserver({ database, workerId, leaseGeneration, clock, scheduler, onFailure: error => { stopController.abort(error); } });
    let report: WorkerLoopReport;
    let stopGateSources: () => Promise<void> = async () => undefined;
    try {
      stopGateSources = await gateSources.start(stopController.signal);
      report = await runWorkerLoop({
        workflowId,
        workerId,
        descriptor,
        stores,
        buildManifest,
        childRuns,
        resolveExecution: run => {
          const target = executionDescriptor(run.envelope.workflow);
          return target === undefined ? undefined : { descriptor: target, stores };
        },
        authority: database,
        lifecycle,
        gateSources,
        initialize: async (sessions, signal) => {
          const standing = database.authority.workerSlots.recovery(workerId);
          if (standing !== undefined) {
            if (launch?.commandId !== standing.command.commandId || signal.aborted) throw new Error("worker-standing-recovery-initialization-unavailable");
            database.completeStandingWorkerRecovery(standing.command.commandId, descriptor, clock.now().toISOString());
          } else if (launch !== undefined && database.authority.workerControls.get(launch.commandId)?.request.type === "stop-worker") {
            await initializeFailedWorkerReset({ database, commandId: launch.commandId, leaseGeneration,
              descriptor, signal, clock, scheduler });
          } else if (launch !== undefined) await initializeRetryWorker({ database, commandId: launch.commandId, leaseGeneration,
            descriptor, stores, configFingerprint: resolved.fingerprint, sessions, signal, clock, scheduler });
        },
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
        resetOwner: { member: workerPoolMember(currentMember), lifetime: { leaseGeneration, processId: started.lease.processId, startedAt: started.lease.lifecycle.startedAt } },
        resetControl: createWorkerResetControl({ database, workerId, leaseGeneration, clock, lifecycle: runRecordService }),
        pendingReset: resetObserver,
        activeWorkReset: (run, claim) => {
          const observed = resetObserver();
          const record = database.authority.workerControls.resetForWorker(workerId, leaseGeneration);
          if (observed === undefined || record === undefined) return false;
          const reset = record.reset;
          const slot = database.authority.workerSlots.get(workerId);
          const lease = database.authority.workerLeases.get(workerId);
          if (reset === undefined || slot?.membershipRevision !== reset.member.membershipRevision || slot.retiredAt !== null
            || lease?.controlRevision !== reset.reservedControlRevision || lease.controlCommandId !== record.commandId
            || lease.processId !== reset.lifetime.processId || lease.lifecycle.startedAt !== reset.lifetime.startedAt
            || reset.work.kind !== "current" || reset.work.current.runId !== run.envelope.runId
            || reset.work.current.claimGeneration !== claim.claimGeneration || reset.work.current.attempt !== run.envelope.attempt) throw new Error("worker-reset-observer-authority-unavailable");
          return true;
        },
        browserControl: createWorkerBrowserControl({ database, workerId, leaseGeneration, clock, signal: stopController.signal,
          checkParkedWrite: async (sessions, request, expiresAt) => {
            const owner = database.getMeta();
            if (request.requestedBy !== "local-operator" || request.source !== "run-detail"
              || owner.installationId !== request.target.installationId || owner.profileId !== request.target.profileId) throw new WorkerControlRefusal("parked-check-profile-changed");
            const controller = new AbortController();
            const stop = () => controller.abort(stopController.signal.reason);
            stopController.signal.addEventListener("abort", stop, { once: true });
            if (stopController.signal.aborted) stop();
            const deadline = scheduler.schedule(clock.monotonicMs() + Math.max(0, Date.parse(expiresAt) - clock.nowMs()),
              () => controller.abort(new Error("parked-check-deadline")));
            try {
              return await checkParkedWrite({ repositories: database.authority, descriptor: executionDescriptor(request.target.workflowId),
                target: request.target, commandId: request.commandId, requestedBy: request.requestedBy, signal: controller.signal, sessions,
                configureRun: run => { assertCurrent(); sessions.configureExecution(run.envelope.workflow, stores);
                  const resources = ownedResources.forRun(run); sessions.configureRunResources(resources); return resources; },
                probe: { stores, clock, scheduler, taskDeadlineMs: resolved.config.timeouts.taskMs, log } });
            } finally { deadline.cancel(); stopController.signal.removeEventListener("abort", stop); }
          } }),
        browserActivity: activity => {
          const key = Symbol(activity);
          browserActivities.set(key, activity);
          reportBrowserActivity();
          return () => { browserActivities.delete(key); reportBrowserActivity(); };
        },
        browserObservation: observation => { database.authority.workerControls.observe({ ...observation, leaseGeneration }); },
        configFingerprint: resolved.fingerprint,
        // The SQLite claim transaction fences settings and runtime tokens; the filesystem check fences its inode.
        claimNext: (request, sessions) => {
          assertCurrent();
          return claimWithPreflight({ preflight: runtimePreflight, signal: stopController.signal,
          prepareRun: async (run, signal) => {
            const target = executionDescriptor(run.envelope.workflow);
            if (target === undefined) throw new Error("worker-execution-descriptor-unavailable");
            sessions.configureExecution(run.envelope.workflow, stores);
            sessions.configureRunResources(ownedResources.forRun(run));
            const contracts = new Set(workflowProjections(target).contracts.map(contract => contract.id));
            const needs = stores.stores.flatMap(store => Object.values(store.tasks).filter(task => contracts.has(task.contract.id))
              .flatMap(task => task.impl.sessions));
            await withBoundRunConfigFingerprint(sessions, run.envelope.configFingerprint, async () => {
              const prepared = new Set<string>();
              for (const need of needs) {
                if (prepared.has(need.system)) continue;
                prepared.add(need.system);
                const instance = run.envelope.resolvedInstance?.[need.system];
                if (instance === undefined) throw new Error("preclaim-browser-instance-unavailable");
                await sessions.prepareProfile(need, instance, signal);
              }
            }, run.envelope.browserMode);
          },
          claim: admit => database.withAuthorityTransaction((repositories) => {
          assertCurrent();
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
            workflow: request.workflow, workerId: request.workerId, workerLifetime, runtimeConfig: selectRunRuntime(repositories) }, admit);
          if (outcome.state === "refused" && outcome.refusal.reason !== "none-eligible") requireLifecycleApplied(outcome);
          return outcome;
        }) });
        },
        providers: baselineResources.providers,
        resourcesForRun: run => { assertCurrent(); return ownedResources.forRun(run); },
        idleCadence: () => resolveConfigWithProvenance(readSettings(database.authority).settings,hostFacts,clock,
          { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot }).config.daemon.idleRepollMs,
        artifacts,
        writeSequencerFor: (sessions, taskDeadlineMs) => createWriteSequencer({
          stores,
          authority: database,
        lifecycle,
          sessions,
          emitter,
          clock,
          ids,
          scheduler,
          taskDeadlineMs,
          operator: LOCAL_OPERATOR_ACTOR_ID,
          resolveImplFingerprint: taskId => resolveTaskImplFingerprint(buildManifest, taskId),
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
    } finally {
      resetObserver.stop();
    }
    await stopGateSources();
    maintenance.stop();
    const background = maintenance.failure() ?? resetObserver.failure();
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
      report.closure === "unproved" ? "crashed" : report.stopped === "stop-directive" ? "operator" : "shutdown",
      report.closure === "unproved" ? new WorkerSessionClosureUnprovedError(workerId) : undefined,
      log,
    );
    runtimeReport = report;
  } catch (error) {
    runtimeError = error;
  } finally {
    try { await resources?.stop(); } catch (error) { cleanupErrors.push(error); }
    try { if (ocrAccount !== undefined) await ocrAccount.close(); accountClosureProven = true; }
    catch (error) { cleanupErrors.push(error); }
    removeStopListeners?.();
  }
  let databaseClosureProven = false;
  try {
    if (!accountClosureProven) throw new RuntimeCustodyUncertainError(cleanupErrors);
    closeDatabase(database);
    databaseClosureProven = true;
  } catch (error) {
    cleanupErrors.push(error);
  }
  const browserClosureUnproved = runtimeReport?.closure === "unproved" || runtimeError instanceof WorkerSessionClosureUnprovedError;
  if (databaseClosureProven && !browserClosureUnproved && cleanupErrors.length === 0) {
    try {
      admission.release();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (!databaseClosureProven || browserClosureUnproved || cleanupErrors.length > 0) {
    throw new RuntimeCustodyUncertainError(runtimeError === undefined ? cleanupErrors : [runtimeError, ...cleanupErrors]);
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
