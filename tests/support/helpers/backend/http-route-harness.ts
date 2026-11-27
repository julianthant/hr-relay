import { createItemAttemptHistoryQuery } from "../../../../src/backend/runs/queries/item-attempt-history.js";
import { createWorkerCommandResultQuery } from "../../../../src/backend/runs/queries/worker-command-result.js";
import { createPreflightReportService } from "../../../../src/backend/runtime/preflight/report-service.js";
import { AUTHORITY_DERIVED_TABLES } from "../../../../src/models/config/authority.js";
import { resolveWriteCommandTarget } from "../../../../src/backend/runs/commands/write-command-target.js";
import { unusedWorkerPool } from "./unused-worker-pool.js";
import { unexpectedWorkbookSync } from "./workbook-sync.js";
import { createWorkbookLibraryService, type WorkbookSyncDownload } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { createIntakeCommandResultQuery } from "../../../../src/backend/runs/queries/intake-command-result.js";
import { composeActivity } from "../../../../src/backend/app/composition/dashboard/activity.js";
import { createComposedDashboardReadHost } from "../../../../src/backend/app/composition/dashboard/runtime-resources.js";
import { queryAssistantUsage } from "../../../../src/backend/assistant/usage-counts.js";
import { runQueuedSpanEvent } from "../../../../src/backend/runs/commands/run-queued-span.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createProtectedSettingsRuntimeReader } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { createBoundProfileFixture, boundProfileCredentials, type BoundProfileStorageFixture } from "../admission-fixture.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import { ActorIdSchema as PublicationActorIdSchema, ConfigSnapshotIdSchema } from "../../../../src/rules/identity/ids.js";
import { seedInitialSettingsRuntimeConfig } from "../../fixtures/operator-command-fixtures.js";
import { sqliteRunReader } from "../canonical-run-reader.js";

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync,readFileSync,writeFileSync } from "node:fs";
import { request } from "node:http";
import { dirname,join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { descriptorSetHash } from "../../../../src/backend/app/registries/workflow-registry.js";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { createDiagnosticCaptureService } from "../../../../src/backend/logs/diagnostics/diagnostic-capture.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { createDashboardCommandService } from "../../../../src/backend/runs/commands/command-service.js";
import type { IntakeService } from "../../../../src/backend/runs/commands/intake-service.js";
import { createSettingsApplicationExecutor } from "../../../../src/backend/runs/commands/settings-service.js";
import { createStartPlanService,type StartPlanService } from "../../../../src/backend/runs/commands/start-plan-service.js";
import { createOperatorXlsxExportService } from "../../../../src/backend/runs/exports/operator-xlsx-export-service.js";
import { createRunQueueProjection } from "../../../../src/backend/runs/projections/run-queue-projection.js";
import type { ArtifactBytesQueryDeps } from "../../../../src/backend/runs/queries/artifact-bytes.js";
import type { DiagnosticBundleQueryDeps } from "../../../../src/backend/runs/queries/diagnostic-bundle.js";
import { createCrossDateSearchService } from "../../../../src/backend/runs/queries/search.js";
import { readRunPanel } from "../../../../src/backend/runs/queries/run-detail.js";
import { buildSettingsEditor } from "../../../../src/backend/runs/queries/settings-editor.js";
import { createReceiptService } from "../../../../src/backend/runs/trust/receipt-service.js";
import { readSettings } from "../../../../src/backend/runtime/settings/settings-runtime.js";
import { createContentAddressedArtifactWriter } from "../../../../src/backend/storage/artifacts/content-addressed-artifact-writer.js";
import { createServerVerifiedArtifactReader,type ServerVerifiedArtifactReader } from "../../../../src/backend/storage/artifacts/server-verified-artifact-reader.js";
import { createNoteTimelineWriter } from "../../../../src/backend/storage/events/note-timeline-writer.js";
import { createTimelineEmitter } from "../../../../src/backend/storage/events/timeline-emitter.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { type DashboardHttpServer } from "../../../../src/backend/transports/http/http-server.js";
import type { RequestIdentityCheckpoint } from "../../../../src/backend/transports/http/request-identity.js";
import { createSoloRequestIdentityCheckpoint } from "../../../../src/backend/transports/http/request-identity.js";
import { createDashboardApp,type DashboardAppDeps } from "../../../../src/backend/transports/http/routes/api.js";
import { createDashboardStreamHub,type DashboardStreamHub, type DashboardStreamHubDeps } from "../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import type { ArtifactRef } from "../../../../src/models/artifacts/artifacts.js";
import { initialSettingsFileRecord,settingsRuntimeIdentity } from "../../../../src/models/config/settings.js";
import { ActivityReportSelectionSchema } from "../../../../src/models/dashboard/activity-selection.js";
import { type PreflightDeadlineScheduler } from "../../../../src/models/preflight/preflight.js";
import { RunRecordSchema,type RunRecord } from "../../../../src/models/run/record.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { defineWorkflowRole } from "../../../../src/workflow-kit/validation/module-role.js";
import { UNOBSERVED_BACKFILL_GAP_NOTIFIER } from "../../fixtures/dashboard-stream-seams.js";
import { bindWorkflowDelegationTargets } from "../../../../src/workflow-kit/workflow.js";
import { fixtureChildDescriptor, fixtureDescriptor } from "../../fixtures/descriptor-fixtures.js";
import { registeredExplorerQueryDeps } from "../../fixtures/explorer-seams.js";
import { NO_INTAKE_PROJECTIONS,UNSTORED_CONFIG_IDENTITY,UNWIRED_INTAKE_PARSER,UNWIRED_INTAKE_SERVICE } from "../../fixtures/intake-kernel-seams.js";
import { separationsRunResultRecord,CURRENT_SEPARATIONS_RESULT,seedSeparationsRunAuthority,TERMINAL_SEPARATIONS_RUN } from "../../fixtures/integration/separations-run-fixtures.js";
import { CONFIG_SNAPSHOT,UUID_4 } from "../../fixtures/phase1c-contract-fixtures.js";
import { RUN_ID,sequentialIdFactory } from "../../fixtures/phase1f-run-fixtures.js";
import { createPreflightHarness } from "../../fixtures/preflight-seams.js";
import { personLookupQueuedRun } from "../phase1f-executor-harness.js";
import { AuthorityDatabase } from "../synthetic-storage-admission.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-repositories.js";
import { AT,DAY,traceOf,uuidOf } from "./dashboard-harness.js";
export const HASH_B = resolveConfigWithProvenance(initialSettingsFileRecord().settings, hostConfigFacts({}), manualClock(AT)).fingerprint;

export interface Harness {
  readonly app: ReturnType<typeof createDashboardApp>;
  readonly database: AuthorityDatabase;
  readonly settingsPath: string;
  readonly stateRoot: string;
  readonly clock: ReturnType<typeof manualClock>;
  readonly noteWriter: ReturnType<typeof createNoteTimelineWriter>;
  readonly hub: DashboardStreamHub;
  readonly projection: ReturnType<typeof createRunQueueProjection>;
  readonly artifacts: ReturnType<typeof createContentAddressedArtifactWriter>;
  readonly preflight: ReturnType<typeof createPreflightReportService>;
  readonly artifactSourceReads: number[];
}

export type DiagnosticBundleHarnessDeps = DiagnosticBundleQueryDeps
  & ArtifactBytesQueryDeps
  & Readonly<{ artifacts: ReturnType<typeof createContentAddressedArtifactWriter> }>;

export function beforeArtifactReaderOperation(
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

export function observeArtifactLeaseDisposal(
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

export function writeStoredArtifactEnvelope(
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


const cleanups: (() => void | Promise<void>)[] = [];
export const OPERATOR_JSON_HEADERS = Object.freeze({
  host: "localhost",
  origin: "http://localhost",
  "content-type": "application/json",
});

export const disposeHttpRouteHarness = async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
};

/** A test arms this so one command's audit inserts throw inside the kernel's authority transactions. */
export type CommandAuditInsertFault = {
  commandId: string;
  armed: boolean;
  /** Command ids whose `commandAudits.insert` threw, in call order. */
  failures: string[];
};

function auditInsertCommandId(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null || !("request" in input)) return undefined;
  const request = input.request;
  if (typeof request !== "object" || request === null || !("commandId" in request)) return undefined;
  return typeof request.commandId === "string" ? request.commandId : undefined;
}

function installCommandAuditInsertFault(database: AuthorityDatabase, fault: CommandAuditInsertFault): void {
  const real = database.authority;
  const commandAudits: AuthorityRepositories["commandAudits"] = Object.freeze({
    ...real.commandAudits,
    insert: (input: unknown) => {
      const commandId = auditInsertCommandId(input);
      if (fault.armed === true && commandId === fault.commandId) {
        fault.failures.push(commandId);
        throw new Error("synthetic-child-audit-failure");
      }
      return real.commandAudits.insert(input);
    },
  });
  // One bag for every authority transaction. Nested work compares that object
  // by identity, and the frozen original cannot swap commandAudits in place.
  const authority: AuthorityRepositories = Object.freeze({ ...real, commandAudits });
  Object.defineProperty(database, "authority", {
    value: authority, writable: true, configurable: true, enumerable: true,
  });
}

export async function harness(options: {
  readonly workbookWorkflows?: readonly import("../../../../src/backend/workbooks/workbook-library-service.js").WorkbookReferenceWorkflow[];
  readonly workbookSync?: WorkbookSyncDownload;
  readonly profileFixture?: () => Promise<BoundProfileStorageFixture>;
  readonly protectedCommandAcceptedAt?: DashboardAppDeps["protectedCommandAcceptedAt"];
  readonly requestIdentity?: RequestIdentityCheckpoint;
  readonly intake?: IntakeService;
  readonly ocr?: DashboardAppDeps["ocr"];
  readonly notifications?: (database: AuthorityDatabase) => NonNullable<DashboardAppDeps["notifications"]>;
  /** Wrap the real start-plan service (e.g. to observe whether admission reached it). */
  readonly startPlans?: (real: StartPlanService) => StartPlanService;

  /** The hub's per-subscriber pending bound; the hub default when absent. */
  readonly maxPending?: number;
  readonly notificationStatus?: DashboardStreamHubDeps["notificationStatus"];
  readonly streamSettings?: boolean;
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
  /**
   * While armed, the command authority handed to the kernel throws from
   * `commandAudits.insert` for this command id. The throw runs inside that
   * authority transaction. Every other repository method passes through.
   */
  readonly commandAuditInsertFault?: CommandAuditInsertFault;
  /** Serve the Activity routes on a navigation read lane, as the dashboard does. */
  readonly activityOnLane?: boolean;
} = {}): Promise<Harness> {
  const profile = await (options.profileFixture ?? createBoundProfileFixture)();
  const root = profile.workspace, stateRoot = profile.stateRoot;
  const settingsPath = join(root, ".tracker", "settings", "settings.json");
  const clock = manualClock(AT);
  const ids = sequentialIdFactory("c");
  const database = AuthorityDatabase.open(
    { path: join(stateRoot, "state.db"), busyTimeoutMs: 1000, migrationOwner: "bff-flow-test" },
    clock,
  );
  database.withAuthorityTransaction(repositories => {
    seedInitialSettingsRuntimeConfig(database, clock);
    repositories.configSnapshots.insert(CONFIG_SNAPSHOT);
  });
  assert.equal("projections" in database, false, "the retired projection repositories have no database capability");
  const artifacts = createContentAddressedArtifactWriter({
    admission: profile.admission,
  });
  const artifactSourceReads: number[] = [];
  const artifactReader = createServerVerifiedArtifactReader({
    admission: profile.admission,
    observeIo: (kind, bytes) => {
      if (kind === "source-read") artifactSourceReads.push(bytes);
    },
    ...(options.observeArtifactLeaseClosed === undefined
      ? {}
      : { observeLeaseClosed: options.observeArtifactLeaseClosed }),
  });
  cleanups.push(async () => {
    const readiness = await Promise.allSettled([artifacts.ready, artifactReader.ready]);
    const failures = readiness.filter(result => result.status === "rejected").map((result): unknown => result.reason);
    if (failures.length > 0) throw new AggregateError(failures, "artifact initialization failed");
    database.close();
    await profile.close();
  });

  bindWorkflowDelegationTargets([fixtureDescriptor, fixtureChildDescriptor]);
  const descriptors = {
    resolve: (workflowId: string) => (workflowId === "fixture-graph" ? fixtureDescriptor : undefined),
  };
  const searchDescriptors = {
    resolve: (workflowId: string) => workflowId === "separations"
      ? { id: "separations", label: "Separations", code: "sp", category: "separation" }
      : undefined,
  };
  const projection = createRunQueueProjection({
    assistantUsage: (from, to, generatedAt) => queryAssistantUsage(database, { from, to, generatedAt }),
    timeline: database.authority.timelineEvents,
    reader: sqliteRunReader(database, clock),
    stateRoot,
    clock,
    appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash([fixtureDescriptor.contractFingerprint]),
    ledger: createTransactionHistory(database.authority),
    authority: {
      queueParents: envelopes => database.authority.dependencies.parents(envelopes),
      listCheckpoints: (workflowId, itemId) => database.authority.runCheckpoints.listByItem(workflowId, itemId),
      listGateResults: runId => database.authority.gateResults.listByRun(runId),
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

  const spans = createTimelineEmitter({
    repository: database.authority.timelineEvents,
    clock,
    pid: 4242,
  });
  const noteWriter = createNoteTimelineWriter({ repository: database.authority.timelineEvents, clock, pid: 4242 });

  const runDetailDeps = { timeline: database.authority.timelineEvents, runReader: sqliteRunReader(database, clock),
    stateRoot,
    projection,
    authority: {
      getRun: (runId: string) => database.authority.runs.get(runId),
      latestCheckpoint: (workflowId: string, itemId: string, nodeId: string) =>
        database.authority.runCheckpoints.latest(workflowId, itemId, nodeId),
      listCheckpoints: (workflowId: string, itemId: string) => database.authority.runCheckpoints.listByItem(workflowId, itemId),
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
  const credentials = boundProfileCredentials(profile.admission);
  const settingsFile = {
    read: () => {
      // Persisted settings do not mutate the running process; model active and saved revisions separately.
      const record = readSettings(database.authority);
      const persisted = settingsRuntimeIdentity(record, resolveConfigWithProvenance(record.settings, hostConfigFacts({}), clock).fingerprint);
      if (
        persisted.settingsRevision === activeSettingsIdentity.settingsRevision
        && persisted.settingsSchemaHash === activeSettingsIdentity.settingsSchemaHash
        && persisted.settingsFingerprint === activeSettingsIdentity.settingsFingerprint
      ) {
        return { record, activeConfig: activeSettings.config, activePreferences: activeSettings.preferences, runtimeStatus: { state: "current" as const, identity: activeSettingsIdentity } };
      }
      return { record, activeConfig: activeSettings.config, activePreferences: activeSettings.preferences, runtimeStatus: { state: "restart-required" as const, active: activeSettingsIdentity, persisted } };
    },
  };
  if (options.commandAuditInsertFault !== undefined) installCommandAuditInsertFault(database, options.commandAuditInsertFault);
  const kernel = createCommandKernel({
    lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: (run, publication) => {
      if (publication === undefined) throw new Error("command-created run lacks queue presentation");
      spans.emit(runQueuedSpanEvent({ run, ...publication, actorId: PublicationActorIdSchema.parse(publication.actorId) }));
    } }),
    appVersion: "0.1.0",
    configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER,
    intakeProjections: NO_INTAKE_PROJECTIONS,
    authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
    clock,
    ids,
    descriptors,
    writeResolution: {
      recheck: () => {
        throw new Error("write resolution is not wired in this harness");
      },
      resolveAbsent: () => {
        throw new Error("write resolution is not wired in this harness");
      },
    },
    workerRuntime: { pool: unusedWorkerPool() },
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
  const settingsEditor = { settings: settingsFile, protectedSettings: createProtectedSettingsRuntimeReader(credentials),
    environment: {}, clock };
  const hub = createDashboardStreamHub({
    projection,
    runPanels: { read: (runId, signal) => readRunPanel(runDetailDeps, runId, signal) },
    backfillGaps: UNOBSERVED_BACKFILL_GAP_NOTIFIER,
    ...(options.maxPending === undefined ? {} : { maxPending: options.maxPending }),
    ...(options.notificationStatus === undefined ? {} : { notificationStatus: options.notificationStatus }),
    ...(options.streamSettings === true
      ? { settings: { read: () => buildSettingsEditor(settingsEditor), onChange: () => () => undefined } }
      : {}),
  });
  cleanups.push(() => hub.close());
  const { authority, report } = createPreflightHarness(clock, HASH_B, options.preflightBeforeRun, options.preflightScheduler);
  const preflight = createPreflightReportService({
    dashboard: authority,
    clock,
    runtime: {
      currentScope(workflowId) {
        if (workflowId !== undefined) throw new Error("workflow preflight is not wired in the HTTP harness");
        return { configFingerprint: HASH_B, configSnapshotId: ConfigSnapshotIdSchema.parse(UUID_4),
          descriptorFingerprint: fixtureDescriptor.contractFingerprint, requestedCapabilities: ["dashboard.serve"] };
      },
      admission: {
        read() { throw new Error("workflow preflight is not wired in the HTTP harness"); },
        async prepare() { throw new Error("workflow preflight is not wired in the HTTP harness"); },
      },
    },
  });


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
  const activityInput = { database, clock, descriptors, ledger: createTransactionHistory(database.authority) };
  const activityLanes = options.activityOnLane === true ? createComposedDashboardReadHost({ admission: profile.admission, database, clock }) : undefined;
  if (activityLanes !== undefined) cleanups.push(() => activityLanes.close());
  const { activity, activityPopulation, reports, readActivityDocument } = composeActivity({ ...activityInput, ...(activityLanes === undefined ? {} : { readLanes: activityLanes }) });
  const workbookLibrary = createWorkbookLibraryService({ sync: options.workbookSync ?? unexpectedWorkbookSync, repository: database.authority.workbooks, clock });
  const app = createDashboardApp({
    protectedCommandAcceptedAt: options.protectedCommandAcceptedAt ?? ((commandId) => credentials.acceptedAt(commandId)),
    requestIdentity: options.requestIdentity ?? createSoloRequestIdentityCheckpoint({
      id: "local-operator",
      label: "Local operator",
    }),
    intake: options.intake ?? UNWIRED_INTAKE_SERVICE,
    ...(options.ocr === undefined ? {} : { ocr: options.ocr }),
    ...(options.notifications === undefined ? {} : { notifications: options.notifications(database) }),
    intakeCommandResult: createIntakeCommandResultQuery(database),
    workerCommandResult: createWorkerCommandResultQuery(database),
    workbooks: { library: workbookLibrary, workflows: options.workbookWorkflows ?? [fixtureDescriptor],
      withReadPosition: serve => database.withAuthorityReadSnapshot(() => serve(database.capturedChangeKey().changeLogSeq)) },
    bootstrap: {
      appVersion: "0.1.0",
      clock,
      modules: [{ descriptor: fixtureDescriptor, role: defineWorkflowRole({ kind: "standalone" }) }],
      descriptorSetHash: descriptorSetHash([fixtureDescriptor.contractFingerprint]),
      settingsSchemaHash: descriptorSetHash(["settings-schema"]),
      projection,
      actorLabel: () => "Fixture Operator",
      authorityMeta: () => database.getMeta(),
      workbookCompatibility: workflows => workbookLibrary.compatibility(workflows),
      preflightReport: () => report,
    },
    preflight,
    projection,
    search,
    activity,
    activityPopulation,
    xlsxExports: createOperatorXlsxExportService({
      clock,
      ids,
      sourceIdentity: database.getSourceDatabaseIdentity(),
      artifacts,
      authority: database.authority.operatorXlsxExports,
      search,
      withSearchSnapshot: read => database.withAuthorityReadSnapshot(read),
      ...(readActivityDocument === undefined ? { activityReport: (from: string, to: string, token: string) => reports.readSelected(from, to, token) } : { readActivityDocument }),
    }),
    resolveWriteCommand: request => resolveWriteCommandTarget(request, database.authority),
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
    runDetail: { ...runDetailDeps, itemAttemptHistory: createItemAttemptHistoryQuery({ database, reader: runDetailDeps.runReader }) },
    commands,
    startPlans,
    hub,

    settingsEditor,
    storage: {
      admission: profile.admission,
      credentials,
      doctorOptions: {
        stateRootTrustAnchor: root,
        stateRoot,
        authorityPath: join(stateRoot, "state.db"),
        backupDirectory: join(stateRoot, "backups", "authority"),
        busyTimeoutMs: 1000,
      },
      clock,
      serviceState: () => ({
        state: "never-run",
        reason: "the test harness runs no backup lane",
      }),
    },
    explorer: registeredExplorerQueryDeps(clock, descriptorSetHash([fixtureDescriptor.contractFingerprint])),
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

export function optionalFileBytes(path: string): Buffer | undefined {
  return existsSync(path) ? readFileSync(path) : undefined;
}

export function settingsAuthoritySnapshot(h: Harness, commandId: string) {
  const settingsRoot = dirname(h.settingsPath);
  return {
    settingsBytes: optionalFileBytes(h.settingsPath),
    protectedBytes: optionalFileBytes(join(h.stateRoot, "credentials", "protected.json")),
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

/** Assistant chat rows an accepted send writes; a fault check that spans a send names its exact history writes. */
export const ASSISTANT_HISTORY_TABLES = Object.freeze(["assistant_conversations", "assistant_messages"]);
export interface HistoryWrites { readonly tables: readonly string[]; readonly writes: number }
const NO_HISTORY_WRITES: HistoryWrites = { tables: [], writes: 0 };

export function faultAuthoritySnapshot(h: Pick<Harness, "database" | "stateRoot">, history: HistoryWrites = NO_HISTORY_WRITES) {
  const raw = new DatabaseSync(join(h.stateRoot, "state.db"), { readOnly: true });
  try {
    const tables = raw.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('database_states','timeline_events','debug_events') ORDER BY name").all()
      // The change log and run references are derived from the rows compared here, and log the permitted timeline writes too.
      .filter(row => typeof row.name !== "string" || (!history.tables.includes(row.name) && !AUTHORITY_DERIVED_TABLES.some(table => table === row.name)));
    const rows = tables.map(row => {
      if (typeof row.name !== "string" || !/^[a-z_]+$/u.test(row.name)) throw new Error("fixture table identity invalid");
      return { table: row.name, rows: raw.prepare(`SELECT * FROM ${row.name} ORDER BY rowid`).all() };
    });
    return { rows, schema: raw.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all(),
      generation: h.database.getMeta().authorityGeneration,
      timeline: h.database.authority.timelineEvents.page({ limit: 500 }),
      debug: h.database.authority.timelineEvents.debugPage({ limit: 500 }) };
  } finally { raw.close(); }
}

type TimelinePage = ReturnType<Harness["database"]["authority"]["timelineEvents"]["page"]>;
/** The dashboard's loop-delay monitor writes a stall diagnostic on its own clock; a slow host can land one inside any checked span. */
const isLoopStall = (record: TimelinePage[number]) => record.payload.kind === "debug" && record.payload.event.category === "boot"
  && record.payload.event.area === "event-loop" && record.payload.event.reason === "event-loop-stall";

/** Asserts a span wrote nothing to authority except loop-stall diagnostics; returns how many it wrote. */
export function assertOnlyLoopStallWrites(database: Harness["database"],
  before: Readonly<{ generation: number; timeline: TimelinePage; debug: TimelinePage }>): number {
  assert.deepEqual(database.authority.timelineEvents.page({ limit: 500 }), before.timeline);
  const debug = database.authority.timelineEvents.debugPage({ limit: 500 });
  assert.deepEqual(debug.slice(0, before.debug.length), before.debug);
  const added = debug.slice(before.debug.length);
  assert.ok(added.every(isLoopStall), "the span wrote only loop-stall diagnostics");
  assert.equal(database.getMeta().authorityGeneration, before.generation, "debug rows advance no authority generation");
  return added.length;
}

/** Exact HTTP-fault timeline counts compose the dashboard with the event-loop monitor off. */
export const exactHttpFaultLoopDelay = false;

export function assertHttpFaultOnly(h: Pick<Harness, "database" | "stateRoot">, before: ReturnType<typeof faultAuthoritySnapshot>, expected: number,
  history: HistoryWrites = NO_HISTORY_WRITES) {
  const after = faultAuthoritySnapshot(h, history);
  assert.deepEqual(after.schema, before.schema, "HTTP refusal changes no table, index or trigger");
  assert.deepEqual(after.rows, before.rows, "HTTP refusal changes no HR, settings, command, audit or proof owner");
  assert.deepEqual(after.timeline, before.timeline);
  assert.deepEqual(after.debug.slice(0, before.debug.length), before.debug);
  const added = after.debug.slice(before.debug.length), stalls = added.filter(isLoopStall).length;
  assert.equal(added.length - stalls, expected);
  for (const record of added.filter(record => !isLoopStall(record))) {
    assert.equal(record.payload.kind, "debug");
    if (record.payload.kind !== "debug") throw new Error("HTTP refusal wrote non-debug authority");
    assert.equal(record.payload.event.category, "http");
  }
  assert.equal(after.generation, Number(before.generation) + history.writes, "debug rows advance no authority generation");
}

export function rawSettingsPatchFingerprint(patch: unknown): string {
  return createHash("sha256")
    .update("hrauto:settings-patch:v2\0")
    .update(canonicalJsonStringify(patch))
    .digest("hex");
}

export async function captureDiagnosticBundle(h: Harness, runId = RUN_ID) {
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

export async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

export function currentSeparationsRun(input: Readonly<{
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

export function seedCurrentSeparationsRun(
  h: Harness,
  run: RunRecord,
  canonicalSubject = "10800000",
): void {
  const result = separationsRunResultRecord(run, {
    ...CURRENT_SEPARATIONS_RESULT,
    approved: { ...CURRENT_SEPARATIONS_RESULT.approved, emplId: canonicalSubject },
  });
  assert.equal(run.completion?.kind, "done");
  const settled = RunRecordSchema.parse({ ...run, completion: { ...run.completion, resultDigest: result.resultDigest } });
  seedSeparationsRunAuthority(h.database, join(h.stateRoot, "state.db"), settled, result);
}

export function persistCurrentSeparationsEvidence(
  h: Harness,
  runs: readonly RunRecord[],
): void {
  for(const run of runs)assert.equal(h.database.canonicalPerson(run.envelope.runId).state,"available");
}

export function projectCurrentSeparationsRuns(h: Harness, runs: readonly RunRecord[]): void {
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

export async function activityPeople(h: Harness): Promise<unknown> {
  const response = await h.app.request(`/api/v1/reports/activity?from=${DAY}&to=${DAY}`);
  assert.equal(response.status, 200);
  return ActivityReportSelectionSchema.parse(await response.json()).people;
}

export async function loopbackResponse(
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

export function foreignOriginCases() {
return [
    ["missing Origin", { host: "localhost" }],
    ["foreign Origin", { host: "localhost", origin: "https://hostile.example" }],
    ["malformed Origin", { host: "localhost", origin: "not an origin" }],
    ["Host-mismatched Origin", { host: "localhost:3938", origin: "http://127.0.0.1:3938" }],
    ["non-loopback Host", { host: "attacker.example", origin: "http://attacker.example" }],
  ] as const;
}
