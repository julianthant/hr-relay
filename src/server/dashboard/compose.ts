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
 *   real Phase-1 path: `npm run cli worker <workflow-id>`;
 * - `refresh-browser` / `reopen-browser`: reaching a live worker's session set
 *   from this process is the same live-lane work; acknowledging an effect
 *   that did not happen is exactly what the executor refuses to do.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { RuntimeIsolation } from "../../config/define-runtime-isolation.js";
import {
  CAPTURE_INTAKE_BINDINGS,
  DESCRIPTORS,
  INTAKE_PROJECTIONS,
  SERVER_REGISTRY,
  WORKFLOW_MODULES,
  readPendingImplBindings,
} from "../../control/workflow-registry.js";
import { descriptorRuntimeNodes, runtimeNodeLabel, type AnyWorkflowDescriptor } from "../../base/workflow.js";
import { reachableCommits, resolveFreshnessBound } from "../../domain/workflow/checkpoint.js";
import { createCommandKernel, type WorkerRuntimeExecutor, type WriteResolutionExecutor } from "../../core/command-kernel.js";
import { createPhase1WorkerRuntimeExecutor, type WorkerProcessSupervisor } from "../../core/worker-loop.js";
import { createWriteResolutionExecutor } from "../../core/write-recovery.js";
import type { Clock } from "../../domain/clock.js";
import { systemClock } from "../../domain/clock.js";
import { SettingsOverrideSchema } from "../../domain/config/schema.js";
import { resolveConfigWithProvenance } from "../../domain/config/resolve.js";
import { systemIdFactory, type IdFactory } from "../../domain/identifiers.js";
import {
  FingerprintSchema,
  LOCAL_OPERATOR_ACTOR_ID,
  ProviderAdmissionIdSchema,
  type Fingerprint,
} from "../../domain/ids.js";
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
import { acquireRuntimeProcessLock } from "../../infra/sqlite/runtime-process-locks.js";
import { pruneEventStreams } from "../../infra/events/jsonl-streams.js";
import { createLedgerReadThrough } from "../../infra/ledger/ledger-read-through.js";
import { createSpanJsonlWriter } from "../../infra/events/span-jsonl-writer.js";
import { createNoteJsonlWriter, type NoteJsonlWriter } from "../../infra/events/note-jsonl-writer.js";
import { createContentAddressedArtifactWriter } from "../../infra/artifacts/content-addressed-artifact-writer.js";
import { createNotificationInbox } from "../../services/notifications/inbox.js";
import { createBackupHealthNotifier } from "../../services/notifications/storage-health.js";
import {
  GateParkObservationSchema,
  createGateParkNotifier,
  type GateParkObservation,
} from "../../services/notifications/gate-park.js";
import { createIntakeParser } from "../intake/intake-parser.js";
import { createDashboardCommandService } from "./commands/command-service.js";
import { createIntakeService } from "./commands/intake-service.js";
import { composeCaptureSurface } from "../capture/compose.js";
import { createStartPlanService } from "./commands/start-plan-service.js";
import { createDashboardApp } from "./routes/api.js";
import { EXPLORER_SOURCE_ROOT, readScenarioSources } from "./queries/explorer.js";
import { readCommittedUiCatalog } from "./queries/ui-catalog.js";
import { buildSafeUiCatalog } from "../../stores/ucpath/driver/catalog.js";
import { createRunQueueProjection } from "./projectors/run-queue-projection.js";
import { createDashboardStreamHub } from "./subscriptions/dashboard-stream.js";
import { startDashboardHttpServer } from "./http-server.js";
import { createReceiptService } from "../trust/receipt-service.js";
import { createAdvisoryProviderClient } from "../../core/provider-admission.js";
import { produceFailureTriageAdvisory } from "../../services/trust/advisory.js";
import { createGeminiAdvisoryAdapter } from "../../infra/providers/gemini-advisory.js";
import { createProviderPool } from "../../infra/providers/provider-pool.js";
import { createTimeoutDeadlineScheduler } from "../scheduling/timeout-deadline-scheduler.js";
import { optionalSecretFamily, providerModelChain } from "../../domain/secrets.js";
import type { AdvisoryQueryDeps } from "./queries/advisory.js";
import { createArchiveSnapshotSource, type ArchiveQueryDeps } from "./queries/archive.js";
import type {
  RunDetailDataOriginView,
  RunDetailQueryDeps,
  RunDetailWriteContractView,
} from "./queries/run-detail.js";
import { describeProofShape } from "../../validation/proof-shape.js";
import type { RegisteredTaskStore } from "../../base/store.js";


/**
 * The gate nodes of a descriptor, in the shape the identity-gate section reads.
 *
 * `resultSchemaHash` is `deriveSchemaHash(node.result, "output")` — byte for
 * byte the value `executeResolveGate` compares an incoming payload against, so a
 * surface that echoes it back cannot be refused for naming a schema this build
 * does not have.
 */
function gateNodeViewsOf(descriptor: AnyWorkflowDescriptor): readonly Readonly<{
  nodeId: string;
  label: string;
  dependsOn: readonly string[];
  resultSchemaHash: string;
}>[] {
  return descriptorRuntimeNodes(descriptor).flatMap((node) => (
    node.kind === "gate"
      ? [{
        nodeId: String(node.id),
        label: node.label,
        dependsOn: node.dependsOn.map(String),
        resultSchemaHash: deriveSchemaHash(node.result, "output"),
      }]
      : []
  ));
}

/**
 * The transaction nodes of a descriptor, in the shape the parked-write
 * section's proof form reads (D245, doc 09 §4.1).
 *
 * `proofSchemaHash` is `deriveSchemaHash(completion.proofSchema, "output")` —
 * byte for byte the value `resolvePresent` compares an incoming
 * `proof.schemaHash` against — and `proof` is that same schema described as a
 * field list, or the named reason this build cannot describe it. Both are
 * derived HERE for the reason stated on `gateNodeViewsOf`: the queries never
 * reach the descriptor builders, and a query that re-walked a proof schema
 * would be a second copy of the contract's identity.
 */
function writeContractViewsOf(descriptor: AnyWorkflowDescriptor): readonly RunDetailWriteContractView[] {
  return descriptorRuntimeNodes(descriptor).flatMap((node) => {
    if (node.kind !== "transaction") return [];
    const completion = node.commit.uses.writeSafety.completion;
    return [{
      commitTaskId: String(node.commit.uses.id),
      completionKind: completion.kind,
      proofSchemaHash: deriveSchemaHash(completion.proofSchema, "output"),
      proof: describeProofShape(completion.proofSchema),
    }];
  });
}

/**
 * D252 — every node that can produce a Data-section value, with the four facts
 * the rail's origin line draws: the step's label, whether its task READS or
 * WRITES, the system it runs against, and the reuse bound its own contract
 * declares per field.
 *
 * Nothing here is inferred. `dir` is the node's task `effect` (doc 01's own
 * word for what a contract does to the world) — the rail's header comment used
 * to record direction as unservable because "nothing durable says whether a
 * recorded field was read or written", which is true of the CHECKPOINT ROW and
 * false of the descriptor that wrote it. `system` comes from the module's own
 * store list, the same binding the explorer's node panel reads, and a headless
 * store contributes none rather than a fabricated label. The bound is resolved
 * through `resolveFreshnessBound`, which is the function `auditCheckpointFreshness`
 * itself calls, and `feeds` through `reachableCommits` for the same reason —
 * the sentence the operator reads is the rule the executor applies.
 *
 * Only the field paths a Data entry can actually carry are resolved, which is
 * exactly `details[].source` ∪ `capabilities.editData.fields`: a bound for a
 * path no surface serves is a fact nobody reads.
 */
export function dataOriginViewsOf(module: {
  readonly descriptor: AnyWorkflowDescriptor;
  readonly stores: readonly RegisteredTaskStore[];
}): readonly RunDetailDataOriginView[] {
  const { descriptor } = module;
  const systemByTaskId = new Map<string, string>();
  for (const store of module.stores) {
    if (store.kind !== "browser") continue;
    for (const task of Object.values(store.tasks)) {
      systemByTaskId.set(String(task.contract.id), String(store.driver.system));
    }
  }
  const nodes = descriptorRuntimeNodes(descriptor);
  const commitNodeIds = new Set(
    nodes.filter((node) => node.kind === "transaction").map((node) => String(node.id)),
  );
  const editData = descriptor.capabilities?.editData;
  const declaredPaths = new Map<string, Set<string>>();
  const declare = (nodeId: string, fieldPath: string): void => {
    const existing = declaredPaths.get(nodeId);
    if (existing === undefined) declaredPaths.set(nodeId, new Set([fieldPath]));
    else existing.add(fieldPath);
  };
  for (const detail of descriptor.details) declare(String(detail.source.nodeId), detail.source.fieldPath);
  if (typeof editData === "object") {
    for (const field of editData.fields) declare(String(field.nodeId), field.fieldPath);
  }

  return nodes.flatMap((node) => {
    if (node.kind !== "task" && node.kind !== "transaction") return [];
    const contract = node.kind === "task" ? node.uses : node.commit.uses;
    const paths = declaredPaths.get(String(node.id));
    const feeds = reachableCommits(nodes, node.id, commitNodeIds).map((sink) => {
      const target = nodes.find((candidate) => String(candidate.id) === String(sink.nodeId));
      return {
        nodeId: String(sink.nodeId),
        label: target === undefined ? String(sink.nodeId) : runtimeNodeLabel(target),
      };
    });
    return [{
      nodeId: String(node.id),
      step: runtimeNodeLabel(node),
      dir: contract.effect === "read" ? "read" as const : "write" as const,
      ...(systemByTaskId.has(String(contract.id))
        ? { system: systemByTaskId.get(String(contract.id)) }
        : {}),
      ...(contract.effect === "read" && paths !== undefined
        ? {
          freshness: [...paths].sort().map((fieldPath) => {
            const bound = resolveFreshnessBound(contract.freshness, fieldPath);
            return {
              fieldPath,
              maxAge: Number.isFinite(bound.maxAgeMs) ? bound.maxAgeMs : "unbounded" as const,
              override: bound.override,
            };
          }),
        }
        : {}),
      feeds,
    }];
  });
}

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

/**
 * The advisory model this root names when the operator's `.env` declares no
 * chain — the same explicit-with-provenance rule `OCR_GEMINI_MODEL_ID` follows
 * (legacy `provider-limits.ts` priority-1 tier-1), never a default minted
 * inside the secrets reader.
 */
export const ADVISORY_GEMINI_MODEL_ID = "gemini-3-flash-preview";

/**
 * D218: how often the dashboard tails `spans/*.jsonl` for lines other
 * processes appended. The worker's spans have no other way into this
 * process, so this is the ceiling on how stale a live timeline can be;
 * command-emitted lines don't wait for it (the command service ticks the
 * tail itself after emitting).
 */
export const SPAN_TAIL_POLL_MS = 250;

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
        + `worker ${input.workerId} with: npm run cli worker ${input.workflowId}`,
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

  const env = input.env ?? configResolutionEnvironment();
  const resolved = resolveConfigWithProvenance(env, {}, clock);
  mkdirSync(stateRoot, { recursive: true });
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
  /**
   * The ONE cheap backup reading (doc 03 §2.5) — shared verbatim by the
   * bootstrap summary and the notification watch below, so the bell can never
   * announce a state the Settings indicator would not show.
   */
  const readBackupSummary = (): "current" | "stale" | "missing" => {
    let liveGeneration: { state: "known"; value: number } | { state: "unavailable" };
    try {
      liveGeneration = { state: "known", value: database.getMeta().authorityGeneration };
    } catch {
      // A DISTINGUISHABLE unknown, not a default: authority unavailability is
      // already the summary's own `authority` arm, and the backup indicator
      // then judges by manifest age alone — the degraded contract
      // `summarizeBackupHealth` documents.
      liveGeneration = { state: "unavailable" };
    }
    return summarizeBackupHealth(
      { backupDirectory, maxBackupAgeMs: AUTHORITY_BACKUP_MAX_AGE_MS },
      liveGeneration.state === "known" ? liveGeneration.value : undefined,
      clock,
    );
  };

  /**
   * D222: a stale/missing backup is doc 03 §2.6's `storage` notification, not
   * an every-view banner — the durable inbox row is the alert, produced here
   * because this process owns the backup cadence and therefore the reading.
   * Transition-only publishing (and the restart fold) live in the notifier.
   */
  const inbox = createNotificationInbox({
    authority: database,
    clock,
    ids,
    actorId: LOCAL_OPERATOR_ACTOR_ID,
  });
  const backupNotifier = createBackupHealthNotifier({ inbox });
  const publishBackupHealth = async (): Promise<void> => {
    try {
      await backupNotifier.observed(readBackupSummary());
    } catch (error) {
      // Retained, never swallowed: a failed publish means the durable alert
      // row could not be written (the inbox is an authority table), and this
      // process's one served storage-lane failure surface is the doctor
      // wire's `service` arm. The notifier forgets nothing on a throw, so the
      // next tick retries the same transition.
      backupServiceState = BackupServiceStateWireSchema.parse({
        state: "failed",
        failedAt: clock.now().toISOString(),
        message: `storage-health notification failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  };
  void requestBackup("interval").then(publishBackupHealth);
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
    // The health watch runs on EVERY tick — age-based staleness advances with
    // no generation movement, so a clean store must still be observed.
    if (authorityGeneration > lastBackedUpGeneration) {
      void requestBackup("interval").then(publishBackupHealth);
    } else {
      void publishBackupHealth();
    }
  }, AUTHORITY_BACKUP_INTERVAL_MS);
  backupTimer.unref();

  /**
   * D262: the second wired producer — doc 03 §2.6's open operator gate. A run
   * parked at a gate is the one state in this product that cannot move without a
   * person, and until now nothing told anybody. The park itself is written by
   * the worker (a separate process, no operator attached, and a run must park
   * even when the inbox cannot be written), so the fact is READ back here from
   * authority, where it stands until a human resolves it.
   */
  const gateParkNotifier = createGateParkNotifier({ inbox });
  const readGateParks = (): readonly GateParkObservation[] =>
    database.authority.runs.listParkedAtGate().map((run) => {
      // The repository refuses such a row before it reaches here; this keeps the
      // narrowing below a checked fact rather than an assertion.
      if (run.lifecycle.state !== "parked-gate") {
        throw new Error(`run ${run.envelope.runId} was listed as parked at a gate but reads ${run.lifecycle.state}`);
      }
      return GateParkObservationSchema.parse({
        runId: run.envelope.runId,
        workflowId: run.envelope.workflow,
        gateId: run.lifecycle.gateId,
      });
    });
  const publishGateParks = async (): Promise<void> => {
    try {
      await gateParkNotifier.observed(readGateParks());
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

  /**
   * ONE read-through over the append-only write ledger, shared by the two
   * surfaces that read it: the archive resolves an archived run's pointers
   * (D179) and the Activity report folds the range's entries (D236). A second
   * instance would be a second parse discipline over the record of what was
   * filed into a real HR system.
   */
  const ledger = createLedgerReadThrough(stateRoot);

  const projection = createRunQueueProjection({
    stateRoot,
    clock,
    appVersion,
    descriptorSetHash: setHash,
    ledger,
    authority: {
      getRun: (runId) => database.authority.runs.get(runId),
      listNotifications: (actorId) => database.authority.notifications.listByActor(actorId),
      listLiveWorkerLeases: () => database.authority.workerLeases.listLive(),
      getWorkerLease: (workerId) => database.authority.workerLeases.get(workerId),
      isArchived: (runId) => database.authority.archivedRuns.isArchived(runId),
      getFailure: (failureId) => database.authority.failures.get(failureId),
      getReceipt: (runId) => database.authority.evidenceReceipts.findByRun(runId),
      // Doc 03 §1.2: the one stored node output a queue row reads — the
      // subject's name, at the leaf the descriptor declares.
      latestCheckpoint: (workflowId, itemId, nodeId) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
    },
    descriptors,
    projectionStore: database,
  });

  const spanWriter = createSpanJsonlWriter({ stateRoot, clock });
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

  /**
   * D218: the ONE live span feed is the disk tail. The worker is a separate
   * OS process (`createDashboardWorkerSupervisor` refuses to even spawn one
   * here), so its task spans exist only as lines in `spans/*.jsonl` — the
   * old in-process writer hook folded this process's own emissions and
   * nothing else, which served an empty timeline (and empty pipeline chips
   * and dataFacts) for every run enqueued after boot. The boot rebuild above
   * seeded the byte cursors; this poll folds whatever ANY process appends
   * after it, and the command service ticks the same cursor after its own
   * emissions so an operator's follow-up read is never a poll behind.
   */
  const spanTailTimer = setInterval(() => projection.ingestFromDisk(), SPAN_TAIL_POLL_MS);
  spanTailTimer.unref();

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
  // Doc 06 §2.2 (D170): the upload route publishes source files through the
  // one content-addressed writer, and the parser re-derives rows and columns
  // from those immutable bytes for every intake read.
  const artifacts = createContentAddressedArtifactWriter({
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
  const runDetailDeps: RunDetailQueryDeps = {
    stateRoot,
    projection,
    authority: {
      getRun: (runId) => database.authority.runs.get(runId),
      latestCheckpoint: (workflowId, itemId, nodeId) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
      // Doc 09 §4.1: read straight off write-safety authority, per request.
      getWriteIntent: (writeIntentId) => database.authority.writeIntents.get(writeIntentId),
      // D237: the SAME `listByRun` read D204 gave the receipt, so the panel and
      // the receipt name one approver for one gate.
      listGateResults: (runId) => database.authority.gateResults.listByRun(runId),
    },
    descriptors: {
      /**
       * The descriptor itself, plus the gate view the identity-gate section
       * needs. The gate facts are DERIVED from the runtime graph here rather
       * than in the query, for the same reason the receipt service lives here:
       * `src/server/dashboard/queries` never reaches the descriptor builders,
       * and a query that re-derived a schema hash would be a second copy of the
       * descriptor's identity.
       */
      resolve: (workflowId) => {
        // D252 reads the MODULE, not the descriptor alone: a task's system is
        // the store's, and `src/workflows/<id>/descriptor.ts` may not reach a
        // store (D106). The tuple is the same one every other registry derives
        // from, so there is no second list to keep in step.
        const module = WORKFLOW_MODULES.find((candidate) => candidate.descriptor.id === workflowId);
        if (module === undefined) return undefined;
        const { descriptor } = module;
        return {
          ...descriptor,
          gateNodes: gateNodeViewsOf(descriptor),
          writeContracts: writeContractViewsOf(descriptor),
          dataOrigins: dataOriginViewsOf(module),
        };
      },
    },
    // D140/D142: the receipt and failure sections serve CONTENT through the
    // one authority-backed derivation, the same one `explain run` reads.
    trust: createReceiptService({ database, descriptors: DESCRIPTORS }),
  };

  const archiveDeps: ArchiveQueryDeps = {
    clock,
    appVersion,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    descriptors: { list: () => DESCRIPTORS },
    // The archive's ledger read-through, over the SAME state root the
    // projector appends to — the pointers stay pointers and this is what
    // turns them back into what was filed.
    ledger,
  };

  const kernel = createCommandKernel({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids,
    // D179: the build every run this kernel enqueues is stamped with, and the
    // build an application-scope version bump is checked against.
    appVersion,
    descriptors,
    writeResolution,
    workerRuntime,
    intakeParser,
    intakeProjections,
    // D171: the identity an intake fan-out stamps its runs with — the SAME
    // resolved config and stored snapshot the start planner uses, so a run born
    // from a spreadsheet and one born from the run surface are comparable.
    configIdentity: { configFingerprint: resolved.fingerprint, configSnapshotId },
    archiveSnapshots: createArchiveSnapshotSource(runDetailDeps),
  });

  const commands = createDashboardCommandService({
    kernel,
    clock,
    spans: spanWriter,
    projection,
    descriptors,
    authorityRead: {
      getRun: (runId) => database.authority.runs.get(runId),
      getStartPlan: (startPlanId) => database.authority.startPlans.get(startPlanId),
      getIntakeSession: (intakeSessionId) => database.authority.intakeSessions.get(intakeSessionId),
      getIntakeManifest: (manifestId) => database.authority.intakeManifests.get(manifestId),
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

  const intake = createIntakeService({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    authorityRead: {
      getIntakeSession: (intakeSessionId) => database.authority.intakeSessions.get(intakeSessionId),
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
   * Capture (2i-F, D174) — one composition value, shared with the BFF test
   * harnesses so a test can never prove a surface the product does not have.
   */
  const capture = composeCaptureSurface({
    database,
    artifacts,
    commands,
    descriptors,
    bindings: CAPTURE_INTAKE_BINDINGS,
    config: resolved.config,
    configIdentity: { configFingerprint: resolved.fingerprint, configSnapshotId },
    appVersion,
    env,
    clock,
    ids,
  });

  // Restart recovery (doc 06 §5.1): whatever the last process left `pending`
  // is settled before the first request is served, so a bundle never waits on
  // a phone that may never come back.
  await capture.drainFinalizations();

  /**
   * Doc 12 §4.4's advisory (2i-G, D178). The pool composes from the SAME
   * `geminiApiKeys` family and model chain the OCR pool uses, because they
   * are the same keys — but the capability, and therefore the budget, is its
   * own. No key composes NO adapter and no seam: the route then refuses by
   * name, and the bootstrap wire says `not-configured` with the environment
   * variable to set. A composed-but-empty advisory would be worse than none.
   */
  const advisoryKeys = optionalSecretFamily("geminiApiKeys", env);
  const advisoryModels = providerModelChain("geminiApiKeys", env);
  const advisoryChildren = (advisoryModels.length > 0 ? advisoryModels : [ADVISORY_GEMINI_MODEL_ID])
    .flatMap((modelId) => advisoryKeys.map((apiKey, keyIndex) => ({
      label: `gemini-key${String(keyIndex + 1)}/${modelId}`,
      adapter: createGeminiAdvisoryAdapter({ apiKey, modelId, clock }),
    })));
  const advisoryScheduler = createTimeoutDeadlineScheduler(clock);
  const advisory: AdvisoryQueryDeps | undefined = advisoryChildren.length === 0
    ? undefined
    : {
      authority: {
        getRun: (runId) => database.authority.runs.get(runId),
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
        return produceFailureTriageAdvisory({ clock, client }, failure);
      },
    };

  const hub = createDashboardStreamHub({ projection });

  const app = createDashboardApp({
    bootstrap: {
      appVersion,
      clock,
      // The MODULE tuple, not `DESCRIPTORS`: the served `role` (D219) is the
      // module's declaration, so the bootstrap document is built from the same
      // composition root the explorer reads.
      modules: WORKFLOW_MODULES,
      descriptorSetHash: setHash,
      settingsSchemaHash: deriveSchemaHash(SettingsOverrideSchema, "input"),
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
    runDetail: runDetailDeps,
    archive: archiveDeps,
    commands,
    startPlans,
    intake,
    capture,
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
    /**
     * The explorer reads the SAME `WORKFLOW_MODULES` tuple the kernel composes
     * from (2i-G, D176) — not `DESCRIPTORS`, because a module also carries the
     * store list, the intake projection and the capture binding the surface
     * reports. The UI catalog comes off the in-memory registries here so the
     * served committed artifact can be checked against them on every read.
     */
    ...(advisory === undefined ? {} : { advisory }),
    explorer: {
      clock,
      modules: WORKFLOW_MODULES,
      descriptorSetHash: setHash,
      // `EXPLORER_SOURCE_ROOT`, never `repoRoot`: these files belong to the
      // source tree this process is running, while `repoRoot` names where
      // runtime state resolves from and may legitimately be a temp directory.
      pendingImplBindings: readPendingImplBindings(EXPLORER_SOURCE_ROOT),
      uiCatalog: buildSafeUiCatalog(),
      listScenarioSources: () => readScenarioSources(EXPLORER_SOURCE_ROOT),
    },
    uiCatalog: { readCatalogJson: () => readCommittedUiCatalog(EXPLORER_SOURCE_ROOT) },
  });

  const server = await startDashboardHttpServer({ app, port: input.isolation.backendPort });

  return Object.freeze({
    port: server.port,
    noteWriter,
    stop: async (): Promise<void> => {
      await server.close();
      hub.close();
      clearInterval(spanTailTimer);
      clearInterval(backupTimer);
      clearInterval(gateParkTimer);
      // Doc 03 §2.5's graceful-drain trigger: one final verified backup while
      // the database is still open. A failure surfaces AFTER cleanup — loud
      // to the stopper, never a half-closed process.
      await requestBackup("graceful-drain");
      database.close();
      // Released only after the handle is closed: the lock's whole meaning is
      // "nothing holds this database open", so releasing it first would let a
      // restore start against a still-open file.
      processLock.release();
      if (backupServiceState.state === "failed") {
        throw new Error(`graceful-drain authority backup failed: ${backupServiceState.message}`);
      }
    },
  });
}
