import { resolveWriteCommandTarget } from "../../../runs/commands/write-command-target.js";
import { randomUUID } from "node:crypto";
import { emitFaultWithCauses, emitOptionalDiagnostic } from "../../../logs/debug-events.js";
import { join } from "node:path";
import { z } from "zod";
import configuredWorkflowSources from "../../../../../config/dashboard-workflow-sources.json" with { type: 'json' };
import { AssistantModelPreferenceSchema } from "../../../../models/config/assistant-model-preference.js";
import type { ClearRunHistoryRequest } from "../../../../models/dashboard/run-history.js";
import { createOcrStartReadiness } from "../../../runs/start/ocr-readiness.js";
import { admitOcrExtraction } from "../../../../models/ocr/extraction.js";
import { buildExtractionInstruction } from "../../../../models/ocr/instruction.js";
import { WorkerPoolMemberSchema } from "../../../../models/run/worker-slot.js";
import { requireStoppedPool, WorkerPoolError, WorkerSetupRefusedError, type WorkerMemberView } from "../../../runtime/workers/worker-pool.js";
import { LOCAL_OPERATOR_ACTOR_ID, WorkerIdSchema } from "../../../../rules/identity/ids.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { ChatGptAccountError } from "../../../accounts/chatgpt-account-service.js";
import { ProfileSessionRefusedError } from "../../../profiles/profile-errors.js";
import { createChatGptOcrTestService } from "../../../accounts/chatgpt-ocr-test.js";
import { createAssistantActivityQuery } from "../../../assistant/activity.js";
import { createAssistantPlugins } from "../../../assistant/plugins/registry.js";
import { assistantWorkflowFacts, loadAssistantWorkflowFacts, type AssistantWorkflowFacts } from "../../../assistant/plugins/workflows/facts.js";
import { assistantSurfaceCoverage, composeAssistant, createAssistantPluginDeps, startAssistantHistoryCleanup } from "./assistant.js";
import { AuthoritySourceClosureUnprovedError } from "../../../storage/source-closure.js";
import { CHATGPT_OCR_MODEL,createChatGptOcrPageReader } from "../../../processing/providers/chatgpt-ocr-adapter.js";
import { createNominatimGeocodeAdapter } from "../../../processing/providers/geocode-adapters.js";
import { createCommandKernel } from "../../../runs/commands/command-kernel.js";
import { createDashboardCommandService } from "../../../runs/commands/command-service.js";
import { createOcrSourceService } from "../../../runs/commands/ocr-source-service.js";
import { createRunWorkerCapacity, RunWorkerStartupError } from "../../../runs/commands/run-worker-capacity.js";
import { createStartPlanService } from "../../../runs/commands/start-plan-service.js";
import { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import { createApplicationLifecycle } from "../../../runs/lifecycle/application-lifecycle.js";
import type { ServedSummaryQueries } from "../../../runs/projections/run-queue-projection.js";
import { createWorkerCommandResultQuery } from "../../../runs/queries/worker-command-result.js";
import { createIntakeCommandResultQuery } from "../../../runs/queries/intake-command-result.js";
import { createRunWorkbookService } from "../../../runs/workbooks.js";
import { createRunHistoryService } from "../../../runs/commands/run-history-service.js";
import { createCommandBrowserManager } from "../../../runtime/browser/command-browser.js";
import { createPreflightReportService } from "../../../runtime/preflight/report-service.js";
import { createTimeoutDeadlineScheduler } from "../../../runtime/scheduling/timeout-deadline-scheduler.js";
import { activeSettingsConfig,activeSettingsRuntimeIdentity, readAdmittedProfileIdentity } from "../../../runtime/settings/settings-runtime.js";
import { createServerVerifiedArtifactReader } from "../../../storage/artifacts/server-verified-artifact-reader.js";
import { createDuoCredentialStore } from "../../../storage/configuration/duo-credential-store.js";
import { createTransactionHistory } from "../../../storage/sqlite/transaction-history.js";
import { historyArchivePath, readCopySeedSamples } from "../../../storage/sqlite/isolated-history-store.js";
import { startDashboardHttpServer,type DashboardHttpServer } from "../../../transports/http/http-server.js";
import { createSoloRequestIdentityCheckpoint } from "../../../transports/http/request-identity.js";
import { createDashboardApp } from "../../../transports/http/routes/api.js";
import { openStaticBundle } from "../../../transports/http/static-bundle.js";
import { createSharePointWorkbookSync } from "../../../workbooks/sharepoint-sync.js";
import { WorkbookLibraryError } from "../../../workbooks/workbook-library-error.js";
import { createWorkbookLibraryService } from "../../../workbooks/workbook-library-service.js";
import { DESCRIPTORS,READABLE_WORKFLOW_MODULES } from "../../registries/workflow-registry.js";
import { RuntimeCustodyUncertainError } from "../storage-compose.js";
import { composeActivity } from "./activity.js";
import { composeDataQueries } from "./data.js";
import { composeExplorer } from "./explorer.js";
import { composeFailureResolution } from "./failure-resolution.js";
import { composeIntake } from "./intake.js";
import { composeNotificationPublications,composeNotificationReads,composeNotificationRoutes,createHistoryNotificationTarget } from "./notification-wiring.js";
import { composeQueueSummaries } from "./queue-summaries.js";
import { createOperatorProjection } from "./queue.js";
import { createCopySamples } from "./copy-samples.js";
import type { DashboardRuntime } from "./runtime-contracts.js";
import { type DashboardComposeInput,type StartupCleanup,type StartupCustody } from "./runtime-contracts.js";
import { prepareDashboardEnvironment,prepareDashboardRuntime } from "./runtime-resources.js";
import { composeShell } from "./shell.js";
import { composeDashboardShutdown } from "./shutdown-custody.js";
import { composeStorage } from "./storage.js";
import { startNotificationPolling } from "./notifications.js";
import { composeDashboardTimeline } from "./timeline.js";
import { composeWorkerPool,productionWorkerLaunch,realWorkerProcessSpawner } from "./worker-process.js";
import { composeWriteSafety,prepareWriteSafety } from "./write-safety.js";
import { readRunPanel } from "../../../runs/queries/run-detail.js";


const DASHBOARD_WORKFLOW_SOURCES = ["served", "hidden"] as const;
type DashboardWorkflowSource = (typeof DASHBOARD_WORKFLOW_SOURCES)[number];

export class DashboardWorkflowSourceRefusedError extends Error {
  readonly name = "DashboardWorkflowSourceRefusedError";

  constructor(readonly workflowId: string, readonly value: unknown) {
    super(`config/dashboard-workflow-sources.json: workflow ${workflowId} has source ${JSON.stringify(value)}; expected "served" or "hidden"`);
  }
}

function parseDashboardWorkflowSources(configured: unknown): Readonly<Record<string, DashboardWorkflowSource>> {
  const sources: Record<string, DashboardWorkflowSource> = {};
  for (const [workflowId, value] of Object.entries(z.record(z.string(), z.unknown()).parse(configured))) {
    const source = DASHBOARD_WORKFLOW_SOURCES.find(candidate => candidate === value);
    if (source === undefined) throw new DashboardWorkflowSourceRefusedError(workflowId, value);
    sources[workflowId] = source;
  }
  return Object.freeze(sources);
}

export async function composeDashboardRuntimeStartup(input: DashboardComposeInput, startupCleanups: StartupCleanup[], custody: StartupCustody): Promise<DashboardRuntime> {
  const workflowSources = parseDashboardWorkflowSources(configuredWorkflowSources);
  const environment = prepareDashboardEnvironment(input, custody);
  const { repoRoot, frontend } = environment;
  const staticBundle = frontend === "built-bundle"
    ? await openStaticBundle(join(repoRoot, "dist", "dashboard"), repoRoot, input.frontendBuildScript)
    : undefined;


  let wakeForWork: (workflowId: string) => void = () => undefined;
  const resources = prepareDashboardRuntime(input, startupCleanups, custody, environment, staticBundle, workflowId => wakeForWork(workflowId));
  const { settingsProcesses } = resources;
  const { logWriter, stopLogWriter } = resources;
  const { requiredClosure, requireProducerClosure, dashboardPreflightRunners, env, clock, ids, machineAdmission, profile, assertCurrent, selected, stateRoot, appVersion, context, database, admission, chatGptAccount, selectedModelProfileId, selectedModelEpoch, assertSelectedModelContext, captureSelectedModel, resolved, protectedSettingsAuthority, protectedSecrets, settingsBoundary, configSnapshotId, backupDirectory, backupServiceState, loggingRepository, debugEvents, loopDelayMonitor, descriptors, setHash, runtimePreflight, lifecycle, backfillGapNotifier, notificationInbox, notificationObserver, preflightAuthority, readLanes } = resources;
  const history = database.dashboardHistory();
  // A copy profile serves its sample runs and Sessions cards from the history archive; production never attaches one.
  const samples = history === database ? undefined : createCopySamples({ stored: readCopySeedSamples(historyArchivePath(stateRoot), admission.profileBinding),
    realSlots: () => database.authority.workerSlots.list(), changed: () => { projection.reconcileWorkerAuthority(); } });
  const notificationReads = composeNotificationReads(database, history);
  const reader = history === database ? lifecycle : new RunRecordService({ database: history, clock, ids,
    publishQueued: () => { throw new Error("isolated-history-read-only"); }, resolveDescriptor: descriptors.resolve });
  const ledger = createTransactionHistory(history.authority);
  const runHistory = createRunHistoryService({ database, lifecycle, afterClear: () => { assertCurrent(); projection.rebuildFromTimeline(); } });
  const confirmedHistoryCommand = (request: ClearRunHistoryRequest) => {
    if (request.target.profileId !== admission.profileBinding.profileId || request.target.epoch !== context.profileEpoch) {
      throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    }
    assertCurrent();
    if (profile.runtime.selectedContext(profile.token) !== context) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    context.assertCurrent();
    return { commandId: request.commandId };
  };

  const { activity, activityPopulation, reports, readActivityDocument } = composeActivity({ database: history, clock, descriptors, ledger, readLanes });
  const summaries: ServedSummaryQueries = { ...composeQueueSummaries(history), activity: (from, to) => reports.read(from, to) };
  const servedReader = { read: reader.read.bind(reader), list: reader.list.bind(reader), withRunTreeSnapshot: reader.withRunTreeSnapshot.bind(reader), summaries };
  let snapshotWorkers: () => readonly WorkerMemberView[] = () => [];
  const workerMembers = (): readonly WorkerMemberView[] => samples === undefined ? snapshotWorkers() : [...snapshotWorkers(), ...samples.views()];
  let startupPending: (workflowId: string) => boolean = () => false;
  const projection = createOperatorProjection({ workerMembers, workerStartupPending: workflowId => startupPending(workflowId), stateRoot, clock, appVersion, descriptorSetHash: setHash, ledger, database: history, descriptors: { resolve: id => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === id)?.descriptor }, reader: servedReader, readLanes, samples });

  const { noteWriter, stopTimeline, diagnosticRetentionTimer } = composeDashboardTimeline({ database, clock, loggingRepository, projection, startupCleanups, admission, readLanes, lifecycle, debugEvents });

  const reportSupervisorFault = (error: Error, origin?: Readonly<{ workerId: string; pid?: number }>): void => {
    if (error instanceof RunWorkerStartupError && error.cause instanceof WorkerSetupRefusedError) return;
    if (error instanceof WorkerSetupRefusedError) {
      const event = { category: "worker", area: "supervisor", phase: "failed", correlationId: randomUUID(),
        code: error.code, message: error.message, reason: "setup-refused" };
      void debugEvents.emit(event, origin === undefined ? undefined : { kind: "worker", workerId: WorkerIdSchema.parse(origin.workerId) });
      input.workerProcess?.faultSink?.(JSON.stringify(event));
      return;
    }
    const detail = error instanceof WorkerPoolError ? error.detail : {}, pid = origin?.pid ?? detail.pid;
    emitFaultWithCauses(debugEvents, input.workerProcess?.faultSink, error, { category: "worker", area: "supervisor", code: "WORKER_SUPERVISOR_FAILED",
      reason: error instanceof RuntimeCustodyUncertainError ? "custody-unproved" : "supervisor-failed",
      ...(origin === undefined ? {} : { message: [`workerId=${origin.workerId}`, ...(pid === undefined ? [] : [`pid=${String(pid)}`]),
        ...(detail.field === undefined ? [] : [`field=${detail.field}`])].join(" ") }) });
  };
  const reportDashboardTransferFault = (error: Error): void => {
    emitFaultWithCauses(debugEvents, input.workerProcess?.faultSink, error, { category: "http", area: "response-transfer", code: "DASHBOARD_TRANSFER_FAILED",
      reason: error instanceof RuntimeCustodyUncertainError ? "custody-unproved" : "transfer-failed" });
  };
  const assertAssistantEffect = (commandId: string): void => { composedAssistant.assertEffect(commandId); };
  profile.runtime.beginSupervisorConstruction(profile.token);
  const nominatim = createNominatimGeocodeAdapter({clock});
  const spawnWorker = realWorkerProcessSpawner(input.lifetimeLock, nominatim, logWriter);
  const workers = composeWorkerPool({
    admission,
    sessionGeneration: context.profileEpoch,
    profileRoot: resolved.config.paths.browserProfileRoot,
    database,
    clock,
    scheduler: input.workerProcess?.scheduler ?? createTimeoutDeadlineScheduler(clock),
    ids,
    launch: input.workerProcess?.launch ?? productionWorkerLaunch(repoRoot, env, frontend === "vite-dev"),
    spawn: request => input.workerProcess?.spawn?.(request, spawnWorker) ?? spawnWorker(request),
    settleExit: member => { profile.runtime.workerExited(admission, WorkerPoolMemberSchema.parse(member)); },
    onChange: () => { projection.reconcileWorkerAuthority(); },
    onFault: reportSupervisorFault,
    onStopChannelClosed: error => { void debugEvents.emit({ category: "worker", phase: "settled", correlationId: randomUUID(), area: "supervisor",
      reason: "stop-channel-closed", code: (error as NodeJS.ErrnoException).code }); },
    preflight: runtimePreflight,
    assertAssistantEffect,
  });
  snapshotWorkers = () => workers.pool.snapshot();
  wakeForWork = workers.pool.wakeForWork;
  profile.runtime.bindSupervisor(profile.token, workers.pool);
  const stopWorkerControl = requiredClosure(async () => {
    try {
      requireStoppedPool(await workers.pool.stopAll("shutdown"));
      await nominatim.stop();
    } finally { await stopLogWriter(); }
  });
  custody.closeWorkerControl = stopWorkerControl;
  const { writeResolution, artifacts } = prepareWriteSafety({ database, admission, lifecycle, descriptors, ids });
  await artifacts.ready;
  const artifactReader = createServerVerifiedArtifactReader({
    admission,
  });
  await artifactReader.ready;
  const { intakeParser, intakeProjections, trustReads, runDetailDeps } = composeWriteSafety({ database, lifecycle, history, reader, stateRoot, projection, workerMembers, artifacts, artifactReader, readLanes,
    operatorName: () => { assertCurrent(); return readAdmittedProfileIdentity(machineAdmission, admission).displayName; } });

  const explorerBoundary = composeExplorer({ clock, descriptorSetHash: setHash });

  const servedDescriptors = DESCRIPTORS.filter(descriptor => workflowSources[descriptor.id] === "served");
  // The manifest identity hashes the facts from the running definitions; the on-disk pin is checked only when the assistant runs.
  const factsSha256 = assistantWorkflowFacts(servedDescriptors).sha256;
  let pinnedFacts: AssistantWorkflowFacts | undefined;
  const assistantFacts = () => pinnedFacts ??= loadAssistantWorkflowFacts(repoRoot, servedDescriptors);

  let resolveQuit: () => void = () => undefined;
  const shutdownRequested = new Promise<void>(resolve => { resolveQuit = resolve; });
  const applicationLifecycle = createApplicationLifecycle({ database,
    requestQuit: input.requestApplicationQuit ?? resolveQuit,
    ...(input.updateHost === undefined ? {} : { updateHost: input.updateHost }),
    onFailure: reportSupervisorFault,
  });
  startupCleanups.push(() => applicationLifecycle.dispose());
  // The kernel is made before the hub, so its ordinary settings commits reach the hub through this source.
  const settingsChanges = new Set<() => void>();
  const publishSettingsChanged = () => { for (const listener of [...settingsChanges]) listener(); };
  const ocrReadiness = createOcrStartReadiness(chatGptAccount, CHATGPT_OCR_MODEL);
  const nativeKernel = createCommandKernel({
    commandNotices: notificationInbox,
    ensureReceipt: runId => trustReads.trust.ensureReceipt(runId),
    readableDescriptors: { resolve: workflowId => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === workflowId)?.descriptor },
    workbookRows: createRunWorkbookService({ database, clock,
      resolveDescriptor: workflowId => READABLE_WORKFLOW_MODULES.find(module => module.descriptor.id === workflowId)?.descriptor }),
    applicationQuitAvailable: true,
    preflight: runtimePreflight.admission,
    ...ocrReadiness,
    assistantSurface: () => { if (assistantSurface === undefined) throw new Error("assistant-surface-unavailable"); return assistantSurface; },
    workflowSources,
    assistantFactsSha256: () => factsSha256,
    failureResolution: composeFailureResolution(database.authority).commands,
    lifecycle,
    authority: { evidenceSchemaHash: database.evidenceSchemaHash.bind(database), withAuthorityTransaction: (work) => database.withAuthorityTransaction(repositories => { assertCurrent(); const result = work(repositories); assertCurrent(); return result; }),
      afterAuthorityCommit: publish => database.afterAuthorityCommit(publish) },
    clock,
    ids,

    appVersion,
    descriptors,
    writeResolution,
    workerRuntime: { pool: workers.seam },
    intakeParser,
    intakeProjections,

    configIdentity: { configFingerprint: resolved.fingerprint, configSnapshotId },
    settings: settingsBoundary.executor,
    settingsCommitted: publishSettingsChanged,
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

    assistantRevalidate: command => { composedAssistant.assertEffect(command.commandId, command); },
  });

  const kernel = samples?.guard(nativeKernel) ?? nativeKernel;


  const startWorkerCapacity = createRunWorkerCapacity({ kernel, authority: database.authority, running: workers.running, ensureRunning: workers.ensureRunning, setupRefusal: workers.setupRefusal,
    own: workers.own, reportDetachedFailure: reportSupervisorFault, startupPendingChanged: () => { projection.reconcileWorkerAuthority(); } });
  startupPending = startWorkerCapacity.startupPending;
  const commands = createDashboardCommandService({
    commandNotices: notificationInbox,
    quitAccepted: applicationLifecycle.quitAccepted,
    kernel,
    projection,
    startWorkerCapacity,
    ...(settingsProcesses === undefined ? {} : { async executeOrdinarySettings(command) {
      composedAssistant.assertEffect(command.commandId, command);
      const result = await settingsProcesses.execute(command);
      assertCurrent();
      if (result.state === "applied") publishSettingsChanged();
      return result;
    } }),
  });

  const nativeStartPlans = createStartPlanService({
    workbooks: { createReferenceCapture: () => workbookLibrary.createReferenceCapture() },
    preflight: runtimePreflight.admission,
    ...ocrReadiness,
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
  const startPlans = samples?.guardStartPlans(nativeStartPlans) ?? nativeStartPlans;

  const notificationTarget = createHistoryNotificationTarget(history, reader);
  const notifications = composeNotificationRoutes({ database: history, clock, lifecycle: reader, descriptors, runDetailDeps, assertCurrent, notificationObserver, notificationTarget, notificationReads, readLanes,
    reportListReadFailure: () => { emitOptionalDiagnostic(() => debugEvents.emit({ category: "sse", phase: "failed",
      correlationId: randomUUID(), area: "notification-list", reason: "poll-read-failed" })); } });
  const nativeDataQueries = composeDataQueries(runDetailDeps);
  const dataQueries = { ...nativeDataQueries, rerunValues: (request: unknown) => samples?.rerunValues(request) ?? nativeDataQueries.rerunValues(request) };
  const ocrSources = createOcrSourceService({ database, reader: lifecycle, clock, artifacts, artifactReader, assertCurrent });
  const attachment = (conversationId: string, id: string) => database.authority.assistantHistory.attachment(conversationId, id, clock.now().toISOString());
  const assistantPluginDeps = createAssistantPluginDeps({ database, runs: lifecycle, runDetail: runDetailDeps, assertCurrent, facts: assistantFacts,
    search: () => shell.search, notifications: () => notifications, workbooks: () => workbookLibrary, attachment, clock,
    edits: { apply: (context, work) => composedAssistant.applyEdit(context, work),
      notification: notificationId => database.authority.notifications.get(notificationId), workbooks: () => workbookLibrary } });
  database.bindAssistantEpoch(() => context.profileEpoch);
  const composedAssistant: ReturnType<typeof composeAssistant> = composeAssistant({ database, executeEditCommand: command => commands.execute(command), readPlugins: () => createAssistantPlugins(assistantPluginDeps),
    starts: { descriptors, served: workflowId => workflowSources[workflowId] === "served", plans: startPlans, runs: lifecycle,
      rerunValues: request => dataQueries.rerunValues(request), attachment, ocrSources: () => ocrSources, submit: command => commands.submit(command) },
    service: { debugEvents, account: { ...chatGptAccount, ...context.accountAuthority },
      activity: createAssistantActivityQuery({ database, clock, assertCurrent, workflowLabel: workflowId => {
        const descriptor = descriptors.resolve(workflowId);
        if (descriptor === undefined) throw new Error(`assistant-activity-workflow-missing:${workflowId}`);
        return descriptor.label;
      } }),
      assertComposition: assertCurrent, actorId: resolved.config.actor.id, facts: assistantFacts,
      owner: () => { assertCurrent(); return { profileId: context.admission.profileBinding.profileId, epoch: context.profileEpoch }; },
      runReferenceLabel: (runId, version) => assistantPluginDeps.runReferenceLabel(runId, version),
      selectedModel: () => { const captured = captureSelectedModel(); return { preference: captured.view.preference, assertCurrent: captured.assertPreferenceCurrent }; },
      readModelPreference: () => captureSelectedModel().view,
      readSession: runId => { const read = lifecycle.read(runId), surface = runDetailDeps.projection.queueSurface(runId);
        return read.state === "present" && surface !== undefined ? { run: read.run, surface } : undefined; },
      clock },
  });
  const assistant = composedAssistant.assistant;


  const intake = composeIntake({ database, artifacts, parser: intakeParser, projections: intakeProjections, descriptors, clock, ids });
  const workbookCommands = createCommandBrowserManager({ admission, leases: database.authority.duoCeremonyLeases,
    clock, scheduler: createTimeoutDeadlineScheduler(clock), recordEvidence: () => {
      assertCurrent();
      void debugEvents.emit({ category: "session", phase: "acquired", correlationId: randomUUID(), area: "workbook-sync",
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
  const workbookReadPosition = database.trackAuthorityTables([
    "workbook_library", "workbook_library_state", "workbook_library_snapshots", "workbook_payloads",
    "workbook_types", "workflow_workbook_selections",
  ]);

  const shell = composeShell({ workbookCompatibility: workflows => workbookLibrary.compatibility(workflows), database, readLanes, projection, activity: reports, readActivityDocument, clock, ids, artifacts, descriptors,
    actorLabel: () => {
      assertCurrent();
      const person = machineAdmission.readProfileRegistry().profiles.find(row => row.profileId === admission.profileBinding.profileId);
      if (person === undefined) throw new Error("PROFILE_AUTHORITY_UNAVAILABLE");
      return `${person.firstName} ${person.lastName}`;
    },
    appVersion, descriptorSetHash: setHash, backfillGaps: backfillGapNotifier,
    notificationPublications: composeNotificationPublications({ database, clock, lifecycle, descriptors, runDetailDeps, notificationInbox, target: notifications.target }),
    notificationList: notifications.streamList,
    notificationStatus: { read: () => notifications.status(), onChange: listener => notificationObserver.onStatusChange(listener) },
    runPanels: { read: (runId, signal) => readRunPanel(runDetailDeps, runId, signal) },
    settings: { read: settingsBoundary.editable, onChange: listener => {
      settingsChanges.add(listener);
      const stop = settingsBoundary.onChange(listener);
      return () => { settingsChanges.delete(listener); stop(); };
    } },
    preflightReport: () => preflightAuthority.readLatest(),
  });
  const { hub } = shell;
  startupCleanups.push(requiredClosure(() => hub.close()));

  const initialPreflight = await preflightAuthority.refresh(new AbortController().signal);
  await resources.bootImport;
  assertCurrent();
  input.onInitialPreflight?.(initialPreflight);
  // Boot spawns the standing members; each one that fails shows on its card with its cause.
  void workers.startActive();

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
    debugReportRunReader: lifecycle,
    assistant,
    chatGptOcrModel: CHATGPT_OCR_MODEL,
    chatGptOcrTest,
    chatGptAccount: {
      readStatus: () => { assertCurrent(); return chatGptAccount.readStatus(); },
      checkStatus: async (signal, options) => { assertCurrent(); const result = await chatGptAccount.checkStatus(signal, options); assertCurrent(); return result; },
      signIn: async fields => { assertCurrent(); const result = await chatGptAccount.signIn(fields); assertCurrent(); return result; },
      signOut: async () => { assertCurrent(); const result = await chatGptAccount.signOut(); assertCurrent(); return result; },
    },
    notifications,
    ...(staticBundle === undefined ? {} : { staticBundle }),
    requestIdentity: { identify: request => {
      if (input.applicationTransport === undefined) assertCurrent();
      else input.applicationTransport.consumeAdmission(request);
      return createSoloRequestIdentityCheckpoint(resolved.config.actor).identify(request);
    } },
    preflight: createPreflightReportService({ dashboard: preflightAuthority, runtime: runtimePreflight, clock }),
    ...shell,
    projection,
    runDetail: runDetailDeps,
    data: dataQueries,
    diagnosticBundles: trustReads.diagnosticBundles,
    commands,
    resolveWriteCommand: request => resolveWriteCommandTarget(request, database.authority),
    commandJournal: database.authority.commands,
    ...(samples === undefined ? {} : { refuseSampleCommand: samples.refuseRun }),
    protectedCommandAcceptedAt: (commandId) => protectedSettingsAuthority.acceptedAt(commandId),
    bulkCommandAcceptances: {
      withTransaction: (work) => database.withAuthorityTransaction((repositories) => {
        assertCurrent(); const result = work({ get: repositories.commands.getBulk, insert: repositories.commands.acceptBulk }); assertCurrent(); return result; }),
    },
    startPlans,
    applicationLifecycle,
    intake,
    ocr: ocrSources,
    intakeCommandResult: createIntakeCommandResultQuery(database),
    workerCommandResult: createWorkerCommandResultQuery(database),
    workbooks: { library: workbookLibrary, workflows: shell.bootstrap.modules.map(module => module.descriptor),
      withReadPosition: serve => database.withAuthorityReadSnapshot(() => {
        assertCurrent();
        const response = serve(workbookReadPosition());
        assertCurrent();
        return response;
      }),
    },
    ...settingsBoundary.routes,
    ...composeStorage({ credentials: context.credentials, admission, repoRoot, stateRoot, backupDirectory, clock, serviceState: () => backupServiceState }),
    runHistory: { clear: request => runHistory.clear(confirmedHistoryCommand(request)),
      check: request => runHistory.check(confirmedHistoryCommand(request)) },
    ...explorerBoundary,
    activity,
    activityPopulation,
  });
  const assistantSurface = assistantSurfaceCoverage(app.routes);

  // Unfinished sends become delivery-unknown before any history route serves; expired chats are reclaimed now and hourly.
  database.authority.assistantHistory.settleInterrupted(clock.now().toISOString());
  database.authority.assistantHistory.reclaimExpired(clock.now().toISOString());
  const startHttpServer = input.httpServerStarter ?? startDashboardHttpServer;
  const observation = { clock, debugEvents };
  const server: DashboardHttpServer = input.applicationTransport === undefined ? await startHttpServer({
    app,
    port: input.backendPortOverride ?? input.isolation.backendPort,
    onTransferError: reportDashboardTransferFault,
    observation,
  }) : { port: input.applicationTransport.listener.port,
    close: input.applicationTransport.listener.mount(app, input.applicationTransport.accepts, observation).close };
  custody.transportClosed = false;
  startupCleanups.push(requiredClosure(async () => {
    const failures: unknown[] = [];
    try { await server.close(); custody.transportClosed = true; } catch (error) { failures.push(error); }
    if (failures.length > 0) throw new RuntimeCustodyUncertainError(failures);
  }));
  dashboardPreflightRunners.markBackendOwned(server.port);
  const gateParkTimer = startNotificationPolling(database, clock, notificationObserver, notifications.pollList);
  startupCleanups.push(() => clearInterval(gateParkTimer));
  const historyTimer = startAssistantHistoryCleanup(() => { database.authority.assistantHistory.reclaimExpired(clock.now().toISOString()); }, error => {
    const event = { category: "worker", phase: "failed", correlationId: randomUUID(), area: "assistant-history-cleanup", code: "ASSISTANT_HISTORY_CLEANUP_FAILED",
      reason: error instanceof RuntimeCustodyUncertainError || error instanceof AuthoritySourceClosureUnprovedError ? "custody-unproved" : "cleanup-failed" };
    void debugEvents.emit(event);
    input.workerProcess?.faultSink?.(JSON.stringify(event));
  });
  startupCleanups.push(() => clearInterval(historyTimer));

  return composeDashboardShutdown({ profile, selected, requireProducerClosure, notificationObserver, loopDelayMonitor, shutdownRequested, noteWriter, stopTimeline, readLanes, settingsProcesses, diagnosticRetentionTimer, hub, stopLogWriter, stopWorkerControl, takeWorkerStopFailures: workers.pool.takeShutdownStopFailures, server, gateParkTimer, historyTimer, custody });
}
