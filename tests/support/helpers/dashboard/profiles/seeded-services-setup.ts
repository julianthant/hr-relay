import { resolveWriteCommandTarget } from "../../../../../src/backend/runs/commands/write-command-target.js";
import { unusedWorkerPool } from "../../backend/unused-worker-pool.js";
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
import { createTrustNotifications } from "../../../../../src/backend/app/composition/dashboard/notifications.js";
import { composeNotificationRoutes } from "../../../../../src/backend/app/composition/dashboard/notification-wiring.js";
import { ocrHostRun } from "../../../../../src/backend/runs/queries/ocr-record-members.js";
import { createNotificationTargetQuery } from "../../../../../src/backend/runs/queries/notifications.js";
import { createWorkbookIntakeBridge } from "../../../../../src/backend/runs/commands/workbook-intake-service.js";
import { createWorkbookLibraryService } from "../../../../../src/backend/workbooks/workbook-library-service.js";
import { WorkbookLibraryError } from "../../../../../src/backend/workbooks/workbook-library-error.js";
import { SETTINGS_SCHEMA_HASH } from "../../../../../src/models/config/settings.js";
import type { AssistantService } from "../../../../../src/backend/assistant/service.js";

import { composeActivity } from "../../../../../src/backend/app/composition/dashboard/activity.js";
import { projectWorkbookCompatibilityFromRepository } from "../../../../../src/backend/workbooks/workbook-library-service.js";
import { descriptorSetHash, READABLE_WORKFLOW_MODULES, WORKFLOW_MODULES } from "../../../../../src/backend/app/registries/workflow-registry.js";
import { resolveConfigWithProvenance } from "../../../../../src/backend/app/config/resolve.js";
import { createCommandKernel } from "../../../../../src/backend/runs/commands/command-kernel.js";
import { createDashboardCommandService } from "../../../../../src/backend/runs/commands/command-service.js";
import { runQueuedSpanEvent } from "../../../../../src/backend/runs/commands/run-queued-span.js";
import { createStartPlanService } from "../../../../../src/backend/runs/commands/start-plan-service.js";
import { RunRecordService } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { createApplicationLifecycle } from "../../../../../src/backend/runs/lifecycle/application-lifecycle.js";
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
import { hostConfigFacts } from "../../../../../src/models/config/host-display.js";
import { initialProtectedStoreRecord } from "../../../../../src/models/config/protected-settings.js";
import { initialSettingsFileRecord, settingsRuntimeIdentity } from "../../../../../src/models/config/settings.js";
import { ActorIdSchema as PublicationActorIdSchema } from "../../../../../src/rules/identity/ids.js";
import type { Clock } from "../../../../../src/rules/time/clock.js";
import { defineWorkflowRole } from "../../../../../src/workflow-kit/validation/module-role.js";

export function createSeededServicesSetup({ createFixtureDashboardApp }: {
createFixtureDashboardApp: (before: Omit<DashboardAppDeps, "settings" | "settingsEditor" | "storage" | "explorer">, after: Pick<DashboardAppDeps, "settings" | "settingsEditor" | "storage" | "explorer">) => ReturnType<typeof createDashboardApp>;
}) {
  function composeSeededServices({ database, clock, stateRoot, root, projection, spans, descriptors, runIds, selectionServices, productWorkflows }: {
   /** Serve the production catalog (same filter as composeShell) instead of person-lookup alone. */
   productWorkflows?: boolean;
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

    const lifecycle = new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), publishQueued: (run, publication) => {
        if (publication === undefined) throw new Error("command-created run lacks queue presentation");
        spans.emit(runQueuedSpanEvent({ run, ...publication, actorId: PublicationActorIdSchema.parse(publication.actorId) }));
      } });
    const kernel = createCommandKernel({
      lifecycle: lifecycle,
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
        recheck: () => {
          throw new Error("write resolution is not wired in the mock seed");
        },
        resolveAbsent: () => {
          throw new Error("write resolution is not wired in the mock seed");
        },
      },
      workerRuntime: { pool: unusedWorkerPool() },
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
    // Product-app services: real notification and workbook-library composition; the live-only ones (SharePoint download,
    // ChatGPT assistant) are the minimum the dashboard's start-up reads need.
    const productAppDeps = (): Pick<DashboardAppDeps, "notifications" | "workbooks" | "assistant"> => {
      const { observer } = createTrustNotifications({ database, clock, ids: sequentialIdFactory("n"), reader: lifecycle });
      const notificationTarget = createNotificationTargetQuery({ get: database.authority.notifications.get, read: id => lifecycle.read(id), failure: database.authority.failures.get,
        host: run => database.withAuthorityReadSnapshot(() => ocrHostRun(database.authority, run)),
        command: commandId => database.authority.commands.readForNotice(commandId),
        bulk: bulkCommandId => { const acceptance = database.authority.commands.getBulk(bulkCommandId); return acceptance === undefined ? undefined : { acceptance, children: database.authority.commands.listBulkChildren(bulkCommandId) }; } });
      const library = createWorkbookLibraryService({ repository: database.authority.workbooks, clock,
        sync: { withDownload: () => { throw new WorkbookLibraryError("WORKBOOK_SYNC_LINK_REQUIRED"); } } });
      const profileId = "00000000-0000-4000-8000-000000000001";
      const assistant: AssistantService = {
        respond: () => Promise.resolve({ state: "refused", code: "ASSISTANT_UNAVAILABLE", message: "The assistant is unavailable. Check the ChatGPT connection." }),
        modelPreference: () => ({ profileId, epoch: 1, revision: 1, preference: { slug: "gpt-5.4", effort: "medium" } }),
        permission: () => ({ state: "grant-required", profileId, epoch: 1, mode: "every-action", settingsRevision: 1, settingsSchemaHash: SETTINGS_SCHEMA_HASH, policyRevision: 0 }),
      };
      return {
        notifications: composeNotificationRoutes({ database, clock, lifecycle, runDetailDeps, descriptors: { resolve: id => { const descriptor = descriptors.resolve(id); if (descriptor === undefined) throw new Error(`seeded-descriptor-missing:${id}`); return descriptor; } }, assertCurrent: () => undefined, notificationObserver: observer, notificationTarget }),
        workbooks: { library, intake: createWorkbookIntakeBridge(library, UNWIRED_INTAKE_SERVICE), workflows: [] },
        assistant,
      };
    };
    const hub = createDashboardStreamHub({ projection, backfillGaps: UNOBSERVED_BACKFILL_GAP_NOTIFIER });
    const productDeps = productWorkflows === true ? productAppDeps() : {};
    const app = createFixtureDashboardApp({
      ...productDeps,
      requestIdentity: createSoloRequestIdentityCheckpoint({
        id: "local-operator",
        label: "Local operator",
      }),
      intake: UNWIRED_INTAKE_SERVICE,
      resolveWriteCommand: request => resolveWriteCommandTarget(request, database.authority),
      commandJournal: database.authority.commands,
      protectedCommandAcceptedAt: () => { throw new Error("seeded BFF has no credential command authority"); },
      bulkCommandAcceptances: {
        withTransaction: (work) => database.withAuthorityTransaction((repositories) =>
          work({ get: repositories.commands.getBulk, insert: repositories.commands.acceptBulk })),
      },
      preflight: healthyDashboardPreflightExecutor(clock),
      applicationLifecycle: createApplicationLifecycle({ database,
        requestQuit: () => { throw new Error("seeded fixture cannot quit the process"); },
        onFailure: error => { throw error; },
      }),
      bootstrap: {
        appVersion: SEEDED_APP_VERSION,
        clock,

        modules: productWorkflows === true
          ? READABLE_WORKFLOW_MODULES.filter(module => WORKFLOW_MODULES.some(publicModule => publicModule === module) || module.descriptor.capabilities?.review === true)
          : [{ descriptor: personLookupDescriptor, role: defineWorkflowRole({ kind: "standalone" }) }],
        descriptorSetHash: descriptorSetHash([CONTRACT_FINGERPRINT]),
        settingsSchemaHash: descriptorSetHash(["settings-schema"]),
        projection,
        actorLabel: () => "Fixture Operator",
        authorityMeta: () => database.getMeta(),
        // The seeded adapter runs no backup lane; "missing" is its true state.
        workbookCompatibility: workflows => projectWorkbookCompatibilityFromRepository(database.authority.workbooks, workflows),
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


  return { app, hub };
  }

  return { composeSeededServices };
}
