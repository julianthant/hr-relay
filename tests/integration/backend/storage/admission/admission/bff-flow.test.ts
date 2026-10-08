import { syntheticStateRoot } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { RuntimeAdmission } from "../../../../../../src/backend/storage/admission/admission.js";
import { createProtectedSettingsRuntimeReader } from "../../../../../../src/backend/runtime/settings/settings-runtime.js";
import { createRunLifecycleStorage } from "../../../../../../src/backend/storage/sqlite/lifecycle-storage.js";
import { captureArchiveReport } from "../../../../../../src/backend/storage/archive/report-capture.js";
import { transferArchiveReport } from "../../../../../../src/backend/storage/archive/archive-transfer.js";
import { sqliteRunReader } from "../../../../../support/helpers/canonical-run-reader.js";
import { createRunLogStreamStore } from "../../../../../../src/backend/logs/run-log-stream.js";
import { RunLogsStreamHub } from "../../../../../../src/backend/transports/http/subscriptions/run-logs-stream.js";
import { CommandResultSchema } from "../../../../../../src/rules/commands/commands.js";
import { singleAppliedRunId } from "../../../../../support/fixtures/operator-command-fixtures.js";
import { seedSyntheticRuntimeConfig } from "../../../../../support/fixtures/operator-command-fixtures.js";
import { runQueuedSpanEvent } from "../../../../../../src/backend/runs/commands/run-queued-span.js";
import { composeActivity } from "../../../../../../src/backend/app/composition/dashboard/activity.js";
import { ActorIdSchema as PublicationActorIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { RunRecordService } from "../../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { hostConfigFacts } from "../../../../../../src/models/config/host-display.js";
/**
 * The BFF spine end-to-end over REAL machinery: the D109 planner + a real
 * authority database + the D113 kernel behind POST /api/v1/start-plans and
 * POST /api/v1/commands, run.queued span emission into SQLite, THE
 * projection serving GET /api/v1/dashboard, run detail + note-backed logs,
 * and strict route refusals. No projection fake, no kernel fake — the only
 * fakes are the process seams (worker supervisor, write sequencer) that 1g
 * leaves typed.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import readXlsxFile from "read-excel-file/node";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { request } from "node:http";
import type { ArtifactRef } from "../../../../../../src/models/artifacts/artifacts.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { SETTINGS_SCHEMA_HASH, initialSettingsFileRecord, settingsRuntimeIdentity, deriveSettingsPatchFingerprint } from "../../../../../../src/models/config/settings.js";
import { PROTECTED_SETTINGS_SCHEMA_HASH } from "../../../../../../src/models/config/protected-settings.js";
import { requiredPreflightChecks, type PreflightDeadlineScheduler } from "../../../../../../src/models/preflight/preflight.js";
import { ActivityReportSelectionSchema } from "../../../../../../src/models/dashboard/activity-selection.js";
import { CrossDateSearchPageSchema } from "../../../../../../src/models/dashboard/search.js";
import { DiagnosticBundleIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { RunRecordSchema, type RunRecord } from "../../../../../../src/models/run/record.js";
import { RunDetailSectionResponseSchema } from "../../../../../../src/models/dashboard/run-detail.js";
import { DiagnosticBundleSchema, type DiagnosticBundle } from "../../../../../../src/models/trust/diagnostic.js";
import { StorageDoctorWireSchema } from "../../../../../../src/models/dashboard/storage.js";
import { EditableSettingsWireSchema } from "../../../../../../src/models/dashboard/settings-editor.js";
import { createActivityPersonPseudonymDomain } from "../../../../../../src/models/trust/activity-person-pseudonym.js";
import { createPreflightHarness } from "../../../../../support/fixtures/preflight-seams.js";
import { PreflightRerunCommandResultSchema } from "../../../../../../src/models/preflight/preflight.js";
import { defineWorkflowRole } from "../../../../../../src/workflow-kit/validation/module-role.js";
import { createCommandKernel } from "../../../../../../src/backend/runs/commands/command-kernel.js";
import { createCredentialStore } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { readSettings } from "../../../../../../src/backend/runtime/settings/settings-runtime.js";
import { AuthorityDatabase, type AuthorityRepositories } from "../../../../../support/helpers/synthetic-storage-admission.js";
import { DiagnosticAttachmentStorageRecordSchema } from "../../../../../../src/backend/storage/sqlite/storage-records.js";
import { createContentAddressedArtifactWriter } from "../../../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader, type ServerVerifiedArtifactReader } from "../../../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { createNoteJsonlWriter } from "../../../../../../src/backend/storage/events/note-jsonl-writer.js";
import { createTimelineEmitter } from "../../../../../../src/backend/storage/events/timeline-emitter.js";
import { readTimelineRecords, timelineSpanLocation } from "../../../../../../src/backend/storage/events/timeline-reader.js";
import { createDashboardCommandService, deriveBulkChildCommandId } from "../../../../../../src/backend/runs/commands/command-service.js";
import type { IntakeService } from "../../../../../../src/backend/runs/commands/intake-service.js";
import { createSettingsApplicationExecutor } from "../../../../../../src/backend/runs/commands/settings-service.js";
import { createStartPlanService, type StartPlanService } from "../../../../../../src/backend/runs/commands/start-plan-service.js";
import { descriptorSetHash } from "../../../../../../src/backend/app/composition/dashboard/compose.js";
import { startDashboardHttpServer, type DashboardHttpServer } from "../../../../../../src/backend/transports/http/http-server.js";
import { createReceiptService } from "../../../../../../src/backend/runs/trust/receipt-service.js";
import { createDashboardApp, type DashboardAppDeps } from "../../../../../../src/backend/transports/http/routes/api.js";
import { DashboardStreamEnvelopeSchema, type DashboardStreamEnvelope } from "../../../../../../src/models/dashboard/subscription.js";
import type { DiagnosticBundleQueryDeps } from "../../../../../../src/backend/runs/queries/diagnostic-bundle.js";
import { createCrossDateSearchService } from "../../../../../../src/backend/runs/queries/search.js";
import { createOperatorXlsxExportService } from "../../../../../../src/backend/runs/exports/operator-xlsx-export-service.js";
import { createSoloRequestIdentityCheckpoint } from "../../../../../../src/backend/transports/http/request-identity.js";
import type { RequestIdentityCheckpoint } from "../../../../../../src/backend/transports/http/request-identity.js";
import { RequestIdentityRefusedError } from "../../../../../../src/backend/runs/commands/refusals.js";
import type { ArtifactBytesQueryDeps } from "../../../../../../src/backend/runs/queries/artifact-bytes.js";
import { createDiagnosticCaptureService } from "../../../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { activityReportCsv } from "../../../../../../src/backend/runs/queries/activity-export.js";
import { activityReportCaveats } from "../../../../../../src/models/dashboard/activity.js";
import { createRunQueueProjection } from "../../../../../../src/backend/runs/projections/run-queue-projection.js";
import { createDashboardStreamHub, type DashboardStreamHub } from "../../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { fixtureDescriptor } from "../../../../../support/fixtures/descriptor-fixtures.js";
import { ACTIVITY_PERSON_PSEUDONYM_KEY_HEX, activityPersonPseudonymResultRecord, CURRENT_SEPARATIONS_RESULT, seedSeparationsRunAuthority, TERMINAL_SEPARATIONS_RUN } from "../../../../../support/fixtures/integration/activity-person-pseudonym-fixtures.js";
import { ARCHIVED_RUN } from "../../../../../support/fixtures/archive-fixtures.js";
import { HASH_B, UUID_4 } from "../../../../../support/fixtures/phase1c-contract-fixtures.js";
import { RUN_ID, sequentialIdFactory } from "../../../../../support/fixtures/phase1f-run-fixtures.js";
import { personLookupQueuedRun } from "../../../../../support/helpers/phase1f-executor-harness.js";
import { AT, DAY, traceOf, uuidOf } from "../../../../../support/helpers/backend/dashboard-harness.js";
import { insertMeasuredSearchRun } from "../../../../../support/helpers/backend/cross-date-search-harness.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER, UNWIRED_INTAKE_SERVICE } from "../../../../../support/fixtures/intake-kernel-seams.js";
import { resolveConfigWithProvenance } from "../../../../../../src/backend/app/config/resolve.js";
import { explorerQueryDeps } from "../../../../../support/fixtures/explorer-seams.js";
import { archiveQueryDeps, archiveSnapshots } from "../../../../../support/fixtures/archive-seams.js";
import { createTransactionHistory } from "../../../../../../src/backend/storage/sqlite/transaction-history.js";
import { UNOBSERVED_BACKFILL_GAP_NOTIFIER } from "../../../../../support/fixtures/dashboard-stream-seams.js";

interface Harness {
  readonly app: ReturnType<typeof createDashboardApp>;
  readonly database: AuthorityDatabase;
  readonly settingsPath: string;
  readonly stateRoot: string;
  readonly clock: ReturnType<typeof manualClock>;
  readonly noteWriter: ReturnType<typeof createNoteJsonlWriter>;
  readonly hub: DashboardStreamHub;
  readonly projection: ReturnType<typeof createRunQueueProjection>;
  readonly artifacts: ReturnType<typeof createContentAddressedArtifactWriter>;
  readonly preflight: ReturnType<typeof createPreflightHarness>;
  readonly artifactSourceReads: number[];
}

type DiagnosticBundleHarnessDeps = DiagnosticBundleQueryDeps
  & ArtifactBytesQueryDeps
  & Readonly<{ artifacts: ReturnType<typeof createContentAddressedArtifactWriter> }>;

function beforeArtifactReaderOperation(
  reader: ServerVerifiedArtifactReader,
  before: (operation: "verify" | "prepare", ref: ArtifactRef) => void | Promise<void>,
): ServerVerifiedArtifactReader {
  return Object.freeze({
    async verify(ref: ArtifactRef, signal?: AbortSignal) {
      await before("verify", ref);
      await reader.verify(ref, signal);
    },
    async prepare(ref: ArtifactRef, signal?: AbortSignal) {
      await before("prepare", ref);
      return reader.prepare(ref, signal);
    },
  });
}

function observeArtifactLeaseDisposal(
  reader: ServerVerifiedArtifactReader,
  onDispose: () => void,
): ServerVerifiedArtifactReader {
  return Object.freeze({
    verify: (ref: ArtifactRef, signal?: AbortSignal) => reader.verify(ref, signal),
    async prepare(ref: ArtifactRef, signal?: AbortSignal) {
      const lease = await reader.prepare(ref, signal);
      return Object.freeze({
        ref: lease.ref,
        takeBody: () => lease.takeBody(),
        async dispose() {
          onDispose();
          await lease.dispose();
        },
      });
    },
  });
}

function writeStoredArtifactEnvelope(
  h: Harness,
  ref: ArtifactRef,
  mutation: "digest" | "oversized" | "truncated" | "identity" | "metadata digest" | "size" | "media type",
): void {
  const payloadBase64 = mutation === "digest" ? "WF0="
    : mutation === "oversized" ? "W10A"
      : mutation === "truncated" ? "Ww=="
        : "W10=";
  writeFileSync(join(h.stateRoot, "artifacts", `${ref.sha256}.artifact`), JSON.stringify({
    ref: {
      ...ref,
      ...(mutation === "identity" ? { id: "00000000-0000-4000-8000-000000000099" } : {}),
      ...(mutation === "metadata digest" ? { sha256: "0".repeat(64) } : {}),
      ...(mutation === "size" ? { bytes: 3 } : {}),
      ...(mutation === "media type" ? { mediaType: "text/plain" } : {}),
    },
    payloadBase64,
  }));
}

const cleanups: (() => void)[] = [];
const OPERATOR_JSON_HEADERS = Object.freeze({
  host: "localhost",
  origin: "http://localhost",
  "content-type": "application/json",
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function harness(options: {
  readonly protectedCommandAcceptedAt?: DashboardAppDeps["protectedCommandAcceptedAt"];
  readonly requestIdentity?: RequestIdentityCheckpoint;
  readonly intake?: IntakeService;
  /** Wrap the real start-plan service (e.g. to observe whether admission reached it). */
  readonly startPlans?: (real: StartPlanService) => StartPlanService;
  /** An advisory seam; absent by default (D178: no provider is composed here). */
  /** An Explorer safe-edit validation seam; absent by default. */
  readonly explorerEdits?: DashboardAppDeps["explorerEdits"];
  /** The hub's per-subscriber pending bound; the hub default when absent. */
  readonly maxPending?: number;
  readonly preflightBeforeRun?: () => Promise<void>;
  readonly preflightScheduler?: PreflightDeadlineScheduler;
  readonly omitDiagnosticBundles?: boolean;
  readonly diagnosticBundles?: (
    real: DiagnosticBundleHarnessDeps,
  ) => DiagnosticBundleHarnessDeps;
  readonly observeArtifactLeaseClosed?: () => void;
  readonly runCaptureAuthority?: (
    real: AuthorityRepositories["diagnosticBundles"],
  ) => AuthorityRepositories["diagnosticBundles"];
  /** Wrap the ingress journal read to prove request-only refusals stop before authority. */
  readonly commandJournal?: (
    real: DashboardAppDeps["commandJournal"],
  ) => DashboardAppDeps["commandJournal"];
} = {}): Harness {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "hrauto-bff-")));
  const stateRoot = join(root, ".tracker");
  mkdirSync(stateRoot, { mode: 0o700 });
  const settingsPath = join(root, ".tracker", "settings", "settings.json");
  const clock = manualClock(AT);
  const ids = sequentialIdFactory("c");
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 1000, migrationOwner: "bff-flow-test" },
    clock,
  );
  seedSyntheticRuntimeConfig(database);
  assert.equal("projections" in database, false, "the retired projection repositories have no database capability");
  const artifacts = createContentAddressedArtifactWriter({
    admission: RuntimeAdmission.syntheticRoots(join(root, ".tracker"), join(root, ".tracker/artifacts")),
  });
  const artifactSourceReads: number[] = [];
  const artifactReader = createServerVerifiedArtifactReader({
    admission: RuntimeAdmission.syntheticRoots(join(root, ".tracker"), join(root, ".tracker/artifacts")),
    observeIo: (kind, bytes) => {
      if (kind === "source-read") artifactSourceReads.push(bytes);
    },
    ...(options.observeArtifactLeaseClosed === undefined
      ? {}
      : { observeLeaseClosed: options.observeArtifactLeaseClosed }),
  });
  cleanups.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });

  const descriptors = {
    resolve: (workflowId: string) => (workflowId === "fixture-graph" ? fixtureDescriptor : undefined),
  };
  const searchDescriptors = {
    resolve: (workflowId: string) => workflowId === "separations"
      ? { id: "separations", label: "Separations", code: "sp", category: "separation" }
      : undefined,
  };
  const projection = createRunQueueProjection({
    timeline: database.authority.timelineEvents,
    reader: sqliteRunReader(database, clock),
    stateRoot,
    clock,
    appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash([fixtureDescriptor.contractFingerprint]),
    ledger: createTransactionHistory(database.authority),
    authority: {
      listNotifications: () => [],
      listNotificationCheckpoints: () => [],
      listLiveWorkerLeases: () => database.authority.workerLeases.listLive(),
      getWorkerLease: (workerId: string) => database.authority.workerLeases.get(workerId),
      listWorkerPools: () => database.authority.workerPools.list(),
      listRunBatches: () => database.authority.runSessions.list(),
      getRunBatch: (id) => database.authority.runSessions.get(id),
      getFailure: (failureId: string) => database.authority.failures.get(failureId),
      getReceipt: (runId: string) => database.authority.evidenceReceipts.findByRun(runId),
      canonicalPerson: (runId: string) => database.canonicalPerson(runId),
      latestCheckpoint: (workflowId: string, itemId: string, nodeId: string) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
    },
    descriptors,
  });
  // D218: no in-process hook — the command service ticks the projection's
  // database cursor after emitting, exactly as production wires it.
  const spans = createTimelineEmitter({
    repository: database.authority.timelineEvents,
    clock,
    pid: 4242,
  });
  const noteWriter = createNoteJsonlWriter({ stateRoot, clock, pid: 4242 });

  const runDetailDeps = { runReader: sqliteRunReader(database, clock),
    stateRoot,
    projection,
    authority: {
      getRun: (runId: string) => database.authority.runs.get(runId),
      latestCheckpoint: (workflowId: string, itemId: string, nodeId: string) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
      getWriteIntent: (writeIntentId: string) => database.authority.writeIntents.get(writeIntentId),
      listGateResults: (runId: string) => database.authority.gateResults.listByRun(runId),
    },
    descriptors: {
      resolve: (workflowId: string) => (workflowId === fixtureDescriptor.id ? fixtureDescriptor : undefined),
    },
    trust: createReceiptService({ database, runReader: sqliteRunReader(database, clock), descriptors: [fixtureDescriptor] }),
    captures: {
      runReader: sqliteRunReader(database, clock),
      authority: options.runCaptureAuthority?.(database.authority.diagnosticBundles)
        ?? database.authority.diagnosticBundles,
      artifactReader,
    },
  };

  const activeSettings = resolveConfigWithProvenance({}, hostConfigFacts({}), clock);
  const activeSettingsIdentity = settingsRuntimeIdentity(initialSettingsFileRecord(), activeSettings.fingerprint);
  const credentials = createCredentialStore({ stateRoot });
  const settingsFile = {
    read: () => {
      // Applying a revision does not mutate the running process. This test
      // harness therefore models the same persisted/active split as the real
      // runtime instead of serving a stale identity as a false "current".
      const record = readSettings(database.authority);
      const persisted = settingsRuntimeIdentity(record, resolveConfigWithProvenance(record.settings, hostConfigFacts({}), clock).fingerprint);
      if (
        persisted.settingsRevision === activeSettingsIdentity.settingsRevision
        && persisted.settingsSchemaHash === activeSettingsIdentity.settingsSchemaHash
        && persisted.settingsFingerprint === activeSettingsIdentity.settingsFingerprint
      ) {
        return { record, activeConfig: activeSettings.config, runtimeStatus: { state: "current" as const, identity: activeSettingsIdentity } };
      }
      return { record, activeConfig: activeSettings.config, runtimeStatus: { state: "restart-required" as const, active: activeSettingsIdentity, persisted } };
    },
  };
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: (run, publication) => {
      if (publication === undefined) throw new Error("command-created run lacks queue presentation");
      spans.emit(runQueuedSpanEvent({ run, ...publication, actorId: PublicationActorIdSchema.parse(publication.actorId) }));
    } }),
    appVersion: "0.1.0",
    archiveSnapshots: archiveSnapshots(runDetailDeps),
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids,
    descriptors,
    writeResolution: {
      resolvePresent: () => {
        throw new Error("write resolution is not wired in this harness");
      },
      resolveAbsent: () => {
        throw new Error("write resolution is not wired in this harness");
      },
    },
    workerRuntime: {
      planWorkerCount: () => ({ state: "accepted", workerIds: ["fixture-graph-worker-1"] }),
      spawnWorker: () => ({ state: "accepted" }),
      refreshBrowser: () => ({ state: "accepted" }),
      reopenBrowser: () => ({ state: "accepted" }),
    },
    settings: createSettingsApplicationExecutor((settings) => resolveConfigWithProvenance(settings, hostConfigFacts({}), clock), credentials),
  });
  const commands = createDashboardCommandService({ kernel, projection });
  const startPlans = (options.startPlans ?? ((real: StartPlanService) => real))(createStartPlanService({
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    authorityRead: database,
    descriptors,
    clock,
    ids,
    planTtlMs: 10 * 60 * 1000,
    configFingerprint: HASH_B,
    configSnapshotId: UUID_4,
    plannedBy: "local-operator",
  }));
  const hub = createDashboardStreamHub({
    projection,
    backfillGaps: UNOBSERVED_BACKFILL_GAP_NOTIFIER,
    ...(options.maxPending === undefined ? {} : { maxPending: options.maxPending }),
  });
  cleanups.push(() => hub.close());
  const runLogsHub = new RunLogsStreamHub({ projection, store: createRunLogStreamStore(stateRoot),
    readRun: runId => {
      const result = runDetailDeps.runReader.read(runId);
      return result.state === "present" ? { disposition: result.disposition, run: result.run } : undefined;
    } });
  cleanups.push(() => runLogsHub.close());
  const preflight = createPreflightHarness(clock, HASH_B, options.preflightBeforeRun, options.preflightScheduler);


  const search = createCrossDateSearchService({
    clock,
    sourceIdentity: database.getSourceDatabaseIdentity(),
    cursorSigningKey: new Uint8Array(32).fill(0x42),
    descriptors: searchDescriptors,
    authority: {
      readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
        authorityGeneration: database.getMeta().authorityGeneration,
        searchRuns: (input) => database.authority.runs.search(input),
      })),
    },
  });
  const activity = composeActivity({ database, clock, descriptors, ledger: createTransactionHistory(database.authority) });
  const app = createDashboardApp({
    protectedCommandAcceptedAt: options.protectedCommandAcceptedAt ?? ((commandId) => credentials.acceptedAt(commandId)),
    requestIdentity: options.requestIdentity ?? createSoloRequestIdentityCheckpoint({
      id: "local-operator",
      label: "Local operator",
    }),
    intake: options.intake ?? UNWIRED_INTAKE_SERVICE,
    bootstrap: {
      appVersion: "0.1.0",
      clock,
      modules: [{ descriptor: fixtureDescriptor, role: defineWorkflowRole({ kind: "standalone" }) }],
      descriptorSetHash: descriptorSetHash([fixtureDescriptor.contractFingerprint]),
      settingsSchemaHash: descriptorSetHash(["settings-schema"]),
      projection,
      authorityMeta: () => database.getMeta(),
      // The harness runs no backup lane; "missing" is its true state.
      backupSummary: () => "missing",
      preflightReport: () => preflight.report,
    },
    preflight: preflight.authority,
    projection,
    search,
    activity,
    xlsxExports: createOperatorXlsxExportService({
      clock,
      ids,
      sourceIdentity: database.getSourceDatabaseIdentity(),
      artifacts,
      authority: database.authority.operatorXlsxExports,
      search,
      activityReport: (from, to, token) => activity.readSelected(from, to, token),
    }),
    commandJournal: options.commandJournal?.(database.authority.commands)
      ?? database.authority.commands,
    bulkCommandAcceptances: {
      withTransaction: (work) => database.withAuthorityTransaction((repositories) =>
        work({ get: repositories.commands.getBulk, insert: repositories.commands.acceptBulk })),
    },
    ...(options.omitDiagnosticBundles
      ? {}
      : {
          diagnosticBundles: options.diagnosticBundles?.({
            runReader: sqliteRunReader(database, clock),
            authority: database.authority.diagnosticBundles,
            artifactReader,
            artifacts,
          }) ?? {
            runReader: sqliteRunReader(database, clock),
            authority: database.authority.diagnosticBundles,
            artifactReader,
          },
        }),
    runDetail: runDetailDeps,
    archive: archiveQueryDeps({ database, clock, appVersion: "0.1.0", descriptors: [fixtureDescriptor] }),
    commands,
    startPlans,
    ...(options.explorerEdits === undefined ? {} : { explorerEdits: options.explorerEdits }),
    hub,
    runLogsHub,
    // D274 item 6 — the read-only Settings status sections read the SAME
    // resolved config and descriptor tuple this harness composes everything else
    // from, so nothing on that page can be true here and false in production.
    settings: { config: resolveConfigWithProvenance({}, hostConfigFacts({}), clock).config, descriptors: [fixtureDescriptor] },
    settingsEditor: { settings: settingsFile, protectedSettings: createProtectedSettingsRuntimeReader(credentials),
      environment: {}, clock },
    storage: {
      admission: syntheticStateRoot(stateRoot),
      doctorOptions: {
        stateRootTrustAnchor: root,
        stateRoot,
        authorityPath: join(stateRoot, "state.db"),
        backupDirectory: join(stateRoot, "backups", "authority"),
        maxBackupAgeMs: 45 * 60 * 1000,
        busyTimeoutMs: 1000,
      },
      clock,
      serviceState: () => ({
        state: "never-run",
        reason: "the test harness runs no backup lane",
      }),
    },
    explorer: explorerQueryDeps(clock, descriptorSetHash([fixtureDescriptor.contractFingerprint])),
  });
  return {
    app,
    database,
    settingsPath,
    stateRoot,
    clock,
    noteWriter,
    hub,
    projection,
    artifacts,
    preflight,
    artifactSourceReads,
  };
}


function optionalFileBytes(path: string): Buffer | undefined {
  return existsSync(path) ? readFileSync(path) : undefined;
}

function settingsAuthoritySnapshot(h: Harness, commandId: string) {
  const settingsRoot = dirname(h.settingsPath);
  return {
    settingsBytes: optionalFileBytes(h.settingsPath),
    protectedBytes: optionalFileBytes(join(dirname(settingsRoot), "credentials", "protected.json")),
    initializationBytes: optionalFileBytes(join(settingsRoot, "authority.json")),
    lockBytes: optionalFileBytes(join(settingsRoot, "settings.lock")),
    prepareBytes: optionalFileBytes(join(settingsRoot, "prepare.json")),
    rollbackBytes: optionalFileBytes(join(settingsRoot, "rollback.json")),
    current: h.database.authority.settingsCurrent.get(),
    journal: h.database.authority.commands.get(commandId),
    audit: h.database.authority.commandAudits.findByCommand(commandId),
    runtimeGeneration: h.database.authority.runtimeConfig.get()?.generation,
    authorityGeneration: h.database.getMeta().authorityGeneration,
  };
}

function rawSettingsPatchFingerprint(patch: unknown): string {
  return createHash("sha256")
    .update("hrauto:settings-patch:v2\0")
    .update(canonicalJsonStringify(patch))
    .digest("hex");
}

async function captureDiagnosticBundle(h: Harness, runId = RUN_ID) {
  if (h.database.authority.runs.get(runId) === undefined) {
    h.database.authority.runs.enqueue(personLookupQueuedRun({ runId }));
  }
  return createDiagnosticCaptureService({
    authority: h.database.authority,
    artifacts: h.artifacts,
    clock: h.clock,
    ids: sequentialIdFactory("d"),
  }).capture({
    trigger: "operator-request",
    runId,
    requestedBy: "local-operator",
    configFingerprint: HASH_B,
    descriptorFingerprint: fixtureDescriptor.contractFingerprint,
    fields: [],
    attachments: [{
      kind: "console-summary",
      mediaType: "application/json",
      bytes: new TextEncoder().encode("[]"),
      sensitivity: "redacted",
    }],
  });
}

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

/**
 * D288's real storage-to-route proof needs current Separations authority rows,
 * not the projection fake used by the fold unit tests. These rows retain the
 * current descriptor identity and canonical result shape that the production
 * pseudonym write capability revalidates before it persists evidence.
 */
function currentSeparationsRun(input: Readonly<{
  seed: number;
  shape: "single" | "operation" | "operation-member";
  parent?: RunRecord;
  runId?: string;
  enqueuedAt?: string;
}>): RunRecord {
  const endedAt = input.enqueuedAt ?? AT.toISOString();
  const completion = TERMINAL_SEPARATIONS_RUN.completion;
  assert.ok(completion);
  return RunRecordSchema.parse({
    ...TERMINAL_SEPARATIONS_RUN,
    lifecycle: { state: "terminal", outcome: "done", endedAt },
    completion: { ...completion, authorizedAt: endedAt },
    createdAt: input.enqueuedAt ?? AT.toISOString(),
    updatedAt: input.enqueuedAt ?? AT.toISOString(),
    envelope: {
      ...TERMINAL_SEPARATIONS_RUN.envelope,
      enqueuedAt: input.enqueuedAt ?? AT.toISOString(),
      runId: input.runId ?? uuidOf(input.seed),
      itemId: uuidOf(input.seed + 5_000),
      traceId: traceOf(input.seed),
      shape: input.shape,
      ...(input.parent === undefined ? {} : {
        parent: {
          runId: input.parent.envelope.runId,
          tracePrefix: input.parent.envelope.traceId,
          edgeId: "members",
        },
      }),
    },
  });
}

function seedCurrentSeparationsRun(
  h: Harness,
  run: RunRecord,
  canonicalSubject = "10800000",
): void {
  const result = activityPersonPseudonymResultRecord(run, {
    ...CURRENT_SEPARATIONS_RESULT,
    approved: { ...CURRENT_SEPARATIONS_RESULT.approved, emplId: canonicalSubject },
  });
  seedSeparationsRunAuthority(h.database, join(h.stateRoot, "state.db"), run, result);
}

function persistCurrentSeparationsEvidence(
  h: Harness,
  generation: string,
  runs: readonly RunRecord[],
): void {
  assert.throws(()=>h.database.createActivityPersonPseudonymBackfillWriteCapability(
    createActivityPersonPseudonymDomain({keyGeneration:generation,keyHex:ACTIVITY_PERSON_PSEUDONYM_KEY_HEX})),/activity-person-pseudonyms-retired/u);
  for(const run of runs)assert.equal(h.database.canonicalPerson(run.envelope.runId).state,"available");
}

function projectCurrentSeparationsRuns(h: Harness, runs: readonly RunRecord[]): void {
  const writer = createTimelineEmitter({ repository: h.database.authority.timelineEvents, clock: h.clock, pid: 4_243 });
  for (const run of runs) {
    writer.emit({
      t: "run.queued",
      kind: "run",
      ts: h.clock.now().toISOString(),
      workflow: run.envelope.workflow,
      runId: run.envelope.runId,
      attempt: run.envelope.attempt,
      traceId: run.envelope.traceId,
      spanPath: run.envelope.traceId,
      itemId: run.envelope.itemId,
      ...(run.envelope.parent === undefined ? {} : { parentRunId: run.envelope.parent.runId }),
      shape: run.envelope.shape,
      priority: run.envelope.priority,
      dryRun: run.envelope.dryRun,
      actorId: "local-operator",
      title: `Separations proof ${run.envelope.runId.slice(0, 8)}`,
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
      resolvedInstance: run.envelope.resolvedInstance,
      configFingerprint: run.envelope.configFingerprint,
      configSnapshotId: run.envelope.configSnapshotId,
    });
  }
  h.projection.ingestFromTimeline();
}

function archiveCurrentSeparationsRun(h: Harness, run: RunRecord): void {
  const storage=createRunLifecycleStorage(h.database);
  const report=captureArchiveReport({snapshot:storage.capture(run.envelope.runId),transferId:uuidOf(9990),capturedAt:h.clock.now().toISOString(),sections:[],files:[]});
  assert.ok(transferArchiveReport(storage,report,run.version));
}

async function activityPeople(h: Harness): Promise<unknown> {
  const response = await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`);
  assert.equal(response.status, 200);
  return ActivityReportSelectionSchema.parse(await response.json()).people;
}

async function loopbackResponse(
  server: DashboardHttpServer,
  path: string,
  init: Readonly<{ method: "GET" | "HEAD"; headers?: Readonly<Record<string, string>> }>,
): Promise<Readonly<{ status: number; headers: Readonly<Record<string, string | string[] | undefined>>; body: Buffer }>> {
  return new Promise((resolve, reject) => {
    const client = request({
      hostname: "127.0.0.1",
      port: server.port,
      path,
      method: init.method,
      headers: init.headers,
    }, (response) => {
      const chunks: Uint8Array[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(Uint8Array.from(chunk)));
      response.once("end", () => resolve(Object.freeze({
        status: response.statusCode ?? 0,
        headers: Object.freeze({ ...response.headers }),
        body: Buffer.concat(chunks),
      })));
      response.once("error", reject);
    });
    client.once("error", reject);
    client.end();
  });
}

describe("BFF spine flow (start plan -> kernel -> spans -> projection)", () => {
  it("round-trips an explicit headed browser presentation from the request through the queued run", async () => {
    const h = harness();
    const planResponse = await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        workflowId: "fixture-graph",
        submissions: [{ eid: "10873698", mode: "read-only" }],
        dryRun: false,
        browserMode: "headed",
      }),
    });
    assert.equal(planResponse.status, 200);
    const plan = await json(planResponse);
    assert.equal(plan.browserMode, "headed");

    const stored = h.database.authority.startPlans.get(String(plan.startPlanId));
    assert.equal((stored as { browserMode?: unknown } | undefined)?.browserMode, "headed");

    const fingerprints = plan.fingerprints as Record<string, string>;
    const command = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7d",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "start-run",
        family: "start",
        type: "start-run",
        target: {
          workflowId: "fixture-graph",
          startPlanId: plan.startPlanId,
          expectedVersion: plan.expectedVersion,
        },
        payload: fingerprints,
      }),
    });
    assert.equal(command.status, 200);
    const runId = singleAppliedRunId(CommandResultSchema.parse(await json(command)));
    assert.ok(runId, "the browser-mode plan must propose a run");
    const run = h.database.authority.runs.get(runId);
    assert.equal((run?.envelope as { browserMode?: unknown } | undefined)?.browserMode, "headed");
  });

  it("serves strict cross-date search from durable run authority", async () => {
    const h = harness();
    insertMeasuredSearchRun(h.database, { seed: 77, enqueuedAt: "2026-08-28T15:00:00.000Z" });

    const response = await h.app.request("/api/v1/search?q=separations&scope=workflow&limit=1");

    assert.equal(response.status, 200);
    const page = CrossDateSearchPageSchema.parse(await response.json());
    assert.equal(page.totalMatches, 1);
    assert.equal(page.results[0]?.workflowId, "separations");

    const duplicate = await h.app.request("/api/v1/search?q=separations&q=other");
    assert.equal(duplicate.status, 400);
    const unknown = await h.app.request("/api/v1/search?q=separations&title=unsafe");
    assert.equal(unknown.status, 400);
    for (const parameter of [
      "workflow=Invalid_Workflow!",
      "state=unknown-state",
      "shape=invalid-shape",
      "dryRun=maybe",
      "system=invalid-system",
      "priority=interactive",
    ]) {
      const unmeasured = await h.app.request(`/api/v1/search?q=separations&${parameter}`);
      assert.equal(unmeasured.status, 400, parameter);
    }
    const maximum = await h.app.request(`/api/v1/search?q=${"x".repeat(160)}&limit=50`);
    assert.equal(maximum.status, 200);
  });

  it("serves an exact People count from persisted current Separations standalone and member evidence only", async () => {
    const h = harness();
    const standalone = currentSeparationsRun({ seed: 310, shape: "single" });
    const operation = currentSeparationsRun({ seed: 311, shape: "operation" });
    const firstMember = currentSeparationsRun({ seed: 312, shape: "operation-member", parent: operation });
    const secondMember = currentSeparationsRun({ seed: 313, shape: "operation-member", parent: operation });
    // This persisted row is outside the canonical date range. If the
    // repository ignores its requested run ids, the route sees foreign
    // evidence and must become unavailable instead of returning this count.
    const foreign = currentSeparationsRun({ seed: 314, shape: "single", enqueuedAt: "2026-08-02T17:00:00.000Z" });

    seedCurrentSeparationsRun(h, standalone, "10800000");
    seedCurrentSeparationsRun(h, operation, "10800000");
    seedCurrentSeparationsRun(h, firstMember, "10800000");
    seedCurrentSeparationsRun(h, secondMember, "10800001");
    seedCurrentSeparationsRun(h, foreign, "10800002");
    persistCurrentSeparationsEvidence(h, "activity-person-g1", [standalone, firstMember, secondMember, foreign]);
    projectCurrentSeparationsRuns(h, [standalone, operation, firstMember, secondMember]);

    assert.deepEqual(await activityPeople(h), {
      state: "present",
      distinct: 2,
      evidenceRows: 3,
    });
  });

  it("marks the People axis unavailable when one current Separations row lacks persisted evidence", async () => {
    const h = harness();
    const evidenced = currentSeparationsRun({ seed: 320, shape: "single" });
    const missing = currentSeparationsRun({ seed: 321, shape: "single" });

    seedCurrentSeparationsRun(h, evidenced);
    seedSeparationsRunAuthority(h.database,join(h.stateRoot,"state.db"),missing,undefined);
    persistCurrentSeparationsEvidence(h, "activity-person-g1", [evidenced]);
    projectCurrentSeparationsRuns(h, [evidenced, missing]);

    assert.deepEqual(await activityPeople(h), {
      state: "absent",
      evidenceRows: 1,
      unavailableRows: 1,
      reason: "1 of 2 current Separations run/member rows lack validated canonical identity; distinct people is unavailable",
    });
  });

  it("serves canonical People across refused historical pseudonym generations", async () => {
    const h = harness();
    const first = currentSeparationsRun({ seed: 330, shape: "single" });
    const second = currentSeparationsRun({ seed: 331, shape: "single" });

    seedCurrentSeparationsRun(h, first, "10800000");
    seedCurrentSeparationsRun(h, second, "10800001");
    persistCurrentSeparationsEvidence(h, "activity-person-g1", [first]);
    persistCurrentSeparationsEvidence(h, "activity-person-g2", [second]);
    projectCurrentSeparationsRuns(h, [first, second]);

    assert.deepEqual(await activityPeople(h), {
      state: "present",
      evidenceRows: 2,
      distinct: 2,
    });
  });

  it("excludes archived Separations rows and their evidence from the current People corpus", async () => {
    const h = harness();
    const current = currentSeparationsRun({ seed: 340, shape: "single" });
    const archived = currentSeparationsRun({
      seed: 341,
      shape: "single",
      runId: ARCHIVED_RUN.runId,
    });

    seedCurrentSeparationsRun(h, current, "10800000");
    seedCurrentSeparationsRun(h, archived, "10800001");
    persistCurrentSeparationsEvidence(h, "activity-person-g1", [current, archived]);
    projectCurrentSeparationsRuns(h, [current, archived]);
    archiveCurrentSeparationsRun(h, archived);

    assert.deepEqual(await activityPeople(h), {
      state: "present",
      distinct: 1,
      evidenceRows: 1,
    });
  });

  it("fails loud without echoing any observed value outside the closed search corpus", async () => {
    const cases: readonly Readonly<{
      dimension: string;
      observed: string;
      mutate: (record: RunRecord) => RunRecord;
    }>[] = [
      {
        dimension: "workflow",
        observed: "eid-10873698",
        mutate: (record) => RunRecordSchema.parse({
          ...record,
          envelope: { ...record.envelope, workflow: "eid-10873698" },
        }),
      },
      {
        dimension: "shape",
        observed: "preview",
        mutate: (record) => RunRecordSchema.parse({
          ...record,
          envelope: { ...record.envelope, shape: "preview" },
        }),
      },
      {
        dimension: "dry-run",
        observed: "false",
        mutate: (record) => RunRecordSchema.parse({
          ...record,
          envelope: { ...record.envelope, dryRun: false },
        }),
      },
      {
        dimension: "resolved systems",
        observed: "crm",
        mutate: (record) => RunRecordSchema.parse({
          ...record,
          envelope: {
            ...record.envelope,
            resolvedInstance: { ...record.envelope.resolvedInstance, crm: "prod" },
          },
        }),
      },
      {
        dimension: "lifecycle/outcome",
        observed: "queued",
        mutate: (record) => RunRecordSchema.parse({ ...record, lifecycle: { state: "queued" } }),
      },
    ];

    for (const [index, corpusCase] of cases.entries()) {
      const h = harness();
      const run = insertMeasuredSearchRun(h.database, {
        seed: 80 + index,
        enqueuedAt: "2026-08-28T15:00:00.000Z",
      });
      const corrupted = corpusCase.mutate(run);
      const raw = new DatabaseSync(join(h.stateRoot, "state.db"));
      try {
        raw.prepare("UPDATE workflow_runs SET workflow = ?, state = ?, record_json = ? WHERE record_key = ?")
          .run(
            corrupted.envelope.workflow,
            corrupted.lifecycle.state,
            JSON.stringify(corrupted),
            corrupted.envelope.runId,
          );
      } finally {
        raw.close();
      }

      const response = await h.app.request("/api/v1/search?q=separations&limit=1");
      const body = await json(response);

      assert.equal(response.status, 500, corpusCase.dimension);
      assert.equal(body.code, "INTERNAL_FAILURE", corpusCase.dimension);
      assert.equal(
        body.message,
        "run-search-index-rebuild-required",
        corpusCase.dimension,
      );
      assert.doesNotMatch(String(body.message), new RegExp(corpusCase.observed, "u"), corpusCase.dimension);
    }
  });

  it("refuses corrupt search authority without exposing its sensitive bytes", async () => {
    const h = harness();
    const run = insertMeasuredSearchRun(h.database, { seed: 78, enqueuedAt: "2026-08-28T15:00:00.000Z" });
    const sensitiveNodeId = "ssn-951-57-1700-eid-10873698";
    const sensitivePatch = {
      nodeId: sensitiveNodeId,
      fieldPath: "identifier",
      value: "redacted",
      correctedAt: run.createdAt,
      reason: "corrupt fixture",
    };
    const raw = new DatabaseSync(join(h.stateRoot, "state.db"));
    try {
      raw.prepare("UPDATE workflow_runs SET record_json = ? WHERE record_key = ?")
        .run(JSON.stringify({
          ...run,
          envelope: { ...run.envelope, injected: [sensitivePatch, sensitivePatch] },
        }), run.envelope.runId);
    } finally {
      raw.close();
    }

    const response = await h.app.request("/api/v1/search?q=separations&scope=workflow&limit=1");
    const body = await json(response);

    assert.equal(response.status, 500);
    assert.equal(body.code, "INTERNAL_FAILURE");
    assert.equal(body.message, "run-search-index-rebuild-required");
    assert.doesNotMatch(JSON.stringify(body), new RegExp(sensitiveNodeId, "u"));
  });

  it("reruns the one strict preflight authority through its command route", async () => {
    const h = harness();
    const command = {
      commandId: "00000000-0000-4000-8000-000000000010",
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: { expectedConfigFingerprint: HASH_B },
    } as const;

    const response = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify(command),
    });

    assert.equal(response.status, 200);
    const result = PreflightRerunCommandResultSchema.parse(await response.json());
    assert.equal(result.state, "completed");
    assert.deepEqual(result.report.results.map(({ check }) => check), [
      "runtime.compatibility",
      "config.valid",
      "filesystem.health",
      "authority.health",
      "ports.available",
      "process.orphans",
    ]);
    assert.equal(JSON.stringify(h.preflight.authority.readLatest()), JSON.stringify(result.report));

    const malformed = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({ ...command, commandId: "00000000-0000-4000-8000-000000000011", extra: true }),
    });
    assert.equal(malformed.status, 400);
  });

  it("refuses preflight reruns outside the loopback Host and Origin boundary", async () => {
    const h = harness();
    const command = {
      commandId: "00000000-0000-4000-8000-000000000012",
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      type: "rerun-preflight",
      target: { expectedConfigFingerprint: HASH_B },
    } as const;
    const cases = [
      { host: "attacker.example", origin: "http://127.0.0.1:5174" },
      { host: "127.0.0.1:3938", origin: "https://attacker.example" },
    ];

    for (const headers of cases) {
      const response = await h.app.request("/api/v1/preflight/rerun", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(command),
      });
      assert.equal(response.status, 403);
      assert.equal((await json(response)).code, "PREFLIGHT_INGRESS_FORBIDDEN");
    }

    const malformedOrigin = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { host: "127.0.0.1:3938", origin: "not an absolute origin", "content-type": "application/json" },
      body: JSON.stringify(command),
    });
    assert.equal(malformedOrigin.status, 400);
    assert.equal((await json(malformedOrigin)).code, "PREFLIGHT_ORIGIN_INVALID");
  });

  it("keeps preflight body transport and decoding refusals distinguishable", async () => {
    const h = harness();
    const wrongType = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "text/plain", host: "127.0.0.1:3938" },
      body: "{}",
    });
    assert.equal(wrongType.status, 400);
    assert.equal((await json(wrongType)).code, "PREFLIGHT_CONTENT_TYPE_INVALID");

    const invalidJson = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: "{",
    });
    assert.equal(invalidJson.status, 400);
    assert.equal((await json(invalidJson)).code, "PREFLIGHT_BODY_JSON_INVALID");

    const invalidUtf8 = await h.app.request(new Request("http://127.0.0.1:3938/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: new Uint8Array([0xff]),
    }));
    assert.equal(invalidUtf8.status, 400);
    assert.equal((await json(invalidUtf8)).code, "PREFLIGHT_BODY_UTF8_INVALID");
  });

  it("distinguishes malformed lengths, missing bodies, and failed body streams", async () => {
    const h = harness();
    for (const contentLength of ["01", "9007199254740992"]) {
      const response = await h.app.request("/api/v1/preflight/rerun", {
        method: "POST",
        headers: {
          "content-length": contentLength,
          "content-type": "application/json",
          host: "127.0.0.1:3938",
        },
        body: "{}",
      });
      assert.equal(response.status, 400);
      assert.equal((await json(response)).code, "PREFLIGHT_CONTENT_LENGTH_INVALID");
    }

    const missingBody = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
    });
    assert.equal(missingBody.status, 400);
    assert.equal((await json(missingBody)).code, "PREFLIGHT_BODY_MISSING");

    const failedBody = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("injected request-stream failure"));
      },
    });
    const streamRequestInit: RequestInit & { readonly duplex: "half" } = {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: failedBody,
      duplex: "half",
    };
    const readFailed = await h.app.request(new Request(
      "http://127.0.0.1:3938/api/v1/preflight/rerun",
      streamRequestInit,
    ));
    assert.equal(readFailed.status, 400);
    assert.equal((await json(readFailed)).code, "PREFLIGHT_BODY_READ_FAILED");
  });

  it("refuses a preflight rerun body beyond its strict byte limit", async () => {
    const h = harness();
    const response = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({ padding: "x".repeat(4096) }),
    });

    assert.equal(response.status, 413);
    assert.equal((await json(response)).code, "PREFLIGHT_BODY_TOO_LARGE");
  });

  it("rate-bounds preflight rerun starts within one monotonic window", async () => {
    const h = harness();
    const request = (index: number) => h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({
        commandId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: { expectedConfigFingerprint: HASH_B },
      }),
    });

    for (let index = 20; index < 26; index += 1) assert.equal((await request(index)).status, 200);
    const refused = await request(26);
    assert.equal(refused.status, 429);
    assert.equal((await json(refused)).code, "PREFLIGHT_RATE_LIMITED");
  });

  it("admits only one preflight rerun while detector work is active", async () => {
    let release = (): void => undefined;
    let markStarted = (): void => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { markStarted = resolve; });
    const h = harness({ preflightBeforeRun: async () => {
      markStarted();
      await gate;
    } });
    const request = (commandId: string) => h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({
        commandId,
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: { expectedConfigFingerprint: HASH_B },
      }),
    });

    const firstPending = request("00000000-0000-4000-8000-000000000030");
    await started;
    const secondPending = request("00000000-0000-4000-8000-000000000031");
    release();
    const [first, second] = await Promise.all([firstPending, secondPending]);

    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.equal((await json(second)).code, "PREFLIGHT_RERUN_ACTIVE");
  });

  it("keeps rerun admission held after deadlines until all detector callbacks actually settle", async () => {
    const deadlines = new Set<() => void>();
    const began = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const h = harness({
      preflightScheduler: {
        schedule(_at, onDeadline) {
          deadlines.add(onDeadline);
          return { cancel: () => { deadlines.delete(onDeadline); } };
        },
      },
      preflightBeforeRun: async () => { began.resolve(); await release.promise; },
    });
    const request = (suffix: string) => h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({
        commandId: `00000000-0000-4000-8000-0000000000${suffix}`,
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator", source: "settings-surface", type: "rerun-preflight",
        target: { expectedConfigFingerprint: HASH_B },
      }),
    });
    const first = Promise.resolve(request("40"));
    await began.promise;
    assert.equal(deadlines.size, requiredPreflightChecks(["dashboard.serve"]).length);
    for (const deadline of deadlines) deadline();
    let settled = false;
    void first.then(() => { settled = true; }, () => { settled = true; });
    const refused = await request("41");
    assert.equal(refused.status, 429);
    assert.equal((await json(refused)).code, "PREFLIGHT_RERUN_ACTIVE");
    assert.equal(settled, false);
    release.resolve();
    assert.equal((await first).status, 500, "late healthy returns cannot publish a report");
    assert.equal(deadlines.size, 0);
    assert.equal((await request("42")).status, 200, "actual settlement releases admission");
  });

  it.each([
    { profile: "generic", method: "HEAD", range: undefined, status: 200 },
    { profile: "bundle", method: "HEAD", range: undefined, status: 200 },
    { profile: "generic", method: "GET", range: "bytes=0-0", status: 416 },
    { profile: "bundle", method: "GET", range: "bytes=0-0", status: 416 },
  ] as const)(
    "serves the real $profile $method/$status verified-byte profile over node:http",
    async ({ profile, method, range, status }) => {
      let disposals = 0;
      const transferErrors: Error[] = [];
      const h = harness({
        observeArtifactLeaseClosed: () => {
          disposals += 1;
        },
      });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
      const path = profile === "generic"
        ? `/artifacts/v1/${attachment.artifactId}`
        : `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`;
      const server = await startDashboardHttpServer({
        app: h.app,
        port: 0,
        onTransferError: (error) => transferErrors.push(error),
      });
      try {
        const response = await loopbackResponse(server, path, {
          method,
          ...(range === undefined ? {} : { headers: { range } }),
        });

        assert.equal(response.status, status);
        assert.equal(response.body.byteLength, 0);
        assert.equal(response.headers["cache-control"], "no-store");
        assert.equal(
          response.headers["content-disposition"],
          undefined,
          `${profile} must not inherit Archive's attachment-only disposition`,
        );
        if (status === 200) {
          assert.equal(response.headers["content-type"], attachment.mediaType);
          assert.equal(response.headers["content-length"], String(attachment.byteLength));
          assert.equal(response.headers["content-range"], undefined);
        } else {
          assert.equal(response.headers["content-range"], `bytes */${String(attachment.byteLength)}`);
          assert.equal(response.headers["content-type"], undefined);
          assert.equal(response.headers["content-length"], undefined);
        }
        assert.equal(disposals, 1);
        assert.equal(h.artifactSourceReads.length, profile === "generic" ? 1 : 2);
        assert.deepEqual(transferErrors, []);
      } finally {
        await server.close();
      }
    },
  );

  it("cancels the actual generic verified-byte route lease when its socket disconnects", async () => {
    const leaseClosed = Promise.withResolvers<void>();
    const transferErrors: Error[] = [];
    const h = harness({ observeArtifactLeaseClosed: leaseClosed.resolve });
    const bytes = Buffer.alloc(2 * 1024 * 1024, 0x5a);
    h.database.authority.runs.enqueue(personLookupQueuedRun({ runId: RUN_ID }));
    const bundle = await createDiagnosticCaptureService({
      authority: h.database.authority,
      artifacts: h.artifacts,
      clock: h.clock,
      ids: sequentialIdFactory("f"),
    }).capture({
      trigger: "operator-request",
      runId: RUN_ID,
      requestedBy: "local-operator",
      configFingerprint: HASH_B,
      descriptorFingerprint: fixtureDescriptor.contractFingerprint,
      fields: [],
      attachments: [{
        kind: "console-summary",
        mediaType: "application/json",
        bytes,
        sensitivity: "redacted",
      }],
    });
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const server = await startDashboardHttpServer({
      app: h.app,
      port: 0,
      onTransferError: (error) => transferErrors.push(error),
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const client = request({
          hostname: "127.0.0.1",
          port: server.port,
          method: "GET",
          path: `/artifacts/v1/${attachment.artifactId}`,
        }, (response) => {
          response.once("error", () => undefined);
          response.pause();
          response.destroy();
          resolve();
        });
        client.once("error", reject);
        client.end();
      });

      await leaseClosed.promise;
      assert.ok(h.artifactSourceReads.length > 1);
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.ok(transferErrors.length <= 1, "one disconnected transfer may report at most one local error");
      for (const error of transferErrors) assert.match(error.message, /closed|disconnected/u);
    } finally {
      await server.close();
    }
  });

  it("aborts the actual generic route's preparation before headers when its socket disconnects", async () => {
    const routedSignal = Promise.withResolvers<AbortSignal>();
    const signalAborted = Promise.withResolvers<AbortSignal>();
    const transferErrors: Error[] = [];
    const h = harness({
      diagnosticBundles: (real) => ({
        ...real,
        artifactReader: Object.freeze({
          verify: (ref: ArtifactRef, signal?: AbortSignal) => real.artifactReader.verify(ref, signal),
          async prepare(ref: ArtifactRef, signal?: AbortSignal) {
            if (signal === undefined) {
              const error = new Error("the real generic route omitted its request signal");
              routedSignal.reject(error);
              throw error;
            }
            routedSignal.resolve(signal);
            await new Promise<void>((resolve) => signal.addEventListener("abort", () => {
              signalAborted.resolve(signal);
              resolve();
            }, { once: true }));
            signal.throwIfAborted();
            return real.artifactReader.prepare(ref, signal);
          },
        }),
      }),
    });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const server = await startDashboardHttpServer({
      app: h.app,
      port: 0,
      onTransferError: (error) => transferErrors.push(error),
    });
    let serverClosed = false;
    try {
      const clientClosed = Promise.withResolvers<void>();
      const client = request({
        hostname: "127.0.0.1",
        port: server.port,
        method: "GET",
        path: `/artifacts/v1/${attachment.artifactId}`,
      });
      client.once("error", () => undefined);
      client.once("close", clientClosed.resolve);
      client.end();
      const signal = await routedSignal.promise;
      assert.equal(signal.aborted, false);
      client.destroy();

      const observedSignal = await signalAborted.promise;
      await clientClosed.promise;
      assert.equal(observedSignal, signal);
      assert.equal(signal.aborted, true);
      assert.match(String(signal.reason), /disconnected before response handoff/u);
      await server.close();
      serverClosed = true;
      assert.deepEqual(
        transferErrors,
        [],
        "an expected pre-handoff client abort must not be mislabeled as a response-transfer failure",
      );
    } finally {
      if (!serverClosed) await server.close();
    }
  });

  it("serves an authorized diagnostic attachment as an exact no-store resource", async () => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), attachment.mediaType);
    assert.equal(response.headers.get("content-length"), String(attachment.byteLength));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new TextEncoder().encode("[]"));
  });

  it.each(["generic", "bundle"] as const)(
    "verifies and disposes the selected %s lease before returning an exact HEAD response",
    async (profile) => {
      let disposals = 0;
      const h = harness({ diagnosticBundles: (real) => ({
        ...real,
        artifactReader: observeArtifactLeaseDisposal(real.artifactReader, () => {
          disposals += 1;
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
      const path = profile === "generic"
        ? `/artifacts/v1/${attachment.artifactId}`
        : `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`;

      const response = await h.app.request(path, { method: "HEAD" });

      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), attachment.mediaType);
      assert.equal(response.headers.get("content-length"), String(attachment.byteLength));
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(await response.text(), "");
      assert.equal(disposals, 1);
      assert.equal(h.artifactSourceReads.length, profile === "generic" ? 1 : 2);
    },
  );

  it.each(["generic", "bundle"] as const)(
    "verifies and disposes the selected %s lease before refusing Range",
    async (profile) => {
      let disposals = 0;
      const h = harness({ diagnosticBundles: (real) => ({
        ...real,
        artifactReader: observeArtifactLeaseDisposal(real.artifactReader, () => {
          disposals += 1;
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
      const path = profile === "generic"
        ? `/artifacts/v1/${attachment.artifactId}`
        : `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`;

      const response = await h.app.request(path, { headers: { range: "bytes=0-0" } });

      assert.equal(response.status, 416);
      assert.equal(response.headers.get("content-range"), `bytes */${String(attachment.byteLength)}`);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(await response.text(), "");
      assert.equal(disposals, 1);
      assert.equal(h.artifactSourceReads.length, profile === "generic" ? 1 : 2);
    },
  );

  it("serves an attachment only through the exact verified bundle that indexes it", async () => {
    const readerOperations: { operation: "verify" | "prepare"; ref: ArtifactRef }[] = [];
    const h = harness({ diagnosticBundles: (real) => ({
      ...real,
      artifactReader: beforeArtifactReaderOperation(real.artifactReader, (operation, ref) => {
        readerOperations.push({ operation, ref });
      }),
    }) });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const envelopeByteLength = readFileSync(
      join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`),
    ).byteLength;

    const response = await h.app.request(
      `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`,
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), attachment.mediaType);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new TextEncoder().encode("[]"));
    assert.deepEqual(readerOperations, [
      {
        operation: "verify",
        ref: {
          id: attachment.artifactId,
          sha256: attachment.digest,
          bytes: attachment.byteLength,
          mediaType: attachment.mediaType,
        },
      },
      {
        operation: "prepare",
        ref: {
          id: attachment.artifactId,
          sha256: attachment.digest,
          bytes: attachment.byteLength,
          mediaType: attachment.mediaType,
        },
      },
    ], "selected success performs one E29 verification and one fresh exact-ref preparation");
    assert.deepEqual(
      h.artifactSourceReads,
      [envelopeByteLength, envelopeByteLength],
      "selected preparation performs a fresh source read after E29",
    );

    const foreign = await h.app.request(
      `/api/v1/diagnostic-bundles/00000000-0000-4000-8000-000000000099/attachments/${attachment.artifactId}`,
    );
    assert.equal(foreign.status, 404, "an indexed artifact must not detach from its requested bundle identity");
  });

  it("serves the stored screenshot bytes and its captured dimensions through one exact bundle", async () => {
    const h = harness();
    await captureDiagnosticBundle(h);
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jG9sAAAAASUVORK5CYII=";
    const bundle = await createDiagnosticCaptureService({
      authority: h.database.authority, artifacts: h.artifacts, clock: h.clock, ids: sequentialIdFactory("e"),
    }).capture({
      trigger: "operator-request", runId: RUN_ID, requestedBy: "local-operator",
      configFingerprint: HASH_B, descriptorFingerprint: fixtureDescriptor.contractFingerprint,
      fields: [], attachments: [{
        kind: "screenshot", mediaType: "image/png", bytes: Buffer.from(pngBase64, "base64"),
        width: 1, height: 1, sensitivity: "restricted",
      }],
    });
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its screenshot");
    const path = `/api/v1/diagnostic-bundles/${bundle.bundleId}`;
    const metadata = await h.app.request(path);
    const wire = await json(metadata);
    assert.deepEqual(wire.contents, [{
      kind: "screenshot", key: "Screenshot", detail: "image/png · 68 bytes · 1 × 1 px · restricted",
      artifactId: attachment.artifactId, mediaType: "image/png", byteLength: 68,
      digest: attachment.digest, width: 1, height: 1, sensitivity: "restricted",
    }]);
    const response = await h.app.request(`${path}/attachments/${attachment.artifactId}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.equal(response.headers.get("content-length"), "68");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString("base64"), pngBase64);
  });

  it("marks diagnostic metadata and refused resource responses no-store and nosniff", async () => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const base = `/api/v1/diagnostic-bundles/${bundle.bundleId}`;

    for (const [path, status] of [
      [base, 200],
      [`${base}/manifest`, 200],
      [`${base}/attachments/${attachment.artifactId}`, 200],
      [`${base}/attachments/00000000-0000-4000-8000-000000000099`, 404],
    ] as const) {
      const response = await h.app.request(path);
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store", path);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff", path);
      await response.body?.cancel();
    }
  });

  it("refuses an existing attachment owned only by another existing bundle", async () => {
    const h = harness();
    const first = await captureDiagnosticBundle(h);
    const second = await createDiagnosticCaptureService({
      authority: h.database.authority,
      artifacts: h.artifacts,
      clock: h.clock,
      ids: sequentialIdFactory("e"),
    }).capture({
      trigger: "operator-request", runId: RUN_ID, requestedBy: "local-operator",
      configFingerprint: HASH_B, descriptorFingerprint: fixtureDescriptor.contractFingerprint,
      fields: [], attachments: [{
        kind: "console-summary", mediaType: "application/json",
        bytes: new TextEncoder().encode('["other bundle"]'), sensitivity: "redacted",
      }],
    });
    const attachment = first.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const secondBundleResponse = await h.app.request(`/api/v1/diagnostic-bundles/${second.bundleId}`);
    assert.equal(secondBundleResponse.status, 200);
    await secondBundleResponse.body?.cancel();
    const genericResponse = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);
    assert.equal(genericResponse.status, 200);
    await genericResponse.body?.cancel();

    const response = await h.app.request(
      `/api/v1/diagnostic-bundles/${second.bundleId}/attachments/${attachment.artifactId}`,
      { headers: { range: "bytes=0-0" } },
    );
    assert.equal(response.status, 404);
    assert.equal((await json(response)).code, "TARGET_NOT_FOUND");
    assert.equal(response.headers.get("content-range"), null);
  });

  it("does not infer purge history from absent diagnostic authority", async () => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    h.database.authority.diagnosticBundles.purge(bundle.bundleId, "2027-01-01T00:00:00.000Z");

    for (const bundleId of [bundle.bundleId, "00000000-0000-4000-8000-000000000099"]) {
      for (const suffix of ["", "/manifest", `/attachments/${attachment.artifactId}`]) {
        const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundleId}${suffix}`);
        assert.equal(response.status, 404);
        const body = await json(response);
        assert.equal(body.code, "TARGET_NOT_FOUND");
        assert.equal(body.retryable, false);
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.equal(response.headers.get("content-disposition"), null);
      }
    }
    assert.equal(readFileSync(join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`), "utf8").length > 0, true,
      "physical bytes remain, but no longer authorize an attachment response");
  });

  it.each(["bundle identity", "bundle digest", "index identity", "index digest", "index size", "index media type", "missing index", "duplicate index"] as const)(
    "refuses exact attachment readback for corrupt %s before opening bytes", async (mutation) => {
      let opened = false;
      const h = harness({ diagnosticBundles: (real) => ({
        ...real,
        authority: {
          ...real.authority,
          get: (id) => {
            const stored = real.authority.get(id);
            if (stored === undefined) return undefined;
            return DiagnosticBundleSchema.parse({ ...stored,
              ...(mutation === "bundle identity" ? { bundleId: "00000000-0000-4000-8000-000000000099" } : {}),
              ...(mutation === "bundle digest" ? { contentDigest: "0".repeat(64) } : {}),
            });
          },
          listAttachments: (id) => {
            const rows = real.authority.listAttachments(id);
            if (mutation === "missing index") return [];
            if (mutation === "duplicate index") return [...rows, ...rows];
            return rows.map((row) => DiagnosticAttachmentStorageRecordSchema.parse({
              ...row,
              ...(mutation === "index identity" ? { bundleId: "00000000-0000-4000-8000-000000000099" } : {}),
              attachment: { ...row.attachment,
                ...(mutation === "index digest" ? { digest: "0".repeat(64) } : {}),
                ...(mutation === "index size" ? { byteLength: 3 } : {}),
                ...(mutation === "index media type" ? { kind: "accessibility-excerpt", mediaType: "text/yaml" } : {}),
              },
            }));
          },
        },
        artifactReader: beforeArtifactReaderOperation(real.artifactReader, () => {
          opened = true;
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

      const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`);
      assert.equal(response.status, 500);
      assert.equal((await json(response)).code, "DIAGNOSTIC_BUNDLE_CORRUPT");
      assert.equal(response.headers.get("content-length"), null);
      assert.equal(opened, false, "authority must bind before storage is opened");
    },
  );

  for (const [failOnRead, phase] of [[1, "E29"], [2, "fresh selected prepare"]] as const) {
    it.each(["digest", "oversized", "truncated", "read failure"] as const)(
      `refuses %s during ${phase} without a partial byte response`, async (mutation) => {
        let reads = 0;
        const operations: ("verify" | "prepare")[] = [];
        const h: Harness = harness({ diagnosticBundles: (real) => ({
          ...real,
          artifactReader: beforeArtifactReaderOperation(real.artifactReader, async (operation, ref) => {
            operations.push(operation);
            reads += 1;
            if (reads !== failOnRead) return;
            if (mutation === "read failure") throw new Error("PRIVATE_STORAGE_PATH");
            writeStoredArtifactEnvelope(h, ref, mutation);
          }),
        }) });
        const bundle = await captureDiagnosticBundle(h);
        const attachment = bundle.attachments[0];
        if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

        const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`,
          { headers: { range: "bytes=0-0" } });
        assert.equal(response.status, 500);
        const body = await json(response);
        assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
        assert.equal(body.retryable, false);
        assert.equal(reads, failOnRead);
        assert.deepEqual(operations, failOnRead === 1 ? ["verify"] : ["verify", "prepare"]);
        assert.doesNotMatch(JSON.stringify(body), /PRIVATE_STORAGE_PATH/u);
        assert.equal(response.headers.get("content-range"), null);
        assert.equal(response.headers.get("content-length"), null);
        assert.equal(response.headers.get("cache-control"), "no-store");
      },
    );
  }

  it("refuses a verified attachment Range without returning partial bytes", async () => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`,
      { headers: { range: "bytes=0-0" } });
    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), "bytes */2");
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });

  for (const [failOnRead, phase] of [[1, "E29"], [2, "fresh selected prepare"]] as const) {
    it.each(["identity", "digest", "size", "media type"] as const)(
      `refuses a stored attachment whose physical %s changes during ${phase}`, async (mutation) => {
        let reads = 0;
        const operations: ("verify" | "prepare")[] = [];
        const h: Harness = harness({ diagnosticBundles: (real) => ({
          ...real,
          artifactReader: beforeArtifactReaderOperation(real.artifactReader, async (operation, ref) => {
            operations.push(operation);
            reads += 1;
            if (reads === failOnRead) {
              writeStoredArtifactEnvelope(h, ref, mutation === "digest" ? "metadata digest" : mutation);
            }
          }),
        }) });
        const bundle = await captureDiagnosticBundle(h);
        const attachment = bundle.attachments[0];
        if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

        const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`);
        assert.equal(response.status, 500);
        const body = await json(response);
        assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
        assert.equal(body.retryable, false);
        assert.equal(reads, failOnRead);
        assert.deepEqual(operations, failOnRead === 1 ? ["verify"] : ["verify", "prepare"]);
        assert.doesNotMatch(JSON.stringify(body), new RegExp(h.stateRoot, "u"));
        assert.equal(response.headers.get("content-length"), null);
      },
    );
  }

  it.each([
    ["bad bundle", "..%2F..%2Flatest", "00000000-0000-4000-8000-000000000001"],
    ["bad attachment", "00000000-0000-4000-8000-000000000001", "..%2F..%2Flatest"],
  ])("rejects %s before diagnostic authority lookup", async (_case, bundleId, artifactId) => {
    let authorityRead = false;
    const h = harness({ diagnosticBundles: (real) => ({ ...real, authority: { ...real.authority,
      get: (id) => { authorityRead = true; return real.authority.get(id); },
    } }) });
    const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundleId}/attachments/${artifactId}`);
    assert.equal(response.status, 400);
    assert.equal((await json(response)).code, "SCHEMA_INVALID");
    assert.equal(authorityRead, false);
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("refuses an uncomposed bundle attachment capability by kind", async () => {
    const h = harness({ omitDiagnosticBundles: true });
    const response = await h.app.request("/api/v1/diagnostic-bundles/00000000-0000-4000-8000-000000000001/attachments/00000000-0000-4000-8000-000000000002");
    assert.equal(response.status, 409);
    assert.equal((await json(response)).code, "SECTION_UNAVAILABLE");
    assert.equal(response.headers.get("cache-control"), "no-store");
  });

  it("distinguishes physical missing bytes during E29 and fresh selected preparation", async () => {
    for (const [failOnRead, phase] of [[1, "E29"], [2, "fresh selected prepare"]] as const) {
      let reads = 0;
      const operations: ("verify" | "prepare")[] = [];
      const h: Harness = harness({ diagnosticBundles: (real) => ({
        ...real,
        artifactReader: beforeArtifactReaderOperation(real.artifactReader, async (operation, ref) => {
          operations.push(operation);
          reads += 1;
          if (reads === failOnRead) {
            rmSync(join(h.stateRoot, "artifacts", `${ref.sha256}.artifact`));
          }
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

      const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`,
        { headers: { range: "bytes=0-0" } });
      assert.equal(response.status, 500);
      const body = await json(response);
      assert.equal(body.code, "DIAGNOSTIC_BUNDLE_BYTES_MISSING");
      assert.equal(body.retryable, false);
      assert.equal(reads, failOnRead);
      assert.deepEqual(operations, failOnRead === 1 ? ["verify"] : ["verify", "prepare"], phase);
      assert.doesNotMatch(JSON.stringify(body), new RegExp(h.stateRoot, "u"));
      assert.match(String(body.message), new RegExp(bundle.bundleId, "u"));
      assert.match(String(body.message), new RegExp(attachment.artifactId, "u"));
      assert.equal(response.headers.get("content-length"), null);
      assert.equal(response.headers.get("content-range"), null);
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });

  it("treats a stored object without diagnostic attachment authority as foreign", async () => {
    const h = harness();
    const storedOnly = await h.artifacts.put(
      new TextEncoder().encode("storage is not authorization"),
      { mediaType: "text/plain" },
    );

    const response = await h.app.request(`/artifacts/v1/${storedOnly.id}`, {
      headers: { range: "bytes=0-0" },
    });
    const body = await json(response);

    assert.equal(response.status, 404);
    assert.equal(body.code, "TARGET_NOT_FOUND");
    assert.equal(body.retryable, false);
    assert.doesNotMatch(JSON.stringify(body), /storage is not authorization/u);
  });

  it("reports diagnostic artifact readback unavailable when no authority is composed", async () => {
    const h = harness({ omitDiagnosticBundles: true });

    const response = await h.app.request("/artifacts/v1/00000000-0000-4000-8000-000000000099");
    const body = await json(response);

    assert.equal(response.status, 409);
    assert.equal(body.code, "SECTION_UNAVAILABLE");
    assert.equal(body.retryable, false);
    assert.equal(response.headers.get("content-length"), null);
  });

  it.each([
    ["non-UUID", "not-an-artifact-id"],
    ["traversal-shaped", "..%2F..%2Flatest"],
  ] as const)("rejects a %s artifact id before authority lookup", async (_case, artifactId) => {
    const h = harness({
      diagnosticBundles: (real) => ({
        ...real,
        authority: {
          ...real.authority,
          findByArtifact: () => {
            throw new Error("artifact authority must not see an invalid id");
          },
        },
      }),
    });

    const response = await h.app.request(`/artifacts/v1/${artifactId}`);
    const body = await json(response);

    assert.equal(response.status, 400);
    assert.equal(body.code, "SCHEMA_INVALID");
    assert.doesNotMatch(String(body.message), /artifact authority must not see/u);
  });

  it.each([
    ["digest", "digest", "X"],
    ["size", "oversized", "PRIVATE_DIAGNOSTIC_BYTES"],
  ] as const)("refuses an indexed artifact whose stored %s is corrupt before Range handling", async (
    _case,
    mutation,
    leakedBytes,
  ) => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const ref = {
      id: attachment.artifactId,
      sha256: attachment.digest,
      bytes: attachment.byteLength,
      mediaType: attachment.mediaType,
    };
    const storedBytes = mutation === "digest" ? "X]" : `[]${leakedBytes}`;
    writeFileSync(join(h.stateRoot, "artifacts", `${ref.sha256}.artifact`), JSON.stringify({
      ref,
      payloadBase64: Buffer.from(storedBytes).toString("base64"),
    }));

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`, {
      headers: { range: "bytes=0-0" },
    });
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.doesNotMatch(bodyText, new RegExp(leakedBytes, "u"));
    assert.equal(response.headers.get("content-range"), null);
    assert.equal(response.headers.get("content-length"), null);
  });

  it("refuses indexed content whose stored media type disagrees with authority", async () => {
    const h = harness({
      diagnosticBundles: (real) => ({
        ...real,
        authority: {
          ...real.authority,
          findByArtifact: (artifactId) => real.authority.findByArtifact(artifactId).map((row) =>
            DiagnosticAttachmentStorageRecordSchema.parse({
              ...row,
              attachment: {
                kind: "accessibility-excerpt",
                artifactId: row.attachment.artifactId,
                mediaType: "text/yaml",
                byteLength: row.attachment.byteLength,
                digest: row.attachment.digest,
                sensitivity: "redacted",
              },
            })),
        },
      }),
    });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);
    const body = await json(response);

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.equal(response.headers.get("content-length"), null);
  });

  it("normalizes diagnostic attachment authority failure without leaking its storage path", async () => {
    const localPath = "/private/operator/.tracker/state.sqlite";
    const h = harness({
      diagnosticBundles: (real) => ({
        ...real,
        authority: {
          ...real.authority,
          findByArtifact: () => {
            throw new Error(`authority unavailable at ${localPath}`);
          },
        },
      }),
    });
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.doesNotMatch(bodyText, new RegExp(localPath, "u"));
  });

  it("returns typed missing bytes when authority indexes an artifact whose physical object is missing", async () => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    rmSync(join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`));

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText) as Record<string, unknown>;

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_BYTES_MISSING");
    assert.equal(body.retryable, false);
    assert.match(String(body.message), /has no stored bytes/u);
    assert.doesNotMatch(bodyText, new RegExp(h.stateRoot, "u"));
  });

  it.each(["generic", "bundle"] as const)(
    "reports a local reader filesystem failure on the %s route as path-free internal failure",
    async (profile) => {
      let sabotaged = false;
      const h = harness({ diagnosticBundles: (real) => ({
        ...real,
        artifactReader: beforeArtifactReaderOperation(real.artifactReader, (_operation, ref) => {
          if (sabotaged) return;
          sabotaged = true;
          const storedPath = join(h.stateRoot, "artifacts", `${ref.sha256}.artifact`);
          rmSync(storedPath);
          mkdirSync(storedPath);
        }),
      }) });
      const bundle = await captureDiagnosticBundle(h);
      const attachment = bundle.attachments[0];
      if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
      const path = profile === "generic"
        ? `/artifacts/v1/${attachment.artifactId}`
        : `/api/v1/diagnostic-bundles/${bundle.bundleId}/attachments/${attachment.artifactId}`;

      const response = await h.app.request(path);
      const bodyText = await response.text();
      const body = JSON.parse(bodyText) as Record<string, unknown>;

      assert.equal(response.status, 500);
      assert.equal(body.code, "INTERNAL_FAILURE");
      assert.equal(body.retryable, false);
      assert.match(String(body.message), /verified artifact storage operation failed/u);
      assert.doesNotMatch(bodyText, new RegExp(h.stateRoot, "u"));
      assert.doesNotMatch(bodyText, /DIAGNOSTIC_BUNDLE_(?:CORRUPT|BYTES_MISSING)/u);
      assert.equal(response.headers.get("content-length"), null);
    },
  );

  it("verifies a ranged artifact before refusing partial delivery", async () => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");

    const response = await h.app.request(`/artifacts/v1/${attachment.artifactId}`, {
      headers: { range: "bytes=0-0" },
    });

    assert.equal(response.status, 416);
    assert.equal(response.headers.get("content-range"), `bytes */${String(attachment.byteLength)}`);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.arrayBuffer()).byteLength, 0);
  });

  it.each([
    ["mutated", false],
    ["missing", true],
  ] as const)("returns a typed path-free failure when a real diagnostic artifact is %s", async (_case, removeArtifact) => {
    const h = harness();
    const bundle = await captureDiagnosticBundle(h);
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    const artifactPath = join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`);
    if (removeArtifact) rmSync(artifactPath);
    else writeFileSync(artifactPath, "{\"mutated\":true}", "utf8");

    const suffix = removeArtifact ? "/manifest" : "";
    const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}${suffix}`);
    const body = await json(response);
    assert.equal(response.status, 500);
    assert.equal(body.code, removeArtifact ? "DIAGNOSTIC_BUNDLE_BYTES_MISSING" : "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.match(String(body.message), new RegExp(bundle.bundleId, "u"));
    assert.match(String(body.message), new RegExp(attachment.artifactId, "u"));
    assert.match(String(body.message), new RegExp(attachment.kind, "u"));
    assert.doesNotMatch(String(body.message), new RegExp(h.stateRoot, "u"));
    assert.doesNotMatch(String(body.message), /(?:\/private\/|\/var\/folders\/)/u);
  });

  it("returns typed corruption when the diagnostic repository returns a foreign bundle id", async () => {
    const foreignBundleId = DiagnosticBundleIdSchema.parse("00000000-0000-4000-8000-000000000999");
    const h = harness({
      diagnosticBundles: (real) => ({
        ...real,
        authority: {
          get: (bundleId) => {
            const stored = real.authority.get(bundleId);
            return stored === undefined
              ? undefined
              : { ...stored, bundleId: foreignBundleId };
          },
          listAttachments: real.authority.listAttachments,
          findByArtifact: real.authority.findByArtifact,
        },
      }),
    });
    const bundle = await captureDiagnosticBundle(h);
    const response = await h.app.request(`/api/v1/diagnostic-bundles/${bundle.bundleId}`);
    const body = await json(response);

    assert.equal(response.status, 500);
    assert.equal(body.code, "DIAGNOSTIC_BUNDLE_CORRUPT");
    assert.equal(body.retryable, false);
    assert.match(String(body.message), /durable authority identity mismatch/u);
    assert.match(String(body.message), new RegExp(bundle.bundleId, "u"));
    assert.doesNotMatch(String(body.message), new RegExp(foreignBundleId, "u"));
  });

  it("reuses exact-ref verification within one captures request and re-verifies on the next request", async () => {
    const syntheticBundles: DiagnosticBundle[] = [];
    const h = harness({
      runCaptureAuthority: (real) => Object.freeze({
        ...real,
        get(bundleId: string) {
          return syntheticBundles.find((bundle) => bundle.bundleId === bundleId) ?? real.get(bundleId);
        },
        listByRun(runId: string) {
          return [...real.listByRun(runId), ...syntheticBundles.filter((bundle) => bundle.runId === runId)];
        },
        listAttachments(bundleId: string) {
          const synthetic = syntheticBundles.find((bundle) => bundle.bundleId === bundleId);
          if (synthetic === undefined) return real.listAttachments(bundleId);
          return synthetic.attachments.map((attachment) => DiagnosticAttachmentStorageRecordSchema.parse({
            bundleId: synthetic.bundleId,
            attachment,
            createdAt: synthetic.createdAt,
          }));
        },
      }),
    });
    const planResponse = await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        workflowId: "fixture-graph",
        submissions: [{ eid: "10873698", mode: "read-only" }],
        dryRun: false,
      }),
    });
    assert.equal(planResponse.status, 200);
    const plan = await json(planResponse);
    const fingerprints = plan.fingerprints as Record<string, string>;
    const commandResponse = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7d",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "start-run",
        family: "start",
        type: "start-run",
        target: {
          workflowId: "fixture-graph",
          startPlanId: plan.startPlanId,
          expectedVersion: plan.expectedVersion,
        },
        payload: {
          descriptorFingerprint: fingerprints.descriptorFingerprint,
          configFingerprint: fingerprints.configFingerprint,
          ingressSchemaHash: fingerprints.ingressSchemaHash,
          canonicalInputSchemaHash: fingerprints.canonicalInputSchemaHash,
          inputFingerprint: fingerprints.inputFingerprint,
        },
      }),
    });
    assert.equal(commandResponse.status, 200);
    const plannedRun = { runId: singleAppliedRunId(CommandResultSchema.parse(await json(commandResponse))) };

    const capture = createDiagnosticCaptureService({
      authority: h.database.authority,
      artifacts: h.artifacts,
      clock: h.clock,
      ids: sequentialIdFactory("d"),
    });
    const sharedAttachment = {
      kind: "accessibility-excerpt" as const,
      mediaType: "text/yaml",
      bytes: new TextEncoder().encode("- button: Retry"),
      sensitivity: "redacted" as const,
    };
    const first = await capture.capture({
      trigger: "operator-request",
      runId: plannedRun.runId,
      requestedBy: "local-operator",
      configFingerprint: HASH_B,
      descriptorFingerprint: fixtureDescriptor.contractFingerprint,
      fields: [],
      attachments: [sharedAttachment],
    });
    const automaticCapture = createDiagnosticCaptureService({
      authority: h.database.authority,
      artifacts: h.artifacts,
      clock: h.clock,
      ids: sequentialIdFactory("e"),
    });
    const automaticCases = [
      { trigger: "task-failure", originKind: "failure" },
      { trigger: "unexpected-state", originKind: "unexpected-state" },
      { trigger: "subject-mismatch", originKind: "subject-mismatch" },
      { trigger: "recovery-park", originKind: "recovery-park" },
    ] as const;
    const automaticBundles: DiagnosticBundle[] = [];
    for (const automaticCase of automaticCases) {
      automaticBundles.push(await automaticCapture.prepare({
        trigger: automaticCase.trigger,
        runId: plannedRun.runId,
        failureId: "00000000-0000-4000-8000-0000000000f1",
        configFingerprint: HASH_B,
        descriptorFingerprint: fixtureDescriptor.contractFingerprint,
        fields: [],
        attachments: [sharedAttachment],
      }));
    }
    syntheticBundles.push(...automaticBundles);
    const firstAttachment = first.attachments[0];
    if (firstAttachment === undefined || automaticBundles.some((bundle) => bundle.attachments[0] === undefined)) {
      throw new Error("the diagnostic fixtures did not write their shared attachment");
    }
    for (const automatic of automaticBundles) {
      assert.notEqual(first.bundleId, automatic.bundleId);
      assert.notDeepEqual(first.origin, automatic.origin);
      assert.notEqual(first.contentDigest, automatic.contentDigest);
      assert.deepEqual(automatic.attachments[0], firstAttachment);
    }
    const envelopeByteLength = readFileSync(
      join(h.stateRoot, "artifacts", `${firstAttachment.digest}.artifact`),
    ).byteLength;

    const readCaptures = async () => {
      const response = await h.app.request(`/api/v1/runs/${plannedRun.runId}/captures`);
      assert.equal(response.status, 200);
      const captures = RunDetailSectionResponseSchema.parse(await response.json());
      assert.equal(captures.section, "captures");
      if (captures.section !== "captures") throw new Error("expected captures");
      return captures;
    };
    const firstResponse = await readCaptures();
    const firstRequestSourceReads = [...h.artifactSourceReads];
    const secondResponse = await readCaptures();
    const secondRequestSourceReads = [...h.artifactSourceReads];
    const expectedArtifacts = [{
      artifact: {
        mediaKind: "data",
        artifactId: firstAttachment.artifactId,
        mediaType: firstAttachment.mediaType,
        byteLength: firstAttachment.byteLength,
        sha256: firstAttachment.digest,
        sensitivity: firstAttachment.sensitivity,
        redaction: "applied",
      },
      origins: [
        { bundleId: first.bundleId, originKind: "operator-request" },
        ...automaticBundles.map((bundle, index) => ({
          bundleId: bundle.bundleId,
          originKind: automaticCases[index]?.originKind,
        })),
      ],
    }];
    for (const captures of [firstResponse, secondResponse]) {
      assert.deepEqual(captures.payload.artifacts, expectedArtifacts);
    }
    assert.deepEqual(
      firstRequestSourceReads,
      [envelopeByteLength],
      "one request must completely verify one shared exact artifact ref only once",
    );
    assert.deepEqual(
      secondRequestSourceReads,
      [envelopeByteLength, envelopeByteLength],
      "a second request must perform one additional complete source verification",
    );
  });

  it("plans, starts, projects, and serves the run through the one payload", async () => {
    const h = harness();

    const planResponse = await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        workflowId: "fixture-graph",
        submissions: [{ eid: "10873698", mode: "read-only" }, { eid: "not-an-eid", mode: "read-only" }],
        dryRun: false,
      }),
    });
    assert.equal(planResponse.status, 200);
    const plan = await json(planResponse);
    const planned = plan.planned as { logicalKey: string; title: string }[];
    const refused = plan.refused as { entry: number; code: string }[];
    assert.equal(planned.length, 1);
    assert.equal(planned[0].title, "Fixture 10873698");
    assert.deepEqual(refused.map(({ entry, code }) => ({ entry, code })), [{ entry: 2, code: "input-invalid" }]);

    const fingerprints = plan.fingerprints as Record<string, string>;
    const command = {
      commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7a",
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "start-run",
      family: "start",
      type: "start-run",
      target: {
        workflowId: "fixture-graph",
        startPlanId: plan.startPlanId,
        expectedVersion: plan.expectedVersion,
      },
      payload: {
        descriptorFingerprint: fingerprints.descriptorFingerprint,
        configFingerprint: fingerprints.configFingerprint,
        ingressSchemaHash: fingerprints.ingressSchemaHash,
        canonicalInputSchemaHash: fingerprints.canonicalInputSchemaHash,
        inputFingerprint: fingerprints.inputFingerprint,
      },
    };
    const commandResponse = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify(command),
    });
    assert.equal(commandResponse.status, 200);
    const createdRunId = singleAppliedRunId(CommandResultSchema.parse(await json(commandResponse)));
    const created = h.database.authority.runs.get(createdRunId); assert.ok(created);

    // The run.queued event commits with its canonical run.
    const spanLines = readTimelineRecords(h.database.authority.timelineEvents).records.map(timelineSpanLocation);
    assert.equal(spanLines.length, 1);
    assert.match(spanLines[0].text, /"t":"run\.queued"/);
    assert.match(spanLines[0].text, /"title":"Fixture 10873698"/);

    // A replay returns already-applied and emits NO second span.
    const replay = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify(command),
    });
    assert.equal((await json(replay)).state, "already-applied");
    assert.equal(readTimelineRecords(h.database.authority.timelineEvents).records.length, 1);

    // THE payload serves the row and its counts from one fold.
    const dayResponse = await h.app.request(`/api/v1/dashboard?day=${DAY}`);
    assert.equal(dayResponse.status, 200);
    const day = await json(dayResponse);
    const surfaces = day.queueSurfaces as { runId: string; status: string; pipeline: { id: string }[] }[];
    assert.equal(surfaces.length, 1);
    assert.equal(surfaces[0].runId, created.envelope.runId);
    assert.equal(surfaces[0].status, "queued");
    // Pipeline comes from the descriptor's runtime nodes, pending until spans arrive.
    assert.equal(surfaces[0].pipeline.length > 0, true);
    assert.equal(surfaces[0].pipeline.every(({ id }) => typeof id === "string"), true);
    assert.deepEqual(day.workflowCounts, [
      { workflowId: "fixture-graph", count: 1, statusCounts: [{ status: "queued", count: 1 }] },
    ]);
    assert.deepEqual(day.statusCounts, [{ status: "queued", count: 1 }]);

    // Detail header + note-backed logs slice.
    const runId = created.envelope.runId;
    const detail = await json(await h.app.request(`/api/v1/runs/${runId}`));
    assert.equal((detail.header as { title: string }).title, "Fixture 10873698");
    // DCA3: a live read must state absence, not omit capture availability.
    assert.deepEqual(detail.captures, {
      state: "absent", reason: "this run has no indexed diagnostic capture artifacts",
    });
    const bundle = await captureDiagnosticBundle(h, runId);
    const capturedDetail = await json(await h.app.request(`/api/v1/runs/${runId}`));
    assert.deepEqual(capturedDetail.captures, { state: "available", artifactCount: 1 });
    const capturesResponse = await h.app.request(`/api/v1/runs/${runId}/captures`);
    assert.equal(capturesResponse.status, 200);
    const captures = RunDetailSectionResponseSchema.parse(await capturesResponse.json());
    assert.equal(captures.section, "captures");
    if (captures.section !== "captures") throw new Error("expected captures");
    assert.equal(captures.payload.runId, runId);
    assert.deepEqual(captures.payload.artifacts.map(({ artifact, origins }) => ({ artifactId: artifact.artifactId, origins })),
      bundle.attachments.map(({ artifactId }) => ({ artifactId, origins: [{ bundleId: bundle.bundleId, originKind: "operator-request" }] })));
    const attachment = bundle.attachments[0];
    if (attachment === undefined) throw new Error("the diagnostic fixture did not write its attachment");
    rmSync(join(h.stateRoot, "artifacts", `${attachment.digest}.artifact`));
    const missingDetailResponse = await h.app.request(`/api/v1/runs/${runId}`);
    assert.equal(missingDetailResponse.status, 200);
    assert.deepEqual((await json(missingDetailResponse)).captures, {
      state: "error",
      code: "DIAGNOSTIC_BUNDLE_BYTES_MISSING",
      message: `diagnostic bundle ${bundle.bundleId}: attachment ${attachment.artifactId} (${attachment.kind}) has no stored bytes`,
      retryable: false,
    });
    const missingCapturesResponse = await h.app.request(`/api/v1/runs/${runId}/captures`);
    assert.equal(missingCapturesResponse.status, 500);
    assert.equal((await json(missingCapturesResponse)).code, "DIAGNOSTIC_BUNDLE_BYTES_MISSING");
    h.noteWriter.emitNote({
      workflow: "fixture-graph",
      address: { runId, attempt: 1, traceId: created.envelope.traceId, spanPath: created.envelope.traceId },
      level: "step",
      message: "opened person search",
    });
    const logs = await json(await h.app.request(`/api/v1/runs/${runId}/logs`));
    const payload = logs.payload as { notes: { message: string; level: string }[]; nextCursor: { state: string } };
    assert.deepEqual(payload.notes.map(({ message, level }) => ({ message, level })), [
      { message: "opened person search", level: "info" },
    ]);
    assert.equal(payload.nextCursor.state, "absent");

    // The SSE hub serves the same snapshot the query returned.
    const connection = await h.hub.connect({ day: DAY });
    const snapshot = connection.initial[1];
    if (snapshot.type !== "snapshot" || snapshot.topic !== "dashboard-day") assert.fail("expected a dashboard-day snapshot");
    expect(snapshot.payload).toEqual(day);
    connection.close();
  });

  it("serves the timeline for task spans committed through another authority connection (D218)", async () => {
    // The regression the cross-process tail exists for: the run is enqueued
    // by THIS process, its task spans are appended by ANOTHER process (the
    // worker), and the run detail must still serve a timeline — before D218
    // the projection folded only its own emissions and `timeline.events`
    // stayed [] for every run enqueued after boot.
    const h = harness();
    const plan = await json(await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        workflowId: "fixture-graph",
        submissions: [{ eid: "10873698", mode: "read-only" }],
        dryRun: false,
      }),
    }));
    const fingerprints = plan.fingerprints as Record<string, string>;
    const commandResponse = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7c",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "start-run",
        family: "start",
        type: "start-run",
        target: { workflowId: "fixture-graph", startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion },
        payload: {
          descriptorFingerprint: fingerprints.descriptorFingerprint,
          configFingerprint: fingerprints.configFingerprint,
          ingressSchemaHash: fingerprints.ingressSchemaHash,
          canonicalInputSchemaHash: fingerprints.canonicalInputSchemaHash,
          inputFingerprint: fingerprints.inputFingerprint,
        },
      }),
    });
    const runId = singleAppliedRunId(CommandResultSchema.parse(await json(commandResponse)));
    const created = h.database.authority.runs.get(runId); assert.ok(created);
    const traceId = created.envelope.traceId;

    // Independent worker connection; no in-process projection callback.
    const base = {
      workflow: "fixture-graph", pid: 777, runId, attempt: 1, traceId,
      spanPath: `${traceId}/probe#1`, parentSpanPath: traceId,
    };
    const workerDatabase = AuthorityDatabase.open({ path: join(h.stateRoot, "state.db"),
      busyTimeoutMs: 1000, migrationOwner: "bff-worker-test" }, h.clock);
    try {
      const workerSpans = createTimelineEmitter({ repository: workerDatabase.authority.timelineEvents, clock: h.clock, pid: 777 });
      workerSpans.emit({ ...base, t: "span.started", kind: "task", ts: h.clock.now().toISOString(), name: "probe" });
      workerSpans.emit({ ...base, t: "span.ended", kind: "task", ts: h.clock.now().toISOString(), outcome: "done" });
    } finally { workerDatabase.close(); }

    // Production's poll tick, invoked directly.
    h.projection.ingestFromTimeline();

    const detail = await json(await h.app.request(`/api/v1/runs/${runId}`));
    const timeline = detail.timeline as { events: { label: string; state: string }[] };
    assert.equal(timeline.events.length > 0, true);
    assert.deepEqual(
      timeline.events.filter(({ label }) => label === "probe").map(({ state }) => state),
      ["done"],
    );
  });

  it("refuses a foreign-origin settings command before any authority effect", async () => {
    const h = harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b79";
    const patch = { "browser.headless": { set: false } } as const;
    const command = {
      commandId,
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedBy: "forged-actor",
      source: "hostile-page",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    };
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "https://hostile.example",
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });

    assert.equal(response.status, 403);
    assert.equal((await json(response)).code, "OPERATOR_MUTATION_ORIGIN_REFUSED");
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it.each([
    ["missing Origin", { host: "localhost", "content-type": "application/json" }, 403, "OPERATOR_MUTATION_ORIGIN_REFUSED"],
    ["foreign Origin", { ...OPERATOR_JSON_HEADERS, origin: "https://hostile.example" }, 403, "OPERATOR_MUTATION_ORIGIN_REFUSED"],
    ["text/plain", { ...OPERATOR_JSON_HEADERS, "content-type": "text/plain" }, 415, "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED"],
  ] as const)("refuses %s without consuming either command body or changing authority", async (_label, headers, status, code) => {
    const h = harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b74";
    const bulkCommandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b73";
    const patch = { "browser.headless": { set: false } } as const;
    h.database.authority.runs.enqueue(personLookupQueuedRun({ runId: RUN_ID }));
    const snapshot = () => ({
      settings: settingsAuthoritySnapshot(h, commandId),
      run: h.database.authority.runs.get(RUN_ID),
      parent: h.database.authority.commands.getBulk(bulkCommandId),
      child: settingsAuthoritySnapshot(h, deriveBulkChildCommandId(bulkCommandId, RUN_ID)),
    });
    const before = snapshot();
    for (const [path, body] of [
      ["/api/v1/commands", {
        commandId, family: "settings", type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
      }],
      ["/api/v1/commands/bulk", {
        commandId, bulkCommandId, family: "run", type: "cancel", mode: "best-effort",
        targets: [{ runId: RUN_ID, expectedVersion: 1 }],
      }],
    ] as const) {
      // Pass this exact Request to Hono: spies wrap the real raw-body methods,
      // and valid JSON makes early consumption observable even if refusal still wins.
      const request = new Request(`http://localhost${path}`, {
        method: "POST", headers, body: JSON.stringify(body),
      });
      const reads = (["json", "text", "arrayBuffer", "blob", "formData"] as const)
        .map((method) => vi.spyOn(request, method));

      const response = await h.app.request(request);

      assert.equal(response.status, status, path);
      assert.equal((await json(response)).code, code, path);
      for (const read of reads) expect(read).not.toHaveBeenCalled();
      assert.equal(request.bodyUsed, false, path);
      assert.deepEqual(snapshot(), before, `${path} has zero authority effects`);
    }
  });

  it.each([
    ["unknown envelope field", { extra: true }, { extra: true }],
    ["unknown target field", { target: { expectedRevision: 1, extra: true } }, { targets: [{ runId: RUN_ID, expectedVersion: 1, extra: true }] }],
    ["wrong target type", { target: { expectedRevision: "1" } }, { targets: [{ runId: RUN_ID, expectedVersion: "1" }] }],
    ["wrong action", { type: "cancel" }, { type: "apply-settings" }],
    ["wrong command id", { commandId: "invalid" }, { bulkCommandId: "invalid" }],
    ["unknown payload field", { payload: {
      settingsSchemaHash: SETTINGS_SCHEMA_HASH,
      patchFingerprint: "a".repeat(64),
      patch: { "browser.headless": { set: false } },
      extra: true,
    } }, { targets: [] }],
  ] as const)("refuses %s through strict command ingress with zero effects", async (_label, singleChange, bulkChange) => {
    const h = harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b72";
    const bulkCommandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b71";
    const patch = { "browser.headless": { set: false } } as const;
    h.database.authority.runs.enqueue(personLookupQueuedRun({ runId: RUN_ID }));
    const snapshot = () => ({
      settings: settingsAuthoritySnapshot(h, commandId),
      run: h.database.authority.runs.get(RUN_ID),
      parent: h.database.authority.commands.getBulk(bulkCommandId),
      child: settingsAuthoritySnapshot(h, deriveBulkChildCommandId(bulkCommandId, RUN_ID)),
    });
    const before = snapshot();
    const single = {
      commandId, family: "settings", type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: deriveSettingsPatchFingerprint(patch), patch },
    };
    const bulk = {
      commandId, bulkCommandId, family: "run", type: "cancel", mode: "best-effort",
      targets: [{ runId: RUN_ID, expectedVersion: 1 }],
    };
    for (const [path, body, status, code] of [
      ["/api/v1/commands", { ...single, ...singleChange }, 400, "SCHEMA_INVALID"],
      ["/api/v1/commands/bulk", { ...bulk, ...bulkChange }, 422, "schema-mismatch"],
    ] as const) {
      const response = await h.app.request(path, {
        method: "POST", headers: OPERATOR_JSON_HEADERS, body: JSON.stringify(body),
      });
      assert.equal(response.status, status, path);
      assert.equal((await json(response)).code, code, path);
      assert.deepEqual(snapshot(), before, `${path} has zero authority effects`);
    }
  });

  it("returns not-editable for a protected key submitted through ordinary settings before authority access", async () => {
    let journalReads = 0;
    const h = harness({
      commandJournal: (real) => ({
        get(commandId) {
          journalReads += 1;
          return real.get(commandId);
        },
      }),
    });
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b69";
    const patch = { ucpathPassword: { set: "never-return-this-value" } };
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId,
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: rawSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), {
      state: "rejected",
      commandId,
      code: "not-editable",
      message: "not-editable { key: ucpathPassword }",
    });
    assert.equal(journalReads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it.each([
    ["unknown ordinary", { "unknown.setting": { clear: true } }, "unknown.setting", "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b6a"],
    ["deployment-owned ordinary", { "paths.stateRoot": { set: "/tmp/foreign-root" } }, "paths.stateRoot", "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b6b"],
  ] as const)("returns not-editable for %s before authority access", async (_label, patch, key, commandId) => {
    let journalReads = 0;
    const h = harness({
      commandJournal: (real) => ({
        get(commandId) {
          journalReads += 1;
          return real.get(commandId);
        },
      }),
    });
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId,
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: rawSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), {
      state: "rejected", commandId, code: "not-editable", message: `not-editable { key: ${key} }`,
    });
    assert.equal(journalReads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it.each([
    { label: "partial display set", seed: {}, patch: { "display.screenWidth": { set: 1600 } }, missing: ["display.screenHeight"] },
    { label: "partial display clear", seed: { "display.screenWidth": { set: 1600 }, "display.screenHeight": { set: 900 } }, patch: { "display.screenHeight": { clear: true } }, missing: ["display.screenHeight"] },
    { label: "partial annual dates clear", seed: { "annualDates.FY2027.jobEndDate": { set: "06/30/2027" }, "annualDates.FY2027.kronosDefaultEndDate": { set: "06/30/2027" }, "annualDates.FY2027.kronosDefaultStartDate": { set: "07/01/2026" } }, patch: { "annualDates.FY2027.jobEndDate": { clear: true } }, missing: ["annualDates.FY2027.jobEndDate"] },
  ])("returns cross-field-invalid for $label without durable effects", async ({ seed, patch, missing }) => {
    const h = harness();
    const send = (commandId: string, expectedRevision: number, changes: unknown) => h.app.request("/api/v1/commands", {
      method: "POST", headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ commandId, family: "settings", type: "apply-settings", target: { expectedRevision },
        payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: rawSettingsPatchFingerprint(changes), patch: changes } }),
    });
    const seeded = Object.keys(seed).length > 0;
    if (seeded) assert.equal((await send("00000000-0000-4000-8000-000000000901", 1, seed)).status, 200);
    const commandId = "00000000-0000-4000-8000-000000000902";
    const before = settingsAuthoritySnapshot(h, commandId);
    const response = await send(commandId, seeded ? 2 : 1, patch);
    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), { state: "rejected", commandId, code: "cross-field-invalid",
      message: `cross-field-invalid { keys: ${missing.join(", ")} }` });
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it("accepts a current-year job-end date without Kronos fields", async () => {
    const h = harness();
    const path = `annualDates.FY${String(h.clock.fiscalYear())}.jobEndDate`;
    const patch = { [path]: { set: "06/30/2027" } };
    const response = await h.app.request("/api/v1/commands", {
      method: "POST", headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ commandId: "00000000-0000-4000-8000-000000000903", family: "settings", type: "apply-settings",
        target: { expectedRevision: 1 }, payload: { settingsSchemaHash: SETTINGS_SCHEMA_HASH, patchFingerprint: rawSettingsPatchFingerprint(patch), patch } }),
    });
    assert.equal(response.status, 200);
    const record = h.database.withAuthorityTransaction(repositories => readSettings(repositories));
    assert.equal(record.settingsSchemaHash, SETTINGS_SCHEMA_HASH);
    assert.deepEqual(record.settings.annualDates, { [`FY${String(h.clock.fiscalYear())}`]: { jobEndDate: "06/30/2027" } });
  });

  it("refuses invalid or unauthorized requests before protected retry identity and journal reads", async () => {
    let reads = 0;
    const forbiddenRead = () => { reads += 1; throw new Error("forbidden request-only authority read"); };
    const h = harness({ protectedCommandAcceptedAt: forbiddenRead, commandJournal: () => ({ get: forbiddenRead }) });
    const commandId = "00000000-0000-4000-8000-000000000907";
    const request = { commandId, family: "settings", type: "apply-protected-settings", target: { expectedRevision: 1 },
      payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: "00000000-0000-4000-8000-000000000908", entries: { ucpathPassword: { set: "synthetic-validation-only" } } } };
    const before = settingsAuthoritySnapshot(h, commandId);
    for (const { body, headers, status } of [
      { body: { ...request, payload: { ...request.payload, protectedSchemaHash: "0".repeat(64) } }, headers: OPERATOR_JSON_HEADERS, status: 422 },
      { body: { ...request, payload: { ...request.payload, entries: { ucpathPassword: { set: 42 } } } }, headers: OPERATOR_JSON_HEADERS, status: 422 },
      { body: request, headers: { ...OPERATOR_JSON_HEADERS, origin: "https://foreign.invalid" }, status: 403 },
    ]) {
      const response = await h.app.request("/api/v1/commands", { method: "POST", headers, body: JSON.stringify(body) });
      assert.equal(response.status, status);
    }
    assert.equal(reads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it.each(["set", "clear"] as const)("settles an uncertain credential %s audit through HTTP after the server clock advances", async (operation) => {
    const h = harness();
    const commandId = "00000000-0000-4000-8000-000000000903";
    const request = { commandId, family: "settings", type: "apply-protected-settings", target: { expectedRevision: operation === "clear" ? 2 : 1 },
      payload: { protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH, writeId: "00000000-0000-4000-8000-000000000904",
        entries: { ucpathPassword: operation === "clear" ? { clear: true } : { set: "synthetic-http-retry-private" } } } };
    const send = (body: unknown = request) => h.app.request("/api/v1/commands", { method: "POST", headers: OPERATOR_JSON_HEADERS, body: JSON.stringify(body) });
    if (operation === "clear") {
      const seed = { ...request, commandId: "00000000-0000-4000-8000-000000000905", target: { expectedRevision: 1 },
        payload: { ...request.payload, writeId: "00000000-0000-4000-8000-000000000906", entries: { ucpathPassword: { set: "synthetic-http-retry-private" } } } };
      assert.equal((await send(seed)).status, 200);
      h.clock.advanceWall(1000);
    }
    const acceptedAt = h.clock.now().toISOString();
    const transaction = h.database.withAuthorityTransaction.bind(h.database);
    vi.spyOn(h.database, "withAuthorityTransaction").mockImplementationOnce((work) => transaction((repositories) => {
      work(repositories);
      throw new Error("injected-http-audit-failure");
    }));
    assert.equal((await send()).status, 500);
    const privatePath = join(h.stateRoot, "credentials", "protected.json");
    const bytes = readFileSync(privatePath);
    assert.equal(h.database.authority.commands.get(commandId), undefined);
    const beforeForeign = settingsAuthoritySnapshot(h, commandId);
    const foreign = await send({ commandId, family: "run", type: "cancel", target: { runId: UUID_4, expectedVersion: 1 } });
    assert.equal(foreign.status, 422);
    assert.equal((await json(foreign)).code, "command-divergent");
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), beforeForeign);
    h.clock.advanceWall(1000);
    const divergent = { ...request, payload: { ...request.payload, entries: { ucpathPassword: { set: "synthetic-http-retry-divergent" } } } };
    const denied = await json(await send(divergent));
    assert.equal(denied.code, "command-divergent");
    h.clock.advanceWall(1000);
    const retry = await send();
    assert.equal(retry.status, 200);
    assert.equal((await json(retry)).state, "applied");
    assert.equal((await json(await send())).state, "already-applied");
    assert.deepEqual(readFileSync(privatePath), bytes);
    const audit = h.database.authority.commandAudits.findByCommand(commandId); assert.ok(audit);
    assert.equal(audit.request.requestedAt, acceptedAt);
    assert.equal(JSON.stringify(audit).includes("synthetic-http-retry-private"), false);
  });

  it("returns invalid-value for an ordinary settings leaf before authority access", async () => {
    let journalReads = 0;
    const h = harness({
      commandJournal: (real) => ({
        get(commandId) {
          journalReads += 1;
          return real.get(commandId);
        },
      }),
    });
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b66";
    const patch = { "browser.headless": { set: "not-a-boolean" } };
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId,
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: rawSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), {
      state: "rejected",
      commandId,
      code: "invalid-value",
      message: "invalid-value { key: browser.headless }",
    });
    assert.equal(journalReads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it("returns invalid-value for a protected settings leaf before authority access", async () => {
    let journalReads = 0;
    const h = harness({
      commandJournal: (real) => ({
        get(commandId) {
          journalReads += 1;
          return real.get(commandId);
        },
      }),
    });
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b68";
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId,
        family: "settings",
        type: "apply-protected-settings",
        target: { expectedRevision: 1 },
        payload: {
          protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
          writeId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b67",
          entries: { sharepointOnboardingRosterUrl: { set: "protected-canary-not-a-url" } },
        },
      }),
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), {
      state: "rejected",
      commandId,
      code: "invalid-value",
      message: "invalid-value { key: sharepointOnboardingRosterUrl }",
    });
    assert.equal(journalReads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it.each([
    [
      "ordinary schema mismatch before an invalid leaf",
      "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b61",
      {
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: "0".repeat(64),
          patchFingerprint: rawSettingsPatchFingerprint({ "browser.headless": { set: "not-a-boolean" } }),
          patch: { "browser.headless": { set: "not-a-boolean" } },
        },
      },
      "schema-mismatch",
      "settings.json schema-mismatch",
    ],
    [
      "ordinary patch fingerprint mismatch before an invalid leaf",
      "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b62",
      {
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: "0".repeat(64),
          patch: { "browser.headless": { set: "not-a-boolean" } },
        },
      },
      "patch-fingerprint-mismatch",
      "patch-fingerprint-mismatch: settings patch fingerprint does not match its canonical value",
    ],
    [
      "protected schema mismatch before an invalid leaf",
      "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b63",
      {
        family: "settings",
        type: "apply-protected-settings",
        target: { expectedRevision: 1 },
        payload: {
          protectedSchemaHash: "0".repeat(64),
          writeId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b60",
          entries: { sharepointOnboardingRosterUrl: { set: "protected-canary-not-a-url" } },
        },
      },
      "schema-mismatch",
      "protected.json schema-mismatch",
    ],
  ] as const)("preserves %s at mixed-failure ingress", async (_label, commandId, request, code, message) => {
    let journalReads = 0;
    const h = harness({
      commandJournal: (real) => ({
        get(commandId) {
          journalReads += 1;
          return real.get(commandId);
        },
      }),
    });
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ commandId, ...request }),
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), {
      state: "rejected",
      commandId,
      code,
      message,
    });
    assert.equal(journalReads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it("returns not-editable for an unknown protected settings key before authority access", async () => {
    let journalReads = 0;
    const h = harness({
      commandJournal: (real) => ({
        get(commandId) {
          journalReads += 1;
          return real.get(commandId);
        },
      }),
    });
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b65";
    const before = settingsAuthoritySnapshot(h, commandId);

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId,
        family: "settings",
        type: "apply-protected-settings",
        target: { expectedRevision: 1 },
        payload: {
          protectedSchemaHash: PROTECTED_SETTINGS_SCHEMA_HASH,
          writeId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b64",
          entries: { unknownProtectedName: { clear: true } },
        },
      }),
    });

    assert.equal(response.status, 422);
    assert.deepEqual(await json(response), {
      state: "rejected",
      commandId,
      code: "not-editable",
      message: "not-editable { key: unknownProtectedName }",
    });
    assert.equal(journalReads, 0);
    assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before);
  });

  it.each([[null], [[]], ["command"], [1]])("refuses a non-object command body (%j) without authority effects", async (body) => {
    const h = harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b70";
    const before = settingsAuthoritySnapshot(h, commandId);
    for (const [path, status, code] of [
      ["/api/v1/commands", 400, "SCHEMA_INVALID"],
      ["/api/v1/commands/bulk", 422, "schema-mismatch"],
    ] as const) {
      const response = await h.app.request(path, {
        method: "POST", headers: OPERATOR_JSON_HEADERS, body: JSON.stringify(body),
      });
      assert.equal(response.status, status, path);
      assert.equal((await json(response)).code, code, path);
      assert.deepEqual(settingsAuthoritySnapshot(h, commandId), before, path);
    }
  });

  it("stamps accepted command provenance from the server-owned operator session", async () => {
    const h = harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b78";
    const patch = { "browser.headless": { set: false } } as const;
    const acceptedAt = h.clock.now().toISOString();

    const response = await h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        commandId,
        requestedAt: "2020-01-01T00:00:00.000Z",
        requestedBy: "local-operator",
        source: "hostile-page",
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: deriveSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });

    assert.equal(response.status, 200);
    assert.equal((await json(response)).state, "applied");
    const expectedCommand = {
      commandId,
      requestedAt: acceptedAt,
      requestedBy: "local-operator",
      source: "dashboard",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    };
    assert.deepEqual(h.database.authority.commands.get(commandId), expectedCommand);
    assert.deepEqual(h.database.authority.commandAudits.findByCommand(commandId)?.request, expectedCommand);
    assert.equal(
      h.database.authority.settingsCurrent.get()?.commandFingerprint,
      createHash("sha256")
        .update("hrauto:settings-command:v1\0")
        .update(canonicalJsonStringify(expectedCommand))
        .digest("hex"),
    );
  });

  it("replays the first server-accepted canonical command after the clock advances", async () => {
    const h = harness();
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b77";
    const acceptedAt = h.clock.now().toISOString();
    const patch = { "browser.headless": { set: false } } as const;
    const command = {
      commandId,
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedBy: "local-operator",
      source: "hostile-page",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    };
    const request = () => h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: {
        host: "localhost",
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
    });
    assert.equal((await json(await request())).state, "applied");
    h.clock.advanceWall(1_000);

    const replay = await request();

    assert.equal(replay.status, 200);
    assert.equal((await json(replay)).state, "already-applied");
    assert.equal(h.database.authority.commands.get(commandId)?.requestedAt, acceptedAt);

    const accepted = h.database.authority.commands.get(commandId);
    const generationBeforeMismatch = h.database.getMeta().authorityGeneration;
    const mismatchedReplay = await h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ ...command, requestedBy: "other-operator" }),
    });
    assert.equal(mismatchedReplay.status, 403);
    assert.equal((await json(mismatchedReplay)).code, "REQUEST_IDENTITY_REFUSED");
    assert.deepEqual(h.database.authority.commands.get(commandId), accepted);
    assert.equal(h.database.getMeta().authorityGeneration, generationBeforeMismatch);
  });

  it("serializes concurrent acceptance of one command id around the server clock", async () => {
    let firstPrepareReached: (() => void) | undefined;
    const firstPrepare = new Promise<void>((resolve) => {
      firstPrepareReached = resolve;
    });
    let prepares = 0;
    const intake: IntakeService = {
      ...UNWIRED_INTAKE_SERVICE,
      async prepare(): Promise<void> {
        prepares += 1;
        if (prepares !== 1) return;
        firstPrepareReached?.();
        await new Promise<void>((resolve) => setImmediate(resolve));
      },
    };
    const h = harness({ intake });
    const commandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b75";
    const acceptedAt = h.clock.now().toISOString();
    const patch = { "browser.headless": { set: false } } as const;
    const command = {
      commandId,
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedBy: "local-operator",
      source: "hostile-page",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: SETTINGS_SCHEMA_HASH,
        patchFingerprint: deriveSettingsPatchFingerprint(patch),
        patch,
      },
    };
    const request = () => h.app.request("http://localhost/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify(command),
    });
    const first = request();
    await firstPrepare;
    h.clock.advanceWall(1_000);

    const responses = await Promise.all([first, request()]);

    assert.deepEqual(responses.map(({ status }) => status), [200, 200]);
    assert.deepEqual(
      await Promise.all(responses.map(async (response) => (await json(response)).state)),
      ["applied", "already-applied"],
    );
    assert.equal(h.database.authority.commands.get(commandId)?.requestedAt, acceptedAt);
  });

  it("refuses malformed and unavailable requests with typed wire errors", async () => {
    const h = harness();

    const badDay = await h.app.request("/api/v1/dashboard?day=today");
    assert.equal(badDay.status, 400);
    assert.equal((await json(badDay)).code, "SCHEMA_INVALID");

    const missingRun = await h.app.request(`/api/v1/runs/9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7a`);
    assert.equal(missingRun.status, 404);
    assert.equal((await json(missingRun)).code, "TARGET_NOT_FOUND");

    const badCommand = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ family: "start", type: "start-run" }),
    });
    assert.equal(badCommand.status, 400);

    const settingsCommandId = "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7b";
    const settingsPatch = { "browser.headless": { set: false } } as const;
    const mismatchedCommand = {
      commandId: settingsCommandId,
      requestedAt: h.clock.now().toISOString(),
      requestedBy: "local-operator",
      source: "settings-surface",
      family: "settings",
      type: "apply-settings",
      target: { expectedRevision: 1 },
      payload: {
        settingsSchemaHash: "a".repeat(64),
        patchFingerprint: deriveSettingsPatchFingerprint(settingsPatch),
        patch: settingsPatch,
      },
    };
    const settingsBefore = settingsAuthoritySnapshot(h, settingsCommandId);

    const mismatchedSettingsSchema = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify(mismatchedCommand),
    });
    assert.equal(mismatchedSettingsSchema.status, 422);
    const rejection = await json(mismatchedSettingsSchema);
    assert.equal(rejection.state, "rejected");
    assert.equal(rejection.code, "schema-mismatch");
    assert.deepEqual(
      settingsAuthoritySnapshot(h, settingsCommandId),
      settingsBefore,
      "a schema-mismatched settings command must leave file, prepare, current, journal, audit, and generations byte-exactly unchanged",
    );

    const unknownWorkflowPlan = await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ workflowId: "mystery-flow", submissions: [{}], dryRun: false }),
    });
    assert.equal(unknownWorkflowPlan.status, 404);

    const unknownRoute = await h.app.request("/api/v1/mystery");
    assert.equal(unknownRoute.status, 404);
    assert.equal((await json(unknownRoute)).code, "ROUTE_NOT_FOUND");

    const retiredCaptureRoute = await h.app.request("/api/v1/capture/phone/session");
    assert.equal(retiredCaptureRoute.status, 404);
    assert.equal((await json(retiredCaptureRoute)).code, "ROUTE_NOT_FOUND");

    const generationBeforeRetiredCommand = h.database.getMeta().authorityGeneration;
    const retiredCaptureCommand = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000098",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "dashboard",
        family: "capture",
        type: "capture-finalize",
        target: { captureSessionId: UUID_4, expectedVersion: 1 },
      }),
    });
    assert.equal(retiredCaptureCommand.status, 400);
    assert.equal((await json(retiredCaptureCommand)).code, "SCHEMA_INVALID");
    assert.equal(h.database.getMeta().authorityGeneration, generationBeforeRetiredCommand);

    const badTopics = await h.app.request("/events/v1?topics=everything");
    const badCursor = await h.app.request(`/events/v1?topics=dashboard-day:${DAY}`, {
      headers: { "last-event-id": "not-a-projection-cursor" },
    });
    assert.equal(badCursor.status, 400);
    const unboundGeneration = await h.app.request(`/events/v1?topics=dashboard-day:${DAY}`, {
      headers: { "dashboard-projection-generation": "7" },
    });
    assert.equal(unboundGeneration.status, 400);
    assert.equal(badTopics.status, 400);
  });

  it("refuses a command whose requested actor disagrees with BFF admission before authority changes", async () => {
    const h = harness();
    const commandId = "00000000-0000-4000-8000-000000000095";
    const patch = {
      "display.screenWidth": { set: 1980 },
      "display.screenHeight": { set: 1080 },
    } as const;

    const response = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId,
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "other-operator",
        source: "settings-surface",
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: 1 },
        payload: {
          settingsSchemaHash: SETTINGS_SCHEMA_HASH,
          patchFingerprint: deriveSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });

    assert.equal(response.status, 403);
    assert.equal((await json(response)).code, "REQUEST_IDENTITY_REFUSED");
    assert.equal(h.database.authority.commands.get(commandId), undefined);

    const preflightResponse = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000096",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "other-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: {
          expectedConfigFingerprint: "a".repeat(64),
          expectedDescriptorFingerprint: "b".repeat(64),
        },
      }),
    });
    assert.equal(preflightResponse.status, 403);
    assert.equal((await json(preflightResponse)).code, "REQUEST_IDENTITY_REFUSED");

    const bulkResponse = await h.app.request("/api/v1/commands/bulk", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000097",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "other-operator",
        source: "queue",
        family: "run",
        type: "cancel",
        bulkCommandId: "00000000-0000-4000-8000-000000000097",
        targets: [{ runId: UUID_4, expectedVersion: 1 }],
        mode: "best-effort",
      }),
    });
    assert.equal(bulkResponse.status, 403);
    assert.equal((await json(bulkResponse)).code, "REQUEST_IDENTITY_REFUSED");
  });

  it("crosses one request-identity checkpoint on every registered route and refuses before effects", async () => {
    let checkpointCalls = 0;
    const h = harness({
      requestIdentity: {
        identify: () => {
          checkpointCalls += 1;
          throw new RequestIdentityRefusedError("the request identity checkpoint refused this caller");
        },
      },
    });
    const generationBefore = h.database.getMeta().authorityGeneration;
    const materializePath = (path: string): string => path.replaceAll(/:[^/]+/gu, UUID_4);
    const routes = h.app.routes.filter((route) => route.method !== "ALL");

    assert.ok(routes.length > 0);
    for (const route of routes) {
      checkpointCalls = 0;
      const response = await h.app.request(materializePath(route.path), {
        method: route.method,
        ...(route.method === "GET" || route.method === "HEAD"
          ? {}
          : { headers: { "content-type": "application/json" }, body: "{}" }),
      });
      assert.equal(response.status, 403, `${route.method} ${route.path}`);
      assert.equal(checkpointCalls, 1, `${route.method} ${route.path}`);
      assert.equal((await json(response)).code, "REQUEST_IDENTITY_REFUSED");
    }

    checkpointCalls = 0;
    const unknownResponse = await h.app.request("/api/v1/not-registered");
    assert.equal(unknownResponse.status, 403);
    assert.equal(checkpointCalls, 1);
    assert.equal((await json(unknownResponse)).code, "REQUEST_IDENTITY_REFUSED");

    assert.equal(h.database.getMeta().authorityGeneration, generationBefore);
    const artifactRoot = join(h.stateRoot, "artifacts");
    assert.deepEqual(existsSync(artifactRoot) ? readdirSync(artifactRoot) : [], []);
    const inspection = new DatabaseSync(join(h.stateRoot, "state.db"), { readOnly: true });
    try {
      const row = inspection.prepare("SELECT count(*) AS count FROM generated_artifacts WHERE export_id IS NOT NULL").get();
      assert.equal(Reflect.get(row ?? {}, "count"), 0);
    } finally {
      inspection.close();
    }
  });

  it("serves the read-only storage doctor on demand (2i-D)", async () => {
    const h = harness();
    const response = await h.app.request("/api/v1/storage/doctor");
    assert.equal(response.status, 200);
    const report = StorageDoctorWireSchema.parse(await response.json());
    assert.equal(report.mode, "read-only");
    assert.equal(report.authority.state, "healthy");
    if (report.authority.state === "healthy") {
      assert.equal(report.authority.authorityGeneration, h.database.getMeta().authorityGeneration);
    }
    assert.equal(report.counts.state, "available");
    // The harness runs no backup lane: the on-disk truth is missing, and the
    // service arm says why in its own words rather than an inferred blank.
    assert.equal(report.backup.state, "missing");
    assert.deepEqual(report.spanAuthority, {
      state: "reconciled",
      liveRunCount: 0,
      streamRunCount: 0,
      archived: [],
      deleted: [],
    });
    assert.deepEqual(report.restoreCandidates, []);
    assert.deepEqual(report.service, {
      state: "never-run",
      reason: "the test harness runs no backup lane",
    });

    // The same summary reaches bootstrap: authority probed, backup indicator real.
    const boot = await json(await h.app.request("/api/v1/bootstrap"));
    const storage = boot.storage as { authority: string; backup: string };
    assert.equal(storage.authority, "healthy");
    assert.equal(storage.backup, "missing");
    const sections = boot.settingsSections as { id: string; label: string }[];
    // The LABEL is asserted with the id, because it is served here and rendered
    // verbatim by `buildSettingsNav` — the surface authors none of it. `Storage
    // health` is the demo's one name for the entry and the page it opens
    // (UF-SET-9); the two used to disagree because only the panel header was
    // ported (D276 item 4).
    assert.deepEqual(sections, [
      { id: "storage", label: "Storage checks", revision: 1 },
      { id: "workflow-capabilities", label: "Workflow capabilities", revision: 1 },
    ]);
  });

  it("serves a sanitized span-stream structural diagnosis through the real storage doctor", async () => {
    const h = harness();
    const run = RunRecordSchema.parse(personLookupQueuedRun({ runId: RUN_ID }));
    h.database.authority.runs.enqueue(run);
    createTimelineEmitter({ repository: h.database.authority.timelineEvents, clock: h.clock, pid: 4242 }).emit({
      t: "run.queued",
      kind: "run",
      ts: run.envelope.enqueuedAt,
      workflow: run.envelope.workflow,
      runId: run.envelope.runId,
      attempt: run.envelope.attempt,
      traceId: run.envelope.traceId,
      spanPath: `${run.envelope.traceId}/foreign-root`,
      itemId: run.envelope.itemId,
      shape: run.envelope.shape,
      priority: run.envelope.priority,
      dryRun: run.envelope.dryRun,
      actorId: "local-operator",
      title: "malformed root path fixture",
      descriptorVersion: run.envelope.descriptorVersion,
      contractFingerprint: run.envelope.contractFingerprint,
      resolvedInstance: run.envelope.resolvedInstance,
      configFingerprint: run.envelope.configFingerprint,
      configSnapshotId: run.envelope.configSnapshotId,
    });

    const response = await h.app.request("/api/v1/storage/doctor");

    assert.equal(response.status, 200);
    const report = StorageDoctorWireSchema.parse(await response.json());
    assert.equal(report.spanAuthority.state, "degraded");
    if (report.spanAuthority.state !== "degraded") throw new Error("span structural corruption must degrade the doctor wire");
    assert.deepEqual(report.spanAuthority.problems, [{
      state: "malformed",
      runId: run.envelope.runId,
      table: "span_stream",
      summary: "run.queued root spanPath does not equal traceId",
    }]);
  });

  it("reruns preflight through the closed read-only command and returns the exact report", async () => {
    const h = harness();
    const response = await h.app.request("/api/v1/preflight/rerun", {
      method: "POST",
      headers: { "content-type": "application/json", host: "127.0.0.1:3938" },
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000091",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        type: "rerun-preflight",
        target: {
          expectedConfigFingerprint: HASH_B,
        },
      }),
    });

    assert.equal(response.status, 200);
    const result = await json(response);
    assert.equal(result.state, "completed");
    assert.equal(result.commandId, "00000000-0000-4000-8000-000000000091");
    assert.deepEqual(
      (result.report as { results: { check: string }[] }).results.map(({ check }) => check),
      requiredPreflightChecks(["dashboard.serve"]),
    );
  });

  it("serves the resolver-owned editor inventory and reads the persisted settings revision back", async () => {
    const h = harness();
    const initial = EditableSettingsWireSchema.parse(await json(await h.app.request("/api/v1/settings/editable")));
    assert.equal(initial.revision, 1);
    assert.deepEqual(initial.sections.map((section) => section.id), ["general", "display", "performance", "paths", "routes", "annual-dates", "providers"]);
    const initialWidth = initial.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
    assert.equal(initialWidth?.source, "default");

    const patch = {
      "display.screenWidth": { set: 1980 },
      "display.screenHeight": { set: 1080 },
    } as const;
    const applied = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "00000000-0000-4000-8000-000000000096",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "settings-surface",
        family: "settings",
        type: "apply-settings",
        target: { expectedRevision: initial.revision },
        payload: {
          settingsSchemaHash: initial.settingsSchemaHash,
          patchFingerprint: deriveSettingsPatchFingerprint(patch),
          patch,
        },
      }),
    });
    assert.equal(applied.status, 200);
    const readback = EditableSettingsWireSchema.parse(await json(await h.app.request("/api/v1/settings/editable")));
    assert.equal(readback.revision, 2);
    const persistedWidth = readback.sections.flatMap((section) => section.leaves).find((leaf) => leaf.path === "display.screenWidth");
    assert.equal(persistedWidth?.source, "settings");
    assert.equal(persistedWidth?.effectiveValue, 1980);
    assert.equal(persistedWidth?.settingsValue, 1980);
  });

  it("refuses an unavailable run-detail section by name and serves failure only when real", async () => {
    const h = harness();
    const planResponse = await json(await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid: "10873698", mode: "read-only" }], dryRun: false }),
    }));
    const fingerprints = planResponse.fingerprints as Record<string, string>;
    const commandResponse = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7d",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "start-run",
        family: "start",
        type: "start-run",
        target: {
          workflowId: "fixture-graph",
          startPlanId: planResponse.startPlanId,
          expectedVersion: planResponse.expectedVersion,
        },
        payload: fingerprints,
      }),
    });
    const runId = singleAppliedRunId(CommandResultSchema.parse(await json(commandResponse)));

    const review = await h.app.request(`/api/v1/runs/${runId}/review`);
    assert.equal(review.status, 409);
    assert.equal((await json(review)).code, "SECTION_UNAVAILABLE");

    // A receipt states a SETTLED verdict, so a queued run's absence names the
    // state rather than a missing feature (D141).
    const receipt = await json(await h.app.request(`/api/v1/runs/${runId}/receipt`));
    assert.deepEqual(receipt.payload, {
      state: "missing",
      reason: "run is queued; a receipt states a settled verdict and this run has none yet",
    });

    const failure = await json(await h.app.request(`/api/v1/runs/${runId}/failure`));
    assert.equal((failure.payload as { state: string }).state, "missing");

    const attempts = await json(await h.app.request(`/api/v1/runs/${runId}/context-attempts`));
    const entries = (attempts.payload as { entries: { label: string; valueRedacted: string }[] }).entries;
    assert.deepEqual(entries[0], { label: "current-attempt", valueRedacted: "1" });
  });

  it("serves the Activity report over a NAMED range and refuses one the caller never named (D180)", async () => {
    const h = harness();
    const planResponse = await json(await h.app.request("/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid: "10873698", mode: "read-only" }], dryRun: false }),
    }));
    await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "9e8d7c6b-5a49-4382-9170-2f3e4d5c6b7e",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "start-run",
        family: "start",
        type: "start-run",
        target: {
          workflowId: "fixture-graph",
          startPlanId: planResponse.startPlanId,
          expectedVersion: planResponse.expectedVersion,
        },
        payload: planResponse.fingerprints,
      }),
    });

    const report = ActivityReportSelectionSchema.parse(
      await (await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`)).json(),
    );
    // The report is the SAME projection the day payload is served from, so the
    // route cannot hand back a total the dashboard would disagree with.
    const day = await json(await h.app.request(`/api/v1/dashboard?day=${DAY}`));
    assert.equal(report.totalRuns, (day.queueSurfaces as unknown[]).length);
    assert.deepEqual(report.days, [{ day: DAY, runs: 1 }]);
    assert.deepEqual(report.workflows, [{
      workflowId: "fixture-graph",
      registration: { state: "registered", label: "Fixture Graph", code: "fx", categoryId: "operations" },
      runs: 1,
      completion: { readBack: 0, warnings: 0, warningsUnknown: 0 },
      failed: 0, cancelled: 0, partial: 0, open: 1,
    }]);
    assert.equal(report.terminalRuns, 0);
    assert.equal(report.durations.medianMs.state, "absent");

    // A missing bound is never "today" or "this month": the route refuses and
    // says which parameters it needs, rather than answering a different
    // question than the link the operator followed asked.
    const halfRange = await h.app.request(`/api/v1/reports/activity?from=${DAY}`);
    assert.equal(halfRange.ok, false);
    assert.match(String((await json(halfRange)).message), /requires both from= and to=/);

    const noRange = await h.app.request("/api/v1/reports/activity");
    assert.equal(noRange.ok, false);
    assert.match(String((await json(noRange)).message), /requires both from= and to=/);

    // A malformed bound is refused by the wire schema, by name.
    const badBound = await h.app.request(`/api/v1/reports/activity?from=today&to=${DAY}`);
    assert.equal(badBound.status, 400);
    assert.equal((await json(badBound)).code, "SCHEMA_INVALID");

    // An inverted range never returns an empty report that reads as "no work".
    const inverted = await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=2026-08-01`);
    assert.equal(inverted.ok, false);
    assert.match(String((await json(inverted)).message), /ends before it starts/);
  });
  /**
   * D240 — the SAME report as a file. The route is tested for the two things
   * that make an export honest: it refuses a half-named window exactly as the
   * JSON route does (an export travels further than a page, so a silently
   * defaulted window would too), and the artifact carries the rules beside the
   * numbers.
   */
  it("serves the Activity report as a CSV that carries its own caveats (D240)", async () => {
    const h = harness();
    const activityReport = ActivityReportSelectionSchema.parse(
      await (await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`)).json(),
    );
    const report = h.projection.buildActivityReportWire(DAY, DAY);

    const response = await h.app.request(`/api/v1/reports/activity.csv?from=${DAY}&to=${DAY}&snapshot=${activityReport.snapshot.token}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/csv; charset=utf-8");
    assert.equal(
      response.headers.get("content-disposition"),
      `attachment; filename="activity-${DAY}_${DAY}.csv"`,
    );
    const csv = await response.text();
    // The bytes are the builder's, so the route cannot serve a second rendering.
    assert.equal(csv, activityReportCsv(report));
    // Every rule the panel shows behind its ⓘ is IN the file, verbatim.
    for (const caveat of activityReportCaveats(report)) {
      assert.ok(csv.includes(caveat.includes(",") ? `"${caveat}"` : caveat), `the export carries: ${caveat}`);
    }
    assert.ok(csv.includes(`Window from,${DAY}`));
    assert.ok(csv.includes("Write ledger — what was actually filed"));

    const halfRange = await h.app.request(`/api/v1/reports/activity.csv?from=${DAY}&snapshot=${activityReport.snapshot.token}`);
    assert.equal(halfRange.ok, false);
    assert.match(String((await json(halfRange)).message), /requires both from= and to=/);

    const noRange = await h.app.request("/api/v1/reports/activity.csv");
    assert.equal(noRange.ok, false);
    assert.match(String((await json(noRange)).message), /requires both from= and to=/);

    const inverted = await h.app.request(`/api/v1/reports/activity.csv?from=${DAY}&to=2026-08-01&snapshot=${activityReport.snapshot.token}`);
    assert.equal(inverted.ok, false);
    assert.match(String((await json(inverted)).message), /ends before it starts/);
  });

  it("serves one dedicated XLSX download only after its exact evidence is durable", async () => {
    const h = harness();
    const activityReport = ActivityReportSelectionSchema.parse(
      await (await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`)).json(),
    );

    const response = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        requestVersion: 3,
        selection: { kind: "activity", from: DAY, to: DAY, snapshotToken: activityReport.snapshot.token },
      }),
    });

    assert.equal(response.status, 200);
    const exportId = response.headers.get("x-operator-export-id");
    assert.ok(exportId);
    const evidence = h.database.authority.operatorXlsxExports.get(exportId);
    assert.ok(evidence);
    assert.equal(evidence.workbookVersion, 3);
    assert.equal(evidence.requestedBy, "local-operator");
    assert.equal(response.headers.get("content-type"), evidence.download.mediaType);
    assert.equal(response.headers.get("content-disposition"), evidence.download.contentDisposition);
    assert.equal(response.headers.get("content-length"), String(evidence.download.byteLength));
    assert.equal(response.headers.get("etag"), `"${evidence.download.sha256}"`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.byteLength, evidence.download.byteLength);
    assert.equal(createHash("sha256").update(bytes).digest("hex"), evidence.download.sha256);

    const genericRead = await h.app.request(`/artifacts/v1/${evidence.artifact.id}`);
    assert.equal(genericRead.status, 404);

    const malformed = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        requestVersion: 3,
        selection: { kind: "activity", from: DAY, to: DAY, snapshotToken: activityReport.snapshot.token, latest: true },
      }),
    });
    assert.equal(malformed.status, 400);
    assert.equal((await json(malformed)).code, "SCHEMA_INVALID");

    const smuggledActor = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        requestVersion: 3,
        requestedBy: "other-operator",
        selection: { kind: "activity", from: DAY, to: DAY, snapshotToken: activityReport.snapshot.token },
      }),
    });
    assert.equal(smuggledActor.status, 400);
    assert.equal((await json(smuggledActor)).code, "SCHEMA_INVALID");
  });

  it.each([
    {
      label: "foreign Origin",
      headers: { ...OPERATOR_JSON_HEADERS, origin: "https://hostile.example" },
      status: 403,
      code: "OPERATOR_MUTATION_ORIGIN_REFUSED",
    },
    {
      label: "simple text/plain media type",
      headers: { ...OPERATOR_JSON_HEADERS, "content-type": "text/plain" },
      status: 415,
      code: "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED",
    },
  ])("refuses XLSX $label before durable effects", async ({ headers, status, code }) => {
    const h = harness();
    const activityReport = ActivityReportSelectionSchema.parse(
      await (await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`)).json(),
    );
    const before = h.database.getMeta();
    const response = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers,
      body: JSON.stringify({
        requestVersion: 3,
        selection: { kind: "activity", from: DAY, to: DAY, snapshotToken: activityReport.snapshot.token },
      }),
    });
    assert.equal(response.status, status);
    assert.equal((await json(response)).code, code);
    assert.deepEqual(h.database.getMeta(), before);
  });

  it("exports every page of one real signed cross-date search selection as evidenced XLSX", async () => {
    const h = harness();
    insertMeasuredSearchRun(h.database, { seed: 201, enqueuedAt: "2026-08-28T15:00:00.000Z" });
    insertMeasuredSearchRun(h.database, { seed: 202, enqueuedAt: "2026-08-28T14:00:00.000Z" });

    const firstSearch = await h.app.request("/api/v1/search?q=separations&scope=workflow&limit=1");
    assert.equal(firstSearch.status, 200);
    const selectionPage = CrossDateSearchPageSchema.parse(await firstSearch.json());
    assert.equal(selectionPage.totalMatches, 2);
    assert.equal(selectionPage.results.length, 1);
    assert.equal(selectionPage.nextCursor.state, "present");

    const response = await h.app.request("/api/v1/exports/xlsx", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        requestVersion: 3,
        selection: {
          kind: "search",
          query: { q: "separations", scope: "workflow", facets: {}, limit: 1 },
          snapshot: {
            generatedAt: selectionPage.generatedAt,
            authorityGeneration: selectionPage.snapshot.authorityGeneration,
            order: selectionPage.snapshot.order,
            token: selectionPage.snapshot.token,
          },
        },
      }),
    });

    assert.equal(response.status, 200);
    const exportId = response.headers.get("x-operator-export-id");
    assert.ok(exportId);
    const evidence = h.database.authority.operatorXlsxExports.get(exportId);
    assert.ok(evidence);
    assert.equal(evidence.workbookVersion, 3);
    assert.equal(evidence.requestedBy, "local-operator");
    assert.equal(evidence.selection.kind, "search");
    assert.equal(evidence.workbook.rowCount, 2);
    assert.equal(response.headers.get("content-type"), evidence.download.mediaType);
    assert.equal(response.headers.get("content-length"), String(evidence.download.byteLength));
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(createHash("sha256").update(bytes).digest("hex"), evidence.download.sha256);
    const workbook = await readXlsxFile(bytes);
    assert.deepEqual(workbook.map(({ sheet }) => sheet), ["Read Me", "Runs"]);
    assert.equal(workbook[1]?.data.length, 3);
  });

  it("executes a bulk cancel as N CAS-bound children and answers the per-run vector (D235)", async () => {
    const h = harness();

    // Three real runs through the real plan -> start doors, one per subject.
    const startRun = async (eid: string, commandId: string): Promise<string> => {
      const planResponse = await h.app.request("/api/v1/start-plans", {
        method: "POST",
        headers: OPERATOR_JSON_HEADERS,
        body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid, mode: "read-only" }], dryRun: false }),
      });
      assert.equal(planResponse.status, 200);
      const plan = await json(planResponse);
      const fingerprints = plan.fingerprints as Record<string, string>;
      const started = await h.app.request("/api/v1/commands", {
        method: "POST",
        headers: OPERATOR_JSON_HEADERS,
        body: JSON.stringify({
          commandId,
          requestedAt: h.clock.now().toISOString(),
          requestedBy: "local-operator",
          source: "start-run",
          family: "start",
          type: "start-run",
          target: { workflowId: "fixture-graph", startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion },
          payload: {
            descriptorFingerprint: fingerprints.descriptorFingerprint,
            configFingerprint: fingerprints.configFingerprint,
            ingressSchemaHash: fingerprints.ingressSchemaHash,
            canonicalInputSchemaHash: fingerprints.canonicalInputSchemaHash,
            inputFingerprint: fingerprints.inputFingerprint,
          },
        }),
      });
      return singleAppliedRunId(CommandResultSchema.parse(await json(started)));
    };
    const runA = await startRun("10873698", "1a000000-0000-4000-8000-000000000001");
    const runB = await startRun("10002296", "1a000000-0000-4000-8000-000000000002");
    const runC = await startRun("10873700", "1a000000-0000-4000-8000-000000000003");
    const runD = await startRun("10873701", "1a000000-0000-4000-8000-000000000005");
    const versionOf = (runId: string): number => {
      const run = h.database.authority.runs.get(runId);
      assert.notEqual(run, undefined, `run ${runId} exists in authority`);
      return (run as { version: number }).version;
    };

    // runC is cancelled up front so its bulk child exercises the REFUSED arm
    // through the same kernel precondition a single press would hit.
    const soloCancel = await h.app.request("/api/v1/commands", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body: JSON.stringify({
        commandId: "1a000000-0000-4000-8000-000000000004",
        requestedAt: h.clock.now().toISOString(),
        requestedBy: "local-operator",
        source: "queue",
        family: "run",
        type: "cancel",
        target: { runId: runC, expectedVersion: versionOf(runC) },
      }),
    });
    assert.equal((await json(soloCancel)).state, "applied");

    // Whole-request refusals reach NO target: an empty batch, a duplicated
    // target, and the all-or-none mode this runtime deliberately refuses.
    const envelope = {
      commandId: "1a000000-0000-4000-8000-00000000000b",
      requestedAt: "2020-01-01T00:00:00.000Z",
      requestedBy: "local-operator",
      source: "hostile-page",
      family: "run",
      type: "cancel",
      bulkCommandId: "1a000000-0000-4000-8000-00000000000b",
      mode: "best-effort",
    } as const;
    const postBulk = async (body: unknown): Promise<{ status: number; payload: Record<string, unknown> }> => {
      const response = await h.app.request("/api/v1/commands/bulk", {
        method: "POST",
        headers: OPERATOR_JSON_HEADERS,
        body: JSON.stringify(body),
      });
      return { status: response.status, payload: await json(response) };
    };

    const empty = await postBulk({ ...envelope, targets: [] });
    assert.equal(empty.status, 422);
    assert.equal(empty.payload.state, "refused");
    assert.equal(empty.payload.code, "schema-mismatch");

    const duplicated = await postBulk({
      ...envelope,
      commandId: "1a000000-0000-4000-8000-00000000000c",
      bulkCommandId: "1a000000-0000-4000-8000-00000000000c",
      targets: [{ runId: runA, expectedVersion: 1 }, { runId: runA, expectedVersion: 1 }],
    });
    assert.equal(duplicated.payload.state, "refused");
    assert.match(String(duplicated.payload.message), /more than once/);

    const allOrNone = await postBulk({
      ...envelope,
      commandId: "1a000000-0000-4000-8000-00000000000d",
      bulkCommandId: "1a000000-0000-4000-8000-00000000000d",
      mode: "all-or-none",
      targets: [{ runId: runA, expectedVersion: 1 }],
    });
    assert.equal(allOrNone.payload.state, "refused");
    assert.equal(allOrNone.payload.code, "capability-unavailable");
    assert.match(String(allOrNone.payload.message), /Nothing was\s+attempted/);

    // The mixed vector: one applied, one conflict (stale version, with the
    // server's currentVersion), one refused by the kernel's own precondition.
    const bulkBody = {
      ...envelope,
      targets: [
        { runId: runA, expectedVersion: versionOf(runA) },
        { runId: runB, expectedVersion: 999 },
        { runId: runC, expectedVersion: versionOf(runC) },
      ],
    };
    const first = await postBulk(bulkBody);
    assert.equal(first.status, 200);
    assert.equal(first.payload.state, "vector");
    assert.equal(first.payload.requestedCount, 3);
    const results = first.payload.results as Record<string, unknown>[];
    assert.deepEqual(results.map(({ outcome }) => outcome), ["applied", "conflict", "refused"]);
    assert.equal(results[0].runId, runA);
    assert.equal(results[0].replayed, false);
    assert.equal(results[1].runId, runB);
    assert.equal(results[1].currentVersion, versionOf(runB), "conflict carries the server's own current version");
    assert.equal(results[2].runId, runC);
    assert.equal(typeof results[2].code, "string");
    const childIds = new Set(results.map(({ commandId }) => commandId));
    assert.equal(childIds.size, 3, "each target's child command has its own derived identity");
    const acceptedChild = h.database.authority.commands.get(String(results[0].commandId));
    assert.equal(acceptedChild?.requestedAt, h.clock.now().toISOString());
    assert.equal(acceptedChild?.requestedBy, "local-operator");
    assert.equal(acceptedChild?.source, "dashboard");
    const acceptedParent = h.database.authority.commands.getBulk(envelope.bulkCommandId);
    assert.notEqual(acceptedParent, undefined);
    assert.equal(h.database.authority.commands.parentId(String(results[0].commandId)), envelope.bulkCommandId);
    assert.equal(h.database.authority.commands.parentId(String(results[1].commandId)), undefined);
    assert.equal(h.database.authority.commands.parentId(String(results[2].commandId)), undefined);
    assert.equal(h.database.authority.commandAudits.findByCommand(envelope.bulkCommandId), undefined);

    assert.deepEqual(acceptedParent?.request.targets, bulkBody.targets);
    assert.equal(acceptedParent?.request.requestedAt, h.clock.now().toISOString());
    assert.equal(acceptedParent?.request.requestedBy, "local-operator");
    assert.equal(acceptedParent?.request.source, "dashboard");

    // Re-delivering the SAME bulk envelope replays the applied child rather
    // than filing a second cancel: the child ids are derived, not minted.
    h.clock.advanceWall(1_000);
    const replay = await postBulk(bulkBody);
    assert.equal(replay.payload.state, "vector");
    const replayed = replay.payload.results as Record<string, unknown>[];
    assert.deepEqual(replayed.map(({ outcome }) => outcome), ["applied", "conflict", "refused"]);
    assert.equal(replayed[0].replayed, true, "the applied child is answered from the journal, not re-executed");
    assert.equal(replayed[0].commandId, results[0].commandId);
    assert.deepEqual(
      h.database.authority.commands.getBulk(envelope.bulkCommandId),
      acceptedParent,
      "exact replay reuses the byte-exact accepted parent and its original accepted time",
    );

    const snapshot = (): unknown => ({
      generation: h.database.getMeta().authorityGeneration,
      parent: h.database.authority.commands.getBulk(envelope.bulkCommandId),
      runs: [runA, runB, runC, runD].map((runId) => h.database.authority.runs.get(runId)),
      children: [runA, runB, runC, runD].map((runId) => {
        const childId = deriveBulkChildCommandId(envelope.bulkCommandId, runId);
        return {
          command: h.database.authority.commands.get(childId),
          audit: h.database.authority.commandAudits.findByCommand(childId),
        };
      }),
    });
    const simultaneous = await Promise.all([postBulk(bulkBody), postBulk(bulkBody)]);
    assert.ok(simultaneous.every((response) => response.payload.state === "vector"));
    assert.ok(simultaneous.every((response) => (response.payload.results as Record<string, unknown>[])[0].replayed === true));
    const identityBefore = snapshot();
    for (const commandId of [envelope.bulkCommandId, String(results[0].commandId)]) {
      const response = await h.app.request("/api/v1/commands", { method: "POST", headers: OPERATOR_JSON_HEADERS,
        body: JSON.stringify({ commandId, family: "run", type: "cancel", target: bulkBody.targets[0] }) });
      const refusal = await json(response);
      assert.equal(refusal.state, "rejected");
      assert.equal(refusal.code, "command-divergent");
    }
    const bulkIdentityRefusal = await postBulk({ ...bulkBody, bulkCommandId: String(results[0].commandId) });
    assert.equal(bulkIdentityRefusal.payload.state, "refused");
    assert.equal(bulkIdentityRefusal.payload.code, "command-divergent");
    assert.deepEqual(snapshot(), identityBefore);
    const beforeConcurrent = snapshot();
    const divergentConcurrent = await Promise.all([postBulk(bulkBody), postBulk({ ...bulkBody, reason: "different selection reason" })]);
    assert.equal(divergentConcurrent[0].payload.state, "vector");
    assert.equal(divergentConcurrent[1].payload.state, "refused");
    assert.deepEqual(snapshot(), beforeConcurrent);
    const divergentReplays = [
      { label: "changes operation", body: { ...bulkBody, type: "retry" } },
      { label: "changes mode", body: { ...bulkBody, mode: "all-or-none" } },
      { label: "changes reason", body: { ...bulkBody, reason: "different selection reason" } },
      {
        label: "adds an old+new target",
        body: {
          ...bulkBody,
          targets: [...bulkBody.targets, { runId: runD, expectedVersion: versionOf(runD) }],
        },
      },
      {
        label: "omits an accepted target",
        body: { ...bulkBody, targets: bulkBody.targets.slice(0, -1) },
      },
      {
        label: "reorders the accepted targets",
        body: { ...bulkBody, targets: [...bulkBody.targets].reverse() },
      },
      {
        label: "changes one accepted child",
        body: {
          ...bulkBody,
          targets: [
            { ...bulkBody.targets[0], expectedVersion: bulkBody.targets[0].expectedVersion + 1 },
            ...bulkBody.targets.slice(1),
          ],
        },
      },
    ] as const;
    for (const divergent of divergentReplays) {
      const before = snapshot();
      const refusal = await postBulk(divergent.body);
      assert.equal(refusal.status, 422, divergent.label);
      assert.equal(refusal.payload.state, "refused", divergent.label);
      assert.equal(refusal.payload.code, "schema-mismatch", divergent.label);
      assert.deepEqual(snapshot(), before, `${divergent.label} has byte-exact zero child effects`);
    }

    const runG = await startRun("10873704", "1a000000-0000-4000-8000-000000000008");
    const concurrentBody = { ...envelope, commandId: "1a000000-0000-4000-8000-00000000000f", bulkCommandId: "1a000000-0000-4000-8000-00000000000f", targets: [{ runId: runG, expectedVersion: versionOf(runG) }] };
    const concurrentNew = await Promise.all([postBulk(concurrentBody), postBulk(concurrentBody), postBulk({ ...concurrentBody, reason: "divergent concurrent acceptance" })]);
    assert.deepEqual(concurrentNew.map(({ payload }) => payload.state), ["vector", "vector", "refused"]);
    assert.equal((concurrentNew[0].payload.results as Record<string, unknown>[])[0].replayed, false);
    assert.equal((concurrentNew[1].payload.results as Record<string, unknown>[])[0].replayed, true);

    // Fail the second real child inside its command/audit transaction. Prior success
    // remains durable, the failed child rolls back, and the third is never attempted.
    const runE = await startRun("10873702", "1a000000-0000-4000-8000-000000000006");
    const runF = await startRun("10873703", "1a000000-0000-4000-8000-000000000007");
    const failureBody = { ...envelope, commandId: "1a000000-0000-4000-8000-00000000000e", bulkCommandId: "1a000000-0000-4000-8000-00000000000e", targets: [runD, runE, runF].map((runId) => ({ runId, expectedVersion: versionOf(runId) })) };
    const failId = deriveBulkChildCommandId(failureBody.bulkCommandId, runE);
    const raw = new DatabaseSync(join(h.stateRoot, "state.db"));
    try {
      raw.exec(`CREATE TRIGGER synthetic_child_failure BEFORE INSERT ON command_audits WHEN NEW.command_id = '${failId}' BEGIN SELECT RAISE(ABORT, 'synthetic-child-audit-failure'); END`);
      const failure = await postBulk(failureBody);
      assert.equal(failure.payload.requestedCount, 3);
      assert.deepEqual((failure.payload.results as Record<string, unknown>[]).map(({ outcome }) => outcome), ["applied", "errored"]);
      assert.equal(h.database.authority.commands.get(failId), undefined);
      assert.equal(h.database.authority.commands.get(deriveBulkChildCommandId(failureBody.bulkCommandId, runF)), undefined);
      assert.equal(versionOf(runE), failureBody.targets[1].expectedVersion);
      raw.exec("DROP TRIGGER synthetic_child_failure");
      const resumed = await postBulk(failureBody);
      const outcomes = resumed.payload.results as Record<string, unknown>[];
      assert.deepEqual(outcomes.map(({ outcome }) => outcome), ["applied", "applied", "applied"]);
      assert.equal(outcomes[0].replayed, true);
      assert.equal(outcomes[1].replayed, false);
      assert.equal(outcomes[2].replayed, false);
    } finally { raw.close(); }

  });
  /**
   * The remaining browser-reachable POSTs (ref frontend-backend-integration §3.4 admission table):
   * a start plan persists durable authority, an intake upload creates or joins a
   * session with bytes, Explorer validation reconciles authority claims, and the
   * advisory spends a constrained provider. A hostile page can reach loopback
   * with a simple no-CORS POST and a JSON-shaped `text/plain` body that
   * `c.req.json()` parses anyway, so the Host/Origin pair must refuse BEFORE a
   * byte of body, query, authority or provider is touched.
   */
  const FOREIGN_ORIGIN_CASES = [
    ["missing Origin", { host: "localhost" }],
    ["foreign Origin", { host: "localhost", origin: "https://hostile.example" }],
    ["malformed Origin", { host: "localhost", origin: "not an origin" }],
    ["Host-mismatched Origin", { host: "localhost:3938", origin: "http://127.0.0.1:3938" }],
    ["non-loopback Host", { host: "attacker.example", origin: "http://attacker.example" }],
  ] as const;

  it.each(FOREIGN_ORIGIN_CASES)(
    "refuses a start plan with %s before the planner or the body is touched",
    async (_label, headers) => {
      let plans = 0;
      const h = harness({
        startPlans: (real) => ({ ...real, plan: (input) => { plans += 1; return real.plan(input); } }),
      });
      const request = new Request("http://localhost/api/v1/start-plans", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ workflowId: "fixture-graph", submissions: [{ eid: "10873698", mode: "read-only" }] }),
      });
      const reads = (["json", "text", "arrayBuffer", "blob", "formData"] as const)
        .map((method) => vi.spyOn(request, method));

      const response = await h.app.request(request);

      assert.equal(response.status, 403);
      assert.equal((await json(response)).code, "OPERATOR_MUTATION_ORIGIN_REFUSED");
      for (const read of reads) expect(read).not.toHaveBeenCalled();
      assert.equal(request.bodyUsed, false);
      assert.equal(plans, 0);
    },
  );

  it("refuses a start plan whose JSON body rides text/plain, and admits the same body as JSON", async () => {
    let plans = 0;
    const h = harness({
      startPlans: (real) => ({ ...real, plan: (input) => { plans += 1; return real.plan(input); } }),
    });
    const body = JSON.stringify({
      workflowId: "fixture-graph",
      submissions: [{ eid: "10873698", mode: "read-only" }],
      dryRun: false,
      browserMode: "headed",
    });
    const refused = await h.app.request("http://localhost/api/v1/start-plans", {
      method: "POST",
      headers: { ...OPERATOR_JSON_HEADERS, "content-type": "text/plain" },
      body,
    });
    assert.equal(refused.status, 415);
    assert.equal((await json(refused)).code, "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED");
    assert.equal(plans, 0);

    const admitted = await h.app.request("http://localhost/api/v1/start-plans", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body,
    });
    assert.equal(admitted.status, 200);
    assert.equal(plans, 1);
  });

  it.each(FOREIGN_ORIGIN_CASES)(
    "refuses an intake upload with %s before the query, the bytes or the intake service are read",
    async (_label, headers) => {
      let uploads = 0;
      const h = harness({
        intake: {
          ...UNWIRED_INTAKE_SERVICE,
          upload: () => {
            uploads += 1;
            return Promise.resolve({ state: "refused" as const, code: "unreadable-file" as const, message: "unreachable" });
          },
        },
      });
      const request = new Request("http://localhost/api/v1/intake/files?workflow=fixture-graph&filename=roster.csv", {
        method: "POST",
        headers: { ...headers, "content-type": "text/csv" },
        body: "eid\n10873698\n",
      });
      const reads = (["json", "text", "arrayBuffer", "blob", "formData"] as const)
        .map((method) => vi.spyOn(request, method));

      const response = await h.app.request(request);

      assert.equal(response.status, 403);
      assert.equal((await json(response)).code, "OPERATOR_MUTATION_ORIGIN_REFUSED");
      for (const read of reads) expect(read).not.toHaveBeenCalled();
      assert.equal(request.bodyUsed, false);
      assert.equal(uploads, 0);
    },
  );

  it("admits a same-origin intake upload under the file's own media type and keeps the route's media contract", async () => {
    const seen: string[] = [];
    const h = harness({
      intake: {
        ...UNWIRED_INTAKE_SERVICE,
        upload: (input) => {
          seen.push(`${input.workflow}|${input.fileName}|${input.mediaType}|${String(input.bytes.byteLength)}`);
          return Promise.resolve({ state: "refused" as const, code: "unreadable-file" as const, message: "the fixture intake accepts nothing" });
        },
      },
    });
    const response = await h.app.request("http://localhost/api/v1/intake/files?workflow=fixture-graph&filename=roster.csv", {
      method: "POST",
      headers: { host: "localhost", origin: "http://localhost", "content-type": "text/csv" },
      body: "eid\n10873698\n",
    });
    // Admitted (not 403/415): the intake service's own refusal answers, under
    // the route's typed intake code — the loopback door never requires JSON here.
    assert.equal(response.status, 422);
    assert.equal((await json(response)).code, "INTAKE_UNREADABLE_FILE");
    assert.deepEqual(seen, ["fixture-graph|roster.csv|text/csv|13"]);
  });

  it.each(FOREIGN_ORIGIN_CASES)(
    "refuses Explorer validation with %s before its authority is consulted",
    async (_label, headers) => {
      const h = harness();
      const request = new Request("http://localhost/api/v1/explorer/validate", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ workflowId: "fixture-graph" }),
      });
      const reads = (["json", "text", "arrayBuffer", "blob", "formData"] as const)
        .map((method) => vi.spyOn(request, method));
      const response = await h.app.request(request);
      // 403 rather than the harness's "Explorer authority is not composed"
      // unavailability: admission wins before the handler runs at all.
      assert.equal(response.status, 403);
      assert.equal((await json(response)).code, "OPERATOR_MUTATION_ORIGIN_REFUSED");
      for (const read of reads) expect(read).not.toHaveBeenCalled();
      assert.equal(request.bodyUsed, false);
    },
  );
  it("keeps Explorer validation on the JSON door: text/plain refuses, same-origin JSON reaches the seam", async () => {
    const seen: unknown[] = [];
    const h = harness({
      explorerEdits: {
        validate: (input) => {
          seen.push(input);
          return { state: "conflict", code: "revision-stale", message: "fixture conflict" } as never;
        },
      },
    });
    const body = JSON.stringify({ workflowId: "fixture-graph" });
    const refused = await h.app.request("http://localhost/api/v1/explorer/validate", {
      method: "POST",
      headers: { ...OPERATOR_JSON_HEADERS, "content-type": "text/plain" },
      body,
    });
    assert.equal(refused.status, 415);
    assert.equal((await json(refused)).code, "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED");
    assert.deepEqual(seen, []);

    const admitted = await h.app.request("http://localhost/api/v1/explorer/validate", {
      method: "POST",
      headers: OPERATOR_JSON_HEADERS,
      body,
    });
    assert.equal(admitted.status, 409);
    assert.deepEqual(seen, [{ workflowId: "fixture-graph" }]);
  });

  it("serves /events/v1 through the demand-driven bridge: an unread client is bounded to one reset-required and cancel closes the hub connection", async () => {
    const h = harness({ maxPending: 2 });
    const response = await h.app.request(`http://localhost/events/v1?topics=dashboard-day:${DAY}`, {
      headers: { host: "localhost" },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.ok(response.body);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const parse = (text: string): DashboardStreamEnvelope[] => text.split("\n\n")
      .filter((block) => block.includes("data: "))
      .map((block) => DashboardStreamEnvelopeSchema.parse(JSON.parse(
        block.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n"),
      )));
    const initial: DashboardStreamEnvelope[] = [];
    while (initial.length < 3) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      initial.push(...parse(decoder.decode(chunk.value, { stream: true })));
    }
    assert.deepEqual(initial.map(({ type }) => type), ["hello", "snapshot", "health"]);
    assert.equal(h.hub.subscriberCount(), 1);

    // Six count-bearing changes while nobody reads: an eager push loop would
    // deliver six snapshots; the bounded bridge delivers at most what its
    // highWaterMark already pulled, then exactly one reset-required.
    const runs = Array.from({ length: 6 }, (_, index) => {
      const runId = `9e8d7c6b-5a49-4382-9170-2f3e4d5c6c0${String(index)}`;
      h.database.authority.runs.enqueue(personLookupQueuedRun({
        runId,
        itemId: `3333333${String(index)}-3333-4333-8333-333333333333`,
      }));
      const record = h.database.authority.runs.get(runId);
      if (record === undefined) assert.fail(`run ${runId} did not enqueue`);
      return record;
    });
    projectCurrentSeparationsRuns(h, runs);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const live: DashboardStreamEnvelope[] = [];
    while (!live.some(({ type }) => type === "reset-required")) {
      const chunk = await reader.read();
      assert.equal(chunk.done, false);
      live.push(...parse(decoder.decode(chunk.value, { stream: true })));
    }
    assert.equal(live.filter(({ type }) => type === "reset-required").length, 1);
    assert.equal(live.at(-1)?.type, "reset-required");
    assert.ok(live.filter(({ type }) => type === "snapshot").length < runs.length, "the bound must have collapsed most snapshots");

    await reader.cancel();
    assert.equal(h.hub.subscriberCount(), 0);
  });
});
