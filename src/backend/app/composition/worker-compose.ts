import { composeWorkerArtifactProjector } from "./worker/artifact-output.js";
import { hasUncertainBrowserLaunch } from "../../runtime/browser/native-browser.js";
import { createDuoCredentialStore } from "../../storage/configuration/duo-credential-store.js";
import { createNominatimWorkerAdapter } from "../../processing/providers/nominatim-owner.js";
import { createNominatimGeocodeAdapter } from "../../processing/providers/geocode-adapters.js";
import { RuntimeLifetimeLock, WorkerRuntimeLifetimeLock } from "../../storage/admission/lifetime-lock.js";
import { hasUnprovedSourceClosure, retainUnprovedSourceOwners } from "../../storage/source-closure.js";
import { createChatGptAccountService } from "../../accounts/chatgpt-account-service.js";
import { createChatGptOcrAdapter, CHATGPT_OCR_MODEL } from "../../processing/providers/chatgpt-ocr-adapter.js";
import type { TaskStoreRegistry } from "../../../workflow-kit/task-registry.js";
import { deriveSchemaHash } from "../../../models/validation/schema-bound-value.js";
import { createDurableChildRunExecutor } from "../../runtime/execution/durable-child-executor.js";
import { runQueuedSpanEvent } from "../../runs/commands/run-queued-span.js";
import { WorkerSessionClosureUnprovedError, withBoundRunConfigFingerprint } from "../../runtime/workers/worker-sessions.js";
import { createIpcRouter, type IpcRouter } from "../../runtime/workers/worker-ipc-router.js";
import { createWorkerChildChannel, type WorkerChildChannel } from "../../runtime/workers/worker-child-channel.js";
import { WORKER_MESSAGE_PREFIX, type WorkerActivity } from "../../runtime/workers/worker-messages.js";
import { sanitizeDebugText } from "../../../rules/redaction/redaction.js";
import { readFileSync as readBuildFile } from "node:fs";
import { appendEmergencyFault, withEmergencyTimelineWriter } from "../../logs/emergency-faults.js";
import { importLocalDebugLog } from "../../storage/events/local-debug-log.js";
import { z } from "zod";
import { WorkerPoolMemberSchema } from "../../../models/run/worker-slot.js";
import { ActorIdSchema, BrowserSystemIdSchema, CommandIdSchema, WorkerIdSchema } from "../../../rules/identity/ids.js";
import { composeRuntimePreflight } from "../preflight/runtime-admission.js";
import type { RuntimePreflightRunnerFactory } from "../preflight/runtime-runners.js";
import { claimWithPreflight, workerPreflightRefusal } from "../preflight/worker-admission.js";
import { PreflightAdmissionRefusal } from "../../../rules/preflight/preflight-admission.js";
import { createWorkerChildControls } from "../../runtime/workers/worker-browser-control.js";
import { checkParkedWrite } from "../../runtime/writes/write-recovery.js";
import { WorkerControlRefusal } from "../../../models/run/worker-control.js";
import { selectRunRuntime } from "../../runs/settings/run-settings.js";
import { createRunResourcesFactory, type BrowserProfileAuthority } from "./worker/run-resources.js";
import { bindFailureCapture } from "../../runs/lifecycle/failure-resolution.js";
import { createCredentialStore } from "../../storage/configuration/credential-store.js";
import { captureSelectedProfileStorage, RuntimeCustodyUncertainError } from "./storage-compose.js";
import { withOperationProof } from "../../storage/configuration/credential-safe-file.js";
import { assertProfileBrowserRoot } from "./profile-credential-inventory.js";
import { type RuntimeAdmission } from "../../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../../storage/admission/admission-identity.js";
import { hostConfigFacts } from "../../../models/config/host-display.js";

import { RunRecordService, workerRunLifecyclePort, requireLifecycleApplied } from "../../runs/lifecycle/run-record-service.js";
import { dirname, join } from "node:path";
import type { TaskLogger } from "../../../workflow-kit/task.js";
import { descriptorRuntimeNodes, workflowProjections, workflowTerminalResultExecution } from "../../../workflow-kit/workflow.js";
import { compileWorkflow, type WorkflowModule } from "../../../workflow-kit/workflow-definition.js";
import type { RuntimeIsolation } from "../../../models/config/define-runtime-isolation.js";
import { childWorkflowModuleOf, DESCRIPTORS, SERVER_REGISTRY } from "../registries/workflow-registry.js";
import { runWorkerLoop, WorkerLoopReportSchema, type WorkerLoopReport } from "../../runtime/workers/worker-loop.js";
import type { DuoCeremonyGateFactory } from "../../runtime/gates/duo-ceremony-gate.js";
import type { WorkerBrowserSessionFactory, WorkerSessionManager } from "../../runtime/workers/worker-sessions.js";
import { createWriteSequencer } from "../../runtime/writes/write-sequencer.js";
import { createGateSourceRuntime, type GateSourcePort } from "../../runtime/gates/gate-source-runtime.js";
import { systemClock, type Clock } from "../../../rules/time/clock.js";
import { resolveConfigWithProvenance } from "../config/resolve.js";
import { systemIdFactory, type IdFactory } from "../../../rules/identity/identifiers.js";
import { LOCAL_OPERATOR_ACTOR_ID, PositiveIntSchema, WorkflowIdSchema } from "../../../rules/identity/ids.js";
import type { PositiveInt } from "../../../rules/identity/ids.js";
import type { RunId, WorkerId, WorkflowId } from "../../../rules/identity/ids.js";
import { assertNoMigratedEnvironmentKeys } from "../../../models/config/secrets.js";
import { hostAwareResolutionEnvironment } from "../../../models/config/secrets.js";
import { probePrimaryDisplay } from "../host/primary-display.js";
import { createContentAddressedArtifactWriter } from "../../storage/artifacts/content-addressed-artifact-writer.js";
import { createDiagnosticCaptureService } from "../../logs/diagnostics/diagnostic-capture.js";
import { createRunBrowserScreenshotCapture, createRunDiagnosticCapture } from "../../logs/diagnostics/run-diagnostic-capture.js";
import { withCurrentSettings, readAdmittedProfileIdentity, createCredentialSecretSource, readSettings, requireCurrentSettings } from "../../runtime/settings/settings-runtime.js";
import { createTimelineEmitter } from "../../storage/events/timeline-emitter.js";
import { createDebugEventWriter, emitFaultWithCauses } from "../../logs/debug-events.js";
import { createNoteTimelineWriter } from "../../storage/events/note-timeline-writer.js";


import { createTimeoutDeadlineScheduler } from "../../runtime/scheduling/timeout-deadline-scheduler.js";
import { AuthorityDatabase } from "../../storage/sqlite/index.js";
import { taskStoreRegistry } from "../registries/task-registry.js";

// Cadences are composition choices; the contracts constrain renewal and recovery ordering, not numeric defaults.
export const WORKER_HEARTBEAT_INTERVAL_MS = 5_000;

export { createTimeoutDeadlineScheduler };

// Worker stdout carries ids, states, codes and counts only; every other task field stays in the run log.
const STDOUT_LOG_FIELDS: ReadonlySet<string> = new Set(["runId", "workerId", "nodeId", "taskId", "requestId", "writeIntentId", "attempt",
  "state", "status", "code", "capability", "method", "boundary", "errorName", "HDH department",
  "candidates", "rosterRows", "subjects", "eidCellsUnusable", "nameCellsUnusable"]);

/** Structured stdout logging for the worker CLI process (never `console.*`). */
export function lineTaskLogger(write: (line: string) => void, clock: Clock): TaskLogger {
  const emit = (level: "debug" | "info" | "warn") =>
    (message: string, fields?: Readonly<Record<string, string | number | boolean>>): void => {
      const safeFields = Object.fromEntries(Object.entries(fields ?? {}).filter(([key]) => STDOUT_LOG_FIELDS.has(key))
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
  /** Present when the parent pool spawned this process; absent only for the harness `--drain` run. */
  readonly launch?: Readonly<{ workerId: WorkerId; ordinal: PositiveInt; commandId: string; profileId: string; sessionGeneration: number }>;
}

/** `worker <workflow-id> --pool-index <n> [--drain] [--worker-id <id> --ordinal <n> --launch-command-id <id> --profile-id <uuid> --session-generation <n>]`. */
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
    if (flag === "--worker-id" || flag === "--ordinal" || flag === "--launch-command-id" || flag === "--profile-id" || flag === "--session-generation") {
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
  const launch = z.strictObject({ workerId: WorkerIdSchema, ordinal: PositiveIntSchema, commandId: CommandIdSchema, profileId: z.uuid(),
    sessionGeneration: z.number().int().nonnegative() }).parse({
    workerId: launchFields.get("--worker-id"), ordinal: Number(launchFields.get("--ordinal")), commandId: launchFields.get("--launch-command-id"),
    profileId: launchFields.get("--profile-id"), sessionGeneration: Number(launchFields.get("--session-generation")) });
  WorkerPoolMemberSchema.parse({ workflowId, poolIndex, workerId: launch.workerId, ordinal: launch.ordinal });
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
    resolveChild?(parentId: string, workflowId: string): WorkflowModule | undefined;
    stores: TaskStoreRegistry;
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
  // Runs inside the claim transaction after the pause check and before claim admission.
  readonly afterClaimAdmissionCheck?: () => void;
  /** Structured line sink for the default logger; defaults to stdout. */
  readonly write?: (line: string) => void;
}

export const WorkerLaunchUncertainReportSchema = z.strictObject({
  state: z.literal("launch-uncertain"), custody: z.literal("held"), workerId: WorkerIdSchema, workflowId: WorkflowIdSchema,
});
export class WorkerLaunchUncertainError extends RuntimeCustodyUncertainError {
  readonly report: z.infer<typeof WorkerLaunchUncertainReportSchema>;
  constructor(workerId: string, workflowId: string, causes: readonly unknown[]) {
    super(causes); this.name = "WorkerLaunchUncertainError";
    this.report = Object.freeze(WorkerLaunchUncertainReportSchema.parse({ state: "launch-uncertain", custody: "held", workerId, workflowId }));
  }
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
  const selectedRegistry = input.executionRegistry ?? {
    resolve: (id: string) => SERVER_REGISTRY[id], resolveChild: childWorkflowModuleOf, stores,
  };
  const modules = new Map<string, WorkflowModule>();
  const parents = new Map<string, Set<string>>();
  const resolveModule = (id: string, parentId?: string): WorkflowModule | undefined => {
    const module = parentId === undefined || selectedRegistry.resolveChild === undefined
      ? selectedRegistry.resolve(id) : selectedRegistry.resolveChild(parentId, id);
    const previous = modules.get(id);
    if (module === undefined) {
      if (previous !== undefined) throw new Error("worker-execution-registry-changed");
      return undefined;
    }
    if (module.descriptor.id !== id || previous !== undefined && previous !== module
      || module.stores.some(store => !stores.stores.includes(store))) throw new Error("worker-execution-registry-mismatch");
    if (compileWorkflow(module.definition).descriptor !== module.descriptor) {
      throw new Error("worker-execution-compiled-descriptor-mismatch");
    }
    for (const node of descriptorRuntimeNodes(module.descriptor)) {
      const contracts = node.kind === "task" ? [node.uses] : node.kind === "transaction" ? [node.prepare.uses, node.commit.uses] : [];
      const required = contracts.map(contract => contract.id);
      if (node.kind === "transaction") required.push(node.commit.uses.writeSafety.idempotency.probe.taskId);
      for (const taskId of required) {
        if (module.stores.flatMap(store => Object.values(store.tasks)).filter(task => task.contract.id === taskId).length !== 1) {
          throw new Error("worker-execution-task-store-mismatch");
        }
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
      const target = resolveModule(node.target.id, producer.descriptor.id);
      if (target === undefined || deriveSchemaHash(target.descriptor.input, "input") !== deriveSchemaHash(node.target.input, "input")
        || workflowTerminalResultExecution(target.descriptor).schemaHash !== deriveSchemaHash(node.target.result, "output")) throw new Error("delegation-target-descriptor-unavailable");
      for (const system of workflowProjections(target.descriptor).systems) systems.add(system);
      const admitted = parents.get(node.target.id) ?? new Set<string>();
      admitted.add(producer.descriptor.id);
      parents.set(node.target.id, admitted);
      qualify(target, [...ancestry, producer.descriptor.id]);
    }
  };
  qualify(module, []);
  const resolveDescriptor = (id: string) => {
    if (id === workflowId) return resolveModule(id)?.descriptor;
    const admitted = parents.get(id);
    if (admitted === undefined) return undefined;
    for (const parentId of admitted) resolveModule(id, parentId);
    return modules.get(id)?.descriptor;
  };
  const machine = requireRuntimeAdmission(input.admission);
  if (machine.lifetime !== input.lifetimeLock) throw new Error("runtime-lifetime-admission-mismatch");
  const selected = captureSelectedProfileStorage(machine);
  const clock = input.clock ?? systemClock;
  const ids = input.ids ?? systemIdFactory;
  const repoRoot = input.repoRoot ?? process.cwd();
  const build = z.object({ version: z.string() }).parse(JSON.parse(readBuildFile(join(repoRoot, "package.json"), "utf8"))).version;
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
    issued = machine.admitProfile(selected.profileId);
    selected.assertCurrent();
    protectedAuthority = createCredentialStore({ admission: issued, stateRoot });
  } catch (error) {
    if (hasUnprovedSourceClosure(error)) {
      machine.retainSourceClosure(error); issued?.retainSourceClosure(error);
      if (issued !== undefined) retainUnprovedSourceOwners(error, { admission: issued });
      throw new RuntimeCustodyUncertainError([error]);
    }
    try { issued?.release(); }
    catch (closeError) { throw new RuntimeCustodyUncertainError([error, closeError]); }
    throw error;
  }
  const admission = issued;
  const assertCurrent = (): void => withOperationProof(() => admission.assertProfileRuntime());
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
        appendEmergencyFault({ stateRoot, build, area: "worker-startup", reason: "database-unavailable",
          code: "DATABASE_WRITER_UNAVAILABLE", error: error instanceof Error ? error : new Error("Database writer unavailable"), now: clock.now() });
        throw error;
      }
      const database = opened;
      if (launch !== undefined && (launch.profileId !== selected.profileId || launch.sessionGeneration !== machine.readProfileRegistry().sessionGeneration)) {
        throw new Error("worker-launch-profile-changed");
      }
      const workerId = database.withAuthorityTransaction(repositories => {
        assertCurrent();
        readSettings(repositories);
        const slot = launch === undefined ? repositories.workerSlots.active(workflowId).find(candidate => candidate.poolIndex === poolIndex)
          : repositories.workerSlots.get(launch.workerId);
        if (slot === undefined || slot.retiredAt !== null || slot.workflow !== workflowId || slot.poolIndex !== poolIndex
          || launch !== undefined && slot.ordinal !== launch.ordinal) throw new Error("worker-slot-unavailable");
        return WorkerIdSchema.parse(slot.workerId);
      });
      return { database, workerId };
    } catch (error) {
      if (hasUnprovedSourceClosure(error)) {
        admission.retainSourceClosure(error); machine.retainSourceClosure(error);
        retainUnprovedSourceOwners(error, { admission: { admission, machine }, database: opened });
        throw new RuntimeCustodyUncertainError([error]);
      }
      try { if (opened !== undefined) closeDatabase(opened); }
      catch (closeError) { throw new RuntimeCustodyUncertainError([error, closeError]); }
      try { admission.release(); }
      catch (releaseError) { throw new RuntimeCustodyUncertainError([error, releaseError]); }
      throw error;
    }
  })();
  const { database, workerId } = bound;
  let runtimeError: unknown, closureFailure: unknown;
  const cleanupErrors: unknown[] = [];
  let runtimeReport: WorkerLoopReport | undefined;
  let bootRefusal: PreflightAdmissionRefusal | undefined;
  let resources: ReturnType<typeof createRunResourcesFactory> | undefined;
  let ocrAccount: ReturnType<typeof createChatGptAccountService> | undefined;
  let accountClosureProven = true;
  let removeStopListeners: (() => void) | undefined;
  const loggingRepository = withEmergencyTimelineWriter(database.authority.timelineEvents, { stateRoot, clock, build });
  const debugEvents = createDebugEventWriter({ repository: loggingRepository, clock, build });

  try {
  importLocalDebugLog(stateRoot, database.authority.timelineEvents);
  const taskNotes = createNoteTimelineWriter({ repository: loggingRepository, clock });
  const protectedSecrets = createCredentialSecretSource({ read: () => { assertCurrent(); return protectedAuthority.read(); } }, () => { const identity = readAdmittedProfileIdentity(machine, admission); assertCurrent(); return identity; });
  const executionDescriptor = resolveDescriptor;
  const runRecordService = new RunRecordService({ database, clock, ids,
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
  const duo = createDuoCredentialStore(admission, clock);
  const runtimePreflight = composeRuntimePreflight({ duo, admission, credentials: protectedAuthority, database, clock, repoRoot, isolation: input.isolation,
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
    try {
      if (drain) {
        const scope = runtimePreflight.currentScope();
        await runtimePreflight.admission.prepare(scope, input.stopSignal ?? new AbortController().signal);
        runtimePreflight.admission.assertReady(runtimePreflight.currentScope());
      }
    } catch (error) {
      if (error instanceof PreflightAdmissionRefusal && workerPreflightRefusal(error) !== undefined) bootRefusal = error;
      throw error;
    }

  const scheduler = createTimeoutDeadlineScheduler(clock);
  const emitter = createTimelineEmitter({ repository: loggingRepository, clock });

  const artifacts = createContentAddressedArtifactWriter({
    admission,
  });
  // The root initializes at construction; a worker never runs a task before it exists.
  await artifacts.ready;
  const artifactProjector = composeWorkerArtifactProjector({ admission, database, artifacts, clock });
  const diagnosticService = createDiagnosticCaptureService({
    artifacts,
    authority: database.authority,
    clock,
    ids,
  });
  const diagnostics = bindFailureCapture(createRunDiagnosticCapture({ service: diagnosticService }));
  const browserScreenshotCapture = createRunBrowserScreenshotCapture({ service: diagnosticService });

  ocrAccount = createChatGptAccountService({ admission, stateRoot, clock });
  ocrAccount.setDebugEvents(debugEvents);
  accountClosureProven = false;
  const ocr = createChatGptOcrAdapter({ account: ocrAccount, artifacts, clock, model: CHATGPT_OCR_MODEL, assertCurrent });
  const workerNominatim = input.lifetimeLock instanceof RuntimeLifetimeLock ? undefined : createNominatimWorkerAdapter(clock);
  resources = createRunResourcesFactory({runReader:runRecordService,duo,ocr,nominatim:workerNominatim ?? createNominatimGeocodeAdapter({clock}),preflight:runtimePreflight,admission,database,authority:database.authority,artifacts,clock,ids,isolation:input.isolation,protectedSecrets,scheduler,environment:env,
    assertBrowserRoot,
    onDebug: (category, debugWorkerId, event) => {
      debugEvents.emit({ category, ...event }, { kind: "worker", workerId: debugWorkerId });
    },
    assertProfileOwner: requestedWorkerId => withOperationProof(() => {
      assertCurrent();
      if (requestedWorkerId !== workerId) throw new Error("browser-profile-worker-owner-mismatch");
      input.lifetimeLock.assertHeld();
      const slot = database.authority.workerSlots.get(workerId);
      if (slot === undefined || slot.retiredAt !== null) throw new Error("browser-profile-worker-owner-mismatch");
    }),
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

    const paused = (): boolean => database.authority.workerSlots.get(workerId)?.paused === true;
    let stopRequested = false;
    let channelFailure: unknown;
    let boundSessions: WorkerSessionManager | undefined;
    let current: WorkerActivity = { state: paused() ? "paused" : "idle" };
    const browserActivities = new Map<symbol, "acquiring" | "authenticating" | "closing">();
    let claimedRun: RunId | undefined;
    let standing: WorkerActivity["refusal"];
    const activityNow = (): WorkerActivity => {
      const base: WorkerActivity = browserActivities.size !== 0 ? { state: "waiting", waiting: [...browserActivities.values()].at(-1) }
        : claimedRun !== undefined ? { state: "busy", runId: claimedRun } : { state: paused() ? "paused" : "idle" };
      return standing === undefined || base.state !== "idle" ? base : { ...base, refusal: standing };
    };
    let channel: WorkerChildChannel | undefined;
    const publish = (next: WorkerActivity): void => {
      if (next.state === current.state && next.runId === current.runId && next.waiting === current.waiting
        && next.refusal?.code === current.refusal?.code && next.refusal?.summary === current.refusal?.summary
        && next.refusal?.retryAt === current.refusal?.retryAt) return;
      current = next;
      channel?.activity(next);
    };
    let router: IpcRouter | undefined;
    const send = process.send?.bind(process);
    if (launch !== undefined) {
      if (send === undefined || !process.connected || process.disconnect === undefined) throw new Error("runtime-parent-channel-required");
      const disconnect = process.disconnect.bind(process);
      const fail = (error: unknown): void => { channelFailure ??= error; stopController.abort(error); };
      router = createIpcRouter({ on: (event, listener) => process.on(event, listener), off: (event, listener) => process.off(event, listener),
        disconnect }, fail);
      const routed = router;
      workerNominatim?.attach(routed);
      const opened = createWorkerChildChannel({ send: message => { send(message, undefined, undefined, error => { if (error !== null) fail(error); }); }, clock,
        handlers: createWorkerChildControls({
          sessions: () => { if (boundSessions === undefined) throw new WorkerControlRefusal("worker-sessions-unavailable"); return boundSessions; },
          signal: stopController.signal,
          checkParkedWrite: async (sessions, request) => {
            const owner = database.getMeta();
            if (request.requestedBy !== "local-operator" || request.source !== "run-detail"
              || owner.installationId !== request.target.installationId || owner.profileId !== request.target.profileId) throw new WorkerControlRefusal("parked-check-profile-changed");
            return await checkParkedWrite({ repositories: database.authority, descriptor: executionDescriptor(request.target.workflowId),
              target: request.target, commandId: request.commandId, requestedBy: request.requestedBy, signal: stopController.signal, sessions,
              configureRun: run => { assertCurrent(); sessions.configureExecution(run.envelope.workflow, stores);
                const resources = ownedResources.forRun(run); sessions.configureRunResources(resources); return resources; },
              probe: { stores, clock, scheduler, taskDeadlineMs: resolved.config.timeouts.taskMs, log } });
          },
          pause: () => { publish({ state: "paused" }); return { directive: "pause" }; },
          resume: () => { publish({ state: "idle" }); return { directive: "run" }; },
        }),
        onStop: () => { stopRequested = true; } });
      channel = opened;
      routed.register(WORKER_MESSAGE_PREFIX, message => {
        try { opened.receive(message); } catch (error) { fail(error); }
      });
    }

    let report: WorkerLoopReport;
    let stopGateSources: () => Promise<void> = async () => undefined;
    try {
      stopGateSources = await gateSources.start(stopController.signal);
      report = await runWorkerLoop({
        workflowId,
        workerId,
        descriptor,
        stores,
        childRuns,
        resolveExecution: run => {
          const target = executionDescriptor(run.envelope.workflow);
          return target === undefined ? undefined : { descriptor: target, stores };
        },
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
        debugEvents,
        taskNotes,
        stopSignal: stopController.signal,
        exitWhenIdle: drain,
        controlPoll: () => stopRequested ? "stop" : paused() ? "pause" : "run",
        claimTurn: { begin: () => channel?.beginRun() ?? true, end: () => { claimedRun = undefined; channel?.endRun(); publish(activityNow()); } },
        bindSessions: sessions => {
          boundSessions = sessions;
          channel?.ready({ workerId, pid: process.pid, profileId: selected.profileId, sessionGeneration: launch?.sessionGeneration ?? 0,
            browserSystems: z.array(BrowserSystemIdSchema).parse([...systems]), activity: current });
        },
        browserActivity: activity => {
          const key = Symbol(activity);
          browserActivities.set(key, activity);
          publish(activityNow());
          return () => { browserActivities.delete(key); publish(activityNow()); };
        },
        browserObservation: observation => { channel?.browser(observation); },
        configFingerprint: resolved.fingerprint,
        onStanding: refusal => { standing = refusal; publish(activityNow()); },
        onClosureUnproved: error => { closureFailure = error; },
        // The SQLite claim transaction fences settings and runtime tokens; the filesystem check fences its inode.
        claimNext: (request, sessions) => {
          assertCurrent();
          return claimWithPreflight({ preflight: runtimePreflight, signal: stopController.signal,
          onObservationChanged: attempt => { log.warn("preflight observation changed during claim; re-preparing", { workerId, attempt }); },
          candidateCurrent: run => database.authority.runs.get(run.envelope.runId)?.version === run.version,
          prepareRun: async (run, signal) => {
            const target = executionDescriptor(run.envelope.workflow);
            if (target === undefined) throw new Error("worker-execution-descriptor-unavailable");
            await sessions.parkForExecution(run.envelope.workflow, stores);
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
          // A stop can arrive after the loop's poll; the claim transaction itself refuses a paused slot.
          if (stopRequested) return { state: "refused" as const, refusal: { reason: "none-eligible" as const } };
          input.afterClaimAdmissionCheck?.();
          const outcome = lifecycle.claimNext({ commandId: request.commandId,
            workflow: request.workflow, workerId: request.workerId, runtimeConfig: selectRunRuntime(repositories) }, admit);
          if (outcome.state === "refused" && outcome.refusal.reason !== "none-eligible") requireLifecycleApplied(outcome);
          if (outcome.state === "applied") { claimedRun = outcome.run.envelope.runId; publish(activityNow()); }
          return outcome;
        }) });
        },
        providers: baselineResources.providers,
        resourcesForRun: run => { assertCurrent(); return ownedResources.forRun(run); },
        idleCadence: () => withOperationProof(() => resolveConfigWithProvenance(readSettings(database.authority).settings,hostFacts,clock,
          { stateRoot: admission.stateRoot, artifactRoot: admission.artifactRoot }).config.daemon.idleRepollMs),
        artifacts,
        artifactProjector,
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
          log,
        }),
        diagnostics,
        browserScreenshotCapture,
      });
      runtimeReport = report;
    } catch (error) {
      channel?.failed(error);
      throw error;
    } finally {
      await stopGateSources();
      router?.close();
    }
    if (channelFailure !== undefined) throw channelFailure instanceof Error ? channelFailure : new Error("worker-ipc-channel-failed", { cause: channelFailure });
    if (report.closure === "unproved") emitFaultWithCauses(debugEvents, undefined, closureFailure, { category: "worker",
      area: "browser-session", code: "WORKER_SESSION_CLOSURE_UNPROVED", reason: "browser-closure-unproved" }, { kind: "worker", workerId });
  } catch (error) {
    const refusal = bootRefusal !== undefined && error === bootRefusal ? workerPreflightRefusal(error) : undefined;
    const refusedBeforeEffects = refusal !== undefined;
    if (refusedBeforeEffects) {
      runtimeReport = WorkerLoopReportSchema.parse({ workerId, workflowId, outcomes: [], stopped: "preflight-refused", closure: "proved",
        preflightRefusal: refusal });
    } else runtimeError = error;
    try {
      if (refusal !== undefined) debugEvents.emit({ category: "worker", phase: "failed", correlationId: ids.uuid(), area: "worker-runtime",
        code: refusal.code, ...(refusal.summary === undefined ? {} : { message: refusal.summary }), reason: "operation-refused" }, { kind: "worker", workerId });
      else emitFaultWithCauses(debugEvents, undefined, error, { category: "worker", area: "worker-runtime", code: "WORKER_RUNTIME_FAILED",
        reason: hasUncertainBrowserLaunch(error) ? "browser-closure-unproved" : "worker-failed" }, { kind: "worker", workerId });
    } catch (loggingError) { cleanupErrors.push(loggingError); }
  } finally {
    try { await resources?.stop(); } catch (error) { cleanupErrors.push(error); }
    try { if (ocrAccount !== undefined) await ocrAccount.close(); accountClosureProven = true; }
    catch (error) { cleanupErrors.push(error); }
    removeStopListeners?.();
  }
  if (cleanupErrors.length > 0) {
    try { emitFaultWithCauses(debugEvents, undefined, new AggregateError(cleanupErrors, "worker cleanup failed"), { category: "worker", area: "worker-cleanup",
      code: "WORKER_CLEANUP_FAILED", reason: "resource-closure-unproved" }, { kind: "worker", workerId }); }
    catch (loggingError) { cleanupErrors.push(loggingError); }
  }
  let databaseClosureProven = false;
  try {
    if (!accountClosureProven) throw new RuntimeCustodyUncertainError(cleanupErrors);
    closeDatabase(database);
    databaseClosureProven = true;
  } catch (error) {
    cleanupErrors.push(error);
  }
  const launchUncertain = [runtimeError, ...cleanupErrors].some(hasUncertainBrowserLaunch);
  const browserClosureUnproved = launchUncertain || runtimeReport?.closure === "unproved" || runtimeError instanceof WorkerSessionClosureUnprovedError;
  if (databaseClosureProven && !browserClosureUnproved && cleanupErrors.length === 0) {
    try {
      admission.release();
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  if (!databaseClosureProven || browserClosureUnproved || cleanupErrors.length > 0) {
    const errors = [...(runtimeError === undefined ? [] : [runtimeError]), ...(closureFailure === undefined ? [] : [closureFailure]), ...cleanupErrors];
    if (launchUncertain) throw new WorkerLaunchUncertainError(workerId, workflowId, errors);
    throw new RuntimeCustodyUncertainError(errors);
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


