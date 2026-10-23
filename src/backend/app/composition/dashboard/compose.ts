import { failureStatus } from "../../../transports/http/routes/failure-status.js";
import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { ProfileLoginRequestSchema, ProfileSignUpRequestSchema, PublicProfileStateSchema } from "../../../../models/profiles/public-profile.js";
import { ProfileSessionRefusedError } from "../../../profiles/profile-session.js";
import { operatorMutationIngressGuard } from "../../../transports/http/routes/operator-mutation-ingress.js";
import { staticBundleHandler } from "../../../transports/http/static-bundle.js";
import { createWorkbookLibraryService } from "../../../workbooks/workbook-library-service.js";
import { createWorkbookIntakeBridge } from "../../../runs/commands/workbook-intake-service.js";
import { createIntakeCommandResultQuery } from "../../../runs/queries/intake-command-result.js";
import { withEmergencyTimelineWriter, importEmergencyFaults } from "../../../logs/emergency-faults.js";
import { assertWorkerProcessStopped } from "../../../storage/sqlite/runtime-process-locks.js";
import { WorkerRetirementProofSchema, workerPoolMember } from "../../../../models/run/worker-slot.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { deleteOwnedBrowserProfile, workerProfileDirectory } from "../../../runtime/browser/browser-session-factory.js";
import type { DashboardBuildCommand } from "./build-identity.js";
import { createPreflightReportService } from "../../../runtime/preflight/report-service.js";
import { composeRuntimePreflight, type RuntimePreflight } from "../../preflight/runtime-admission.js";
import type { RuntimePreflightRunnerFactory } from "../../preflight/runtime-runners.js";
import { PreflightAdmissionRefusal } from "../../../../rules/preflight/preflight-admission.js";
import { createWorkerBrowserChannel } from "../../../runtime/workers/worker-browser-channel.js";
import { WorkerControlRefusal } from "../../../../models/run/worker-control.js";
import { notificationSourceEventOf, notificationWireOf } from "../../../../models/dashboard/projection.js";
import { createNotificationTargetQuery } from "../../../runs/queries/notifications.js";
import { notificationDisplayContext } from "../../../runs/queries/notification-display.js";
import { composeShell } from "./shell.js";
import { composeActivity } from "./activity.js";
import { composeQueueSummaries } from "./queue-summaries.js";
import { composeExplorer } from "./explorer.js";
import { composeSettings } from "./settings.js";
import { composeStorage } from "./storage.js";
import { composeIntake } from "./intake.js";
import type { ServedSummaryQueries } from "../../../runs/projections/run-queue-projection.js";
import { composeFailureResolution } from "./failure-resolution.js";
import { localDatePart, runtimeTimeZone } from "../../../../rules/time/clock.js";
import { EVENT_STREAM_RETENTION_DAYS } from "../../../../models/events/retention.js";
import { createOperatorProjection } from "./queue.js";
import { createOperatorRunDetail } from "./run-detail.js";
import { createTrustNotifications } from "./notifications.js";
import { createTrustReadDependencies } from "./trust.js";
import { composeDataQueries } from "./data.js";
export { dataOriginViewsOf } from "./run-detail-descriptors.js";
import { ActorIdSchema } from "../../../../rules/identity/ids.js";
import { hostConfigFacts } from "../../../../models/config/host-display.js";

import { spawn as spawnChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { openStaticBundle } from "../../../transports/http/static-bundle.js";
import { z } from "zod";
import type { RuntimeIsolation } from "../../../../models/config/define-runtime-isolation.js";
import { descriptorSetHash, DESCRIPTORS, INTAKE_PROJECTIONS, SERVER_REGISTRY } from "../../registries/workflow-registry.js";
import { stepProofDescriptorOf } from "../../registries/step-proof-modules.js";
import { createCommandKernel, type WorkerPoolRuntimeAdoption, type WriteResolutionExecutor } from "../../../runs/commands/command-kernel.js";
import { createWorkerPoolRuntimeExecutor } from "../../../runtime/workers/worker-loop.js";
import type { MonotonicDeadlineScheduler } from "../../../runtime/scheduling/deadline-scheduler.js";
import { isLiveWorker } from "../../../../models/run/worker.js";
import { createDashboardWorkerProcessSupervisor, type DashboardWorkerProcessSupervisor, type WorkerCliLaunchSpec, type WorkerProcessSpawner } from "../../../runtime/workers/worker-supervisor.js";
import { RunRecordService, runContinuationPort } from "../../../runs/lifecycle/run-record-service.js";
import { createStorageRelocationPlanReader } from "../../../storage/maintenance/storage-relocation-plans.js";
import { createWriteResolutionExecutor } from "../../../runtime/writes/write-recovery.js";
import type { Clock } from "../../../../rules/time/clock.js";
import { systemClock } from "../../../../rules/time/clock.js";
import { composeProfileAssistantAuthorization, composeProfileRuntime, RuntimeCustodyUncertainError } from "../storage-compose.js";
import { systemIdFactory, type IdFactory } from "../../../../rules/identity/identifiers.js";
import { FingerprintSchema, LOCAL_OPERATOR_ACTOR_ID } from "../../../../rules/identity/ids.js";
import { assertNoMigratedEnvironmentKeys, hostAwareResolutionEnvironment, workerBootstrapEnvironment } from "../../../../models/config/secrets.js";
import { probePrimaryDisplay } from "../../host/primary-display.js";
import { createPreflightAuthority } from "../../../../models/preflight/preflight.js";
import { BackupServiceStateWireSchema, type BackupServiceStateWire } from "../../../../models/dashboard/storage.js";
import { AuthorityDatabase, AuthorityHealthPreflightRunner, summarizeBackupHealth } from "../../../storage/sqlite/index.js";
import { acquireRuntimeProcessLock } from "../../../storage/sqlite/runtime-process-locks.js";
import { createTransactionHistory } from "../../../storage/sqlite/transaction-history.js";
import { type RuntimeAdmission } from "../../../storage/admission/admission.js";
import { requireRuntimeAdmission } from "../../../storage/admission/admission-identity.js";
import { createTimelineEmitter } from "../../../storage/events/timeline-emitter.js";
import { createNoteTimelineWriter, type NoteTimelineWriter } from "../../../storage/events/note-timeline-writer.js";
import { createRunLogStreamStore } from "../../../logs/run-log-stream.js";
import { RunLogsStreamHub } from "../../../transports/http/subscriptions/run-logs-stream.js";
import { createContentAddressedArtifactWriter } from "../../../storage/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader } from "../../../storage/artifacts/server-verified-artifact-reader.js";

import { createIntakeParser } from "../../../processing/spreadsheet/intake-parser.js";
import { activeSettingsRuntimeIdentity, readBootSettings } from "../../../runtime/settings/settings-runtime.js";
import { createDashboardCommandService } from "../../../runs/commands/command-service.js";
import { createRunWorkerCapacity } from "../../../runs/commands/run-worker-capacity.js";
import { runQueuedSpanEvent } from "../../../runs/commands/run-queued-span.js";
import { createStartPlanService } from "../../../runs/commands/start-plan-service.js";
import { createDashboardApp } from "../../../transports/http/routes/api.js";
import { createSoloRequestIdentityCheckpoint } from "../../../transports/http/request-identity.js";
import { DASHBOARD_LAUNCH_NONCE_ENV } from "../../../transports/http/frontend-owner.js";
import { startDashboardHttpServer, type DashboardHttpServer, type DashboardHttpListener } from "../../../transports/http/http-server.js";
import { createTimeoutDeadlineScheduler } from "../../../runtime/scheduling/timeout-deadline-scheduler.js";

import { createDashboardPreflightRunners } from "../../preflight/dashboard-runners.js";

export interface DashboardRuntime {
  readonly assistantAuthorization?: ReturnType<typeof composeProfileAssistantAuthorization>;
  readonly port: number;
  readonly noteWriter: NoteTimelineWriter;
  readonly notificationStatus: ReturnType<typeof createTrustNotifications>["observer"]["status"];
  detach(): Promise<void>;
  stop(): Promise<void>;
}

export const DashboardFrontendModeSchema = z.enum(["vite-dev", "built-bundle"]);
export type DashboardFrontendMode = z.infer<typeof DashboardFrontendModeSchema>;

export interface DashboardComposeInput {
  readonly admission?: RuntimeAdmission;
  readonly profile?: Readonly<{ runtime: ReturnType<typeof composeProfileRuntime>; token: string }>;
  readonly isolation: RuntimeIsolation;
  readonly env?: NodeJS.ProcessEnv;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  /** Where package.json and the state root resolve from. */
  readonly repoRoot?: string;
  // `vite-dev` delegates frontend bytes to Vite; `built-bundle` serves the validated local bundle.
  readonly frontend?: DashboardFrontendMode;
  readonly frontendBuildScript?: DashboardBuildCommand;
  readonly startPlanTtlMs?: number;
  // Port 0 requests an ephemeral test port.
  readonly backendPortOverride?: 0;
  readonly preflightRunnerFactory?: RuntimePreflightRunnerFactory;
  /** Test-only replacement for injecting an HTTP bind failure after startup admission. */
  readonly httpServerStarter?: (input: Parameters<typeof startDashboardHttpServer>[0]) => Promise<DashboardHttpServer>;
  readonly applicationTransport?: Readonly<{ listener: DashboardHttpListener; accepts: (request: Request) => boolean }>;
  /** Test-only preflight probe override; production always checks the isolated frontend port. */
  readonly frontendPortOverride?: 0;

  readonly workerProcess?: Readonly<{
    spawn?: WorkerProcessSpawner;
    launch?: WorkerCliLaunchSpec;
    birth?: Readonly<{ pollMs: number; timeoutMs: number }>;
    scheduler?: MonotonicDeadlineScheduler;
    /** Receives one structured JSON line per supervisor fault; default writes to stderr. */
    faultSink?: (line: string) => void;
  }>;
}

const PackageVersionSchema = z.strictObject({ version: z.string().min(1) }).loose();



const TIMELINE_POLL_MS = 250;

// Notification polling has its own cadence; leases can change without spans.
export const GATE_PARK_WATCH_MS = 5_000;



// Allow the CLI cold start to publish its lease before declaring a failed birth.
const WORKER_BIRTH_POLL_MS = 250;

// Launch through the secure environment bootstrap, never a parallel CLI path.
export function productionWorkerLaunch(repoRoot: string, environment?: NodeJS.ProcessEnv): Readonly<{
  command: string;
  environment: NodeJS.ProcessEnv;
  prefixArgs: readonly string[];
  cwd: string;
}> {
  return Object.freeze({
    command: process.execPath,
    environment: workerBootstrapEnvironment(environment),
    prefixArgs: Object.freeze(["--import", "tsx", join(repoRoot, "scripts", "dev", "secure-env-bootstrap.ts"), "cli"]),
    cwd: repoRoot,
  });
}
const WORKER_BIRTH_TIMEOUT_MS = 60_000;

export interface WorkerProcessControlInput {
  readonly profileRoot: string;
  readonly processLockRoot: string;
  readonly database: AuthorityDatabase;
  readonly clock: Clock;
  readonly scheduler: MonotonicDeadlineScheduler;
  readonly launch: WorkerCliLaunchSpec;
  readonly spawn: WorkerProcessSpawner;
  readonly birth: Readonly<{ pollMs: number; timeoutMs: number }>;
  readonly onFault: (error: Error) => void;
  readonly preflight?: RuntimePreflight;
  readonly assertAssistantEffect?: (commandId: string) => void;
}


export function composeWorkerProcessControl(input: WorkerProcessControlInput): Readonly<{
  supervisor: DashboardWorkerProcessSupervisor;
  workerRuntime: WorkerPoolRuntimeAdoption;
}> {
  const supervisor = createDashboardWorkerProcessSupervisor({
    launch: input.launch,
    spawn: input.spawn,
    browserControl: createWorkerBrowserChannel(input),
    prepareAdmission: async request => {
      if (request.command !== "spawn-worker" || input.preflight === undefined) return;
      try {
        const scope = input.preflight.currentScope();
        await input.preflight.admission.prepare(scope, new AbortController().signal);
        input.preflight.admission.assertReady(input.preflight.currentScope());
      } catch (error) {
        throw new WorkerControlRefusal(error instanceof PreflightAdmissionRefusal ? error.message : "Worker preflight could not verify readiness.");
      }
    },
    admission: request => input.database.withAuthorityTransaction(repositories => {
      if (request.commandId === undefined) throw new WorkerControlRefusal("worker-control-command-identity-unavailable");
      input.assertAssistantEffect?.(request.commandId);
      if (request.command === "spawn-worker" && input.preflight !== undefined) {
        try { input.preflight.admission.assertReady(input.preflight.currentScope()); }
        catch (error) { if (error instanceof PreflightAdmissionRefusal) throw new WorkerControlRefusal(error.message); throw error; }
      }
      const standing = "member" in request ? repositories.workerSlots.recovery(request.member.workerId) : undefined;
      if (standing !== undefined && request.command === "spawn-worker") {
        const binding = standing.request.binding, lease = repositories.workerLeases.get(request.member.workerId), active = repositories.runtimeConfig.get();
        if (standing.command.commandId !== request.commandId || request.command !== "spawn-worker"
          || canonicalJsonStringify(binding.member) !== canonicalJsonStringify(request.member) || lease?.lifecycle.state !== "stopped"
          || lease.leaseGeneration !== binding.lifetime.leaseGeneration || lease.controlRevision !== binding.reservedControlRevision
          || lease.controlCommandId !== request.commandId || binding.operation.kind !== "retry"
          || active?.configSnapshotId !== binding.operation.configSnapshotId || active.configFingerprint !== binding.operation.configFingerprint) throw new WorkerControlRefusal("worker-standing-recovery-admission-changed");
        input.database.assertRetainedWorkerDeath(binding.member, binding.lifetime, binding.birthCommandId);
        return;
      }
      const record = repositories.workerControls.get(request.commandId);
      if (record === undefined || record.request.type !== request.command && !(request.command === "spawn-worker" && record.lifecycle?.operation.kind === "retry")) throw new WorkerControlRefusal("worker-control-command-not-admitted");
      if (record.lifecycle?.operation.kind === "retry") {
        const active = repositories.runtimeConfig.get();
        const lease = repositories.workerLeases.get(record.lifecycle.member.workerId);
        if (record.phase.state !== "executing" || lease?.lifecycle.state !== "stopped" || lease.leaseGeneration !== record.lifecycle.lifetime.leaseGeneration
          || lease.controlRevision !== record.lifecycle.reservedControlRevision || lease.controlCommandId !== record.commandId
          || active?.configSnapshotId !== record.lifecycle.operation.configSnapshotId || active.configFingerprint !== record.lifecycle.operation.configFingerprint) throw new WorkerControlRefusal("worker-retry-current-authority-changed");
        return;
      }
      if (request.command === "spawn-worker") {
        const lease = repositories.workerLeases.get(request.member.workerId);
        if (lease !== undefined) input.database.assertRetainedWorkerDeath(request.member,
          { leaseGeneration: lease.leaseGeneration, processId: lease.processId, startedAt: lease.lifecycle.startedAt }, lease.birthCommandId);
      }
      if (input.clock.nowMs() >= Date.parse(record.expiresAt)) throw new WorkerControlRefusal("worker-control-expired-before-effect");
      if ("workerId" in record.request.target) {
        const lease = repositories.workerLeases.get(record.request.target.workerId);
        const basis = record.request.target.controlBasis;
        if (lease === undefined || !isLiveWorker(lease) || basis === undefined || lease.leaseGeneration !== basis.leaseGeneration
          || lease.controlRevision !== basis.controlRevision + 1 || lease.controlCommandId !== record.commandId) throw new WorkerControlRefusal("worker-control-basis-changed-before-effect");
      } else if ((repositories.workerPools.get(record.request.target.workflowId)?.version ?? 0) !== (record.roster?.admittedVersion ?? record.request.target.expectedVersion)) throw new WorkerControlRefusal("worker-pool-version-changed-before-effect");
    }),
    leases: {
      observe: (workerId) => {
        const lease = input.database.authority.workerLeases.get(workerId);
        if (lease === undefined || !isLiveWorker(lease)) return undefined;
        return { processId: lease.processId, startedAt: lease.lifecycle.startedAt };
      },
    },
    gracefulStop: {
      request: (member, directive) => input.database.withAuthorityTransaction((repositories) => {
        const lease = repositories.workerLeases.get(member.workerId);
        if (lease === undefined) {
          throw new Error(
            `graceful stop for ${member.workerId} found no worker lease; the durable directive has nowhere to land`,
          );
        }
        if (!isLiveWorker(lease)) {
          throw new Error(
            `graceful stop for ${member.workerId} found the lease ${lease.lifecycle.state}; `
            + "a stopped lease takes no directive",
          );
        }
        if (directive.commandId !== undefined) {
          const record = repositories.workerControls.get(directive.commandId);
          if (record === undefined) throw new WorkerControlRefusal("worker-control-command-not-admitted");
          if ("workerId" in record.request.target) {
            const basis = record.request.target.controlBasis;
            if (basis === undefined || lease.leaseGeneration !== basis.leaseGeneration || lease.controlRevision !== basis.controlRevision + 1 || lease.controlCommandId !== record.commandId) throw new WorkerControlRefusal("worker-control-basis-changed-before-effect");
          }
        }
        const outcome = repositories.workerLeases.control({
          ...(directive.commandId === undefined ? {} : { commandId: directive.commandId }),
          workerId: member.workerId,
          expectedVersion: lease.version,
          control: {
            directive: "stop",
            requestedAt: directive.requestedAt,
            requestedBy: directive.requestedBy,
            ...(directive.reason === undefined ? {} : { reason: directive.reason }),
          },
          now: directive.requestedAt,
        });
        if (outcome.state !== "applied") {
          throw new Error(
            `graceful stop for ${member.workerId} could not write the durable directive: ${outcome.message}`,
          );
        }
        return Object.freeze({
          requestedAt: directive.requestedAt,
          // The WRITE's own before/after — what command authority audits;
          // a later lease read would absorb unrelated bumps into it.
          leaseVersions: Object.freeze({ before: lease.version, after: outcome.lease.version }),
        });
      }),
    },
    clock: input.clock,
    scheduler: input.scheduler,
    birth: input.birth,
    standingRecoverySettled: commandId => {
      const audit = input.database.authority.lifecycleJournal.findAuditByCommand(commandId);
      return audit !== undefined && "kind" in audit && audit.kind === "run-lifecycle" && audit.result.kind === "worker-recovery";
    },
    assertRetainedOwnerDeath: (member, lifetime, birthCommandId) => { input.database.assertRetainedWorkerDeath(member, lifetime, birthCommandId); },
    proveRetirement: member => {
      assertWorkerProcessStopped(input.processLockRoot, member.workerId);
      return input.database.withAuthorityTransaction(repositories => {
        const slot = repositories.workerSlots.get(member.workerId);
        const lease = repositories.workerLeases.get(member.workerId);
        const pending = repositories.workerControls.pending(`worker-pool:${member.workflowId}`);
        const standing = repositories.workerSlots.recovery(member.workerId);
        const reservation = pending.find(control => control.request.type === "plan-worker-count" && control.phase.state === "executing"
          && control.roster?.excess.some(original => canonicalJsonStringify(original) === canonicalJsonStringify(slot))
          || control.lifecycle !== undefined && control.phase.state === "executing" && canonicalJsonStringify(control.lifecycle.member) === canonicalJsonStringify(member)
            && (control.lifecycle.operation.kind === "retry" || control.closure !== undefined));
        if (slot === undefined || slot.retiredAt !== null || slot.membershipRevision !== member.membershipRevision
          || canonicalJsonStringify(workerPoolMember(slot)) !== canonicalJsonStringify(member) || (standing === undefined ? reservation === undefined || pending.length !== 1
            : standing.request.binding.member.membershipRevision !== member.membershipRevision || pending.length !== 0)
          || lease !== undefined && isLiveWorker(lease)
          || repositories.workerControls.browsers(member.workerId).some(browser => browser.health !== "closed")) throw new WorkerControlRefusal("worker-retirement-closure-not-proved");
        input.database.assertWorkerLifecycleRelease(member.workerId);
        const profileDirectory = join(input.profileRoot, `w${String(slot.ordinal)}`);
        for (const browser of repositories.workerControls.browsers(member.workerId)) {
          if (browser.profileDirectory !== workerProfileDirectory({ profileRoot: input.profileRoot, slotOrdinal: slot.ordinal, system: browser.system })) throw new WorkerControlRefusal("worker-retirement-profile-identity-mismatch");
        }
        deleteOwnedBrowserProfile(input.profileRoot, profileDirectory);
        return WorkerRetirementProofSchema.parse({ workerId: member.workerId, membershipRevision: member.membershipRevision,
          checkedAt: input.clock.now().toISOString(), processStopped: true, browsersClosed: true, exclusive: true });
      });
    },
    onFault: input.onFault,
  });
  return Object.freeze({
    supervisor,
    workerRuntime: Object.freeze({ pool: createWorkerPoolRuntimeExecutor(supervisor, input.database.authority.workerSlots, { database: input.database, clock: input.clock }) }),
  });
}

export function reconcileDeadWorkerLifetimes(database: AuthorityDatabase, clock: Clock, onUnavailable: (error: Error) => void): void {
  for (const member of database.authority.workerSlots.list().filter(slot => slot.retiredAt === null)) {
    try { database.settleDeadWorkerLifetime(member.workerId, clock.now().toISOString()); }
    catch (error) { onUnavailable(error instanceof Error ? error : new Error(String(error))); }
  }
}

// Spawn absolute argv without a shell; inherited stderr keeps bootstrap failures visible.
function realWorkerProcessSpawner(): WorkerProcessSpawner {
  return (request) => {
    const child = spawnChildProcess(request.command, [...request.args], {
      cwd: request.cwd,
      env: request.environment,
      stdio: "inherit",
    });
    return Object.freeze({
      pid: child.pid,
      kill: (signal: "SIGTERM" | "SIGKILL"): boolean => child.kill(signal),
      onExit: (listener: (code: number | null, signal: string | null) => void): void => {
        child.on("exit", (code, signal) => {
          listener(code, signal);
        });
      },
      onError: (listener: (error: Error) => void): void => {
        child.on("error", (error) => {
          listener(error);
        });
      },
    });
  };
}

type StartupCleanup = () => void | Promise<void>;
interface StartupCustody { revoke?: () => void; readonly failedClosures: unknown[] }

async function unwindDashboardStartup(
  cleanups: readonly StartupCleanup[],
  primary: unknown,
): Promise<never> {
  const failures: unknown[] = [];
  for (const cleanup of [...cleanups].reverse()) {
    try {
      await cleanup();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length === 0) throw primary;
  if (primary instanceof RuntimeCustodyUncertainError || failures.some(error => error instanceof RuntimeCustodyUncertainError)) throw new RuntimeCustodyUncertainError([primary, ...failures]);
  throw new AggregateError(
    [primary, ...failures],
    "dashboard startup failed and cleanup observed additional failures",
    { cause: primary },
  );
}

export async function composeDashboardRuntime(input: DashboardComposeInput): Promise<DashboardRuntime> {
  const startupCleanups: StartupCleanup[] = [];
  const custody: StartupCustody = { failedClosures: [] };
  try {
    const runtime = await composeDashboardRuntimeStartup(input, startupCleanups, custody);
    startupCleanups.length = 0;
    return runtime;
  } catch (primary: unknown) {
    try { custody.revoke?.(); } catch (error) { custody.failedClosures.push(error); }
    return unwindDashboardStartup(startupCleanups, custody.failedClosures.length === 0 ? primary : new RuntimeCustodyUncertainError([primary, ...custody.failedClosures]));
  }
}

async function composeDashboardRuntimeStartup(
  input: DashboardComposeInput,
  startupCleanups: StartupCleanup[],
  custody: StartupCustody,
): Promise<DashboardRuntime> {
  const requireProducerClosure = (): void => {
    if (custody.failedClosures.length > 0) throw new RuntimeCustodyUncertainError(custody.failedClosures);
  };
  const requiredClosure = (close: StartupCleanup): StartupCleanup => async () => {
    try { await close(); }
    catch (error) { custody.failedClosures.push(error); throw new RuntimeCustodyUncertainError([error]); }
  };
  const env = input.env ?? hostAwareResolutionEnvironment(probePrimaryDisplay);
  assertNoMigratedEnvironmentKeys(env);
  const clock = input.clock ?? systemClock;
  const timeZone = runtimeTimeZone();
  const ids = input.ids ?? systemIdFactory;
  const repoRoot = input.repoRoot ?? process.cwd();
  const machineAdmission = requireRuntimeAdmission(input.admission);
  const profile = input.profile;
  if (profile === undefined) throw new Error("PROFILE_AUTHORITY_UNAVAILABLE");
  profile.runtime.assertMachineOwner(machineAdmission);
  profile.runtime.assertCurrent(profile.token);
  const assertCurrent = () => profile.runtime.assertCurrent(profile.token);
  const selected = machineAdmission.readProfileRegistry().activeProfileId;
  if (selected === null) throw new Error("PROFILE_AUTHORITY_UNAVAILABLE");
  const stateRoot = join(machineAdmission.stateRoot, "profiles", selected);
  const artifactRoot = join(stateRoot, "artifacts");
  const runtimeStoragePair = Object.freeze({ stateRoot, artifactRoot });
  const appVersion = PackageVersionSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")),
  ).version;
  // Validate the production bundle before opening authority, locks or sockets.
  const frontend = DashboardFrontendModeSchema.default("vite-dev").parse(input.frontend);
  const staticBundle = frontend === "built-bundle"
    ? await openStaticBundle(join(repoRoot, "dist", "dashboard"), repoRoot, input.frontendBuildScript)
    : undefined;


  const hostFacts = hostConfigFacts(env);
  // Take the server role lock before opening authority; it fences competing dashboard handles.
  const processLock = input.applicationTransport === undefined ? acquireRuntimeProcessLock(
    { processLockRoot: join(repoRoot, input.isolation.processLockRoot), name: "server", pid: process.pid },
    clock,
  ) : undefined;
  let databaseClosed = true, transportClosed = true;
  startupCleanups.push(() => {
    requireProducerClosure();
    if (!databaseClosed || !transportClosed) {
      throw new RuntimeCustodyUncertainError([new Error("dashboard authority closure is unproved")]);
    }
    try { processLock?.release(); } catch (error) { throw new RuntimeCustodyUncertainError([error]); }
  });
  const context = (() => {
    try { return profile.runtime.selectedContext(profile.token); }
    catch (error) { if (error instanceof RuntimeCustodyUncertainError) databaseClosed = false; throw error; }
  })();
  const { database, admission, account: chatGptAccount } = context;
  custody.revoke = profile.runtime.beginClose;
  databaseClosed = false;
  const prepareRuntimeClosure = (): Promise<void> => {
    profile.runtime.beginClose();
    return profile.runtime.awaitClosurePreparation(admission.profileBinding.profileId);
  };
  startupCleanups.push(async () => {
    requireProducerClosure();
    if (!transportClosed) throw new RuntimeCustodyUncertainError([new Error("dashboard HTTP closure is unproved")]);
    await prepareRuntimeClosure();
    await profile.runtime.close();
    databaseClosed = true;
  });
  importEmergencyFaults(stateRoot, database.authority.timelineEvents);
  database.sweepOrdinaryDiagnostics(clock.now().toISOString());
  const bootConfig = (() => {
    const persistedSettings = database.withAuthorityTransaction((repositories) => readBootSettings(repositories));
    return Object.freeze({
      persistedSettings,
      resolved: context.resolveSettings(persistedSettings.settings),
    });
  })();
  const { persistedSettings, resolved } = bootConfig;
  const protectedSettingsAuthority = context.credentials;
  const protectedSecrets = { read: () => { assertCurrent(); const result = context.protectedSecrets.read(); assertCurrent(); return result; } };
  const storageRelocationPlans: ReturnType<typeof createStorageRelocationPlanReader> = {
    read: () => { assertCurrent(); return createStorageRelocationPlanReader({ authority: database, admission, workspace: repoRoot }).read(); },
    project: repositories => { assertCurrent(); return createStorageRelocationPlanReader({ authority: database, admission, workspace: repoRoot }).project(repositories); },
    validate: request => { assertCurrent(); createStorageRelocationPlanReader({ authority: database, admission, workspace: repoRoot }).validate(request); },
  };
  const settingsBoundary = composeSettings({ database, hostFacts, clock, active: activeSettingsRuntimeIdentity,
    environment: env, credentials: protectedSettingsAuthority,
    runtimeStoragePair, storageRelocationPlans,
    resolveSettings: settings => { assertCurrent(); const result = context.resolveSettings(settings); assertCurrent(); return result; }, assertCurrent });

  const now = clock.now().toISOString();
  const configSnapshotId = ids.uuid();
  database.withAuthorityTransaction((repositories) => {
    const snapshot = {
      configSnapshotId,
      revision: persistedSettings.revision,
      fingerprint: resolved.fingerprint,
      capturedAt: now,
      capturedBy: LOCAL_OPERATOR_ACTOR_ID,
      config: resolved.config,
      provenance: resolved.provenance,
    };
    if (repositories.runtimeConfig.get() === undefined) {
      repositories.runtimeConfig.initialize(snapshot);
      return;
    }
    repositories.configSnapshots.insert(snapshot);
    repositories.runtimeConfig.activate({
      settingsRevision: persistedSettings.revision,
      settingsFingerprint: persistedSettings.settingsFingerprint,
      configSnapshotId,
      configFingerprint: resolved.fingerprint,
      activatedAt: now,
    });
  });


  const backupDirectory = join(stateRoot, "backups", "authority");
  const backupServiceState: BackupServiceStateWire = BackupServiceStateWireSchema.parse({
    state: "never-run",
    reason: "backups are written only on operator command (npm run cli -- storage backup)",
  });

  const readBackupSummary = (): ReturnType<typeof summarizeBackupHealth> => {
    let liveGeneration: { state: "known"; value: number } | { state: "unavailable" };
    try {
      liveGeneration = { state: "known", value: database.getMeta().authorityGeneration };
    } catch {
      // Unavailable authority is distinct from an absent backup; judge the latter by manifest presence.
      liveGeneration = { state: "unavailable" };
    }
    return summarizeBackupHealth(
      { backupDirectory },
      liveGeneration.state === "known" ? liveGeneration.value : undefined,
      clock,
    );
  };

  const loggingRepository = withEmergencyTimelineWriter(database.authority.timelineEvents, { stateRoot, clock, build: appVersion });
  const spanWriter = createTimelineEmitter({ repository: loggingRepository, clock });
  const descriptors = {
    resolve: (workflowId: string) => SERVER_REGISTRY[workflowId]?.descriptor,
  };
  const setHash = descriptorSetHash(DESCRIPTORS.map((descriptor) => descriptor.contractFingerprint));
  const runtimePreflight = composeRuntimePreflight({ admission, credentials: context.credentials, database, clock, repoRoot, isolation: input.isolation,
    descriptors, descriptorSetHash: setHash, protectedSecrets, environment: env,
    ...(input.preflightRunnerFactory === undefined ? {} : { runnerFactory: input.preflightRunnerFactory }) });
  const lifecycle = new RunRecordService({ database, clock, ids,
    admitQueuedRun: run => runtimePreflight.admission.assertReady(runtimePreflight.runScope(run.envelope)),
    publishQueued: (run, publication) => {
      if (publication === undefined) throw new Error("queued run is missing its publication context");
      spanWriter.emit(runQueuedSpanEvent({ run, ...publication, actorId: ActorIdSchema.parse(publication.actorId) }));
    },
  });
  const { backfillGapNotifier, inbox: notificationInbox, observer: notificationObserver } = createTrustNotifications({
    admission, database, clock, ids, reader: lifecycle, stateRoot,
  });
  startupCleanups.push(requiredClosure(() => notificationObserver.stop()));

  // Start only after startup acceptance; stop drains the exact owned observation.

  const dashboardPreflightRunners = createDashboardPreflightRunners({
    repoRoot,
    config: resolved.config,
    stateRoot,
    artifactRoot,
    backendPort: input.backendPortOverride ?? input.isolation.backendPort,
    frontendPort: input.frontendPortOverride ?? input.isolation.frontendPort,
    ...(env[DASHBOARD_LAUNCH_NONCE_ENV] === undefined
      ? {}
      : { frontendOwnerNonce: env[DASHBOARD_LAUNCH_NONCE_ENV] }),
    clock,
    processLockRoot: join(repoRoot, input.isolation.processLockRoot),
    authorityHealth: new AuthorityHealthPreflightRunner(admission, {
      stateRootTrustAnchor: resolve(stateRoot, ".."),
      stateRoot,
      authorityPath: join(stateRoot, "state.db"),
      backupDirectory,
      busyTimeoutMs: 5000,
    }, clock, context.credentials),
    listLiveWorkerProcesses: () => database.authority.workerLeases.listLive().map((lease) => ({
      workerId: lease.workerId,
      processId: lease.processId,
    })),
  });
  const preflightAuthority = createPreflightAuthority({
    configFingerprint: resolved.fingerprint,
    descriptorFingerprint: setHash,
    requestedCapabilities: ["dashboard.serve"],
    runners: dashboardPreflightRunners.runners,
    clock,
    scheduler: createTimeoutDeadlineScheduler(clock),
  });


  const ledger = createTransactionHistory(database.authority);

  const { activity, activityPopulation } = composeActivity({ database, clock, descriptors, ledger, timeZone });
  const summaries: ServedSummaryQueries = { ...composeQueueSummaries(database), activity: (from, to) => activity.read(from, to) };
  const servedReader = { read: lifecycle.read.bind(lifecycle), list: lifecycle.list.bind(lifecycle), withRunTreeSnapshot: lifecycle.withRunTreeSnapshot.bind(lifecycle), summaries };
  let ownsWorker: (lease: import("../../../../models/run/worker.js").WorkerLeaseRecord) => boolean = () => false;
  const projection = createOperatorProjection({ ownsWorker: lease => ownsWorker(lease), stateRoot, clock, appVersion, descriptorSetHash: setHash, ledger, database, descriptors, reader: servedReader });

  const noteWriter = createNoteTimelineWriter({ repository: loggingRepository, clock });

  // Ordinary timeline and notes retain their 30-day append-day window.
  // Confirmed operation events remain until explicit owner deletion.
  database.authority.timelineEvents.pruneBefore(localDatePart(new Date(
    clock.nowMs() - EVENT_STREAM_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  )));

  // Fold whatever span history already exists before serving a single count.
  projection.rebuildFromTimeline();
  const initialHealth = projection.health();
  if (initialHealth.state === "degraded") {
    throw new Error(`dashboard refused to start over a degraded projection: ${initialHealth.lastError ?? "unknown"}`);
  }
  const runLogsHub = new RunLogsStreamHub({ projection, store: createRunLogStreamStore(database.authority.timelineEvents),
    readRun: runId => {
      const existence = lifecycle.read(runId);
      return existence.state === "present" ? { disposition: existence.disposition, run: existence.run } : undefined;
    } });
  runLogsHub.poll();
  if (runLogsHub.stats().degraded) throw new Error("dashboard refused to start over unreadable confirmed log history");
  startupCleanups.push(requiredClosure(() => runLogsHub.close()));

  // Read the shared SQLite cursor; process-local notifications cannot guarantee event delivery.
  const timelineTimer = setInterval(() => {
    projection.ingestFromTimeline();
    runLogsHub.poll();
    // Lease transitions need authority polling because they need not emit spans.
    database.reconcileWorkerControlMilestones(clock.now().toISOString());
    reconcileDeadWorkerLifetimes(database, clock, reportSupervisorFault);
    projection.reconcileWorkerAuthority();
  }, TIMELINE_POLL_MS);
  timelineTimer.unref();
  startupCleanups.push(() => clearInterval(timelineTimer));


  const supervisorFaultSink = input.workerProcess?.faultSink ?? ((line: string): void => {
    process.stderr.write(`${line}\n`);
  });
  const reportSupervisorFault = (error: Error): void => {
    supervisorFaultSink(JSON.stringify({
      ts: clock.now().toISOString(),
      level: "error",
      source: "worker-supervisor",
      message: error.message,
    }));
  };
  const reportDashboardTransferFault = (error: Error): void => {
    supervisorFaultSink(JSON.stringify({
      ts: clock.now().toISOString(),
      level: "error",
      source: "dashboard-http",
      message: error.message,
    }));
  };
  const assertAssistantEffect = (commandId: string): void => {
    if (database.authority.assistantAuthorization.actionByCommand(commandId) === undefined) return;
    assistantAuthorization.assertEffect(commandId);
  };
  profile.runtime.beginSupervisorConstruction(profile.token);
  const workerControl = composeWorkerProcessControl({
    profileRoot: resolved.config.paths.browserProfileRoot,
    processLockRoot: join(repoRoot, input.isolation.processLockRoot),
    database,
    clock,
    scheduler: input.workerProcess?.scheduler ?? createTimeoutDeadlineScheduler(clock),
    launch: input.workerProcess?.launch ?? productionWorkerLaunch(repoRoot, env),
    spawn: input.workerProcess?.spawn ?? realWorkerProcessSpawner(),
    birth: input.workerProcess?.birth ?? { pollMs: WORKER_BIRTH_POLL_MS, timeoutMs: WORKER_BIRTH_TIMEOUT_MS },
    onFault: reportSupervisorFault,
    preflight: runtimePreflight,
    assertAssistantEffect,
  });
  profile.runtime.bindSupervisor(profile.token, workerControl.supervisor);
  startupCleanups.push(requiredClosure(async () => {
    await prepareRuntimeClosure();
    const evidence = workerControl.supervisor.close();
    if (evidence.length > 0) {
      throw new RuntimeCustodyUncertainError([new Error("dashboard worker closure is unproved")]);
    }
  }));
  ownsWorker = lease => workerControl.supervisor.ownsWorker(lease.workerId, lease.processId, lease.lifecycle.startedAt);
  database.reconcileWorkerControlMilestones(clock.now().toISOString());
  reconcileDeadWorkerLifetimes(database, clock, reportSupervisorFault);
  // Ref write-safety's typed operator resolutions, over the SAME AuthorityDatabase
  // instance as the kernel transaction (the executor's documented requirement).

  const writeResolution: WriteResolutionExecutor = createWriteResolutionExecutor({
    continuation: runContinuationPort(lifecycle),
    descriptors,
    authority: database,
    ids,
  });

  const artifacts = createContentAddressedArtifactWriter({
    admission,
  });
  await artifacts.ready;
  const artifactReader = createServerVerifiedArtifactReader({
    admission,
  });
  await artifactReader.ready;
  const intakeParser = createIntakeParser({ artifacts });
  const intakeProjections = {
    resolve: (workflowId: string) => INTAKE_PROJECTIONS[workflowId],
  };

  const trustReads = createTrustReadDependencies({ database, artifactReader, reader: lifecycle });
  const runDetailDeps = createOperatorRunDetail({ stateRoot, projection, database, runReader: lifecycle, canonical: { reader: lifecycle, database, descriptors: { resolve: (workflowId) => DESCRIPTORS.find((entry) => entry.id === workflowId) ?? stepProofDescriptorOf(workflowId) } }, trust: trustReads.trust, captures: trustReads.captures });

  const explorerBoundary = composeExplorer({ database, clock, descriptorSetHash: setHash });

  const kernel = createCommandKernel({
    preflight: runtimePreflight.admission,
    failureResolution: composeFailureResolution(database.authority).commands,
    lifecycle,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(repositories => { assertCurrent(); const result = work(repositories); assertCurrent(); return result; }) },
    clock,
    ids,

    appVersion,
    descriptors,
    writeResolution,
    workerRuntime: workerControl.workerRuntime,
    intakeParser,
    intakeProjections,

    configIdentity: { configFingerprint: resolved.fingerprint, configSnapshotId },
    settings: settingsBoundary.executor,
    authorityProfileId: admission.profileBinding.profileId,
    assistantRevalidate: command => {
      if (database.authority.assistantAuthorization.actionByCommand(command.commandId) === undefined) return;
        assistantAuthorization.assertEffect(command.commandId, command);
    },
    storageRelocationPlans,
    explorerEdits: explorerBoundary.executor,
  });

  const assistantAuthorization = composeProfileAssistantAuthorization(profile.runtime, profile.token, kernel, clock);

  const commands = createDashboardCommandService({
    kernel,
    projection,
    startWorkerCapacity: createRunWorkerCapacity({ kernel, authority: database.authority,
      reconcileWorker: workerId => {
        const lease = database.settleDeadWorkerLifetime(workerId, clock.now().toISOString());
        return lease !== undefined && isLiveWorker(lease);
      } }),
  });

  const startPlans = createStartPlanService({
    preflight: runtimePreflight.admission,
    protectedSecrets,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(repositories => { assertCurrent(); const result = work(repositories); assertCurrent(); return result; }) },
    authorityRead: database,
    descriptors,
    clock,
    ids,
    planTtlMs: input.startPlanTtlMs ?? 10 * 60 * 1000,
    configFingerprint: resolved.fingerprint,
    configSnapshotId,
    plannedBy: LOCAL_OPERATOR_ACTOR_ID,
  });

  const intake = composeIntake({ database, artifacts, parser: intakeParser, projections: intakeProjections, descriptors, clock, ids });
  const workbookLibrary = createWorkbookLibraryService({ repository: database.authority.workbooks, clock });

  const shell = composeShell({ database, projection, activity, clock, timeZone, ids, artifacts, descriptors, runLogsHub,
    appVersion, descriptorSetHash: setHash, backfillGaps: backfillGapNotifier,
    notificationPublications: { subscribe: notificationInbox.onPublication, project: publication => database.withAuthorityReadSnapshot(() => ({
      sourceId: FingerprintSchema.parse(publication.sourceId), actorId: publication.notification.actorId, durable: publication.durable,
      notification: notificationWireOf(publication.notification, clock.nowMs(), notificationDisplayContext(publication.notification, {
        presentation: runDetailDeps,
        read: id => lifecycle.read(id), descriptor: id => descriptors.resolve(id),
        checkpoints: { listByAttempt: (workflowId, itemId, nodeId, attempt) => database.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt) },
      }), notificationSourceEventOf(publication.notification, { actorId: publication.notification.actorId, notificationId: publication.notification.notificationId, adopted: false, event: publication.event })),
    })) },
    preflightReport: () => preflightAuthority.readLatest(), backupSummary: readBackupSummary,
  });
  const { hub } = shell;
  startupCleanups.push(requiredClosure(() => hub.close()));

  const initialPreflight = await preflightAuthority.refresh(new AbortController().signal);
  const blockingChecks = initialPreflight.results.filter(({ status }) => status === "fail");
  if (blockingChecks.length > 0) {
    throw new Error(
      `dashboard preflight refused startup: ${blockingChecks.map(({ check, summary }) => `${check}: ${summary}`).join("; ")}`,
    );
  }

  startupCleanups.push(prepareRuntimeClosure);
  const notificationTarget = createNotificationTargetQuery({ get: database.authority.notifications.get, read: id => lifecycle.read(id), failure: database.authority.failures.get });
  const app = createDashboardApp({
    chatGptAccount: {
      readAccount: () => { assertCurrent(); const result = chatGptAccount.readAccount(); assertCurrent(); return result; },
      signIn: async fields => { assertCurrent(); const result = await chatGptAccount.signIn(fields); assertCurrent(); return result; },
      signOut: async () => { assertCurrent(); const result = await chatGptAccount.signOut(); assertCurrent(); return result; },
    },
    notifications: { snapshot: actor => database.withAuthorityReadSnapshot(() => database.authority.notifications.listByActor(actor).map(record => notificationWireOf(record, clock.nowMs(), notificationDisplayContext(record, {
      presentation: runDetailDeps,
      read: id => lifecycle.read(id), descriptor: id => descriptors.resolve(id),
      checkpoints: { listByAttempt: (workflowId, itemId, nodeId, attempt) => database.authority.runCheckpoints.listByAttempt(workflowId, itemId, nodeId, attempt) },
    }), notificationSourceEventOf(record, database.authority.notificationPublications.latest(record.notificationId))))), target: (id, actor) => database.withAuthorityReadSnapshot(() => notificationTarget(id, actor)), status: notificationObserver.status },
    ...(staticBundle === undefined ? {} : { staticBundle }),
    requestIdentity: { identify: request => { assertCurrent(); return createSoloRequestIdentityCheckpoint(resolved.config.actor).identify(request); } },
    preflight: createPreflightReportService({ dashboard: preflightAuthority, runtime: runtimePreflight, clock }),
    ...shell,
    projection,
    runDetail: runDetailDeps,
    data: composeDataQueries(runDetailDeps),
    diagnosticBundles: trustReads.diagnosticBundles,
    commands,
    commandJournal: database.authority.commands,
    protectedCommandAcceptedAt: (commandId) => protectedSettingsAuthority.acceptedAt(commandId),
    bulkCommandAcceptances: {
      withTransaction: (work) => database.withAuthorityTransaction((repositories) => {
        assertCurrent(); const result = work({ get: repositories.commands.getBulk, insert: repositories.commands.acceptBulk }); assertCurrent(); return result; }),
    },
    startPlans,
    intake,
    intakeCommandResult: createIntakeCommandResultQuery(database),
    workbooks: { library: workbookLibrary, intake: createWorkbookIntakeBridge(workbookLibrary, intake) },
    ...settingsBoundary.routes,
    ...composeStorage({ credentials: context.credentials, admission, repoRoot, stateRoot, backupDirectory, clock, serviceState: () => backupServiceState }),
    ...explorerBoundary.routes,
    activity,
    activityPopulation,
  });

  const startHttpServer = input.httpServerStarter ?? startDashboardHttpServer;
  const server: DashboardHttpServer = input.applicationTransport === undefined ? await startHttpServer({
    app,
    port: input.backendPortOverride ?? input.isolation.backendPort,
    onTransferError: reportDashboardTransferFault,
  }) : { port: input.applicationTransport.listener.port,
    close: input.applicationTransport.listener.mount(app, input.applicationTransport.accepts).close };
  transportClosed = false;
  startupCleanups.push(requiredClosure(async () => {
    const failures: unknown[] = [];
    try { await prepareRuntimeClosure(); } catch (error) { failures.push(error); }
    try { await server.close(); transportClosed = true; } catch (error) { failures.push(error); }
    if (failures.length > 0) throw new RuntimeCustodyUncertainError(failures);
  }));
  dashboardPreflightRunners.markBackendOwned(server.port);
  void notificationObserver.observe();
  const gateParkTimer = setInterval(() => void notificationObserver.observe(), GATE_PARK_WATCH_MS);
  gateParkTimer.unref();
  startupCleanups.push(() => clearInterval(gateParkTimer));

  let detaching: Promise<void> | undefined;
  const detach = (): Promise<void> => {
    detaching ??= (async () => {
      const failures: unknown[] = [];
      try { await server.close(); transportClosed = true; } catch (error) { failures.push(error); }
      try { hub.close(); } catch (error) { failures.push(error); }
      try { runLogsHub.close(); } catch (error) { failures.push(error); }
      clearInterval(timelineTimer);
      clearInterval(gateParkTimer);
      try { await notificationObserver.stop(); } catch (error) { failures.push(error); }
      try { await profile.runtime.awaitClosurePreparation(selected); } catch (error) { failures.push(error); }
      try { if (workerControl.supervisor.close().length > 0) throw new Error("dashboard worker closure is unproved"); }
      catch (error) { failures.push(error); }
      if (failures.length > 0) throw new RuntimeCustodyUncertainError(failures);
    })();
    return detaching;
  };
  return Object.freeze({
    assistantAuthorization,
    port: server.port,
    notificationStatus: notificationObserver.status,
    noteWriter,
    detach,
    stop: async (): Promise<void> => {
      const failures: unknown[] = [];
      try { await prepareRuntimeClosure(); } catch (error: unknown) { failures.push(error); }
      try { await detach(); } catch (error) { failures.push(error); }
      if (failures.length > 0) throw new RuntimeCustodyUncertainError(failures);
      try { await profile.runtime.close(); }
      catch (error) { throw new RuntimeCustodyUncertainError([...failures, error]); }
      try { processLock?.release(); }
      catch (error) { throw new RuntimeCustodyUncertainError([...failures, error]); }
      if (input.applicationTransport === undefined) {
        try { machineAdmission.release(); }
        catch (error) { throw new RuntimeCustodyUncertainError([...failures, error]); }
      }
    },
  });
}


export async function composeDashboardApplication(input: DashboardComposeInput): Promise<Readonly<{ port: number; stop(): Promise<void> }>> {
  const env = input.env ?? hostAwareResolutionEnvironment(probePrimaryDisplay);
  assertNoMigratedEnvironmentKeys(env);
  const machine = requireRuntimeAdmission(input.admission), clock = input.clock ?? systemClock;
  const repoRoot = input.repoRoot ?? process.cwd();
  const frontend = DashboardFrontendModeSchema.default("vite-dev").parse(input.frontend);
  const bundle = frontend === "built-bundle" ? await openStaticBundle(join(repoRoot, "dist", "dashboard"), repoRoot, input.frontendBuildScript) : undefined;
  const processLock = acquireRuntimeProcessLock({ processLockRoot: join(repoRoot, input.isolation.processLockRoot), name: "server", pid: process.pid }, clock);
  const profile = (() => {
    try { return composeProfileRuntime({ admission: machine, clock, hostFacts: hostConfigFacts(env),
      processLockRoot: join(repoRoot, input.isolation.processLockRoot) }); }
    catch (error) {
      try { processLock.release(); } catch (cleanup) { throw new RuntimeCustodyUncertainError([error, cleanup]); }
      throw error;
    }
  })();
  const app = new Hono<{ Variables: { requestActorId: ReturnType<ReturnType<typeof createSoloRequestIdentityCheckpoint>["identify"]> } }>();
  type Selection = { cookie: string; token: string; profileId: string; epoch: number; runtime: DashboardRuntime };
  let selection: Selection | undefined;
  let pending: { cookie: string; operationId: string; profileId: string; runtime: DashboardRuntime } | undefined;
  let transitioning = false;
  const retainedFailures: unknown[] = [];
  const cookieName = "relay-profile-session";
  let registeredPort: number = input.backendPortOverride ?? input.isolation.backendPort;
  const cookieOf = (request: Request): string | undefined => {
    const cookies = request.headers.get("cookie")?.split(";").map(value => value.trim()).filter(value => value.startsWith(`${cookieName}=`));
    if (cookies?.length !== 1) return undefined;
    return cookies[0]?.slice(cookieName.length + 1);
  };
  const loopback = (request: Request): boolean => {
    const host = request.headers.get("host");
    if (host === null || !URL.canParse(`http://${host}`)) return false;
    const url = new URL(`http://${host}`);
    const allowedPorts = frontend === "vite-dev" ? [registeredPort, input.isolation.frontendPort] : [registeredPort];
    return (url.hostname === "127.0.0.1" || url.hostname === "localhost") && allowedPorts.includes(Number(url.port || 80))
      && url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "" && url.password === ""
      && (request.headers.get("origin") === null || request.headers.get("origin") === url.origin);
  };
  const current = (request: Request): Selection => {
    if (!loopback(request) || transitioning || selection === undefined || cookieOf(request) !== selection.cookie) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    profile.assertCurrent(selection.token);
    return selection;
  };
  const selectedPath = (request: Request): boolean => {
    const path = new URL(request.url).pathname;
    return (path.startsWith("/api/") && !path.startsWith("/api/v1/profile/")) || path.startsWith("/events") || path.startsWith("/artifacts");
  };
  const publicFailure = (error: Error) => {
    if (error instanceof ProfileSessionRefusedError) return { status: 409 as const,
      body: PublicProfileStateSchema.parse({ state: "refused", code: error.code }) };
    const mapped = failureStatus(error);
    if (mapped.status === 500) retainedFailures.push(error);
    return { status: mapped.status, body: PublicProfileStateSchema.parse({ state: "error",
      code: error instanceof RuntimeCustodyUncertainError ? "RUNTIME_CUSTODY_UNCERTAIN" : mapped.body.code }) };
  };
  app.onError((error, c) => { const failure = publicFailure(error); return c.json(failure.body, failure.status); });
  app.use("/api/v1/profile/*", async (c, next) => {
    if (!loopback(c.req.raw)) return c.json(PublicProfileStateSchema.parse({ state: "refused", code: "PROFILE_SESSION_STALE" }), 403);
    return next();
  });
  app.get("/api/v1/profile/state", c => {
    if (selection === undefined) return c.json(PublicProfileStateSchema.parse(pending !== undefined && cookieOf(c.req.raw) === pending.cookie
      ? { state: "cancelling", operationId: pending.operationId } : { state: "signed-out" }));
    const active = current(c.req.raw);
    return c.json(PublicProfileStateSchema.parse({ state: "active", profileId: active.profileId, epoch: active.epoch,
      duoState: machine.readProfileRegistry().profiles.find(row => row.profileId === active.profileId)?.duoState }));
  });
  app.use("/api/v1/profile/sign-in", operatorMutationIngressGuard);
  app.use("/api/v1/profile/sign-up", operatorMutationIngressGuard);
  app.use("/api/v1/profile/logout", operatorMutationIngressGuard);
  const activate = async (request: Request, signup: boolean) => {
    if (transitioning || selection !== undefined || pending !== undefined) throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
    transitioning = true;
    try {
      const result = await (async () => {
        if (signup) return profile.session.signUp({ ...ProfileSignUpRequestSchema.parse(await request.json()), createdAt: clock.now().toISOString() });
        const fields = { ...ProfileLoginRequestSchema.parse(await request.json()), at: clock.now().toISOString() };
        const signed = profile.session.signIn(fields);
        if (signed.state !== "cancelling") return signed;
        const continuation = profile.session.authorizeLogoutContinuation(fields);
        if (continuation.state !== "authorized") return continuation;
        return continuation.resume();
      })();
      if (result.state === "wiped") return { state: "signed-out" as const };
      if (result.state === "cancelling" && result.operationId !== undefined) return { state: "cancelling" as const, operationId: result.operationId };
      if (result.state !== "active") return { state: "refused" as const, code: result.code };
      const guarded = new Hono<{ Variables: { requestActorId: ReturnType<ReturnType<typeof createSoloRequestIdentityCheckpoint>["identify"]> } }>();
      guarded.use("*", async (c, next) => {
        try { current(c.req.raw); } catch (error) {
          if (!(error instanceof ProfileSessionRefusedError)) throw error;
          return c.json(PublicProfileStateSchema.parse({ state: "refused", code: error.code }), 401);
        }
        return next();
      });
      guarded.onError((error, c) => { const failure = publicFailure(error); return c.json(failure.body, failure.status); });
      let selectedApp: ReturnType<typeof createDashboardApp> | undefined;
      guarded.all("*", c => { if (selectedApp === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE"); return selectedApp.fetch(c.req.raw); });
      const runtime = await composeDashboardRuntime({ ...input, profile: { runtime: profile, token: result.token },
        applicationTransport: { listener: { ...listener, mount: (activeApp, accepts) => { selectedApp = activeApp; return listener.mount(guarded, accepts); } }, accepts: selectedPath } });
      selection = { cookie: randomUUID(), token: result.token, profileId: result.profileId, epoch: result.epoch, runtime };
      const row = machine.readProfileRegistry().profiles.find(value => value.profileId === result.profileId);
      if (row === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
      return { state: "active" as const, profileId: result.profileId, epoch: result.epoch, duoState: row.duoState };
    } finally { transitioning = false; }
  };
  for (const [path, signup] of [["sign-in", false], ["sign-up", true]] as const) app.post(`/api/v1/profile/${path}`, async c => {
    const result = PublicProfileStateSchema.parse(await activate(c.req.raw, signup));
    if (result.state === "active" && selection !== undefined) c.header("set-cookie", `${cookieName}=${selection.cookie}; HttpOnly; SameSite=Strict; Path=/`);
    return c.json(result);
  });
  app.post("/api/v1/profile/logout", async c => {
    const active = selection === undefined ? undefined : current(c.req.raw);
    if (active === undefined && (pending === undefined || cookieOf(c.req.raw) !== pending.cookie)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    if (transitioning) throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
    transitioning = true;
    try {
      if (active !== undefined) {
        const result = profile.session.logOut(active.token, { at: clock.now().toISOString() });
        if (result.state !== "cancelling" || result.operationId === undefined) throw new ProfileSessionRefusedError("PROFILE_LOGOUT_BLOCKED");
        pending = { cookie: active.cookie, operationId: result.operationId, profileId: active.profileId, runtime: active.runtime };
        selection = undefined;
      }
      const operation = pending;
      if (operation === undefined) throw new ProfileSessionRefusedError("PROFILE_LOGOUT_BLOCKED");
      await operation.runtime.detach();
      await profile.awaitClosurePreparation(operation.profileId);
      const result = profile.session.resumeLogout(operation.operationId);
      if (result.state !== "wiped") return c.json(PublicProfileStateSchema.parse(result.state === "refused"
        ? { state: "refused", code: result.code } : { state: "cancelling", operationId: operation.operationId }));
      pending = undefined;
      c.header("set-cookie", `${cookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
      return c.json(PublicProfileStateSchema.parse({ state: "signed-out" }));
    } finally { transitioning = false; }
  });
  if (bundle !== undefined) app.use("*", staticBundleHandler(bundle));
  app.notFound(c => c.json(PublicProfileStateSchema.parse({ state: "refused", code: "PROFILE_SESSION_STALE" }), 401));
  const listener = await (async () => {
    try { return await startDashboardHttpServer({ app, port: input.backendPortOverride ?? input.isolation.backendPort }); }
    catch (error) {
      try { await profile.close(); } catch (cleanup) { throw new RuntimeCustodyUncertainError([error, cleanup]); }
      try { processLock.release(); } catch (cleanup) { throw new RuntimeCustodyUncertainError([error, cleanup]); }
      throw error;
    }
  })();
  registeredPort = listener.port;
  let stopping: Promise<void> | undefined;
  return Object.freeze({ port: listener.port, stop(): Promise<void> {
    if (stopping !== undefined) return stopping;
    transitioning = true;
    const failures: unknown[] = [];
    try { profile.beginClose(); } catch (error) { failures.push(error); }
    const transportClosure = listener.close();
    stopping = (async () => {
      try { await transportClosure; } catch (error) { failures.push(error); }
      failures.unshift(...retainedFailures);
      const selectedRuntime = selection?.runtime ?? pending?.runtime;
      if (selectedRuntime !== undefined) {
        try { await selectedRuntime.detach(); } catch (error) { failures.push(error); }
      }
      if (failures.length > 0) throw new RuntimeCustodyUncertainError(failures);
      try { await profile.close(); } catch (error) { throw new RuntimeCustodyUncertainError([error]); }
      try { processLock.release(); } catch (error) { throw new RuntimeCustodyUncertainError([error]); }
      try { machine.release(); } catch (error) { throw new RuntimeCustodyUncertainError([error]); }
    })();
    return stopping;
  } });
}
