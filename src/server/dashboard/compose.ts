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
 * Deliberately typed-but-unwired in this process (each fails loud by name):
 * - the worker process supervisor's `spawn-worker`: doc 03's Phase-1f
 *   ratification activates the command ARM (validation, journal, refusal
 *   semantics), but the dashboard process launching browser-worker OS
 *   processes is doc 05's live worker lane (doc 07 assigns the operator
 *   worker-control surface to 2i / the 1i live slice). The refusal names the
 *   real Phase-1 path: `npm run rebuild:cli worker <workflow-id>`;
 * - `refresh-browser` / `reopen-browser`: reaching a live worker's session set
 *   from this process is the same live-lane work; acknowledging an effect
 *   that did not happen is exactly what the executor refuses to do.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import { DESCRIPTORS, SERVER_REGISTRY } from "../../control/workflow-registry.js";
import { createCommandKernel, type WorkerRuntimeExecutor, type WriteResolutionExecutor } from "../../core/command-kernel.js";
import { createPhase1WorkerRuntimeExecutor, type WorkerProcessSupervisor } from "../../core/worker-loop.js";
import { createWriteResolutionExecutor } from "../../core/write-recovery.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { SettingsOverrideSchema } from "../../domain/config/schema.js";
import { resolveConfigWithProvenance } from "../../domain/config/resolve.js";
import { systemIdFactory, type IdFactory } from "../../domain/identifiers.js";
import { FingerprintSchema, LOCAL_OPERATOR_ACTOR_ID, type Fingerprint } from "../../domain/ids.js";
import { deriveSchemaHash } from "../../domain/schema-bound-value.js";
import { configResolutionEnvironment } from "../../domain/secrets.js";
import { sha256Hex } from "../../domain/sha256.js";
import {
  BackupServiceStateWireSchema,
  type BackupServiceStateWire,
} from "../../domain/dashboard/storage.js";
import {
  AuthorityBackupService,
  AuthorityDatabase,
  summarizeBackupHealth,
} from "../../infra/sqlite/index.js";
import { pruneEventStreams } from "../../infra/events/jsonl-streams.js";
import { createSpanJsonlWriter } from "../../infra/events/span-jsonl-writer.js";
import { createNoteJsonlWriter, type NoteJsonlWriter } from "../../infra/events/note-jsonl-writer.js";
import { createDashboardCommandService } from "./commands/command-service.js";
import { createStartPlanService } from "./commands/start-plan-service.js";
import { createDashboardApp } from "./routes/api.js";
import { createRunQueueProjection } from "./projectors/run-queue-projection.js";
import { createDashboardStreamHub } from "./subscriptions/dashboard-stream.js";
import { startDashboardHttpServer } from "./http-server.js";
import { createReceiptService } from "../trust/receipt-service.js";

export interface DashboardRuntime {
  readonly port: number;
  readonly noteWriter: NoteJsonlWriter;
  stop(): Promise<void>;
}

export interface DashboardComposeInput {
  readonly isolation: RuntimeIsolation;
  readonly env?: NodeJS.ProcessEnv;
  readonly clock?: Clock;
  readonly ids?: IdFactory;
  /** Where package.json and the state root resolve from. */
  readonly repoRoot?: string;
  readonly startPlanTtlMs?: number;
}

const PackageVersionSchema = z.strictObject({ version: z.string().min(1) }).loose();

/** Doc 03 §2.5: a dirty store gets a coalesced verified backup at least every 15 minutes. */
export const AUTHORITY_BACKUP_INTERVAL_MS = 15 * 60 * 1000;
/**
 * Three intervals — one slow or missed cycle must not flap the Settings
 * indicator, while a genuinely stalled backup lane still reads stale well
 * inside an operator session. Any authority-generation gap reads stale
 * regardless of age.
 */
export const AUTHORITY_BACKUP_MAX_AGE_MS = 45 * 60 * 1000;

export function descriptorSetHash(fingerprints: readonly string[]): Fingerprint {
  return FingerprintSchema.parse(
    sha256Hex(`hrauto:descriptor-set:v1\0${[...fingerprints].sort().join("\n")}`),
  );
}

/**
 * The dashboard process's `WorkerProcessSupervisor`: doc 03 §Phase-1f
 * activates the worker-browser command ARMS (schema, authority validation,
 * journal, typed refusals), while the process effects behind spawn and
 * refresh/reopen belong to doc 05's live worker lane (doc 07: the operator
 * worker-control surface is 2i / the 1i live slice). Until that lane lands,
 * each effect refuses BY NAME — a thrown supervisor error unwinds the whole
 * command, so no acknowledgement can claim an effect that did not happen.
 * `refreshBrowser`/`reopenBrowser` stay undefined on purpose: the Phase-1
 * executor's own "requires the 1g browser supervisor" refusal is the arm.
 */
export function createDashboardWorkerSupervisor(): WorkerProcessSupervisor {
  return Object.freeze({
    spawnWorker: (input: Readonly<{ workflowId: string; workerId: string }>): never => {
      throw new Error(
        `the dashboard process does not launch browser workers (doc 05 live lane); start `
        + `worker ${input.workerId} with: npm run rebuild:cli worker ${input.workflowId}`,
      );
    },
  });
}

export async function composeDashboardRuntime(input: DashboardComposeInput): Promise<DashboardRuntime> {
  const clock = input.clock ?? systemClock;
  const ids = input.ids ?? systemIdFactory;
  const repoRoot = input.repoRoot ?? process.cwd();
  const stateRoot = join(repoRoot, input.isolation.stateRoot);
  const appVersion = PackageVersionSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")),
  ).version;

  const resolved = resolveConfigWithProvenance(input.env ?? configResolutionEnvironment(), {}, clock);
  mkdirSync(stateRoot, { recursive: true });
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 5000, migrationOwner: "rebuild-dashboard" },
    clock,
  );

  const now = clock.now().toISOString();
  const configSnapshotId = ids.uuid();
  database.withAuthorityTransaction((repositories) => repositories.configSnapshots.insert({
    configSnapshotId,
    revision: 1,
    fingerprint: resolved.fingerprint,
    capturedAt: now,
    capturedBy: LOCAL_OPERATOR_ACTOR_ID,
    config: resolved.config,
    provenance: resolved.provenance,
  }));

  /**
   * Doc 03 §2.5 (2i-D): this process owns the authority backup cadence — one
   * verified backup at start, a coalesced verified backup whenever the store
   * is DIRTY on the interval tick, and a graceful-drain backup at stop.
   * Retention sweeping (14 daily + 8 coalesced + 5 pre-migration) is a
   * recorded remainder; until it lands, only dirty ticks write, so the
   * directory grows with real generations only.
   */
  const backupDirectory = join(stateRoot, "backups", "authority");
  const backups = new AuthorityBackupService(database, { directory: backupDirectory }, clock);
  let backupServiceState: BackupServiceStateWire = BackupServiceStateWireSchema.parse({
    state: "never-run",
    reason: "no backup has completed since this dashboard process started",
  });
  let lastBackedUpGeneration = -1;
  const requestBackup = async (
    trigger: "interval" | "graceful-drain" | "operator",
  ): Promise<void> => {
    try {
      const report = await backups.request({
        trigger,
        requiredGeneration: database.getMeta().authorityGeneration,
      });
      lastBackedUpGeneration = report.finalGeneration;
      backupServiceState = BackupServiceStateWireSchema.parse({
        state: "ok",
        finishedAt: clock.now().toISOString(),
        finalGeneration: report.finalGeneration,
      });
    } catch (error) {
      // The on-disk doctor cannot see a failed run — it leaves no manifest —
      // so the failure is RETAINED and served on the doctor wire's `service`
      // arm; it must never crash the serving process, and it must never read
      // as an unchanged "ok".
      backupServiceState = BackupServiceStateWireSchema.parse({
        state: "failed",
        failedAt: clock.now().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };
  void requestBackup("interval");
  const backupTimer = setInterval(() => {
    let authorityGeneration: number;
    try {
      authorityGeneration = database.getMeta().authorityGeneration;
    } catch (error) {
      backupServiceState = BackupServiceStateWireSchema.parse({
        state: "failed",
        failedAt: clock.now().toISOString(),
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (authorityGeneration > lastBackedUpGeneration) void requestBackup("interval");
  }, AUTHORITY_BACKUP_INTERVAL_MS);
  backupTimer.unref();

  const descriptors = {
    resolve: (workflowId: string) => SERVER_REGISTRY[workflowId]?.descriptor,
  };
  const setHash = descriptorSetHash(DESCRIPTORS.map((descriptor) => descriptor.contractFingerprint));

  const projection = createRunQueueProjection({
    stateRoot,
    clock,
    appVersion,
    descriptorSetHash: setHash,
    authority: {
      getRun: (runId) => database.authority.runs.get(runId),
      listNotifications: (actorId) => database.authority.notifications.listByActor(actorId),
    },
    descriptors,
    projectionStore: database,
  });

  const spanWriter = createSpanJsonlWriter({
    stateRoot,
    clock,
    declaredDetails: (workflow) => {
      const descriptor = descriptors.resolve(workflow);
      if (descriptor === undefined) return undefined;
      return new Set(descriptor.details.map((detail) => detail.key));
    },
    onEvent: (event) => projection.apply(event),
  });
  const noteWriter = createNoteJsonlWriter({ stateRoot, clock });

  // D86: spans/notes prune at 30 days, applied at boot before the fold so the
  // projection never serves a day the retention policy already retired. The
  // ledger is exempt by construction — the prune can only see the two event
  // streams.
  pruneEventStreams({ stateRoot, clock });

  // Fold whatever span history already exists before serving a single count.
  projection.rebuildFromJsonl();
  const initialHealth = projection.health();
  if (initialHealth.state === "degraded") {
    throw new Error(`dashboard refused to start over a degraded projection: ${initialHealth.lastError ?? "unknown"}`);
  }

  const workerRuntime: WorkerRuntimeExecutor = createPhase1WorkerRuntimeExecutor(
    createDashboardWorkerSupervisor(),
  );
  // Doc 09 §4.1's typed operator resolutions, over the SAME AuthorityDatabase
  // instance as the kernel transaction (the executor's documented requirement).
  const writeResolution: WriteResolutionExecutor = createWriteResolutionExecutor({
    descriptors,
    authority: database,
    ids,
  });
  const kernel = createCommandKernel({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids,
    descriptors,
    writeResolution,
    workerRuntime,
  });

  const commands = createDashboardCommandService({
    kernel,
    clock,
    spans: spanWriter,
    projection,
    authorityRead: {
      getRun: (runId) => database.authority.runs.get(runId),
      getStartPlan: (startPlanId) => database.authority.startPlans.get(startPlanId),
    },
  });

  const startPlans = createStartPlanService({
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

  const hub = createDashboardStreamHub({ projection });

  const app = createDashboardApp({
    bootstrap: {
      appVersion,
      clock,
      descriptors: DESCRIPTORS,
      descriptorSetHash: setHash,
      settingsSchemaHash: deriveSchemaHash(SettingsOverrideSchema, "input"),
      projection,
      authorityMeta: () => database.getMeta(),
      backupSummary: () => {
        let liveGeneration: { state: "known"; value: number } | { state: "unavailable" };
        try {
          liveGeneration = { state: "known", value: database.getMeta().authorityGeneration };
        } catch {
          // A DISTINGUISHABLE unknown, not a default: authority
          // unavailability is already the summary's own `authority` arm, and
          // the backup indicator then judges by manifest age alone — the
          // degraded contract `summarizeBackupHealth` documents.
          liveGeneration = { state: "unavailable" };
        }
        return summarizeBackupHealth(
          { backupDirectory, maxBackupAgeMs: AUTHORITY_BACKUP_MAX_AGE_MS },
          liveGeneration.state === "known" ? liveGeneration.value : undefined,
          clock,
        );
      },
    },
    projection,
    runDetail: {
      stateRoot,
      projection,
      authority: {
        getRun: (runId) => database.authority.runs.get(runId),
        latestCheckpoint: (workflowId, itemId, nodeId) =>
          database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
      },
      descriptors: {
        resolve: (workflowId) =>
          DESCRIPTORS.find((descriptor) => descriptor.id === workflowId),
      },
      // D140/D142: the receipt and failure sections serve CONTENT through the
      // one authority-backed derivation, the same one `explain run` reads.
      trust: createReceiptService({ database, descriptors: DESCRIPTORS }),
    },
    commands,
    startPlans,
    hub,
    storage: {
      doctorOptions: {
        authorityPath: join(stateRoot, "state.db"),
        backupDirectory,
        maxBackupAgeMs: AUTHORITY_BACKUP_MAX_AGE_MS,
        busyTimeoutMs: 5000,
      },
      clock,
      serviceState: () => backupServiceState,
    },
  });

  const server = await startDashboardHttpServer({ app, port: input.isolation.backendPort });

  return Object.freeze({
    port: server.port,
    noteWriter,
    stop: async (): Promise<void> => {
      await server.close();
      hub.close();
      clearInterval(backupTimer);
      // Doc 03 §2.5's graceful-drain trigger: one final verified backup while
      // the database is still open. A failure surfaces AFTER cleanup — loud
      // to the stopper, never a half-closed process.
      await requestBackup("graceful-drain");
      database.close();
      if (backupServiceState.state === "failed") {
        throw new Error(`graceful-drain authority backup failed: ${backupServiceState.message}`);
      }
    },
  });
}
