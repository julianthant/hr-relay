import { UNOBSERVED_BACKFILL_GAP_NOTIFIER } from "../../../fixtures/dashboard-stream-seams.js";
import { explorerQueryDeps } from "../../../fixtures/explorer-seams.js";
import { NO_INTAKE_PROJECTIONS } from "../../../fixtures/intake-kernel-seams.js";
import { UNSTORED_CONFIG_IDENTITY } from "../../../fixtures/intake-kernel-seams.js";
import { UNWIRED_INTAKE_PARSER } from "../../../fixtures/intake-kernel-seams.js";
import { UNWIRED_INTAKE_SERVICE } from "../../../fixtures/intake-kernel-seams.js";
import { sequentialIdFactory } from "../../../fixtures/phase1f-run-fixtures.js";
import { healthyDashboardPreflightExecutor } from "../../../fixtures/preflight-seams.js";
import { healthyDashboardPreflightReport } from "../../../fixtures/preflight-seams.js";
import { sqliteRunReader } from "../../canonical-run-reader.js";
import { personLookupDescriptor } from "../../registered-workflows.js";
import { syntheticStateRoot } from "../../synthetic-storage-admission.js";
import { CONFIG_FINGERPRINT } from "../served-fixtures/seeded-identity.js";
import { CONFIG_SNAPSHOT_ID } from "../served-fixtures/seeded-identity.js";
import { CONTRACT_FINGERPRINT } from "../served-fixtures/seeded-identity.js";
import { SEEDED_APP_VERSION } from "../served-fixtures/seeded-identity.js";
import { uuidOf } from "../served-fixtures/seeded-lifecycle.js";
import { join } from "node:path";
import { composeActivity } from "../../../../../src/backend/app/composition/dashboard/activity.js";
import { descriptorSetHash } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { resolveConfigWithProvenance } from "../../../../../src/backend/app/config/resolve.js";
import { createRunLogStreamStore } from "../../../../../src/backend/logs/run-log-stream.js";
import { createCommandKernel } from "../../../../../src/backend/runs/commands/command-kernel.js";
import { createDashboardCommandService } from "../../../../../src/backend/runs/commands/command-service.js";
import { runQueuedSpanEvent } from "../../../../../src/backend/runs/commands/run-queued-span.js";
import { createStartPlanService } from "../../../../../src/backend/runs/commands/start-plan-service.js";
import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createRunQueueProjection } from "../../../../../src/backend/runs/projections/run-queue-projection.js";
import { createCalendarQuery } from "../../../../../src/backend/runs/queries/calendar.js";
import { createItemAttemptHistoryQuery } from "../../../../../src/backend/runs/queries/item-attempt-history.js";
import { createCrossDateSearchService } from "../../../../../src/backend/runs/queries/search.js";
import { createReceiptService } from "../../../../../src/backend/runs/trust/receipt-service.js";
import { createProtectedSettingsRuntimeReader } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/index.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import { createSoloRequestIdentityCheckpoint } from "../../../../../src/backend/transports/http/request-identity.js";
import type { DashboardAppDeps } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { createDashboardApp } from "../../../../../src/backend/transports/http/routes/api.js";
import { createDashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { RunLogsStreamHub } from "../../../../../src/backend/transports/http/subscriptions/run-logs-stream.js";
import { hostConfigFacts } from "../../../../../src/models/config/host-display.js";
import { initialProtectedStoreRecord } from "../../../../../src/models/config/protected-settings.js";
import { initialSettingsFileRecord, settingsRuntimeIdentity } from "../../../../../src/models/config/settings.js";
import { ActorIdSchema as PublicationActorIdSchema } from "../../../../../src/rules/identity/ids.js";
import type { Clock } from "../../../../../src/rules/time/clock.js";
import { defineWorkflowRole } from "../../../../../src/workflow-kit/validation/module-role.js";

export function createSeededServicesSetup({ readFixtureRun, createFixtureDashboardApp }: {
readFixtureRun: (runReader: ReturnType<typeof sqliteRunReader>, runId: string) => Pick<Extract<ReturnType<ReturnType<typeof sqliteRunReader>["read"]>, { state: "present" }>, "disposition" | "run"> | undefined;
createFixtureDashboardApp: (runLogsHub: RunLogsStreamHub, before: Omit<DashboardAppDeps, "runLogsHub" | "settings" | "settingsEditor" | "storage" | "explorer">, after: Pick<DashboardAppDeps, "settings" | "settingsEditor" | "storage" | "explorer">) => ReturnType<typeof createDashboardApp>;
}) {
  function composeSeededServices({ database, clock, stateRoot, root, projection, spans, descriptors, runIds, selectionServices }: {
   selectionServices?: Pick<DashboardAppDeps,"activity"|"search"|"xlsxExports"|"searchMetadataExports">;
   database: AuthorityDatabase; clock: Clock; stateRoot: string; root: string;
   projection: ReturnType<typeof createRunQueueProjection>; spans: ReturnType<typeof createTimelineEmitter>;
   descriptors: {resolve: (workflowId: string) => typeof personLookupDescriptor | undefined}; runIds: Record<string,string>;
  }) {
    const runReader = sqliteRunReader(database, clock);
    const trust = createReceiptService({ database, runReader, descriptors: [personLookupDescriptor] });


    const doneReceipt = trust.ensureReceipt(runIds.doneRun);
    if (doneReceipt.output.length === 0) {
      throw new Error(
        `the seeded done run ${runIds.doneRun} derived an evidence receipt with no output fact; `
        + "the run-receipt-populated state photographs a queue row that states what the run produced",
      );
    }

    const runDetailDeps = { runReader, timeline: database.authority.timelineEvents,
      itemAttemptHistory: createItemAttemptHistoryQuery({ database, reader: runReader }),
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
        resolve: (workflowId: string) =>
          (workflowId === personLookupDescriptor.id ? personLookupDescriptor : undefined),
      },
      canonical: {
        reader: runReader,
        database,
        descriptors: {
          resolve: (workflowId: string) =>
            (workflowId === personLookupDescriptor.id ? personLookupDescriptor : undefined),
        },
      },
      trust,
    };

    const kernel = createCommandKernel({
      lifecycle: new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: (run, publication) => {
        if (publication === undefined) throw new Error("command-created run lacks queue presentation");
        spans.emit(runQueuedSpanEvent({ run, ...publication, actorId: PublicationActorIdSchema.parse(publication.actorId) }));
      } }),
      appVersion: SEEDED_APP_VERSION,
      configIdentity: UNSTORED_CONFIG_IDENTITY,
      intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS,
      authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
      clock,
      // A shared server accepts multiple commands; each audit needs its own ID.
      ids: sequentialIdFactory("d"),
      descriptors,
      writeResolution: {
        resolvePresent: () => {
          throw new Error("write resolution is not wired in the parity seed");
        },
        resolveAbsent: () => {
          throw new Error("write resolution is not wired in the parity seed");
        },
      },
      workerRuntime: { pool: { planPoolWorkerCount: () => { throw new Error("worker runtime is not wired in this fixture"); }, spawnPoolWorker: () => { throw new Error("worker runtime is not wired in this fixture"); }, refreshPoolBrowser: () => { throw new Error("worker runtime is not wired in this fixture"); }, reopenPoolBrowser: () => { throw new Error("worker runtime is not wired in this fixture"); }, stopPoolWorker: () => { throw new Error("worker runtime is not wired in this fixture"); }, pausePoolWorker: () => { throw new Error("worker runtime is not wired in this fixture"); }, resumePoolWorker: () => { throw new Error("worker runtime is not wired in this fixture"); } } },
    });
    const commands = createDashboardCommandService({ kernel, projection });
    const startPlans = createStartPlanService({
      authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work) },
      authorityRead: database,
      descriptors,
      clock,
      ids: { uuid: () => uuidOf(8000) },
      planTtlMs: 10 * 60 * 1000,
      configFingerprint: CONFIG_FINGERPRINT,
      configSnapshotId: CONFIG_SNAPSHOT_ID,
      plannedBy: "local-operator",
    });
    const hub = createDashboardStreamHub({ projection, backfillGaps: UNOBSERVED_BACKFILL_GAP_NOTIFIER });
    const runLogsHub = new RunLogsStreamHub({ projection, store: createRunLogStreamStore(database.authority.timelineEvents),
      readRun: runId => {
        return readFixtureRun(runReader, runId);
      } });

    const app = createFixtureDashboardApp(runLogsHub, {
      requestIdentity: createSoloRequestIdentityCheckpoint({
        id: "local-operator",
        label: "Local operator",
      }),
      intake: UNWIRED_INTAKE_SERVICE,
      commandJournal: database.authority.commands,
      protectedCommandAcceptedAt: () => { throw new Error("seeded BFF has no credential command authority"); },
      bulkCommandAcceptances: {
        withTransaction: (work) => database.withAuthorityTransaction((repositories) =>
          work({ get: repositories.commands.getBulk, insert: repositories.commands.acceptBulk })),
      },
      preflight: healthyDashboardPreflightExecutor(clock),
      bootstrap: {
        appVersion: SEEDED_APP_VERSION,
        clock,

        modules: [{ descriptor: personLookupDescriptor, role: defineWorkflowRole({ kind: "standalone" }) }],
        descriptorSetHash: descriptorSetHash([CONTRACT_FINGERPRINT]),
        settingsSchemaHash: descriptorSetHash(["settings-schema"]),
        projection,
        authorityMeta: () => database.getMeta(),
        // The seeded adapter runs no backup lane; "missing" is its true state.
        backupSummary: () => "missing",
        preflightReport: () => healthyDashboardPreflightReport(clock),
      },
      projection,
      calendar: createCalendarQuery(database, clock),
      search: createCrossDateSearchService({
        clock,
        sourceIdentity: database.getSourceDatabaseIdentity(),
        cursorSigningKey: new Uint8Array(32).fill(0x50),
        descriptors,
        authority: {
          readSnapshot: (read) => database.withAuthorityReadSnapshot(() => read({
            authorityGeneration: database.getMeta().authorityGeneration,
            searchRuns: (input) => database.authority.runs.search(input),
          })),
        },
      }),
      ...composeActivity({database,clock,descriptors,ledger:createTransactionHistory(database.authority)}),
      ...selectionServices,
      runDetail: runDetailDeps,
      commands,
      startPlans,
      hub,
    }, {

      settings: { config: resolveConfigWithProvenance({}, hostConfigFacts({}), clock).config, descriptors: [personLookupDescriptor] },
      settingsEditor: {
        protectedSettings: createProtectedSettingsRuntimeReader({ read: initialProtectedStoreRecord }),
        settings: {
          read: () => {
            const record = initialSettingsFileRecord();
            return { record, runtimeStatus: { state: "current", identity: settingsRuntimeIdentity(record, resolveConfigWithProvenance({}, hostConfigFacts({}), clock).fingerprint) } };
          },
        },
        environment: {},
        clock,
      },
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
          reason: "the seeded adapter runs no backup lane",
        }),
      },
      explorer: explorerQueryDeps(clock, descriptorSetHash([CONTRACT_FINGERPRINT])),
    });


  return { app, hub, runLogsHub };
  }

  return { composeSeededServices };
}
