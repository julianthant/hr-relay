import { localDatePart } from "../../domain/clock.js";
import { EVENT_STREAM_RETENTION_DAYS } from "../../domain/archive/retention.js";
import { createOperatorProjection, createOperatorRunDetail, createOperatorArchive } from "./compose/operator.js";
import { createTrustNotifications, createTrustReadDependencies } from "./compose/trust.js";
import { composeDataQueries } from "./compose/data.js";
export { dataOriginViewsOf } from "./compose/run-detail-descriptors.js";
export { readGateParks } from "./compose/trust.js";
import { createCredentialStore } from "../../infra/config/credential-store.js";
import { retainedRunProtectedBindings } from "../../domain/protected-input.js";
import { ActorIdSchema } from "../../domain/ids.js";
import { hostConfigFacts } from "../../domain/config/host-display.js";
/**
 * The 1g-spine dashboard composition value: open authority, wire the span
 * writers into THE run/queue projection, stand up the command kernel behind
 * the one command route, and serve the Hono BFF on the config-resolved
 * isolation port.
 *
 * This lives in `src/server/` — not `src/core/runtime-composition.ts` — for
 * the same reason `workflow-registry.ts` lives in `src/control/`: the layer
 * matrix places `server` beside `control` ABOVE `core`, so the composition
 * that imports workflow modules cannot textually sit in core without a layer
 * inversion. `startRebuildRuntime` receives this function as its injected
 * `dashboard` seam.
 *
 * Wired as of the 1f production composition:
 * - the write-resolution executor is `createWriteResolutionExecutor` over the
 *   SAME `AuthorityDatabase` instance the kernel's transactions run on (its
 *   documented requirement — the resolution executes INSIDE the kernel's
 *   authority transaction and `commitWriteAttempt` nests on that connection).
 *
 * Wired as of W3 (ref execution-and-sessions §11, D271): the REAL worker
 * process supervisor. The dashboard launches browser-worker OS processes as
 * exact argv children of the worker CLI, proves each birth against the durable
 * worker lease, and settles every worker-pool command through the kernel's
 * async pool seam (`executeWorkerPool`) — no acknowledgement before process
 * evidence, and the graceful-stop channel writes the durable lease directive
 * at the command's own `now`.
 *
 * Deliberately typed-but-unwired in this process (fails loud by name):
 * - `refresh-browser` / `reopen-browser`: a worker-owned browser session lives
 *   in the CHILD process and this supervisor has no cross-process channel into
 *   it yet; acknowledging an effect that did not happen is exactly what the
 *   supervisor refuses to do.
 */
import { spawn as spawnChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
} from "node:fs";
import { join } from "node:path";
import { openStaticBundle } from "./static-bundle.js";
import { z } from "zod";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import {
  DESCRIPTORS,
  INTAKE_PROJECTIONS,
  SERVER_REGISTRY,
  WORKFLOW_MODULES,
  readPendingImplBindings,
} from "../../control/workflow-registry.js";
import {
  createCommandKernel,
  createExplorerCommandJournal,
  type WorkerPoolRuntimeAdoption,
  type WriteResolutionExecutor,
} from "../../core/command-kernel.js";
import { createWorkerPoolRuntimeExecutor } from "../../core/worker-loop.js";
import type { MonotonicDeadlineScheduler } from "../../core/deadline-scheduler.js";
import { isLiveWorker } from "../../domain/run/worker.js";
import {
  createDashboardWorkerProcessSupervisor,
  type DashboardWorkerProcessSupervisor,
  type WorkerCliLaunchSpec,
  type WorkerProcessSpawner,
} from "./worker-supervisor.js";
import { RunRecordService, runContinuationPort } from "../../core/run-record-service.js";
import { createWriteResolutionExecutor } from "../../core/write-recovery.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { resolveConfigWithProvenance } from "../../domain/config/resolve.js";
import { SETTINGS_SCHEMA_HASH, settingsRuntimeIdentity } from "../../domain/config/settings.js";
import { systemIdFactory, type IdFactory } from "../../domain/identifiers.js";
import {
  FingerprintSchema,
  LOCAL_OPERATOR_ACTOR_ID,
  ProviderAdmissionIdSchema,
  type Fingerprint,
} from "../../domain/ids.js";
import {
  assertNoMigratedEnvironmentKeys,
  hostAwareResolutionEnvironment,
  workerBootstrapEnvironment,
} from "../../domain/secrets.js";
import { probePrimaryDisplay } from "../../infra/host/primary-display.js";
import { sha256Hex } from "../../domain/sha256.js";
import { createPreflightAuthority } from "../../domain/preflight.js";
import {
  BackupServiceStateWireSchema,
  type BackupServiceStateWire,
} from "../../domain/dashboard/storage.js";
import {
  AuthorityDatabase,
  AuthorityHealthPreflightRunner,
  summarizeBackupHealth,
  type AuthorityRepositories,
} from "../../infra/sqlite/index.js";
import { acquireRuntimeProcessLock } from "../../infra/sqlite/runtime-process-locks.js";
import { pruneEventStreams } from "../../infra/events/jsonl-streams.js";
import { createTransactionHistory } from "../../infra/sqlite/transaction-history.js";
import { createTimelineEmitter } from "../../infra/events/timeline-emitter.js";
import { createNoteJsonlWriter, type NoteJsonlWriter } from "../../infra/events/note-jsonl-writer.js";
import { createContentAddressedArtifactWriter } from "../../infra/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader } from "../../infra/artifacts/server-verified-artifact-reader.js";

import { createIntakeParser } from "../intake/intake-parser.js";
import { createCredentialSecretSource, createSettingsRuntimeReader, readSettings } from "../settings-runtime.js";
import { createDashboardCommandService } from "./commands/command-service.js";
import { createSettingsApplicationExecutor } from "./commands/settings-service.js";
import { createExplorerEditService } from "./commands/explorer-edit-service.js";
import {
  createExplorerOverrideStore,
  ExplorerOverridePendingError,
} from "./commands/explorer-override-store.js";
import { createIntakeService } from "./commands/intake-service.js";
import { runQueuedSpanEvent } from "./commands/run-queued-span.js";
import { createStartPlanService } from "./commands/start-plan-service.js";
import { createDashboardApp } from "./routes/api.js";
import { createCrossDateSearchService } from "./queries/search.js";
import { createOperatorXlsxExportService } from "./exports/operator-xlsx-export-service.js";
import { createSoloRequestIdentityCheckpoint } from "./request-identity.js";
import { DASHBOARD_LAUNCH_NONCE_ENV } from "./frontend-owner.js";
import { EXPLORER_SOURCE_ROOT, readScenarioSources } from "./queries/explorer.js";
import { readCommittedUiCatalog } from "./queries/ui-catalog.js";
import { buildSafeUiCatalog } from "../../stores/ucpath/driver/catalog.js";
import { createDashboardStreamHub } from "./subscriptions/dashboard-stream.js";
import { startDashboardHttpServer } from "./http-server.js";
import { createAdvisoryProviderClient } from "../../core/provider-admission.js";
import { produceFailureTriageAdvisory } from "../../services/trust/advisory.js";
import { createGeminiAdvisoryAdapter } from "../../infra/providers/gemini-advisory.js";
import { createProviderPool } from "../../infra/providers/provider-pool.js";
import { createTimeoutDeadlineScheduler } from "../scheduling/timeout-deadline-scheduler.js";
import { optionalSecretFamily, providerModelChain } from "../../domain/secrets.js";
import type { AdvisoryQueryDeps } from "./queries/advisory.js";
import { createArchiveSnapshotSource } from "./queries/archive.js";

import { createDashboardPreflightRunners } from "../preflight/dashboard-runners.js";

export interface DashboardRuntime {
  readonly port: number;
  readonly noteWriter: NoteJsonlWriter;
  stop(): Promise<void>;
}

export const DashboardFrontendModeSchema = z.enum(["vite-dev", "built-bundle"]);
export type DashboardFrontendMode = z.infer<typeof DashboardFrontendModeSchema>;

export interface DashboardComposeInput {
  readonly isolation: RuntimeIsolation;
  readonly env?: NodeJS.ProcessEnv;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  /** Where package.json and the state root resolve from. */
  readonly repoRoot?: string;
  /**
   * Who serves the frontend bytes (ref frontend-backend-integration §6.9). `vite-dev` — the
   * default and the development path — leaves that to the Vite dev server on the
   * isolated frontend port; `built-bundle` serves `<repoRoot>/dist/dashboard` from
   * this process and refuses to start without a built `index.html`.
   */
  readonly frontend?: DashboardFrontendMode;
  readonly startPlanTtlMs?: number;
  /**
   * Test-only ingress bind override: `0` asks the OS for an ephemeral port,
   * so a composition test never contends with — or silently passes vacuous
   * because of — a concurrently running dashboard on the machine-wide
   * isolation port. Typed as the literal 0 on purpose: "ephemeral" is the
   * only override; a different fixed port can never enter through this seam.
   * Production omits it and binds the isolation port.
   */
  readonly backendPortOverride?: 0;
  /** Test-only preflight probe override; production always checks the isolated frontend port. */
  readonly frontendPortOverride?: 0;
  /**
   * The worker process edges (W3). Production composes the real
   * `child_process` spawner, the node+tsx CLI launch spec, the real timer
   * scheduler and a structured stderr fault sink; a test injects fakes HERE so
   * it exercises the same composition value production runs.
   */
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

/**
 * The advisory model this root names when the operator's `.env` declares no
 * chain — the same explicit-with-provenance rule `OCR_GEMINI_MODEL_ID` follows
 * (legacy `provider-limits.ts` priority-1 tier-1), never a default minted
 * inside the secrets reader.
 */

/**
 * D218: maximum polling delay for committed timeline events from other processes.
 * Commands also tick this durable cursor before their follow-up reads.
 */
const TIMELINE_POLL_MS = 250;

/**
 * D262: how often the needs-you watch re-derives the parked-at-gate set from
 * authority. Its own timer rather than the span tail's, because a notification
 * cadence is not the projection's to decide, and its own interval rather than
 * the 15-minute backup cadence, because a run waiting on a person should not
 * wait a quarter of an hour to say so. The read is an index scan
 * (`tasks_heartbeat_idx` leads on `state`) over a set that is almost always
 * empty.
 */
export const GATE_PARK_WATCH_MS = 5_000;

export function descriptorSetHash(fingerprints: readonly string[]): Fingerprint {
  return FingerprintSchema.parse(
    sha256Hex(`hrauto:descriptor-set:v1\0${[...fingerprints].sort().join("\n")}`),
  );
}

/**
 * Birth-proof polling for a spawned worker child: the CLI cold start (tsx,
 * the workflow registry import closure, the authority open and lease write)
 * is seconds; a child that has not proved its lease inside the bound is
 * killed and the spawn command rejects loudly rather than waiting forever.
 */
const WORKER_BIRTH_POLL_MS = 250;

/**
 * The worker CLI exactly as `npm run cli -- worker …` runs it, as an argv
 * array: this node binary, tsx's loader, the secure environment bootstrap,
 * and its `cli` arm. The bootstrap is the CLI's SOLE production invoker —
 * `src/cli.ts` only exports `runCli` and running the module directly is
 * inert by design (2026-08-28) — so a launch that names `src/cli.ts` as the
 * entry spawns a child that exits 0 before ever writing a lease, which the
 * birth proof reports as "exited with code 0 before proving its lease birth".
 */
export function productionWorkerLaunch(repoRoot: string, environment?: NodeJS.ProcessEnv): Readonly<{
  command: string;
  environment: NodeJS.ProcessEnv;
  prefixArgs: readonly string[];
  cwd: string;
}> {
  return Object.freeze({
    command: process.execPath,
    environment: workerBootstrapEnvironment(environment),
    prefixArgs: Object.freeze(["--import", "tsx", join(repoRoot, "scripts", "secure-env-bootstrap.ts"), "cli"]),
    cwd: repoRoot,
  });
}
const WORKER_BIRTH_TIMEOUT_MS = 60_000;

export interface WorkerProcessControlInput {
  readonly database: AuthorityDatabase;
  readonly clock: Clock;
  readonly scheduler: MonotonicDeadlineScheduler;
  readonly launch: WorkerCliLaunchSpec;
  readonly spawn: WorkerProcessSpawner;
  readonly birth: Readonly<{ pollMs: number; timeoutMs: number }>;
  readonly onFault: (error: Error) => void;
}

/**
 * W3 (ref execution-and-sessions §11, D271): the dashboard's REAL worker
 * process control, one composition value shared by production and the
 * composition tests so a test can never prove a wiring the product does not
 * have. It binds the D271 supervisor's three authority edges to the ONE
 * `AuthorityDatabase` this process serves from:
 *
 * - the lease probe reads the LIVE worker lease (birth is proved against the
 *   child's own durable lease write — §11.3's only coordination channel);
 * - the graceful-stop channel writes the durable `stop` directive at EXACTLY
 *   the kernel command's `now` (`directive.requestedAt`), in its own authority
 *   transaction, and resolves with that durable instant — closing the W1/W2
 *   gap where a channel stamping its own clock would always postdate the
 *   kernel's observed-stage bound;
 * - the kernel adoption wraps the supervisor in the awaitable pool executor,
 *   so no worker-pool command is acknowledged before process evidence.
 */
export function composeWorkerProcessControl(input: WorkerProcessControlInput): Readonly<{
  supervisor: DashboardWorkerProcessSupervisor;
  workerRuntime: WorkerPoolRuntimeAdoption;
}> {
  const supervisor = createDashboardWorkerProcessSupervisor({
    launch: input.launch,
    spawn: input.spawn,
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
        const outcome = repositories.workerLeases.control({
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
    onFault: input.onFault,
  });
  return Object.freeze({
    supervisor,
    workerRuntime: Object.freeze({ pool: createWorkerPoolRuntimeExecutor(supervisor) }),
  });
}

/**
 * The production process boundary: `node:child_process.spawn` over the exact
 * argv array — never a shell, never a PATH lookup (the supervisor refuses a
 * non-absolute command). `stdio: "inherit"` keeps the worker's structured
 * stdout/stderr lines visible in the dashboard's terminal instead of
 * swallowing them; durable evidence still flows through spans, notes and
 * authority. The closed environment carries only process mechanics and host display.
 * Each child admits its own provider .env and opens its own protected authority.
 */
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

function ensureOwnerOnlyDirectory(path: string, label: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const handle = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(handle).isDirectory()) throw new Error(`${label} is not a directory`);
    fchmodSync(handle, 0o700);
    const permissions = fstatSync(handle).mode & 0o7777;
    if (permissions !== 0o700) {
      throw new Error(`${label} permissions are ${permissions.toString(8)}, expected 700`);
    }
  } finally {
    closeSync(handle);
  }
}

export async function composeDashboardRuntime(input: DashboardComposeInput): Promise<DashboardRuntime> {
  const clock = input.clock ?? systemClock;
  const ids = input.ids ?? systemIdFactory;
  const repoRoot = input.repoRoot ?? process.cwd();
  const stateRoot = join(repoRoot, input.isolation.stateRoot);
  const artifactRoot = join(repoRoot, input.isolation.artifactRoot);
  const appVersion = PackageVersionSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")),
  ).version;
  // Before any authority, lock or socket: a `built-bundle` dashboard with no
  // bundle must never look started (D189).
  // The composition boundary owns the one default: an absent mode IS the
  // development path, declared at the schema rather than as a literal fallback.
  const frontend = DashboardFrontendModeSchema.default("vite-dev").parse(input.frontend);
  const staticBundle = frontend === "built-bundle"
    ? await openStaticBundle(join(repoRoot, "dist", "dashboard"))
    : undefined;

  // D324: the production environment carries the host's primary display as the `display` default.
  const env = input.env ?? hostAwareResolutionEnvironment(probePrimaryDisplay);
  assertNoMigratedEnvironmentKeys(env);
  const hostFacts = hostConfigFacts(env);
  mkdirSync(stateRoot, { recursive: true });
  ensureOwnerOnlyDirectory(artifactRoot, "dashboard artifact root");
  /**
   * D181: this process takes the `server` role lock BEFORE it opens the
   * authority database. Two dashboards over one authority store is the
   * collision `config/runtime-isolation.json` has named since D88 and nothing
   * enforced; it is also the fact `cli storage restore` needs, because a
   * stopped-system proof is composed from these two lock files.
   */
  const processLock = acquireRuntimeProcessLock(
    { processLockRoot: join(repoRoot, input.isolation.processLockRoot), name: "server", pid: process.pid },
    clock,
  );
  const database = (() => {
    try {
      return AuthorityDatabase.open(
        { path: join(stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "rebuild-dashboard" },
        clock,
      );
    } catch (openError) {
      try {
        processLock.release();
      } catch (releaseError) {
        throw new AggregateError(
          [openError, releaseError],
          "dashboard authority open failed and its process record could not release",
          { cause: releaseError },
        );
      }
      throw openError;
    }
  })();
  const protectedSettingsAuthority = createCredentialStore({ stateRoot });
  const protectedSecrets = createCredentialSecretSource(protectedSettingsAuthority);
  const bootConfig = (() => {
    try {
      const explorerOverrides = createExplorerOverrideStore(join(stateRoot, "explorer-overrides.json"));
      try {
        database.withAuthorityTransaction((repositories) => {
          explorerOverrides.reconcilePending(
            undefined,
            createExplorerCommandJournal(repositories).findOutcome,
          );
        });
      } catch (error) {
        if (!(error instanceof ExplorerOverridePendingError)) throw error;
        // An unjournaled prepared claim retains the exact-command replay door.
        // Explorer GET/validate repeats this admission and fails loud until
        // that command commits; partial/divergent evidence refuses boot.
      }
      const persistedSettings = database.withAuthorityTransaction((repositories) =>
        readSettings(repositories));
      return Object.freeze({
        explorerOverrides,
        persistedSettings,
        resolved: resolveConfigWithProvenance(persistedSettings.settings, hostFacts, clock),
      });
    } catch (bootError) {
      try {
        database.close();
      } catch (closeError) {
        throw new AggregateError(
          [bootError, closeError],
          "dashboard settings boot failed and its authority database could not close",
          { cause: closeError },
        );
      }
      try {
        processLock.release();
      } catch (releaseError) {
        throw new AggregateError(
          [bootError, releaseError],
          "dashboard settings boot failed and its process record could not release",
          { cause: releaseError },
        );
      }
      throw bootError;
    }
  })();
  const { explorerOverrides, persistedSettings, resolved } = bootConfig;
  const reconcileExplorerRead = (repositories: AuthorityRepositories): void => {
    explorerOverrides.reconcilePending(
      undefined,
      createExplorerCommandJournal(repositories).findOutcome,
    );
  };
  const settingsReader = createSettingsRuntimeReader({
    database,
    hostFacts,
    clock,
    active: settingsRuntimeIdentity(persistedSettings, resolved.fingerprint),
  });

  const now = clock.now().toISOString();
  const configSnapshotId = ids.uuid();
  database.withAuthorityTransaction((repositories) => {
    repositories.configSnapshots.insert({
      configSnapshotId,
      revision: 1,
      fingerprint: resolved.fingerprint,
      capturedAt: now,
      capturedBy: LOCAL_OPERATOR_ACTOR_ID,
      config: resolved.config,
      provenance: resolved.provenance,
    });
    repositories.runtimeConfig.activate({
      settingsRevision: persistedSettings.revision,
      settingsFingerprint: persistedSettings.settingsFingerprint,
      configSnapshotId,
      configFingerprint: resolved.fingerprint,
      activatedAt: now,
    });
  });

  /**
   * D322 (ref dashboard-surfaces §2.5): this process runs NO backup cadence. A verified
   * authority backup is written only when the operator asks for one
   * (`npm run cli -- storage backup`), so the backup directory holds requested
   * generations only and the doctor wire's `service` arm is the fixed
   * never-run reading that names the command. 2i-D's start/interval/drain
   * triggers and the D222 stale/missing storage alert are retired with it.
   */
  const backupDirectory = join(stateRoot, "backups", "authority");
  const backupServiceState: BackupServiceStateWire = BackupServiceStateWireSchema.parse({
    state: "never-run",
    reason: "backups are written only on operator command (npm run cli -- storage backup)",
  });
  /**
   * The ONE cheap backup reading (ref dashboard-surfaces §2.5) for the bootstrap summary:
   * `current` when the newest verified manifest captured the live authority
   * generation, `stale` once the authority moved past it, `missing` when none
   * exists. D322 sets no age bound — a backup is exactly as old as the
   * operator's last command.
   */
  const readBackupSummary = (): "current" | "stale" | "missing" => {
    let liveGeneration: { state: "known"; value: number } | { state: "unavailable" };
    try {
      liveGeneration = { state: "known", value: database.getMeta().authorityGeneration };
    } catch {
      // A DISTINGUISHABLE unknown, not a default: authority unavailability is
      // already the summary's own `authority` arm, and the backup indicator
      // then judges by manifest presence alone — the degraded contract
      // `summarizeBackupHealth` documents.
      liveGeneration = { state: "unavailable" };
    }
    return summarizeBackupHealth(
      { backupDirectory },
      liveGeneration.state === "known" ? liveGeneration.value : undefined,
      clock,
    );
  };

  const spanWriter = createTimelineEmitter({ repository: database.authority.timelineEvents, clock });
  const lifecycle = new RunRecordService({ database, clock, ids,
    publishQueued: (run, publication) => {
      if (publication === undefined) throw new Error("queued run is missing its publication context");
      spanWriter.emit(runQueuedSpanEvent({ run, ...publication, actorId: ActorIdSchema.parse(publication.actorId) }));
    },
  });
  const { backfillGapNotifier, gateParkNotifier, readParks } = createTrustNotifications({
    database, clock, ids, reader: lifecycle,
  });

  /**
   * D262: the second wired producer — ref dashboard-surfaces §2.6's open operator gate. A run
   * parked at a gate is the one state in this product that cannot move without a
   * person, and until now nothing told anybody. The park itself is written by
   * the worker (a separate process, no operator attached, and a run must park
   * even when the inbox cannot be written), so the fact is READ back here from
   * authority, where it stands until a human resolves it.
   */

  const publishGateParks = async (): Promise<void> => {
    try {
      await gateParkNotifier.observed(readParks());
    } catch {
      /*
       * This catch keeps the timer alive; it does not decide the alert was
       * sent. The notifier advances its memory only after a durable row
       * commits, so the failed park is still pending and the NEXT tick retries
       * the same publish — the tree's own "retrying the same operation" arm,
       * not a substituted value. Nothing about the park is hidden meanwhile:
       * the run is `Waiting` on the queue with its gate named, served from
       * authority by a path that shares nothing with the inbox, and if
       * authority itself cannot be written the `StorageBanner`'s
       * authority-unavailable arm is already the surface that says so — D222's
       * structural argument (an authority that cannot be written cannot record
       * a notification about its own death), from the other side.
       */
    }
  };
  void publishGateParks();
  const gateParkTimer = setInterval(() => void publishGateParks(), GATE_PARK_WATCH_MS);
  gateParkTimer.unref();

  const descriptors = {
    resolve: (workflowId: string) => SERVER_REGISTRY[workflowId]?.descriptor,
  };
  const setHash = descriptorSetHash(DESCRIPTORS.map((descriptor) => descriptor.contractFingerprint));
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
    authorityHealth: new AuthorityHealthPreflightRunner({
      stateRootTrustAnchor: repoRoot,
      stateRoot,
      authorityPath: join(stateRoot, "state.db"),
      backupDirectory,
      busyTimeoutMs: 5000,
    }, clock),
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

  /**
   * ONE read-through over the append-only write ledger, shared by the two
   * surfaces that read it: the archive resolves an archived run's pointers
   * (D179) and the Activity report folds the range's entries (D236). A second
   * instance would be a second parse discipline over the record of what was
   * filed into a real HR system.
   */
  const ledger = createTransactionHistory(database.authority);

  const projection = createOperatorProjection({ stateRoot, clock, appVersion, descriptorSetHash: setHash, ledger, database, descriptors, reader: lifecycle });

  const noteWriter = createNoteJsonlWriter({ stateRoot, clock });

  // Ordinary timeline and notes retain their 30-day append-day window.
  // Confirmed operation events remain until explicit owner deletion.
  pruneEventStreams({ stateRoot, clock, streams: ["notes"] });
  database.authority.timelineEvents.pruneBefore(localDatePart(new Date(
    clock.nowMs() - EVENT_STREAM_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  )));

  // Fold whatever span history already exists before serving a single count.
  projection.rebuildFromTimeline();
  const initialHealth = projection.health();
  if (initialHealth.state === "degraded") {
    throw new Error(`dashboard refused to start over a degraded projection: ${initialHealth.lastError ?? "unknown"}`);
  }

  /**
   * Read the shared SQLite cursor so every producer process reaches the BFF.
   * Only notifications are process-local; missed notifications cannot lose history.
   */
  const timelineTimer = setInterval(() => {
    projection.ingestFromTimeline();
    // The Session Panel's cards and pool declarations are authority
    // (D248/D269); a lease moves without a span at birth, on the ticker's
    // `starting` → `idle`, on an operator directive, and on a crash/expiry
    // settled elsewhere, and a pool row moves on `plan-worker-count`.
    projection.reconcileWorkerAuthority();
  }, TIMELINE_POLL_MS);
  timelineTimer.unref();

  /**
   * W3: the REAL worker process control. Faults observed outside a command
   * (an escalation signal that could not be delivered, a process error after
   * birth, still-live children at close) reach the structured failure path as
   * one JSON line each — never console, never dropped.
   */
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
  const workerControl = composeWorkerProcessControl({
    database,
    clock,
    scheduler: input.workerProcess?.scheduler ?? createTimeoutDeadlineScheduler(clock),
    launch: input.workerProcess?.launch ?? productionWorkerLaunch(repoRoot, env),
    spawn: input.workerProcess?.spawn ?? realWorkerProcessSpawner(),
    birth: input.workerProcess?.birth ?? { pollMs: WORKER_BIRTH_POLL_MS, timeoutMs: WORKER_BIRTH_TIMEOUT_MS },
    onFault: reportSupervisorFault,
  });
  // Ref write-safety §4.1's typed operator resolutions, over the SAME AuthorityDatabase
  // instance as the kernel transaction (the executor's documented requirement).

  const writeResolution: WriteResolutionExecutor = createWriteResolutionExecutor({
    continuation: runContinuationPort(lifecycle),
    descriptors,
    authority: database,
    ids,
  });
  // Ref data-intake-and-edit-data §2.2 (D170): the upload route publishes source files through the
  // one content-addressed writer, and the parser re-derives rows and columns
  // from those immutable bytes for every intake read.
  const artifacts = createContentAddressedArtifactWriter({
    workspaceRoot: repoRoot,
    artifactRoot: input.isolation.artifactRoot,
  });
  const artifactReader = createServerVerifiedArtifactReader({
    workspaceRoot: repoRoot,
    artifactRoot: input.isolation.artifactRoot,
  });
  const intakeParser = createIntakeParser({ artifacts });
  const intakeProjections = {
    resolve: (workflowId: string) => INTAKE_PROJECTIONS[workflowId],
  };

  /**
   * Hoisted above the kernel because D179's archive freezes the SAME payloads
   * these deps render: the snapshot source and the route are one read model,
   * not two.
   */
  const trustReads = createTrustReadDependencies({ database, artifactReader, reader: lifecycle });
  const runDetailDeps = createOperatorRunDetail({ stateRoot, projection, database, runReader: lifecycle, canonical: { reader: lifecycle, database, descriptors: { resolve: (workflowId) => DESCRIPTORS.find((entry) => entry.id === workflowId) } }, trust: trustReads.trust, captures: trustReads.captures });

  const archiveDeps = createOperatorArchive({ clock, appVersion, database, ledger, reader: lifecycle });

  const explorerDeps = {
    clock,
    modules: WORKFLOW_MODULES,
    descriptorSetHash: setHash,
    pendingImplBindings: readPendingImplBindings(EXPLORER_SOURCE_ROOT),
    uiCatalog: buildSafeUiCatalog(),
    listScenarioSources: () => readScenarioSources(EXPLORER_SOURCE_ROOT),
    overrides: explorerOverrides,
  };
  const explorerEdits = createExplorerEditService({ explorer: explorerDeps, overrides: explorerOverrides });
  // Only the command kernel may supply an exact replay envelope. Query and
  // validation admission cannot use the file as authority ahead of its audit.
  // Capture the whole immutable view before releasing that same transaction;
  // every later request must reconcile and capture anew.
  const readExplorerOverrides = () => database.withAuthorityTransaction((repositories) => {
    reconcileExplorerRead(repositories);
    return explorerOverrides.readAll();
  });
  const readableExplorerDeps = {
    ...explorerDeps,
    overrides: { readAll: readExplorerOverrides },
  };

  const kernel = createCommandKernel({
    lifecycle,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids,
    // D179: the build every run this kernel enqueues is stamped with, and the
    // build an application-scope version bump is checked against.
    appVersion,
    descriptors,
    writeResolution,
    workerRuntime: workerControl.workerRuntime,
    intakeParser,
    intakeProjections,
    // D171: the identity an intake fan-out stamps its runs with — the SAME
    // resolved config and stored snapshot the start planner uses, so a run born
    // from a spreadsheet and one born from the run surface are comparable.
    configIdentity: { configFingerprint: resolved.fingerprint, configSnapshotId },
    settings: createSettingsApplicationExecutor((settings) => { resolveConfigWithProvenance(settings, hostFacts, clock); }, protectedSettingsAuthority),
    archiveSnapshots: createArchiveSnapshotSource(runDetailDeps),
    explorerEdits,
  });

  const commands = createDashboardCommandService({ kernel, projection });

  const startPlans = createStartPlanService({
    protectedSecrets,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    authorityRead: database,
    descriptors,
    clock,
    ids,
    planTtlMs: input.startPlanTtlMs ?? 10 * 60 * 1000,
    configFingerprint: resolved.fingerprint,
    configSnapshotId,
    plannedBy: LOCAL_OPERATOR_ACTOR_ID,
  });

  const intake = createIntakeService({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    authorityRead: {
      getIntakeSession: (intakeSessionId) => database.authority.intakeSessions.get(intakeSessionId),
      getIntakeManifest: (manifestId) => database.authority.intakeManifests.get(manifestId),
      findIntakeManifestsBySource: (sourceSha256) =>
        database.authority.intakeManifests.findBySource(sourceSha256),
    },
    artifacts,
    parser: intakeParser,
    projections: intakeProjections,
    descriptors,
    clock,
    ids,
    actorId: LOCAL_OPERATOR_ACTOR_ID,
  });

  /**
   * Ref operator-trust §4.4's advisory (2i-G, D178). The pool composes from the SAME
   * `geminiApiKeys` family and model chain the OCR pool uses, because they
   * are the same keys — but the capability, and therefore the budget, is its
   * own. No key composes NO adapter and no seam: the route then refuses by
   * name, and the bootstrap wire says `not-configured` with the environment
   * variable to set. A composed-but-empty advisory would be worse than none.
   */
  const advisoryKeys = optionalSecretFamily("geminiApiKeys", env);
  const advisoryModels = providerModelChain("geminiApiKeys", resolved.config);
  const advisoryChildren = advisoryModels
    .flatMap((modelId) => advisoryKeys.map((apiKey, keyIndex) => ({
      label: `gemini-key${String(keyIndex + 1)}/${modelId}`,
      adapter: createGeminiAdvisoryAdapter({ apiKey, modelId, clock }),
    })));
  const advisoryScheduler = createTimeoutDeadlineScheduler(clock);
  const advisory: AdvisoryQueryDeps | undefined = advisoryChildren.length === 0
    ? undefined
    : {
      runReader: lifecycle,
      authority: {
        getFailureForRun: (runId) => database.authority.failures.listByRun(runId).at(-1),
      },
      advise: (run, failure) => {
        // The SUBJECT run's own retained config identity (D116's discipline),
        // read back from authority rather than recomputed from this process's
        // current config — the run was budgeted under what it stored.
        const snapshot = database.authority.configSnapshots.get(run.envelope.configSnapshotId);
        if (snapshot === undefined) {
          throw new Error(
            `run ${run.envelope.runId} retained config snapshot ${run.envelope.configSnapshotId}`
            + " is absent from authority; the failure advisory cannot bind an identity it cannot read",
          );
        }
        const client = createAdvisoryProviderClient({
          runId: run.envelope.runId,
          attempt: run.envelope.attempt,
          surface: "failure-triage",
          configSnapshotId: snapshot.configSnapshotId,
          configFingerprint: snapshot.fingerprint,
          configSnapshot: snapshot,
          runSignal: new AbortController().signal,
          adapters: { "ai.advisory": createProviderPool("ai.advisory", advisoryChildren) },
          repository: database.authority.providerAdmissions,
          clock,
          idFactory: { next: () => ProviderAdmissionIdSchema.parse(ids.uuid()) },
          deadlineScheduler: advisoryScheduler,
        });
        return produceFailureTriageAdvisory({ clock, client }, failure, retainedRunProtectedBindings(run).length > 0);
      },
    };

  const hub = createDashboardStreamHub({ projection, backfillGaps: backfillGapNotifier });

  const search = createCrossDateSearchService({
    clock,
    sourceIdentity: database.getSourceDatabaseIdentity(),
    cursorSigningKey: randomBytes(32),
    descriptors,
    authority: {
      readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
        authorityGeneration: database.getMeta().authorityGeneration,
        searchRuns: (searchInput) => database.authority.runs.search(searchInput),
      })),
    },
  });
  const xlsxExports = createOperatorXlsxExportService({
    clock,
    ids,
    sourceIdentity: database.getSourceDatabaseIdentity(),
    artifacts,
    authority: database.authority.operatorXlsxExports,
    search,
    activityReport: (from, to) => projection.buildActivityReportWire(from, to),
  });

  const abortStartup = (reason: Error): never => {
    hub.close();
    clearInterval(timelineTimer);
    clearInterval(gateParkTimer);
    for (const evidence of workerControl.supervisor.close()) {
      reportSupervisorFault(new Error(
        `dashboard preflight cleanup leaves a worker child ${evidence.state}: ${JSON.stringify(evidence)}`,
      ));
    }
    database.close();
    processLock.release();
    throw reason;
  };
  // The artifact writer and verified reader start initializing their roots at
  // construction. Serve nothing until both exist: awaited here, a failure is a
  // legible boot refusal with cleanup; un-awaited, a workspace removed under a
  // fast shutdown becomes an unhandled rejection after stop() has returned.
  try {
    await Promise.all([artifacts.ready, artifactReader.ready]);
  } catch (error: unknown) {
    abortStartup(new Error("dashboard artifact roots could not be initialized", { cause: error }));
  }
  const initialPreflight = await preflightAuthority.refresh(new AbortController().signal);
  const blockingChecks = initialPreflight.results.filter(({ status }) => status === "fail");
  if (blockingChecks.length > 0) {
    abortStartup(new Error(
      `dashboard preflight refused startup: ${blockingChecks.map(({ check, summary }) => `${check}: ${summary}`).join("; ")}`,
    ));
  }

  const app = createDashboardApp({
    ...(staticBundle === undefined ? {} : { staticBundle }),
    requestIdentity: createSoloRequestIdentityCheckpoint(resolved.config.actor),
    preflight: preflightAuthority,
    bootstrap: {
      appVersion,
      clock,
      // The MODULE tuple, not `DESCRIPTORS`: the served `role` (D219) is the
      // module's declaration, so the bootstrap document is built from the same
      // composition root the explorer reads.
      modules: WORKFLOW_MODULES,
      descriptorSetHash: setHash,
      preflightReport: () => preflightAuthority.readLatest(),
      settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      projection,
      authorityMeta: () => database.getMeta(),
      advisoryAvailability: () => (advisory === undefined
        ? {
          state: "unavailable",
          code: "not-configured",
          reason: "no GEMINI_API_KEY is set, so no ai.advisory provider is composed in this process",
        }
        : { state: "available" }),
      backupSummary: readBackupSummary,
    },
    projection,
    search,
    xlsxExports,
    runDetail: runDetailDeps,
    data: composeDataQueries(runDetailDeps),
    diagnosticBundles: trustReads.diagnosticBundles,
    archive: archiveDeps,
    commands,
    commandJournal: database.authority.commands,
    protectedCommandAcceptedAt: (commandId) => protectedSettingsAuthority.acceptedAt(commandId),
    bulkCommandAcceptances: {
      withTransaction: (work) => database.withAuthorityTransaction((repositories) =>
        work({ get: repositories.commands.getBulk, insert: repositories.commands.acceptBulk })),
    },
    startPlans,
    intake,
    hub,
    /**
     * D274 item 6 — the two READ-ONLY Settings status sections.
     *
     * Both halves are the SAME values the rest of this composition already runs
     * on: `resolved.config` is the config a run's `resolveSystemEntryUrl`
     * resolves against, and `DESCRIPTORS` is the tuple the kernel plans with and
     * the bootstrap projects. Neither is re-read, re-resolved or snapshotted, so
     * the page cannot state a host or a capability this process does not have.
     */
    settings: { config: resolved.config, descriptors: DESCRIPTORS },
    settingsEditor: { settings: settingsReader, environment: env, clock },
    storage: {
      doctorOptions: {
        stateRootTrustAnchor: repoRoot,
        stateRoot,
        authorityPath: join(stateRoot, "state.db"),
        backupDirectory,
        busyTimeoutMs: 5000,
      },
      clock,
      serviceState: () => backupServiceState,
    },
    /**
     * The explorer reads the SAME `WORKFLOW_MODULES` tuple the kernel composes
     * from (2i-G, D176) — not `DESCRIPTORS`, because a module also carries the
     * store list and the intake projection the surface reports. The UI catalog
     * comes off the in-memory registries here so the
     * served committed artifact can be checked against them on every read.
     */
    ...(advisory === undefined ? {} : { advisory }),
    explorer: readableExplorerDeps,
    explorerEdits: {
      validate(input) {
        const overrides = readExplorerOverrides();
        return createExplorerEditService({
          explorer: { ...explorerDeps, overrides: { readAll: () => overrides } },
          // Validation's revision/presentation basis is the graph's same view.
          overrides: {
            ...explorerOverrides,
            read: (workflowId) => overrides.find((entry) => entry.workflowId === workflowId),
          },
        }).validate(input);
      },
    },
    uiCatalog: { readCatalogJson: () => readCommittedUiCatalog(EXPLORER_SOURCE_ROOT) },
  });

  const server = await startDashboardHttpServer({
    app,
    port: input.backendPortOverride ?? input.isolation.backendPort,
    onTransferError: reportDashboardTransferFault,
  });
  dashboardPreflightRunners.markBackendOwned(server.port);

  return Object.freeze({
    port: server.port,
    noteWriter,
    stop: async (): Promise<void> => {
      const failures: unknown[] = [];
      try {
        await server.close();
      } catch (error: unknown) {
        failures.push(error);
      }
      try {
        hub.close();
      } catch (error: unknown) {
        failures.push(error);
      }
      clearInterval(timelineTimer);
      clearInterval(gateParkTimer);
      /**
       * W3 shutdown ordering: the supervisor closes AFTER ingress stopped
       * accepting worker commands (`server.close()` above) and BEFORE the
       * database closes and the process lock releases — its close() cancels
       * every armed escalation timer and refuses further commands, and the
       * evidence of every still-live child goes to the structured fault path.
       * This supervisor never pretends a child stopped: a live worker keeps
       * running (its lease, not this process, owns its lifecycle), and the
       * operator can read exactly what was left running.
       */
      try {
        for (const evidence of workerControl.supervisor.close()) {
          try {
            reportSupervisorFault(new Error(
              `dashboard shutdown leaves a worker child ${evidence.state}: ${JSON.stringify(evidence)}`,
            ));
          } catch (error: unknown) {
            failures.push(error);
          }
        }
      } catch (error: unknown) {
        failures.push(error);
      }
      // D322: no graceful-drain backup — an authority backup is written only on
      // operator command (`cli storage backup`), never as a side effect of stop().
      let databaseClosed = false;
      try {
        database.close();
        databaseClosed = true;
      } catch (error: unknown) {
        failures.push(error);
      }
      // Released only after the handle is closed: the lock's whole meaning is
      // "nothing holds this database open", so releasing it first would let a
      // restore start against a still-open file.
      if (databaseClosed) {
        try {
          processLock.release();
        } catch (error: unknown) {
          failures.push(error);
        }
      }
      const primary = failures[0];
      if (failures.length === 1) throw primary;
      if (failures.length > 1) {
        throw new AggregateError(failures, "dashboard shutdown observed multiple failures", { cause: primary });
      }
    },
  });
}
