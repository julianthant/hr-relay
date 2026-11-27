import { resolveWriteCommandTarget } from "../../../../../src/backend/runs/commands/write-command-target.js";
import { unusedWorkerPool } from "../../backend/unused-worker-pool.js";
import { createScriptedExecutor } from "../served-fixtures/seeded-scripted-executor.js";
import { SCRIPTED_WORKFLOWS, scriptedDescriptorOf } from "../served-fixtures/scripted-workflows.js";
import { taskStoreRegistry } from "../../../../../src/backend/app/registries/task-registry.js";
import { dataOriginViewsOf, gateNodeViewsOf, writeContractViewsOf } from "../../../../../src/backend/app/composition/dashboard/run-detail-descriptors.js";
import { readRunPanel } from "../../../../../src/backend/runs/queries/run-detail.js";
import type { WorkerActivity } from "../../../../../src/backend/runtime/workers/worker-messages.js";
import type { AnyWorkflowDescriptor } from "../../../../../src/workflow-kit/workflow.js";
import { UNOBSERVED_BACKFILL_GAP_NOTIFIER } from "../../../fixtures/dashboard-stream-seams.js";
import { registeredExplorerQueryDeps } from "../../../fixtures/explorer-seams.js";
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
import { composeNotificationPublications, composeNotificationRoutes } from "../../../../../src/backend/app/composition/dashboard/notification-wiring.js";
import { ocrHostRun } from "../../../../../src/backend/runs/queries/ocr-record-members.js";
import { createNotificationTargetQuery } from "../../../../../src/backend/runs/queries/notifications.js";
import { createWorkbookLibraryService } from "../../../../../src/backend/workbooks/workbook-library-service.js";
import { WorkbookLibraryError } from "../../../../../src/backend/workbooks/workbook-library-error.js";
import type { AssistantService } from "../../../../../src/backend/assistant/service.js";
import { AssistantHistoryOperationSchema } from "../../../../../src/models/dashboard/assistant.js";

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
import { createProtectedSettingsRuntimeReader, readSettings } from "../../../../../src/backend/runtime/settings/settings-runtime.js";
import { createTimelineEmitter } from "../../../../../src/backend/storage/events/timeline-emitter.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { createTransactionHistory } from "../../../../../src/backend/storage/sqlite/transaction-history.js";
import { createSoloRequestIdentityCheckpoint } from "../../../../../src/backend/transports/http/request-identity.js";
import type { DashboardAppDeps } from "../../../../../src/backend/transports/http/routes/api-types.js";
import { createDashboardApp } from "../../../../../src/backend/transports/http/routes/api.js";
import { createDashboardStreamHub } from "../../../../../src/backend/transports/http/subscriptions/dashboard-stream.js";
import { hostConfigFacts } from "../../../../../src/models/config/host-display.js";
import { initialProtectedStoreRecord } from "../../../../../src/models/config/protected-settings.js";
import { initialSettingsFileRecord, settingsRuntimeIdentity } from "../../../../../src/models/config/settings.js";
import { ActorIdSchema as PublicationActorIdSchema } from "../../../../../src/rules/identity/ids.js";
import type { TestClock } from "../../../../../src/rules/time/clock.js";
import { defineWorkflowRole } from "../../../../../src/workflow-kit/validation/module-role.js";
import { protectedSecretSource } from "../../protected-secret-source.js";
import { createSettingsApplicationExecutor } from "../../../../../src/backend/runs/commands/settings-service.js";
import { buildSettingsEditor, type SettingsEditorQueryDeps } from "../../../../../src/backend/runs/queries/settings-editor.js";
import { createCredentialStore } from "../../synthetic-storage-admission.js";

export function createSeededServicesSetup({ createFixtureDashboardApp }: {
createFixtureDashboardApp: (before: Omit<DashboardAppDeps, "settingsEditor" | "storage" | "explorer">, after: Pick<DashboardAppDeps, "settingsEditor" | "storage" | "explorer">) => ReturnType<typeof createDashboardApp>;
}) {
  function composeSeededServices({ database, clock, stateRoot, root, projection, spans, descriptors, runIds, selectionServices, productWorkflows, scripting, liveSettings }: {
   /** Opt-in: ordinary settings save through the production executor, the editor reads the store, and each commit rides the stream. */
   liveSettings?: boolean;
   /** Opt-in: run Work-Study through the real executor on a script the test holds (needs productWorkflows). */
   scripting?: Readonly<{ profilePath: string; reportWorker: (workerId: string, activity: WorkerActivity) => void }>;
   /** Serve the production catalog (same filter as composeShell) instead of person-lookup alone. */
   productWorkflows?: boolean;
   selectionServices?: Pick<DashboardAppDeps,"activity"|"search"|"xlsxExports"|"searchMetadataExports">;
   database: AuthorityDatabase; clock: TestClock; stateRoot: string; root: string;
   projection: ReturnType<typeof createRunQueueProjection>; spans: ReturnType<typeof createTimelineEmitter>;
   descriptors: {resolve: (workflowId: string) => AnyWorkflowDescriptor | undefined}; runIds: Record<string,string>;
  }) {
    const runReader = sqliteRunReader(database, clock);
    const trust = createReceiptService({ database, runReader, descriptors: scripting === undefined ? [personLookupDescriptor] : [personLookupDescriptor, ...SCRIPTED_WORKFLOWS.flatMap(script => [script.module, ...(script.children ?? [])]).map(module => module.descriptor).filter((descriptor, index, all) => descriptor.id !== personLookupDescriptor.id && all.findIndex(other => other.id === descriptor.id) === index)] });


    const doneReceipt = trust.ensureReceipt(runIds.doneRun);
    if (doneReceipt.output.length === 0) {
      throw new Error(
        `the seeded done run ${runIds.doneRun} derived an evidence receipt with no output fact; `
        + "the run-receipt-populated state photographs a queue row that states what the run produced",
      );
    }

    const servedScripted = (workflowId: string) => {
      const descriptor = scriptedDescriptorOf(workflowId);
      return descriptor === undefined ? undefined : { ...descriptor, gateNodes: gateNodeViewsOf(descriptor),
        writeContracts: writeContractViewsOf(descriptor), dataOrigins: dataOriginViewsOf({ descriptor, stores: taskStoreRegistry.stores }) };
    };
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
        resolve: (workflowId: string) => workflowId === personLookupDescriptor.id ? personLookupDescriptor
          : scripting === undefined ? undefined : servedScripted(workflowId),
      },
      canonical: {
        reader: runReader,
        database,
        descriptors: {
          resolve: (workflowId: string) =>
            (workflowId === personLookupDescriptor.id ? personLookupDescriptor : scripting === undefined ? undefined : scriptedDescriptorOf(workflowId)),
        },
      },
      trust,
    };

    const lifecycle = new RunRecordService({ database: database, clock: clock, ids: sequentialIdFactory("e"), ...(scripting === undefined ? {} : { resolveDescriptor: descriptors.resolve }), publishQueued: (run, publication) => {
        if (publication === undefined) throw new Error("command-created run lacks queue presentation");
        spans.emit(runQueuedSpanEvent({ run, ...publication, actorId: PublicationActorIdSchema.parse(publication.actorId) }));
      } });
    const library = createWorkbookLibraryService({ repository: database.authority.workbooks, clock,
      sync: { withDownload: () => { throw new WorkbookLibraryError("WORKBOOK_SYNC_LINK_REQUIRED"); } } });
    const scripted = scripting === undefined ? undefined : createScriptedExecutor({ database, clock, lifecycle, emitter: spans, library,
      profilePath: scripting.profilePath, reportWorker: scripting.reportWorker });
    // A scripted plan binds the active runtime config, as production plans do.
    const activeConfig = scripting === undefined ? undefined : database.authority.runtimeConfig.get();
    if (scripting !== undefined && activeConfig === undefined) throw new Error("the seeded authority holds no runtime config");
    const settingsChanges = new Set<() => void>();
    const resolveSettings = (value: unknown) => resolveConfigWithProvenance(value, hostConfigFacts({}), clock);
    const kernel = createCommandKernel({
      lifecycle: lifecycle,
      appVersion: SEEDED_APP_VERSION,
      configIdentity: UNSTORED_CONFIG_IDENTITY,
      intakeParser: UNWIRED_INTAKE_PARSER,
      intakeProjections: NO_INTAKE_PROJECTIONS,
      authority: { withAuthorityTransaction: (work) => database.withAuthorityTransaction(work), afterAuthorityCommit: publish => database.afterAuthorityCommit(publish) },
      ...(liveSettings === true ? {
        settings: createSettingsApplicationExecutor(resolveSettings, createCredentialStore({ stateRoot })),
        settingsCommitted: () => { for (const listener of [...settingsChanges]) listener(); },
      } : {}),
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
      ...(scripting === undefined ? {} : { workbooks: library, protectedSecrets: protectedSecretSource({ profileName: "Synthetic Timekeeper" }) }),
      ids: scripting === undefined ? { uuid: () => uuidOf(8000) } : sequentialIdFactory("8"),
      planTtlMs: 10 * 60 * 1000,
      configFingerprint: activeConfig?.configFingerprint ?? CONFIG_FINGERPRINT,
      configSnapshotId: activeConfig?.configSnapshotId ?? CONFIG_SNAPSHOT_ID,
      plannedBy: "local-operator",
    });
    // Product-app services: real notification and workbook-library composition; the live-only ones (SharePoint download,
    // ChatGPT assistant) are the minimum the dashboard's start-up reads need.
    const modules = productWorkflows === true
      ? READABLE_WORKFLOW_MODULES.filter(module => WORKFLOW_MODULES.some(publicModule => publicModule === module) || module.descriptor.capabilities?.review === true)
      : [{ descriptor: personLookupDescriptor, role: defineWorkflowRole({ kind: "standalone" }) }];
    const strictDescriptors = { resolve: (id: string) => { const descriptor = descriptors.resolve(id); if (descriptor === undefined) throw new Error(`seeded-descriptor-missing:${id}`); return descriptor; } };
    const trustNotifications = productWorkflows === true ? createTrustNotifications({ database, clock, ids: sequentialIdFactory("b"), reader: lifecycle }) : undefined;
    const productAppDeps = ({ observer }: NonNullable<typeof trustNotifications>) => {
      const notificationTarget = createNotificationTargetQuery({ get: database.authority.notifications.get, read: id => lifecycle.read(id), failure: database.authority.failures.get,
        host: run => database.withAuthorityReadSnapshot(() => ocrHostRun(database.authority, run)),
        command: commandId => database.authority.commands.readForNotice(commandId),
        bulk: bulkCommandId => { const acceptance = database.authority.commands.getBulk(bulkCommandId); return acceptance === undefined ? undefined : { acceptance, children: database.authority.commands.listBulkChildren(bulkCommandId) }; } });
      const profileId = "00000000-0000-4000-8000-000000000001";
      const assistant: AssistantService = {
        respond: () => Promise.resolve({ kind: "result", result: { state: "no-reply", reason: "ASSISTANT_UNAVAILABLE", canRetry: false, turn: null } }),
        modelPreference: () => ({ profileId, epoch: 1, revision: 1, preference: { slug: "gpt-5.4", effort: "medium" } }),
        historyView: () => { const now = clock.now().toISOString(); return { ...database.authority.assistantHistory.list(now), needsYou: database.authority.assistantProposals.needsYou(now) }; },
        conversation: id => { const view = database.authority.assistantHistory.conversation(id, clock.now().toISOString()); return view && { ...view, sessions: [] }; },
        history: input => database.authority.assistantHistory.apply(AssistantHistoryOperationSchema.parse(input), clock.now().toISOString()),
      };
      return {
        notifications: composeNotificationRoutes({ database, clock, lifecycle, runDetailDeps, descriptors: strictDescriptors, assertCurrent: () => undefined, notificationObserver: observer, notificationTarget }),
        workbooks: { library, workflows: modules.map(module => module.descriptor) },
        assistant,
      };
    };
    const productDeps: Partial<ReturnType<typeof productAppDeps>> = trustNotifications === undefined ? {} : productAppDeps(trustNotifications);
    const notificationRoutes = productDeps.notifications;
    const settingsEditor: SettingsEditorQueryDeps = {
      protectedSettings: createProtectedSettingsRuntimeReader({ read: initialProtectedStoreRecord }),
      settings: {
        read: () => {
          const record = liveSettings === true ? readSettings(database.authority) : initialSettingsFileRecord();
          return { record, runtimeStatus: { state: "current", identity: settingsRuntimeIdentity(record, resolveSettings(record.settings).fingerprint) } };
        },
      },
      environment: {},
      clock,
    };
    const hub = createDashboardStreamHub({
      projection, backfillGaps: trustNotifications?.backfillGapNotifier ?? UNOBSERVED_BACKFILL_GAP_NOTIFIER,
      runPanels: { read: (runId, signal) => readRunPanel(runDetailDeps, runId, signal) },
      ...(trustNotifications === undefined || notificationRoutes === undefined ? {} : {
        notificationPublications: composeNotificationPublications({
          database, clock, lifecycle, descriptors: strictDescriptors, runDetailDeps, notificationInbox: trustNotifications.inbox, target: notificationRoutes.target }),
        notificationList: notificationRoutes.streamList,
        notificationStatus: { read: () => notificationRoutes.status(), onChange: listener => trustNotifications.observer.onStatusChange(listener) },
      }),
      ...(liveSettings === true ? { settings: { read: () => buildSettingsEditor(settingsEditor),
        onChange: (listener: () => void) => { settingsChanges.add(listener); return () => { settingsChanges.delete(listener); }; } } } : {}),
    });
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
      preflight: { ...healthyDashboardPreflightExecutor(clock), read: () => ({ state: "present" as const, report: healthyDashboardPreflightReport(clock) }) },
      applicationLifecycle: createApplicationLifecycle({ database,
        requestQuit: () => { throw new Error("seeded fixture cannot quit the process"); },
        onFailure: error => { throw error; },
      }),
      bootstrap: {
        appVersion: SEEDED_APP_VERSION,
        clock,

        modules,
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

      settingsEditor,
      storage: {
        admission: syntheticStateRoot(stateRoot),
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
          reason: "the seeded adapter runs no backup lane",
        }),
      },
      explorer: registeredExplorerQueryDeps(clock, descriptorSetHash([CONTRACT_FINGERPRINT])),
    });


  return { app, hub, scripted, lifecycle, notificationInbox: trustNotifications?.inbox };
  }

  return { composeSeededServices };
}
