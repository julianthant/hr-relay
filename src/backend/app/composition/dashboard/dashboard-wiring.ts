import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import configuredWorkflowSources from "../../../../../config/dashboard-workflow-sources.json" with { type: 'json' };
import { AssistantModelPreferenceSchema } from "../../../../models/config/assistant-model-preference.js";
import type { ClearRunHistoryRequest } from "../../../../models/dashboard/run-history.js";
import { admitOcrExtraction } from "../../../../models/ocr/extraction.js";
import { buildExtractionInstruction } from "../../../../models/ocr/instruction.js";
import { isLiveWorker } from "../../../../models/run/worker.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { ChatGptAccountError } from "../../../accounts/chatgpt-account-service.js";
import { ProfileSessionRefusedError } from "../../../profiles/profile-errors.js";
import { createChatGptOcrTestService } from "../../../accounts/chatgpt-ocr-test.js";
import { assistantKnowledgeArtifact,loadProductionAssistantContext } from "../../../assistant/context.js";
import { createAssistantService } from "../../../assistant/service.js";
import { assistantSurfaceCoverage,createProductionAssistantTools } from "../../../assistant/tools.js";
import { createAssistantWorkflowStarts } from "../../../assistant/workflow-start.js";
import { createAssistantReadAllowlist } from "./assistant.js";
import { CHATGPT_OCR_MODEL,createChatGptOcrPageReader } from "../../../processing/providers/chatgpt-ocr-adapter.js";
import { createNominatimGeocodeAdapter } from "../../../processing/providers/geocode-adapters.js";
import { createCommandKernel } from "../../../runs/commands/command-kernel.js";
import { createDashboardCommandService } from "../../../runs/commands/command-service.js";
import { createOcrSourceService } from "../../../runs/commands/ocr-source-service.js";
import { createRunWorkerCapacity } from "../../../runs/commands/run-worker-capacity.js";
import { createStartPlanService } from "../../../runs/commands/start-plan-service.js";
import { createWorkbookIntakeBridge } from "../../../runs/commands/workbook-intake-service.js";
import { createApplicationLifecycle } from "../../../runs/lifecycle/application-lifecycle.js";
import type { ServedSummaryQueries } from "../../../runs/projections/run-queue-projection.js";
import { createIntakeCommandResultQuery } from "../../../runs/queries/intake-command-result.js";
import { createNotificationTargetQuery } from "../../../runs/queries/notifications.js";
import { createRunWorkbookService } from "../../../runs/workbooks.js";
import { createRunHistoryService } from "../../../runs/commands/run-history-service.js";
import { createCommandBrowserManager } from "../../../runtime/browser/command-browser.js";
import { createPreflightReportService } from "../../../runtime/preflight/report-service.js";
import { createTimeoutDeadlineScheduler } from "../../../runtime/scheduling/timeout-deadline-scheduler.js";
import { activeSettingsConfig,activeSettingsRuntimeIdentity } from "../../../runtime/settings/settings-runtime.js";
import { createServerVerifiedArtifactReader } from "../../../storage/artifacts/server-verified-artifact-reader.js";
import { createDuoCredentialStore } from "../../../storage/configuration/duo-credential-store.js";
import { readAutomaticRepairNotice } from "../../../storage/maintenance/automatic-repair-notice.js";
import { createTransactionHistory } from "../../../storage/sqlite/transaction-history.js";
import { startDashboardHttpServer,type DashboardHttpServer } from "../../../transports/http/http-server.js";
import { createSoloRequestIdentityCheckpoint } from "../../../transports/http/request-identity.js";
import { createDashboardApp } from "../../../transports/http/routes/api.js";
import { openStaticBundle } from "../../../transports/http/static-bundle.js";
import { createSharePointWorkbookSync } from "../../../workbooks/sharepoint-sync.js";
import { WorkbookLibraryError,createWorkbookLibraryService } from "../../../workbooks/workbook-library-service.js";
import { DESCRIPTORS,READABLE_WORKFLOW_MODULES } from "../../registries/workflow-registry.js";
import { RuntimeCustodyUncertainError,composeProfileAssistantAuthorization } from "../storage-compose.js";
import { composeActivity } from "./activity.js";
import { composeDataQueries } from "./data.js";
import { composeExplorer } from "./explorer.js";
import { composeFailureResolution } from "./failure-resolution.js";
import { composeIntake } from "./intake.js";
import { composeNotificationPublications,composeNotificationRoutes } from "./notification-wiring.js";
import { composeQueueSummaries } from "./queue-summaries.js";
import { createOperatorProjection } from "./queue.js";
import type { DashboardRuntime } from "./runtime-contracts.js";
import { type DashboardComposeInput,type StartupCleanup,type StartupCustody } from "./runtime-contracts.js";
import { prepareDashboardEnvironment,prepareDashboardRuntime } from "./runtime-resources.js";
import { composeShell } from "./shell.js";
import { composeDashboardShutdown } from "./shutdown-custody.js";
import { composeStorage } from "./storage.js";
import { GATE_PARK_WATCH_MS,composeDashboardTimeline } from "./timeline.js";
import { WORKER_BIRTH_POLL_MS,WORKER_BIRTH_TIMEOUT_MS,composeWorkerProcessControl,productionWorkerLaunch,realWorkerProcessSpawner } from "./worker-process.js";
import { composeWriteSafety,prepareWriteSafety } from "./write-safety.js";

export async function composeDashboardRuntimeStartup(input: DashboardComposeInput, startupCleanups: StartupCleanup[], custody: StartupCustody): Promise<DashboardRuntime> {
  const environment = prepareDashboardEnvironment(input, custody);
  const { repoRoot, frontend } = environment;
  const staticBundle = frontend === "built-bundle"
    ? await openStaticBundle(join(repoRoot, "dist", "dashboard"), repoRoot, input.frontendBuildScript)
    : undefined;


  const resources = prepareDashboardRuntime(input, startupCleanups, custody, environment, staticBundle);
  const { requiredClosure, requireProducerClosure, dashboardPreflightRunners, env, clock, timeZone, ids, machineAdmission, profile, assertCurrent, selected, stateRoot, appVersion, context, database, admission, chatGptAccount, selectedModelProfileId, selectedModelEpoch, assertSelectedModelContext, captureSelectedModel, resolved, protectedSettingsAuthority, protectedSecrets, settingsBoundary, configSnapshotId, backupDirectory, backupServiceState, readBackupSummary, loggingRepository, debugEvents, descriptors, setHash, runtimePreflight, lifecycle, backfillGapNotifier, notificationInbox, notificationObserver, preflightAuthority } = resources;
  const ledger = createTransactionHistory(database.authority);
  const runHistory = createRunHistoryService({ database, lifecycle, afterClear: () => { assertCurrent(); projection.rebuildFromTimeline(); } });
  const confirmedHistoryCommand = (request: ClearRunHistoryRequest) => {
    assertCurrent();
    if (profile.runtime.selectedContext(profile.token) !== context || request.target.profileId !== admission.profileBinding.profileId
      || request.target.epoch !== context.profileEpoch) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    context.assertCurrent();
    return { commandId: request.commandId };
  };

  const { activity, activityPopulation } = composeActivity({ database, clock, descriptors, ledger, timeZone });
  const summaries: ServedSummaryQueries = { ...composeQueueSummaries(database), activity: (from, to) => activity.read(from, to) };
  const servedReader = { read: lifecycle.read.bind(lifecycle), list: lifecycle.list.bind(lifecycle), withRunTreeSnapshot: lifecycle.withRunTreeSnapshot.bind(lifecycle), summaries };
  let ownsWorker: (lease: import("../../../../models/run/worker.js").WorkerLeaseRecord) => boolean = () => false;
  const projection = createOperatorProjection({ ownsWorker: lease => ownsWorker(lease), stateRoot, clock, appVersion, descriptorSetHash: setHash, ledger, database, descriptors: { resolve: id => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor }, reader: servedReader });

  const { noteWriter, runLogsHub, timelineTimer } = composeDashboardTimeline({ database, clock, loggingRepository, projection, lifecycle, startupCleanups, requiredClosure });

  const reportSupervisorFault = (error: Error): void => {
    const event = { category: "worker", phase: "failed", correlationId: randomUUID(), area: "supervisor",
      code: "WORKER_SUPERVISOR_FAILED", reason: error instanceof RuntimeCustodyUncertainError ? "custody-unproved" : "supervisor-failed" };
    debugEvents.emit(event);
    input.workerProcess?.faultSink?.(JSON.stringify(event));
  };
  const reportDashboardTransferFault = (error: Error): void => {
    const event = { category: "http", phase: "failed", correlationId: randomUUID(), area: "response-transfer",
      code: "DASHBOARD_TRANSFER_FAILED", reason: error instanceof RuntimeCustodyUncertainError ? "custody-unproved" : "transfer-failed" };
    debugEvents.emit(event);
    input.workerProcess?.faultSink?.(JSON.stringify(event));
  };
  const assertAssistantEffect = (commandId: string): void => {
    if (database.authority.assistantAuthorization.actionByCommand(commandId) === undefined) return;
    assistantAuthorization.assertEffect(commandId);
  };
  profile.runtime.beginSupervisorConstruction(profile.token);
  const nominatim = createNominatimGeocodeAdapter({clock});
  const workerControl = composeWorkerProcessControl({
    admission,
    onExit: (member, pid, valid) => profile.runtime.workerExited(admission, member, pid, valid),
    profileRoot: resolved.config.paths.browserProfileRoot,
    database,
    clock,
    scheduler: input.workerProcess?.scheduler ?? createTimeoutDeadlineScheduler(clock),
    launch: input.workerProcess?.launch ?? productionWorkerLaunch(repoRoot, env, frontend === "vite-dev"),
    spawn: input.workerProcess?.spawn ?? realWorkerProcessSpawner(input.lifetimeLock, nominatim),
    birth: input.workerProcess?.birth ?? { pollMs: WORKER_BIRTH_POLL_MS, timeoutMs: WORKER_BIRTH_TIMEOUT_MS },
    onFault: reportSupervisorFault,
    preflight: runtimePreflight,
    assertAssistantEffect,
  });
  profile.runtime.bindSupervisor(profile.token, workerControl.supervisor);
  const stopWorkerControl = requiredClosure(async () => {
    const evidence = workerControl.supervisor.close();
    if (evidence.length > 0) {
      throw new RuntimeCustodyUncertainError([new Error("dashboard worker closure is unproved")]);
    }
    await nominatim.stop();
  });
  custody.closeWorkerControl = stopWorkerControl;
  ownsWorker = lease => workerControl.supervisor.ownsWorker(lease.workerId, lease.processId, lease.lifecycle.startedAt);
  database.reconcileWorkerControlMilestones(clock.now().toISOString());
  const { writeResolution, artifacts } = prepareWriteSafety({ database, admission, lifecycle, descriptors, ids });
  await artifacts.ready;
  const artifactReader = createServerVerifiedArtifactReader({
    admission,
  });
  await artifactReader.ready;
  const { intakeParser, intakeProjections, trustReads, runDetailDeps } = composeWriteSafety({ database, lifecycle, stateRoot, projection, ownsWorker, artifacts, artifactReader });

  const explorerBoundary = composeExplorer({ clock, descriptorSetHash: setHash });

  const workflowSources = z.record(z.string(), z.enum(["mock", "served"])).parse(configuredWorkflowSources);

  let resolveQuit: () => void = () => undefined;
  const shutdownRequested = new Promise<void>(resolve => { resolveQuit = resolve; });
  const applicationLifecycle = createApplicationLifecycle({ database,
    requestQuit: input.requestApplicationQuit ?? resolveQuit,
    ...(input.updateHost === undefined ? {} : { updateHost: input.updateHost }),
    onFailure: reportSupervisorFault,
  });
  startupCleanups.push(() => applicationLifecycle.dispose());
  const kernel = createCommandKernel({
    readableDescriptors: { resolve: workflowId => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === workflowId)?.descriptor },
    workbookRows: createRunWorkbookService({ database, clock }),
    applicationQuitAvailable: true,
    preflight: runtimePreflight.admission,
    assistantSurface: () => { if (assistantSurface === undefined) throw new Error("assistant-surface-unavailable"); return assistantSurface; },
    workflowSources,
    failureResolution: composeFailureResolution(database.authority).commands,
    lifecycle,
    authority: { evidenceSchemaHash: database.evidenceSchemaHash.bind(database), withAuthorityTransaction: (work) => database.withAuthorityTransaction(repositories => { assertCurrent(); const result = work(repositories); assertCurrent(); return result; }) },
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
    authorityInstallationId: admission.profileBinding.installationId,
    prepareAssistantModelPreference: async request => {
      assertCurrent();
      if (request.requestedBy !== LOCAL_OPERATOR_ACTOR_ID || request.target.profileId !== selectedModelProfileId
        || request.target.epoch !== selectedModelEpoch) throw new Error('assistant-model-selection-refused');
      const choice = Object.freeze(AssistantModelPreferenceSchema.parse(request.payload)), identity = canonicalJsonStringify(choice);
      const assertSelectionCurrent = (): true => {
        assertSelectedModelContext();
        if (request.requestedBy !== LOCAL_OPERATOR_ACTOR_ID || request.target.profileId !== selectedModelProfileId
          || request.target.epoch !== selectedModelEpoch || canonicalJsonStringify(request.payload) !== identity) {
          throw new Error('assistant-model-selection-changed');
        }
        return true;
      };
      const prepared = await chatGptAccount.prepareAssistantModelPreference(choice, assertSelectionCurrent);
      assertSelectionCurrent();
      return prepared;
    },

    assistantRevalidate: command => {
      if (database.authority.assistantAuthorization.actionByCommand(command.commandId) === undefined) return;
        assistantAuthorization.assertEffect(command.commandId, command);
    },
  });

  const assistantAuthorization = composeProfileAssistantAuthorization(profile.runtime, profile.token, kernel, clock);
  const knowledge = assistantKnowledgeArtifact(DESCRIPTORS.filter(descriptor => workflowSources[descriptor.id] === "served").map(descriptor => ({ id: descriptor.id, label: descriptor.label })));


  const commands = createDashboardCommandService({
    quitAccepted: applicationLifecycle.quitAccepted,
    kernel,
    projection,
    startWorkerCapacity: createRunWorkerCapacity({ kernel, authority: database.authority,
      reconcileWorker: workerId => {
        const lease = database.authority.workerLeases.get(workerId);
        return lease !== undefined && isLiveWorker(lease)
          && workerControl.supervisor.ownsWorker(lease.workerId, lease.processId, lease.lifecycle.startedAt);
      } }),
  });

  const startPlans = createStartPlanService({
    workbooks: { snapshot: value => workbookLibrary.snapshot(value), catalog: () => workbookLibrary.catalog(), libraryVersion: (id, versionId) => workbookLibrary.libraryVersion(id, versionId) },
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

  const workflowStarts = createAssistantWorkflowStarts({ database, runs: lifecycle, plans: startPlans, commands,
    authorization: assistantAuthorization, descriptors, served: workflowId => workflowSources[workflowId] === "served",
    actorId: resolved.config.actor.id, clock, assertCurrent });
  const assistantTools = createProductionAssistantTools({ database, kernel, authorization: assistantAuthorization, knowledge,
    actorId: resolved.config.actor.id, clock, assertCurrent, workflowStarts,
    reads: createAssistantReadAllowlist({ runDetail: runDetailDeps, assertCurrent }) });
  const assistant = createAssistantService({ account: { ...chatGptAccount, ...context.accountAuthority },
    context: () => loadProductionAssistantContext(repoRoot, knowledge),
    runtime: () => { assertCurrent(); return knowledge.policy; },
    modelPolicy: () => { assertSelectedModelContext(); return chatGptAccount.captureAssistantModelPolicy(); },
    readModelPreference: () => captureSelectedModel().view,
    readPermission: () => assistantAuthorization.permission(),
    verifySelectedModel: async signal => {
      const captured = captureSelectedModel();
      await chatGptAccount.verifyAssistantCapability(captured.view.preference, captured.assertPreferenceCurrent, signal);
      captured.assertPreferenceCurrent();
    },
    clock, ...assistantTools,
  });


  const intake = composeIntake({ database, artifacts, parser: intakeParser, projections: intakeProjections, descriptors, clock, ids });
  const workbookCommands = createCommandBrowserManager({ admission, leases: database.authority.duoCeremonyLeases,
    clock, scheduler: createTimeoutDeadlineScheduler(clock), recordEvidence: () => {
      assertCurrent();
      debugEvents.emit({ category: "session", phase: "acquired", correlationId: randomUUID(), area: "workbook-sync",
        code: "sharepoint-authenticated", reason: "account-verified" });
    } });
  profile.runtime.registerCommandActivity(profile.token, workbookCommands);
  startupCleanups.push(requiredClosure(async () => {
    workbookCommands.requestCancellation(selected);
    await workbookCommands.awaitCancellation();
  }));
  const workbookSync = createSharePointWorkbookSync({ commands: workbookCommands, protectedSecrets,
    createDuoSource: () => createDuoCredentialStore(admission, clock),
    captureConfiguration: () => {
      assertCurrent();
      const captured = database.withAuthorityReadSnapshot(() => ({ config: activeSettingsConfig(database.authority),
        identity: canonicalJsonStringify(activeSettingsRuntimeIdentity(database.authority)) }));
      return { config: captured.config, assertCurrent: () => {
        assertCurrent();
        if (profile.runtime.selectedContext(profile.token) !== context || context.profileEpoch !== selectedModelEpoch
          || canonicalJsonStringify(activeSettingsRuntimeIdentity(database.authority)) !== captured.identity)
          throw new WorkbookLibraryError("WORKBOOK_SYNC_CONTEXT_CHANGED");
        context.assertCurrent();
      } };
    } });
  const workbookLibrary = createWorkbookLibraryService({ repository: database.authority.workbooks, clock, sync: workbookSync });

  const shell = composeShell({ database, projection, activity, clock, timeZone, ids, artifacts, descriptors, runLogsHub,
    actorLabel: () => {
      assertCurrent();
      const person = machineAdmission.readProfileRegistry().profiles.find(row => row.profileId === admission.profileBinding.profileId);
      if (person === undefined) throw new Error("PROFILE_AUTHORITY_UNAVAILABLE");
      return `${person.firstName} ${person.lastName}`;
    },
    appVersion, descriptorSetHash: setHash, backfillGaps: backfillGapNotifier,
    notificationPublications: composeNotificationPublications({ database, clock, lifecycle, descriptors, runDetailDeps, notificationInbox }),
    preflightReport: () => preflightAuthority.readLatest(), backupSummary: readBackupSummary, automaticRepair: () => readAutomaticRepairNotice(admission),
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

  const notificationTarget = createNotificationTargetQuery({ get: database.authority.notifications.get, read: id => lifecycle.read(id), failure: database.authority.failures.get });
  const chatGptOcrTest = createChatGptOcrTestService({ assertCurrent, dispatch: async (input, signal, source) => {
    const reader = createChatGptOcrPageReader({ account: chatGptAccount, artifacts: source, clock, model: CHATGPT_OCR_MODEL, assertCurrent });
    const { submitted } = await reader.readPage({ ...input, instruction: buildExtractionInstruction(input.formType) }, signal);
    assertCurrent();
    const result = admitOcrExtraction(submitted);
    if (!result.admitted) throw new ChatGptAccountError("CHATGPT_OCR_INVALID");
    return result.extraction;
  } });
  const app = createDashboardApp({
    debugEvents,
    assistant,
    chatGptOcrTest,
    chatGptAccount: {
      readAccount: () => { assertCurrent(); const result = chatGptAccount.readAccount(); assertCurrent(); return result; },
      signIn: async fields => { assertCurrent(); const result = await chatGptAccount.signIn(fields); assertCurrent(); return result; },
      signOut: async () => { assertCurrent(); const result = await chatGptAccount.signOut(); assertCurrent(); return result; },
    },
    notifications: composeNotificationRoutes({ database, clock, lifecycle, descriptors, runDetailDeps, assertCurrent, notificationObserver, notificationTarget }),
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
    applicationLifecycle,
    intake,
    ocr: createOcrSourceService({ database, reader: lifecycle, clock, artifacts, artifactReader, assertCurrent }),
    intakeCommandResult: createIntakeCommandResultQuery(database),
    workbooks: { library: workbookLibrary, intake: createWorkbookIntakeBridge(workbookLibrary, intake) },
    ...settingsBoundary.routes,
    ...composeStorage({ credentials: context.credentials, admission, repoRoot, stateRoot, backupDirectory, clock, serviceState: () => backupServiceState }),
    runHistory: { status: () => runHistory.status(), clear: request => runHistory.clear(confirmedHistoryCommand(request)),
      check: request => runHistory.check(confirmedHistoryCommand(request)) },
    ...explorerBoundary,
    activity,
    activityPopulation,
  });
  const assistantSurface = assistantSurfaceCoverage(app.routes);

  const startHttpServer = input.httpServerStarter ?? startDashboardHttpServer;
  const server: DashboardHttpServer = input.applicationTransport === undefined ? await startHttpServer({
    app,
    port: input.backendPortOverride ?? input.isolation.backendPort,
    onTransferError: reportDashboardTransferFault,
  }) : { port: input.applicationTransport.listener.port,
    close: input.applicationTransport.listener.mount(app, input.applicationTransport.accepts).close };
  custody.transportClosed = false;
  startupCleanups.push(requiredClosure(async () => {
    const failures: unknown[] = [];
    try { await server.close(); custody.transportClosed = true; } catch (error) { failures.push(error); }
    if (failures.length > 0) throw new RuntimeCustodyUncertainError(failures);
  }));
  dashboardPreflightRunners.markBackendOwned(server.port);
  void notificationObserver.observe();
  const gateParkTimer = setInterval(() => void notificationObserver.observe(), GATE_PARK_WATCH_MS);
  gateParkTimer.unref();
  startupCleanups.push(() => clearInterval(gateParkTimer));

  return composeDashboardShutdown({ profile, selected, requireProducerClosure, notificationObserver, assistantAuthorization, shutdownRequested, noteWriter, runLogsHub, timelineTimer, hub, stopWorkerControl, server, gateParkTimer, custody });
}
