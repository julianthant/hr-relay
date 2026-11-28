import { readFileSync } from "node:fs";
import { join } from "node:path";
import { hostConfigFacts } from "../../../../models/config/host-display.js";
import { assertNoMigratedEnvironmentKeys,hostAwareResolutionEnvironment } from "../../../../models/config/secrets.js";
import { ASSISTANT_DEFAULT_EFFORT,ASSISTANT_DEFAULT_MODEL,AssistantModelPreferenceViewSchema } from '../../../../models/dashboard/assistant.js';
import { BackupServiceStateSchema,type BackupServiceState } from "../../../../models/storage/storage-status.js";
import { systemIdFactory } from "../../../../rules/identity/identifiers.js";
import { ActorIdSchema,LOCAL_OPERATOR_ACTOR_ID } from "../../../../rules/identity/ids.js";
import { systemClock } from "../../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { createDebugEventWriter } from "../../../logs/debug-events.js";
import { composeLoopDelayMonitor } from "../../../logs/loop-delay.js";
import { appendEmergencyFault, withEmergencyTimelineWriter } from "../../../logs/emergency-faults.js";
import { importLocalDebugLog } from "../../../storage/events/local-debug-log.js";
import { startLogWriter } from "../../../storage/events/log-writer.js";
import { runQueuedSpanEvent } from "../../../runs/commands/run-queued-span.js";
import { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import { reconcileStartupCrash } from "../../../runs/lifecycle/startup-crash-recovery.js";
import { activeSettingsRuntimeIdentity,readBootSettings,startSettingsKeepAwake } from "../../../runtime/settings/settings-runtime.js";
import { requireRuntimeAdmission } from "../../../storage/admission/admission-identity.js";
import { createDuoCredentialStore } from "../../../storage/configuration/duo-credential-store.js";
import { createTimelineEmitter } from "../../../storage/events/timeline-emitter.js";
import { AuthoritySourceClosureUnprovedError } from "../../../storage/source-closure.js";
import { DASHBOARD_LAUNCH_NONCE_ENV } from "../../../transports/http/frontend-owner.js";
import { openStaticBundle } from "../../../transports/http/static-bundle.js";
import { probePrimaryDisplay } from "../../host/primary-display.js";
import { createDashboardPreflight } from "../../preflight/dashboard-runners.js";
import { composeRuntimePreflight } from "../../preflight/runtime-admission.js";
import { DESCRIPTORS,SERVER_REGISTRY,descriptorSetHash } from "../../registries/workflow-registry.js";
import { RuntimeCustodyUncertainError } from "../storage-compose.js";
import { createTrustNotifications } from "./notifications.js";
import { ownedDiagnostics } from "./notification-health.js";
import { DashboardFrontendModeSchema,PackageVersionSchema,type DashboardComposeInput,type StartupCleanup,type StartupCustody } from "./runtime-contracts.js";
import { composeSettings } from "./settings.js";
import { createDashboardReadHost, ReadLaneStartError } from "../../../storage/sqlite/dashboard-read-host.js";
import { assertRetainedProfileBrowserRoot } from "../../../storage/maintenance/profile-custody.js";

export function createComposedDashboardReadHost(input: Omit<Parameters<typeof createDashboardReadHost>[0], "entry">) {
  return createDashboardReadHost({ ...input, entry: new URL("./read-lane-entry.js", import.meta.url) });
}

export function prepareDashboardEnvironment(input: DashboardComposeInput, custody: StartupCustody) {
  const requireProducerClosure = (): void => {
    if (custody.failedClosures.length > 0) throw new RuntimeCustodyUncertainError(custody.failedClosures);
  };
  const requiredClosure = (close: StartupCleanup): StartupCleanup => async () => {
    try { await close(); }
    catch (error) { custody.failedClosures.push(error); throw new RuntimeCustodyUncertainError([error]); }
  };
  const env = input.env ?? hostAwareResolutionEnvironment(probePrimaryDisplay);
  assertNoMigratedEnvironmentKeys(env);
  const clock = input.clock ?? systemClock;
  const ids = input.ids ?? systemIdFactory;
  const repoRoot = input.repoRoot ?? process.cwd();
  const machineAdmission = requireRuntimeAdmission(input.admission);
  if (machineAdmission.lifetime !== input.lifetimeLock) throw new Error("runtime-lifetime-admission-mismatch");
  const installation = machineAdmission.readInstallationContext();
  if (installation === undefined) throw new Error("profile-application-installation-required");
  const profile = input.profile;
  if (profile === undefined) throw new Error("PROFILE_AUTHORITY_UNAVAILABLE");
  profile.runtime.assertMachineOwner(machineAdmission);
  profile.runtime.assertCurrent(profile.token);
  const assertCurrent = () => profile.runtime.assertCurrent(profile.token);
  const selected = machineAdmission.readProfileRegistry().activeProfileId;
  if (selected === null) throw new Error("PROFILE_AUTHORITY_UNAVAILABLE");
  const stateRoot = join(machineAdmission.stateRoot, "profiles", selected);
  const artifactRoot = join(stateRoot, "artifacts");
  const runtimeStoragePair = Object.freeze({ stateRoot, artifactRoot });
  const appVersion = PackageVersionSchema.parse(
    JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")),
  ).version;
  // Validate the production bundle before opening authority, locks or sockets.
  const frontend = DashboardFrontendModeSchema.default("vite-dev").parse(input.frontend);
  return { requireProducerClosure, requiredClosure, env, clock, ids, repoRoot, machineAdmission, profile, assertCurrent, selected, stateRoot, artifactRoot, runtimeStoragePair, appVersion, frontend };
}

export function prepareDashboardRuntime(input: DashboardComposeInput, startupCleanups: StartupCleanup[], custody: StartupCustody, environment: ReturnType<typeof prepareDashboardEnvironment>, staticBundle: Awaited<ReturnType<typeof openStaticBundle>> | undefined, wakeForWork: (workflowId: string) => void) {
  const { requireProducerClosure, requiredClosure, env, clock, ids, repoRoot, machineAdmission, profile, assertCurrent, selected, stateRoot, artifactRoot, runtimeStoragePair, appVersion, frontend } = environment;
  const hostFacts = hostConfigFacts(env);
  let databaseClosed = true;
  startupCleanups.push(() => {
    requireProducerClosure();
    if (!databaseClosed || !custody.transportClosed) {
      throw new RuntimeCustodyUncertainError([new Error("dashboard authority closure is unproved")]);
    }
  });
  const context = (() => {
    try { return profile.runtime.selectedContext(profile.token); }
    catch (error) { if (error instanceof RuntimeCustodyUncertainError) databaseClosed = false; throw error; }
  })();
  const { database, admission, account: chatGptAccount } = context;
  const selectedModelProfileId = admission.profileBinding.profileId, selectedModelEpoch = context.profileEpoch;
  const assertSelectedModelContext = (): true => {
    assertCurrent();
    if (profile.runtime.selectedContext(profile.token) !== context || context.profileEpoch !== selectedModelEpoch
      || admission.profileBinding.profileId !== selectedModelProfileId) throw new Error('assistant-model-context-changed');
    context.assertCurrent();
    return true;
  };
  const captureSelectedModel = () => database.withAuthorityReadSnapshot(() => {
    assertSelectedModelContext();
    const record = database.authority.assistantModelPreference.get();
    const identity = record === undefined ? undefined : canonicalJsonStringify(record);
    const view = AssistantModelPreferenceViewSchema.parse({ profileId: selectedModelProfileId, epoch: selectedModelEpoch,
      ...(record === undefined
        ? { revision: 0, preference: { slug: ASSISTANT_DEFAULT_MODEL, effort: ASSISTANT_DEFAULT_EFFORT } }
        : { revision: record.revision, preference: record.preference }) });
    const assertPreferenceCurrent = (): true => {
      assertSelectedModelContext();
      const current = database.authority.assistantModelPreference.get();
      if ((current === undefined ? undefined : canonicalJsonStringify(current)) !== identity) throw new Error('assistant-model-preference-changed');
      return true;
    };
    assertSelectedModelContext();
    return { view, assertPreferenceCurrent };
  });

  // A failed startup is no logout: keep live runs for the next start, as a shutdown does.
  custody.revoke = () => profile.runtime.beginClose("shutdown");
  databaseClosed = false;
  const prepareRuntimeClosure = (): Promise<void> => {
    profile.runtime.beginClose("shutdown");
    return profile.runtime.awaitClosurePreparation(admission.profileBinding.profileId);
  };
  startupCleanups.push(async () => {
    requireProducerClosure();
    if (!custody.transportClosed) throw new RuntimeCustodyUncertainError([new Error("dashboard HTTP closure is unproved")]);
    await prepareRuntimeClosure();
    await custody.closeWorkerControl?.();
    await profile.runtime.close();
    databaseClosed = true;
  });
  // Read lanes boot on their own threads while the rest of startup runs; they close before the store they read.
  const readLanes = (() => {
    try { return createComposedDashboardReadHost({ admission, database, clock }); }
    catch (error) {
      // Lanes that did start still hold the store: the unwind joins them before it closes the database.
      if (error instanceof ReadLaneStartError) startupCleanups.push(requiredClosure(() => error.exited));
      throw error;
    }
  })();
  startupCleanups.push(requiredClosure(() => readLanes.close()));
  const statePath = join(stateRoot, "state.db");
  admission.assertAuthorityDatabase(statePath);
  const logWriter = startLogWriter({ statePath, root: stateRoot, onFault: error => {
    try { appendEmergencyFault({ stateRoot, build: appVersion, now: clock.now(), error,
      code: "LOG_WRITER_FAILED", area: "log-writer", reason: "database-unavailable" }); }
    catch { input.workerProcess?.faultSink?.(JSON.stringify({ code: "LOG_WRITER_FAILED", reason: "boot-log-unavailable" })); }
  } });
  const unbindLogPublisher = database.bindLogPublisher(logWriter.publish);
  const stopLogWriter = () => {
    unbindLogPublisher();
    return logWriter.close();
  };
  startupCleanups.push(stopLogWriter);
  importLocalDebugLog(stateRoot, database.authority.timelineEvents);
  importLocalDebugLog(machineAdmission.stateRoot, database.authority.timelineEvents);
  database.sweepOrdinaryDiagnostics(clock.now().toISOString());
  const bootConfig = (() => {
    const persistedSettings = database.withAuthorityTransaction((repositories) => readBootSettings(repositories));
    return Object.freeze({
      persistedSettings,
      resolved: context.resolveSettings(persistedSettings.settings),
    });
  })();
  const { persistedSettings, resolved } = bootConfig;
  const protectedSettingsAuthority = context.credentials;
  const settingsProcesses = input.profileSettingsProcesses?.(admission, input.lifetimeLock, context.profileEpoch, hostFacts, assertCurrent);
  if (settingsProcesses !== undefined) startupCleanups.push(requiredClosure(() => settingsProcesses.close()), requiredClosure(() => settingsProcesses.closeCommands()));
  const protectedSecrets = { read: () => { assertCurrent(); const result = context.protectedSecrets.read(); assertCurrent(); return result; } };
  const settingsBoundary = composeSettings({ database, readLanes, hostFacts, clock, active: activeSettingsRuntimeIdentity,
    environment: env, credentials: protectedSettingsAuthority,
    ...(settingsProcesses === undefined ? {} : { readProtectedSettings: () => settingsProcesses.read() }),
    runtimeStoragePair,
    resolveSettings: settings => { assertCurrent(); const result = context.resolveSettings(settings); assertCurrent(); return result; }, assertCurrent,
    assertBrowserRoot: path => { assertRetainedProfileBrowserRoot(context.admission, path); } });

  const now = clock.now().toISOString();
  const configSnapshotId = ids.uuid();
  database.withAuthorityTransaction((repositories) => {
    const snapshot = {
      configSnapshotId,
      revision: persistedSettings.revision,
      fingerprint: resolved.fingerprint,
      capturedAt: now,
      capturedBy: LOCAL_OPERATOR_ACTOR_ID,
      config: resolved.config,
      preferences: resolved.preferences, preferencesFingerprint: resolved.preferencesFingerprint,
      provenance: resolved.provenance,
    };
    if (repositories.runtimeConfig.get() === undefined) {
      repositories.runtimeConfig.initialize(snapshot);
      return;
    }
    repositories.configSnapshots.insert(snapshot);
    repositories.runtimeConfig.activate({
      settingsRevision: persistedSettings.revision,
      settingsFingerprint: persistedSettings.settingsFingerprint,
      configSnapshotId,
      configFingerprint: resolved.fingerprint,
      activatedAt: now,
    });
  });


  const backupDirectory = join(stateRoot, "backups", "authority");
  const backupServiceState: BackupServiceState = BackupServiceStateSchema.parse({
    state: "never-run",
    reason: "verified backups run hourly while the dashboard is open and after clean shutdown; one in-session backup and the last three shutdown backups are retained",
  });

  const loggingRepository = withEmergencyTimelineWriter(database.authority.timelineEvents, { stateRoot, clock, build: appVersion });
  const debugEvents = createDebugEventWriter({ repository: loggingRepository, clock, build: appVersion, development: frontend === "vite-dev" });
  context.attachSlowOperations(debugEvents);
  context.sessionBackups.start(ownedDiagnostics(database, debugEvents));
  startupCleanups.push(() => context.sessionBackups.requestCancellation());
  const loopDelayMonitor = composeLoopDelayMonitor(input.loopDelay, { clock, debugEvents: ownedDiagnostics(database, debugEvents) });
  startupCleanups.push(() => loopDelayMonitor.stop());
  chatGptAccount.setDebugEvents(debugEvents);
  const spanWriter = createTimelineEmitter({ repository: loggingRepository, clock });
  const descriptors = {
    resolve: (workflowId: string) => SERVER_REGISTRY[workflowId]?.descriptor,
  };
  const setHash = descriptorSetHash(DESCRIPTORS.map((descriptor) => descriptor.contractFingerprint));
  const runtimePreflight = composeRuntimePreflight({ duo: createDuoCredentialStore(admission, clock), admission, credentials: context.credentials, database, clock, repoRoot, isolation: input.isolation,
    descriptors, descriptorSetHash: setHash, protectedSecrets, environment: env,
    ...(input.preflightRunnerFactory === undefined ? {} : { runnerFactory: input.preflightRunnerFactory }) });
  const lifecycle = new RunRecordService({ database, clock, ids, resolveDescriptor: descriptors.resolve,
    admitQueuedRun: run => runtimePreflight.admission.assertReady(runtimePreflight.runScope(run.envelope)),
    publishQueued: (run, publication) => {
      if (publication === undefined) throw new Error("queued run is missing its publication context");
      spanWriter.emit(runQueuedSpanEvent({ run, ...publication, actorId: ActorIdSchema.parse(publication.actorId) }));
      database.afterAuthorityCommit(() => { wakeForWork(run.envelope.workflow); });
    },
  });
  try {
    reconcileStartupCrash({ machine: machineAdmission, admission, database, lifecycle, lock: input.lifetimeLock,
      clock });
  }
  catch (error) {
    if (error instanceof AuthoritySourceClosureUnprovedError) custody.failedClosures.push(error);
    throw error;
  }
  profile.runtime.registerCommandActivity(profile.token, startSettingsKeepAwake({ database, debugEvents: ownedDiagnostics(database, debugEvents) }));
  const { backfillGapNotifier, inbox: notificationInbox, observer: notificationObserver } = createTrustNotifications({
    admission, database, clock, ids, reader: lifecycle, readLanes, stateRoot,
  });
  startupCleanups.push(requiredClosure(() => notificationObserver.stop()));

  // Start only after startup acceptance; stop drains the exact owned observation.

  const { runners: dashboardPreflightRunners, authority: preflightAuthority } = createDashboardPreflight({
    repoRoot,
    config: resolved.config,
    stateRoot,
    artifactRoot,
    backendPort: input.applicationTransport?.listener.port ?? input.backendPortOverride ?? input.isolation.backendPort,
    // The built bundle is served by the BFF itself; only a dev frontend reserves its own port.
    frontendPort: frontend === "built-bundle" ? 0 : input.frontendPortOverride ?? input.isolation.frontendPort,
    ...(env[DASHBOARD_LAUNCH_NONCE_ENV] === undefined
      ? {}
      : { frontendOwnerNonce: env[DASHBOARD_LAUNCH_NONCE_ENV] }),
    clock,
    admission,
    credentials: context.credentials,
    backupDirectory,
    authorityOwner: database,
    configFingerprint: resolved.fingerprint,
    descriptorFingerprint: setHash,
  });
  if (input.applicationTransport !== undefined) dashboardPreflightRunners.markBackendOwned(input.applicationTransport.listener.port);


  return { requireProducerClosure, requiredClosure, env, clock, ids, repoRoot, machineAdmission, profile, assertCurrent, selected, stateRoot, artifactRoot, appVersion, frontend, staticBundle, context, database, admission, readLanes, logWriter, stopLogWriter, settingsProcesses, chatGptAccount, selectedModelProfileId, selectedModelEpoch, assertSelectedModelContext, captureSelectedModel, resolved, protectedSettingsAuthority, protectedSecrets, settingsBoundary, configSnapshotId, backupDirectory, backupServiceState, loggingRepository, debugEvents, loopDelayMonitor, descriptors, setHash, runtimePreflight, lifecycle, backfillGapNotifier, notificationInbox, notificationObserver, dashboardPreflightRunners, preflightAuthority };
}
