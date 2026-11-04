import { hostConfigFacts } from "../../../../models/config/host-display.js";
import { ASSISTANT_DEFAULT_EFFORT,ASSISTANT_DEFAULT_MODEL,AssistantModelPreferenceViewSchema } from '../../../../models/dashboard/assistant.js';
import { createDebugEventWriter } from "../../../logs/debug-events.js";
import { reconcileStartupCrash } from "../../../runs/lifecycle/startup-crash-recovery.js";
import { createDuoCredentialStore } from "../../../storage/configuration/duo-credential-store.js";
import { AuthoritySourceClosureUnprovedError } from "../../../storage/source-closure.js";
import { ActorIdSchema } from "../../../../rules/identity/ids.js";
import { runtimeTimeZone,systemClock } from "../../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../rules/validation/canonical-json.js";
import { importEmergencyFaults,withEmergencyTimelineWriter } from "../../../logs/emergency-faults.js";
import { openStaticBundle } from "../../../transports/http/static-bundle.js";
import { composeRuntimePreflight } from "../../preflight/runtime-admission.js";
import { createTrustNotifications } from "./notifications.js";
import { composeSettings } from "./settings.js";
import { readFileSync } from "node:fs";
import { join,resolve } from "node:path";
import { assertNoMigratedEnvironmentKeys,hostAwareResolutionEnvironment } from "../../../../models/config/secrets.js";
import { BackupServiceStateWireSchema,type BackupServiceStateWire } from "../../../../models/dashboard/storage.js";
import { createPreflightAuthority } from "../../../../models/preflight/preflight.js";
import { systemIdFactory } from "../../../../rules/identity/identifiers.js";
import { LOCAL_OPERATOR_ACTOR_ID } from "../../../../rules/identity/ids.js";
import { RunRecordService } from "../../../runs/lifecycle/run-record-service.js";
import { requireRuntimeAdmission } from "../../../storage/admission/admission-identity.js";
import { createTimelineEmitter } from "../../../storage/events/timeline-emitter.js";
import { AuthorityHealthPreflightRunner,summarizeBackupHealth } from "../../../storage/sqlite/index.js";
import { probePrimaryDisplay } from "../../host/primary-display.js";
import { DESCRIPTORS,SERVER_REGISTRY,descriptorSetHash } from "../../registries/workflow-registry.js";
import { RuntimeCustodyUncertainError } from "../storage-compose.js";
import { runQueuedSpanEvent } from "../../../runs/commands/run-queued-span.js";
import { createTimeoutDeadlineScheduler } from "../../../runtime/scheduling/timeout-deadline-scheduler.js";
import { activeSettingsRuntimeIdentity,readBootSettings } from "../../../runtime/settings/settings-runtime.js";
import { DASHBOARD_LAUNCH_NONCE_ENV } from "../../../transports/http/frontend-owner.js";
import { startDashboardHttpServer,type DashboardHttpServer } from "../../../transports/http/http-server.js";
import { createDashboardPreflightRunners } from "../../preflight/dashboard-runners.js";
import { composeDashboardWiring } from "./dashboard-wiring.js";
import { DashboardFrontendModeSchema,PackageVersionSchema,type DashboardComposeInput,type DashboardRuntime,type StartupCleanup,type StartupCustody } from "./runtime-contracts.js";
import { composeDashboardShutdown } from "./shutdown-custody.js";
import { GATE_PARK_WATCH_MS } from "./timeline.js";

async function unwindDashboardStartup(
  cleanups: readonly StartupCleanup[],
  primary: unknown,
): Promise<never> {
  const failures: unknown[] = [];
  for (const cleanup of [...cleanups].reverse()) {
    try {
      await cleanup();
    } catch (error: unknown) {
      failures.push(error);
    }
  }
  if (failures.length === 0) throw primary;
  if (primary instanceof RuntimeCustodyUncertainError || failures.some(error => error instanceof RuntimeCustodyUncertainError)) throw new RuntimeCustodyUncertainError([primary, ...failures]);
  throw new AggregateError(
    [primary, ...failures],
    "dashboard startup failed and cleanup observed additional failures",
    { cause: primary },
  );
}

export async function composeDashboardRuntime(input: DashboardComposeInput): Promise<DashboardRuntime> {
  input.lifetimeLock.assertHeld();
  const startupCleanups: StartupCleanup[] = [];
  const custody: StartupCustody = { failedClosures: [], transportClosed: true };
  try {
    const runtime = await composeDashboardRuntimeStartup(input, startupCleanups, custody);
    startupCleanups.length = 0;
    return runtime;
  } catch (primary: unknown) {
    try { custody.revoke?.(); } catch (error) { custody.failedClosures.push(error); }
    return unwindDashboardStartup(startupCleanups, custody.failedClosures.length === 0 ? primary : new RuntimeCustodyUncertainError([primary, ...custody.failedClosures]));
  }
}

export async function prepareDashboardRuntime(input: DashboardComposeInput, startupCleanups: StartupCleanup[], custody: StartupCustody) {
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
  const timeZone = runtimeTimeZone();
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
  const staticBundle = frontend === "built-bundle"
    ? await openStaticBundle(join(repoRoot, "dist", "dashboard"), repoRoot, input.frontendBuildScript)
    : undefined;


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
  const captureSelectedModel = () => {
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
    assertPreferenceCurrent();
    return { view, assertPreferenceCurrent };
  };

  custody.revoke = profile.runtime.beginClose;
  databaseClosed = false;
  const prepareRuntimeClosure = (): Promise<void> => {
    profile.runtime.beginClose();
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
  importEmergencyFaults(stateRoot, database.authority.timelineEvents);
  importEmergencyFaults(machineAdmission.stateRoot, database.authority.timelineEvents);
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
  const protectedSecrets = { read: () => { assertCurrent(); const result = context.protectedSecrets.read(); assertCurrent(); return result; } };
  const settingsBoundary = composeSettings({ database, hostFacts, clock, active: activeSettingsRuntimeIdentity,
    environment: env, credentials: protectedSettingsAuthority,
    runtimeStoragePair,
    resolveSettings: settings => { assertCurrent(); const result = context.resolveSettings(settings); assertCurrent(); return result; }, assertCurrent });

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
  const backupServiceState: BackupServiceStateWire = BackupServiceStateWireSchema.parse({
    state: "never-run",
    reason: "verified backups run after clean shutdown; the last three shutdown backups are retained",
  });

  const readBackupSummary = (): ReturnType<typeof summarizeBackupHealth> => {
    let liveGeneration: { state: "known"; value: number } | { state: "unavailable" };
    try {
      liveGeneration = { state: "known", value: database.getMeta().authorityGeneration };
    } catch {
      // Unavailable authority is distinct from an absent backup; judge the latter by manifest presence.
      liveGeneration = { state: "unavailable" };
    }
    return summarizeBackupHealth(
      admission,
      { backupDirectory },
      liveGeneration.state === "known" ? liveGeneration.value : undefined,
      clock,
    );
  };

  const loggingRepository = withEmergencyTimelineWriter(database.authority.timelineEvents, { stateRoot, clock, build: appVersion });
  const debugEvents = createDebugEventWriter({ repository: loggingRepository, clock, build: appVersion, development: frontend === "vite-dev" });
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
  const { backfillGapNotifier, inbox: notificationInbox, observer: notificationObserver } = createTrustNotifications({
    admission, database, clock, ids, reader: lifecycle, stateRoot,
  });
  startupCleanups.push(requiredClosure(() => notificationObserver.stop()));

  // Start only after startup acceptance; stop drains the exact owned observation.

  const dashboardPreflightRunners = createDashboardPreflightRunners({
    repoRoot,
    config: resolved.config,
    stateRoot,
    artifactRoot,
    backendPort: input.applicationTransport?.listener.port ?? input.backendPortOverride ?? input.isolation.backendPort,
    frontendPort: input.frontendPortOverride ?? input.isolation.frontendPort,
    ...(env[DASHBOARD_LAUNCH_NONCE_ENV] === undefined
      ? {}
      : { frontendOwnerNonce: env[DASHBOARD_LAUNCH_NONCE_ENV] }),
    clock,
    authorityHealth: new AuthorityHealthPreflightRunner(admission, {
      stateRootTrustAnchor: resolve(stateRoot, ".."),
      stateRoot,
      authorityPath: join(stateRoot, "state.db"),
      backupDirectory,
      busyTimeoutMs: 5000,
    }, clock, context.credentials),
  });
  if (input.applicationTransport !== undefined) dashboardPreflightRunners.markBackendOwned(input.applicationTransport.listener.port);
  const preflightAuthority = createPreflightAuthority({
    configFingerprint: resolved.fingerprint,
    descriptorFingerprint: setHash,
    requestedCapabilities: ["dashboard.serve"],
    runners: dashboardPreflightRunners.runners,
    clock,
    scheduler: createTimeoutDeadlineScheduler(clock),
  });


  return { requireProducerClosure, requiredClosure, env, clock, timeZone, ids, repoRoot, machineAdmission, profile, assertCurrent, selected, stateRoot, artifactRoot, appVersion, frontend, staticBundle, context, database, admission, chatGptAccount, selectedModelProfileId, selectedModelEpoch, assertSelectedModelContext, captureSelectedModel, resolved, protectedSettingsAuthority, protectedSecrets, settingsBoundary, configSnapshotId, backupDirectory, backupServiceState, readBackupSummary, loggingRepository, debugEvents, descriptors, setHash, runtimePreflight, lifecycle, backfillGapNotifier, notificationInbox, notificationObserver, dashboardPreflightRunners, preflightAuthority };
}
async function composeDashboardRuntimeStartup(input: DashboardComposeInput, startupCleanups: StartupCleanup[], custody: StartupCustody): Promise<DashboardRuntime> {
  const resources = await prepareDashboardRuntime(input, startupCleanups, custody);
  const { requiredClosure, dashboardPreflightRunners, notificationObserver } = resources;
  const wiring = await composeDashboardWiring(input, resources, startupCleanups, custody);
  const { app, reportDashboardTransferFault } = wiring;
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

  return composeDashboardShutdown({ ...resources, ...wiring, server, gateParkTimer, custody });
}
