import { Hono,type Context } from "hono";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync,realpathSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { hostConfigFacts } from "../../../../models/config/host-display.js";
import { ConfigSchema } from "../../../../models/config/schema.js";
import { runtimeProfiles } from "../../../../models/config/define-runtime-isolation.js";
import { assertNoMigratedEnvironmentKeys,hostAwareResolutionEnvironment } from "../../../../models/config/secrets.js";
import {
CancelProfileOnboardingDuoRequestSchema,
CancelProfileOnboardingRequestSchema,
CompleteProfileOnboardingRequestSchema, DuoReenrolStateSchema, ReopenProfileOnboardingBrowserRequestSchema,
ConfirmProfileOnboardingDuoRequestSchema,DeleteProfileAccountRequestSchema,PROFILE_ONBOARDING_STATE,
ProfileDetailsChangeRequestSchema,
ProfileDetailsChangeResultSchema,
ProfileDuoKeyChangeRequestSchema,
ProfileDuoKeyChangeResponseSchema,
ProfileDuoKeysReadSchema,
ProfileLoginChangeResultSchema,
ProfileLoginRequestSchema,
ProfilePasswordChangeRequestSchema,
ProfileFirstRunCheckSchema,
ProfileOnboardingStateSchema,
ProfileSignUpRequestSchema,
PublicProfileStateSchema,
StartProfileOnboardingDuoRequestSchema,
ProfileUsernameChangeRequestSchema,
type PublicProfileState
} from "../../../../models/profiles/public-profile.js";
import { systemClock } from "../../../../rules/time/clock.js";
import { appendEmergencyFault } from "../../../logs/emergency-faults.js";
import { serializeTokenedErrorCauses } from "../../../../models/failures/error-origins.js";
import { ProfileRuntimeStartFailedError,ProfileSessionRefusedError } from "../../../profiles/profile-errors.js";
import { type ActiveProfileSession } from "../../../profiles/profile-session.js";
import { copySigninFixtureBrowser, createProfileOnboardingDuoProvider } from "../../../runtime/browser/onboarding-duo-provider.js";
import { requireRuntimeAdmission } from "../../../storage/admission/admission-identity.js";
import { PROFILE_ONBOARDING_BROWSER_DIRECTORY } from "../../../storage/browser-root-contract.js";
import { createBrowserRoots } from "../../../storage/browser-roots.js";
import { createProfileVerifiers } from "../../../storage/configuration/verifier-store.js";
import { ensureChildDirectory } from "../../../storage/configuration/credential-safe-file.js";
import { assertMaintenanceCustodyAvailable } from "../../../storage/maintenance/custody-availability.js";
import { dispatchMountedRequest,startDashboardHttpServer } from "../../../transports/http/http-server.js";
import { createSoloRequestIdentityCheckpoint } from "../../../transports/http/request-identity.js";
import { createDashboardApp } from "../../../transports/http/routes/api.js";
import { registerDebugResponses } from "../../../transports/http/routes/debug-responses.js";
import { failureStatus } from "../../../transports/http/routes/failure-status.js";
import { operatorMutationIngressGuard } from "../../../transports/http/routes/operator-mutation-ingress.js";
import { openStaticBundle,staticBundleHandler } from "../../../transports/http/static-bundle.js";
import { probePrimaryDisplay } from "../../host/primary-display.js";
import { DASHBOARD_LAUNCH_NONCE_ENV } from "../../../transports/http/frontend-owner.js";
import { ProfileBrowserRootRefusalError } from "../../../storage/admission/admission-identity.js";
import { probeOwnedViteServer } from "../../host/local-vite-probe.js";
import { applicationDataWorkspace, runtimeProfile } from "../../config/runtime-isolation.js";
import { RuntimeCustodyUncertainError,composeProfileRuntime } from "../storage-compose.js";
import { DashboardFrontendModeSchema,PackageVersionSchema,type DashboardComposeInput,type DashboardRuntime } from "./runtime-contracts.js";
import { composeDashboardRuntime } from "./runtime-startup.js";
import { composeApplicationStop,retainPublicFailureCustody } from "./shutdown-custody.js";

const FRONTEND_PROBE_MS = 2000;

export async function composeDashboardApplication(input: DashboardComposeInput): Promise<Readonly<{ port: number; shutdownRequested: Promise<void>; stop(): Promise<void> }>> {
  let resolveApplicationQuit: () => void = () => undefined;
  const shutdownRequested = new Promise<void>(resolve => { resolveApplicationQuit = resolve; });
  input.lifetimeLock.assertHeld();
  if (requireRuntimeAdmission(input.admission).lifetime !== input.lifetimeLock) throw new Error("runtime-lifetime-admission-mismatch");
  const env = input.env ?? hostAwareResolutionEnvironment(probePrimaryDisplay);
  assertNoMigratedEnvironmentKeys(env);
  const machine = requireRuntimeAdmission(input.admission), clock = input.clock ?? systemClock;
  const installation = machine.readInstallationContext();
  if (installation === undefined) throw new Error("profile-application-installation-required");
  if (input.copySignin !== undefined) {
    const profile = input.copySignin.profile, ports = runtimeProfiles[profile];
    const workspace = applicationDataWorkspace(undefined, profile);
    if (runtimeProfile === "production" || profile !== runtimeProfile || input.backendPortOverride !== undefined || input.frontendPortOverride !== undefined
      || input.isolation.backendPort !== ports.backendPort || input.isolation.frontendPort !== ports.frontendPort
      || input.lifetimeLock.port !== ports.lockPort || installation.workspace !== workspace
      || machine.stateRoot !== join(workspace, input.isolation.stateRoot) || realpathSync(machine.stateRoot) !== machine.stateRoot
      || machine.artifactRoot !== join(workspace, input.isolation.artifactRoot) || realpathSync(machine.artifactRoot) !== machine.artifactRoot
      || input.onboardingDuo !== undefined) throw new Error("copy-signin-target-refused");
  }
  const repoRoot = input.repoRoot ?? process.cwd();
  const frontend = DashboardFrontendModeSchema.default("vite-dev").parse(input.frontend);
  const bundle = frontend === "built-bundle" ? await openStaticBundle(join(repoRoot, "dist", "dashboard"), repoRoot, input.frontendBuildScript) : undefined;
  const profileRuntime = await (async () => {
    const facts = hostConfigFacts(env);
    let onboardingDuo = input.onboardingDuo;
    if (onboardingDuo === undefined) {
      const browsers = join(machine.stateRoot, "browsers"), browserRoot = join(browsers, PROFILE_ONBOARDING_BROWSER_DIRECTORY);
      ensureChildDirectory(machine.stateRoot, browsers, "onboarding browsers", 0o700, 0o700);
      ensureChildDirectory(browsers, browserRoot, "onboarding browsers", 0o700, 0o700);
      onboardingDuo = createProfileOnboardingDuoProvider({ browserRoots: createBrowserRoots(machine), browserRoot, extensionDirectory: join(realpathSync(repoRoot), "fast-duo"),
        clock, copySignin: input.copySignin, ...(input.copySignin === undefined ? {} : copySigninFixtureBrowser()), closeProofMs: ConfigSchema.shape.browser.parse(undefined).closeProofMs });
    }
    const profile = composeProfileRuntime({ admission: machine, clock, hostFacts: facts,  onboardingDuo });
    try { await profile.session.recoverOnboarding(); }
    catch (error) {
      try { await profile.close(); }
      catch (cleanup) { throw new RuntimeCustodyUncertainError([error, cleanup]); }
      throw error;
    }
    return profile;
  })();
  const app = new Hono<{ Variables: { requestActorId: ReturnType<ReturnType<typeof createSoloRequestIdentityCheckpoint>["identify"]> } }>();
  const appVersion = PackageVersionSchema.parse(JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"))).version;
  const debugEvents = { emit(input: unknown) {
    const failure = z.object({ code: z.string(), reason: z.string() }).parse(input);
    appendEmergencyFault({ stateRoot: machine.stateRoot, build: appVersion, code: failure.code, area: "profile-request",
      reason: failure.reason, error: new Error(failure.reason), now: clock.now() });
  } };
  registerDebugResponses(app, debugEvents);
  type Selection = { sessionId: string; token: string; profileId: string; epoch: number; runtime: DashboardRuntime };
  let selection: Selection | undefined;
  let onboardingSelection: { sessionId: string; token: string; operationId: string; profileId: string } | undefined;
  let completedDraft: { operationId: string; sessionId: string; profileId: string; epoch: number;
    response: { status: ReturnType<typeof publicFailure>["status"] | 200; body: PublicProfileState }; activeSessionId?: string } | undefined;
  let pending: { sessionId: string; operationId: string; profileId: string; epoch: number; runtime: DashboardRuntime; deleting: boolean } | undefined;
  let transitioning = false;
  const retainedCustodyFailures: unknown[] = [];
  const verifiers = createProfileVerifiers(machine.stateRoot);
  const sessionHeader = "x-relay-session", resumeHeader = "x-relay-resume";
  let registeredPort: number = input.backendPortOverride ?? input.isolation.backendPort;
  const originOf = (request: Request) => new URL(`http://${request.headers.get("host")}`).origin;
  const credential = (request: Request, secret: string, purpose: "active" | "draft" = "active") =>
    purpose + "." + createHmac("sha256", secret).update(JSON.stringify([purpose, originOf(request)])).digest("hex");
  const carries = (request: Request, secret: string, purpose: "active" | "draft" = "active") =>
    request.headers.get(sessionHeader) === credential(request, secret, purpose);
  const bindingFor = (request: Request, registry = machine.readProfileRegistry()) => {
    return registry.activeProfileId === null ? undefined : { installationId: registry.installationId,
      profileId: registry.activeProfileId, epoch: registry.sessionGeneration, origin: originOf(request) };
  };
  type ResumeBinding = NonNullable<ReturnType<typeof bindingFor>>;
  let resumeInFlight: { predecessor: ResumeBinding; result: Promise<PublicProfileState> } | undefined;
  const verifiedResumeBinding = (request: Request, registry = machine.readProfileRegistry()) => {
    const current = bindingFor(request, registry);
    if (current === undefined) return undefined;
    const bound = resumeInFlight?.predecessor ?? current;
    if (bound.origin !== current.origin || bound.installationId !== current.installationId || bound.profileId !== current.profileId
      || (current.epoch !== bound.epoch && current.epoch !== bound.epoch + 1)) return undefined;
    return verifiers.verifyResumeProof(bound, request.headers.get(resumeHeader)) ? bound : undefined;
  };
  const issue = (c: Context, active: Selection, verifiedPredecessor?: string) => {
    const binding = bindingFor(c.req.raw);
    if (selection !== active || binding?.profileId !== active.profileId || binding.epoch !== active.epoch) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    const proof = verifiers.issueResumeProof(binding, verifiedPredecessor);
    c.header("cache-control", "no-store");
    c.header(sessionHeader, credential(c.req.raw, active.sessionId));
    c.header(resumeHeader, proof);
  };
  const frontendPort = input.frontendPortOverride || input.isolation.frontendPort;
  const loopback = (request: Request): boolean => {
    const host = request.headers.get("host");
    if (host === null || !URL.canParse(`http://${host}`)) return false;
    const url = new URL(`http://${host}`);
    const allowedPorts = frontend === "vite-dev" ? [registeredPort, frontendPort] : [registeredPort];
    return (url.hostname === "127.0.0.1" || url.hostname === "localhost") && allowedPorts.includes(Number(url.port || 80))
      && url.pathname === "/" && url.search === "" && url.hash === "" && url.username === "" && url.password === ""
      && (request.headers.get("origin") === null || request.headers.get("origin") === url.origin);
  };
  const current = (request: Request): Selection => {
    if (!loopback(request) || transitioning || selection === undefined || !carries(request, selection.sessionId)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    profileRuntime.assertCurrent(selection.token);
    return selection;
  };
  const currentOnboarding = (request: Request, operationId: string, abort = false) => {
    const draft = onboardingSelection;
    if (!loopback(request) || transitioning || draft === undefined || draft.operationId !== operationId
      || !carries(request, draft.sessionId, "draft")) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    if (abort) profileRuntime.session.assertOnboardingAbort(draft.token, operationId);
    else profileRuntime.session.readOnboarding(draft.token, operationId);
    return draft;
  };
  const selectedPath = (request: Request): boolean => {
    const path = new URL(request.url).pathname;
    return (path.startsWith("/api/") && !path.startsWith("/api/v1/profile/")) || path.startsWith("/events") || path.startsWith("/artifacts");
  };
  const publicFailure = (error: Error) => {
    const custodyUnproved = retainPublicFailureCustody(error, retainedCustodyFailures);
    const mapped = failureStatus(error);
    const causes = mapped.status === 500 || error.cause !== undefined || mapped.body.code === "CREDENTIAL_CONVERSION_REQUIRED" ? serializeTokenedErrorCauses(error) : [];
    for (const cause of causes) {
      const diagnostic = new Error(cause.name);
      diagnostic.name = cause.name;
      diagnostic.stack = cause.stack;
      appendEmergencyFault({ stateRoot: machine.stateRoot, build: appVersion, code: cause.code, error: diagnostic,
        area: "profile-request", reason: cause.token ?? "profile-request-cause", now: clock.now() });
    }
    if (error instanceof ProfileSessionRefusedError) return { status: 409 as const,
      body: PublicProfileStateSchema.parse({ state: "refused", code: error.code }) };
    return { status: mapped.status, body: PublicProfileStateSchema.parse({ state: "error",
      code: custodyUnproved ? "RUNTIME_CUSTODY_UNCERTAIN" : mapped.body.code }) };
  };
  app.onError((error, c) => { const failure = publicFailure(error); return c.json(failure.body, failure.status); });
  let frontendOwned = false;
  app.use("/api/v1/profile/*", async (c, next) => {
    if (!loopback(c.req.raw)) return c.json(PublicProfileStateSchema.parse({ state: "refused", code: "PROFILE_SESSION_STALE" }), 403);
    // Vite proxies with the browser's Host, so a dev-frontend request names the frontend port; direct BFF requests are not probed.
    if (frontend === "vite-dev" && !frontendOwned && new URL(`http://${c.req.header("host") ?? ""}`).port === String(frontendPort)) {
      const probe = await (input.frontendProbe ?? probeOwnedViteServer)({ port: frontendPort, signal: c.req.raw.signal,
        deadlineMonotonicMs: clock.monotonicMs() + FRONTEND_PROBE_MS, clock, ownerNonce: env[DASHBOARD_LAUNCH_NONCE_ENV] });
      if (probe.state === "not-owned" && probe.cleanupFailure !== undefined) {
        try {
          appendEmergencyFault({ stateRoot: machine.stateRoot, build: appVersion, code: "DASHBOARD_FRONTEND_NOT_OWNED", area: "profile-request",
            reason: "frontend-probe-cleanup-failed", now: clock.now(),
            error: probe.cleanupFailure instanceof Error ? probe.cleanupFailure : new Error("frontend-probe-cleanup-failed", { cause: probe.cleanupFailure }) });
        } catch (logFailure) {
          // The refusal still answers; codes and class names only, since messages can carry paths.
          process.stderr.write(`${JSON.stringify({ code: "DASHBOARD_FRONTEND_NOT_OWNED", reason: "frontend-probe-cleanup-failed",
            diagnostic: "boot-log-write-failed", cause: logFailure instanceof Error ? logFailure.name : typeof logFailure })}\n`);
        }
      }
      if (probe.state !== "owned") return c.json(PublicProfileStateSchema.parse({ state: "refused", code: "DASHBOARD_FRONTEND_NOT_OWNED" }), 403);
      frontendOwned = true;
    }
    return next();
  });
  app.get("/api/v1/profile/state", c => {
    c.header("cache-control", "no-store");
    if (selection === undefined && onboardingSelection !== undefined && carries(c.req.raw, onboardingSelection.sessionId, "draft")) {
      return c.json(profileRuntime.session.readOnboarding(onboardingSelection.token, onboardingSelection.operationId));
    }
    if (selection === undefined && pending !== undefined && carries(c.req.raw, pending.sessionId)) return c.json(PublicProfileStateSchema.parse({ state: "cancelling", operationId: pending.operationId }));
    const resumeState = (registry: ReturnType<typeof machine.readProfileRegistry>) =>
      verifiedResumeBinding(c.req.raw, registry) === undefined ? {} : { resumable: true };
    if (selection === undefined) {
      const registry = machine.readProfileRegistry();
      return c.json(PublicProfileStateSchema.parse({ state: "signed-out", signUpRequired: registry.profiles.length === 0,
        ...resumeState(registry),
        ...(registry.profiles.some(row => row.lifecycle === "cancelling") || profileRuntime.session.logoutOperations().some(operation => operation.phase !== "complete")) && { logoutIncomplete: true } }));
    }
    if (!transitioning && !carries(c.req.raw, selection.sessionId)) {
      profileRuntime.assertCurrent(selection.token);
      return c.json(PublicProfileStateSchema.parse({ state: "signed-out", signUpRequired: false, ...resumeState(machine.readProfileRegistry()) }));
    }
    const active = current(c.req.raw);
    return c.json(PublicProfileStateSchema.parse(activeState(active.profileId, active.epoch)));
  });
  app.use("/api/v1/profile/sign-in", operatorMutationIngressGuard);
  app.use("/api/v1/profile/resume", operatorMutationIngressGuard);
  app.use("/api/v1/profile/sign-up", operatorMutationIngressGuard);
  app.use("/api/v1/profile/logout", operatorMutationIngressGuard);
  app.use("/api/v1/profile/delete-account", operatorMutationIngressGuard);
  app.use("/api/v1/profile/onboarding/*", operatorMutationIngressGuard);
  app.use("/api/v1/profile/account/*", operatorMutationIngressGuard);
  app.use("/api/v1/profile/duo/reenrol/*", operatorMutationIngressGuard);
  const activeState = (profileId: string, epoch: number, registry = machine.readProfileRegistry()) => {
    const row = registry.profiles.find(value => value.profileId === profileId);
    if (row === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
    return { state: "active" as const, profileId, epoch, duoState: row.duoState,
      account: profileRuntime.session.account(row) };
  };
  const mountActive = async (result: ActiveProfileSession, onInitialPreflight = input.onInitialPreflight): Promise<PublicProfileState> => {
    const row = machine.readProfileRegistry().profiles.find(value => value.profileId === result.profileId);
    if (row === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
    const guarded = new Hono<{ Variables: { requestActorId: ReturnType<ReturnType<typeof createSoloRequestIdentityCheckpoint>["identify"]> } }>();
    guarded.onError((error, c) => {
      const failure = publicFailure(error);
      debugEvents.emit({ ...failure.body, reason: "profile-request-failed" });
      return c.json(failure.body, failure.status);
    });
    let selectedApp: ReturnType<typeof createDashboardApp> | undefined;
    const admitted = new WeakSet<Request>();
    guarded.all("*", c => {
      const request = c.req.raw;
      try {
        const active = current(request);
        if (active.token !== result.token || active.profileId !== result.profileId || active.epoch !== result.epoch) {
          throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
        }
      } catch (error) {
        if (!(error instanceof ProfileSessionRefusedError)) throw error;
        debugEvents.emit({ code: error.code, reason: "profile-session-refused" });
        return c.json(PublicProfileStateSchema.parse({ state: "refused", code: error.code }), 401);
      }
      if (selectedApp === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
      admitted.add(request);
      try { return dispatchMountedRequest(selectedApp, request); }
      finally { admitted.delete(request); }
    });
    const runtime = await composeDashboardRuntime({ ...input, onInitialPreflight, requestApplicationQuit: resolveApplicationQuit, profile: { runtime: profileRuntime, token: result.token },
      applicationTransport: { listener: { ...listener, mount: (activeApp, accepts) => { selectedApp = activeApp; return listener.mount(guarded, accepts); } }, accepts: selectedPath,
        consumeAdmission: request => { if (!admitted.delete(request)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE"); } } })
      .catch((error: unknown) => {
        if (error instanceof RuntimeCustodyUncertainError || error instanceof ProfileSessionRefusedError || error instanceof ProfileBrowserRootRefusalError) throw error;
        throw new ProfileRuntimeStartFailedError({ cause: error });
      });
    selection = { sessionId: randomUUID(), token: result.token, profileId: result.profileId, epoch: result.epoch, runtime };
    return activeState(result.profileId, result.epoch);
  };
  const activate = async (request: Request, mode: "signup" | "signin" | "resume", expected?: ResumeBinding): Promise<PublicProfileState> => {
    if (transitioning || pending !== undefined) throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
    if (selection !== undefined) {
      const mounted = selection;
      if (mode === "signin") {
        const fields = ProfileLoginRequestSchema.parse(await request.json());
        if (selection !== mounted || transitioning) throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
        const result = profileRuntime.session.signIn({ ...fields, at: clock.now().toISOString() }, mounted.token);
        if (result.state !== "active") return { state: "refused", code: result.state === "refused" ? result.code : "PROFILE_TRANSITION_BLOCKED" };
      } else if (mode !== "resume") throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
      const { token, profileId, epoch } = selection;
      profileRuntime.assertCurrent(token);
      return PublicProfileStateSchema.parse(activeState(profileId, epoch));
    }
    transitioning = true;
    try {
      const result = await (async () => {
        if (mode === "signup") return profileRuntime.session.signUp({ ...ProfileSignUpRequestSchema.parse(await request.json()), createdAt: clock.now().toISOString() });
        if (mode === "resume") {
          if (expected === undefined) throw new ProfileSessionRefusedError("PROFILE_SIGN_IN_REFUSED");
          return profileRuntime.session.resumeSignedInProfile({ at: clock.now().toISOString(), expected });
        }
        const fields = { ...ProfileLoginRequestSchema.parse(await request.json()), at: clock.now().toISOString() };
        const signed = profileRuntime.session.signIn(fields);
        if (signed.state !== "cancelling") return signed;
        const continuation = profileRuntime.session.authorizeLogoutContinuation(fields);
        if (continuation.state !== "authorized") return continuation;
        return continuation.resume();
      })();
      if (result.state === "signed-out") return result;
      if (result.state === "cancelling" && result.operationId !== undefined) return { state: "cancelling" as const, operationId: result.operationId };
      if (result.state === PROFILE_ONBOARDING_STATE) {
        onboardingSelection = { sessionId: randomUUID(), token: result.token, operationId: result.operationId, profileId: result.profileId };
        const { token: _token, ...state } = result;
        return ProfileOnboardingStateSchema.parse(state);
      }
      if (result.state !== "active") return { state: "refused" as const, code: result.code };
      return await mountActive(result);
    } finally { transitioning = false; }
  };
  const resume = async (request: Request): Promise<PublicProfileState> => {
    const flight = resumeInFlight;
    const bound = verifiedResumeBinding(request);
    if (bound === undefined) {
      return { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" };
    }
    if (flight !== undefined) return flight.result;
    const result = activate(request, "resume", bound);
    resumeInFlight = { predecessor: bound, result };
    try { return await result; } finally { resumeInFlight = undefined; }
  };
  const admitProfile = async (mode: "signup" | "signin" | "resume", request: Request) => {
    const activated = await (mode === "resume" ? resume(request) : activate(request, mode));
    const result = PublicProfileStateSchema.parse(activated.state === "refused" ? { state: activated.state, code: activated.code } : activated);
    if (result.state === "active" && (selection?.profileId !== result.profileId || selection.epoch !== result.epoch)) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    return { result, session: result.state === "active" ? selection : undefined };
  };
  app.post("/api/v1/profile/sign-in", async c => {
    const operation = pending;
    if (operation !== undefined) {
      if (transitioning || operation.deleting || !carries(c.req.raw, operation.sessionId)) throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
      const fields = ProfileLoginRequestSchema.parse(await c.req.json());
      if (transitioning || pending !== operation) throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
      profileRuntime.session.confirmPendingLogoutLogin({ ...fields, at: clock.now().toISOString() }, operation);
      return endSession(c, false);
    }
    const admitted = await admitProfile("signin", c.req.raw);
    if (admitted.session !== undefined) issue(c, admitted.session);
    return c.json(admitted.result);
  });
  app.post("/api/v1/profile/resume", async c => {
    const admitted = await admitProfile("resume", c.req.raw);
    if (admitted.session !== undefined) issue(c, admitted.session, c.req.header(resumeHeader));
    return c.json(admitted.result);
  });
  app.post("/api/v1/profile/sign-up", async c => {
    const admitted = await admitProfile("signup", c.req.raw);
    if (admitted.session !== undefined) issue(c, admitted.session);
    if (admitted.result.state === PROFILE_ONBOARDING_STATE && onboardingSelection !== undefined) {
      c.header("cache-control", "no-store");
      c.header(sessionHeader, credential(c.req.raw, onboardingSelection.sessionId, "draft"));
    }
    return c.json(admitted.result);
  });
  app.post("/api/v1/profile/onboarding/duo/browser", async c => {
    const request = CompleteProfileOnboardingRequestSchema.parse(await c.req.json()), draft = currentOnboarding(c.req.raw, request.operationId);
    return c.json(await profileRuntime.session.showOnboardingBrowser(draft.token, request.operationId));
  });
  app.post("/api/v1/profile/onboarding/duo/reopen", async c => {
    const request = ReopenProfileOnboardingBrowserRequestSchema.parse(await c.req.json()), draft = currentOnboarding(c.req.raw, request.operationId);
    return c.json(await profileRuntime.session.reopenOnboardingBrowser(draft.token, request.operationId, request.generation));
  });
  app.post("/api/v1/profile/onboarding/duo/portal", async c => {
    const request = CompleteProfileOnboardingRequestSchema.parse(await c.req.json()), draft = currentOnboarding(c.req.raw, request.operationId);
    return c.json(await profileRuntime.session.openOnboardingPortal(draft.token, request.operationId));
  });
  app.post("/api/v1/profile/onboarding/duo/start", async c => {
    const request = StartProfileOnboardingDuoRequestSchema.parse(await c.req.json()), draft = currentOnboarding(c.req.raw, request.operationId);
    return c.json(await profileRuntime.session.startOnboardingDuo(draft.token, request.operationId, request.method));
  });
  app.post("/api/v1/profile/onboarding/duo/confirm", async c => {
    const request = ConfirmProfileOnboardingDuoRequestSchema.parse(await c.req.json()), draft = currentOnboarding(c.req.raw, request.operationId);
    return c.json(profileRuntime.session.confirmOnboardingDuo(draft.token, request.operationId, request.method, request.attemptId));
  });
  app.post("/api/v1/profile/onboarding/duo/cancel", async c => {
    const request = CancelProfileOnboardingDuoRequestSchema.parse(await c.req.json()), draft = currentOnboarding(c.req.raw, request.operationId);
    return c.json(await profileRuntime.session.cancelOnboardingDuo(draft.token, request.operationId, request.method, request.attemptId));
  });
  app.post("/api/v1/profile/onboarding/cancel", async c => {
    const request = CancelProfileOnboardingRequestSchema.parse(await c.req.json()), draft = currentOnboarding(c.req.raw, request.operationId, true);
    transitioning = true;
    try {
      const result = await profileRuntime.session.cancelOnboarding(draft.token, request.operationId);
      onboardingSelection = undefined;

      return c.json(PublicProfileStateSchema.parse(result));
    } finally { transitioning = false; }
  });
  app.post("/api/v1/profile/onboarding/complete", async c => {
    const request = CompleteProfileOnboardingRequestSchema.parse(await c.req.json());
    const completed = completedDraft;
    if (completed?.operationId === request.operationId && carries(c.req.raw, completed.sessionId, "draft")) {
      const registry = machine.readProfileRegistry();
      if (transitioning || registry.activeProfileId !== completed.profileId || registry.sessionGeneration !== completed.epoch) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
      if (completed.response.body.state === "active") {
        if (selection === undefined || selection.sessionId !== completed.activeSessionId || selection.profileId !== completed.profileId || selection.epoch !== completed.epoch) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
        profileRuntime.assertCurrent(selection.token);
        const { account } = activeState(completed.profileId, completed.epoch, registry);
        issue(c, selection);
        return c.json({ ...completed.response.body, account }, completed.response.status);
      }
      return c.json(completed.response.body, completed.response.status);
    }
    const draft = currentOnboarding(c.req.raw, request.operationId);
    transitioning = true;
    try {
      const active = await profileRuntime.session.completeOnboarding(draft.token, request.operationId);
      onboardingSelection = undefined;
      let initialReport: Parameters<NonNullable<DashboardComposeInput["onInitialPreflight"]>>[0] | undefined;
      const firstRunCheck = () => ProfileFirstRunCheckSchema.parse({ scope: "local-startup", profileId: active.profileId, epoch: active.epoch,
        ...(initialReport === undefined ? { state: "unavailable", code: "PROFILE_FIRST_RUN_CHECK_UNAVAILABLE" }
          : { state: initialReport.results.some(result => result.status === "fail") ? "failed" : "passed", report: initialReport }) });
      const response = await mountActive(active, report => { initialReport = report; input.onInitialPreflight?.(report); }).then(result =>
        ({ status: 200 as const, body: PublicProfileStateSchema.parse({ ...result, firstRunCheck: firstRunCheck() }) }), (error: unknown) => {
        if (!(error instanceof Error)) throw error;
        const failure = publicFailure(error);
        return { status: failure.status, body: PublicProfileStateSchema.parse({ ...failure.body, firstRunCheck: firstRunCheck() }) };
      });
      let activeSessionId: string | undefined;
      if (response.body.state === "active") {
        if (selection === undefined) throw new ProfileSessionRefusedError("PROFILE_AUTHORITY_UNAVAILABLE");
        activeSessionId = selection.sessionId;
        issue(c, selection);
      }
      completedDraft = { operationId: request.operationId, sessionId: draft.sessionId, profileId: active.profileId, epoch: active.epoch,
        response, ...(activeSessionId === undefined ? {} : { activeSessionId }) };
      return c.json(response.body, response.status);
    } finally { transitioning = false; }
  });
  const endSession = async (c: Context, deleting: boolean) => {
    const deletion = deleting ? DeleteProfileAccountRequestSchema.parse(await c.req.json()) : undefined;
    const active = selection === undefined ? undefined : current(c.req.raw);
    if (active === undefined && (pending === undefined || !carries(c.req.raw, pending.sessionId))) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    if (transitioning) throw new ProfileSessionRefusedError("PROFILE_TRANSITION_BLOCKED");
    if (deletion !== undefined) {
      const target = active ?? pending;
      if (target === undefined || target.profileId !== deletion.expectedProfileId || target.epoch !== deletion.expectedEpoch) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
      try { assertMaintenanceCustodyAvailable("account-deletion"); }
      catch (cause) { throw new ProfileSessionRefusedError("PROFILE_ACCOUNT_DELETION_REFUSED", { cause }); }
    }
    completedDraft = undefined;
    transitioning = true;
    try {
      if (active !== undefined) {
        // Abandon an open re-enrolment before revocation. An unproved close throws and leaves the session in place.
        await profileRuntime.session.closeDuoReenrol(active.profileId);
        await active.runtime.drainForLogout();
        const result = profileRuntime.session.logOut(active.token, { at: clock.now().toISOString() });
        if (result.state !== "cancelling" || result.operationId === undefined) throw new ProfileSessionRefusedError("PROFILE_LOGOUT_BLOCKED");
        pending = { sessionId: active.sessionId, operationId: result.operationId, profileId: active.profileId, epoch: active.epoch, runtime: active.runtime, deleting };
        selection = undefined;
      }
      const operation = pending;
      if (operation === undefined || operation.deleting !== deleting) throw new ProfileSessionRefusedError("PROFILE_LOGOUT_BLOCKED");
      await operation.runtime.detach();
      await profileRuntime.awaitClosurePreparation(operation.profileId);
      const result = profileRuntime.session.resumeLogout(operation.operationId);
      if (result.state !== "signed-out") return c.json(PublicProfileStateSchema.parse(result.state === "refused"
        ? { state: "refused", code: result.code } : { state: "cancelling", operationId: operation.operationId }));
      if (operation.deleting) profileRuntime.session.deleteLoggedOutAccount(operation.operationId);
      pending = undefined;

      return c.json(PublicProfileStateSchema.parse({ state: "signed-out", signUpRequired: machine.readProfileRegistry().profiles.length === 0 }));
    } finally { transitioning = false; }
  };
  // A landed change whose flush or closure failed is reported as changed, and an unreadable outcome as unknown; each failure is logged and any custody retained here.
  const changeLogin = (c: Context, change: (token: string, at: string) => ReturnType<typeof profileRuntime.session.changePassword>) => {
    const result = change(current(c.req.raw).token, clock.now().toISOString());
    if (result.state === "refused") return c.json(ProfileLoginChangeResultSchema.parse({ state: "refused", code: result.code }));
    // Custody is retained before the fault is written; a fault that cannot be written is reported beside the settled outcome.
    let diagnostics: { diagnostics: "unrecorded" } | undefined;
    if (result.failure instanceof Error) {
      try { publicFailure(result.failure); }
      catch { diagnostics = { diagnostics: "unrecorded" }; }
    }
    if (result.state === "unknown") return c.json(ProfileLoginChangeResultSchema.parse({ state: "unknown", code: "PROFILE_LOGIN_CHANGE_UNKNOWN", ...diagnostics }));
    return c.json(ProfileLoginChangeResultSchema.parse({ state: "changed", ...(result.durability === undefined ? {} : { durability: result.durability }), ...diagnostics }));
  };
  app.post("/api/v1/profile/account/password", async c => {
    const request = ProfilePasswordChangeRequestSchema.parse(await c.req.json());
    return changeLogin(c, (token, at) => profileRuntime.session.changePassword(token, { ...request, at }));
  });
  app.post("/api/v1/profile/account/username", async c => {
    const request = ProfileUsernameChangeRequestSchema.parse(await c.req.json());
    return changeLogin(c, (token, at) => profileRuntime.session.changeUsername(token, { ...request, at }));
  });
  app.post("/api/v1/profile/account/details", async c => {
    const request = ProfileDetailsChangeRequestSchema.parse(await c.req.json());
    const result = profileRuntime.session.changeDetails(current(c.req.raw).token, request);
    return c.json(ProfileDetailsChangeResultSchema.parse(result.state === "changed" ? result : { state: "refused", code: result.code }));
  });
  app.get("/api/v1/profile/account/duo-keys", c => {
    const { token, profileId, epoch } = current(c.req.raw);
    c.header("cache-control", "no-store");
    return c.json(ProfileDuoKeysReadSchema.parse({ profileId, epoch, snapshot: profileRuntime.session.readDuoKeys(token) }));
  });
  app.post("/api/v1/profile/account/duo-keys", async c => {
    const { token, profileId, epoch } = current(c.req.raw);
    const request = ProfileDuoKeyChangeRequestSchema.parse(await c.req.json());
    if (request.profileId !== profileId || request.epoch !== epoch) throw new ProfileSessionRefusedError("PROFILE_SESSION_STALE");
    c.header("cache-control", "no-store");
    return c.json(ProfileDuoKeyChangeResponseSchema.parse({ profileId, epoch, commandId: request.change.commandId,
      result: profileRuntime.session.changeDuoKey(token, request.change) }));
  });
  const serveDuoReenrol = async (c: Context, respond: (token: string, body: unknown) => unknown) => {
    const token = current(c.req.raw).token;
    return c.json(await respond(token, await c.req.json()));
  };
  app.post("/api/v1/profile/duo/reenrol/begin", c => serveDuoReenrol(c, (token, body) => {
    z.strictObject({}).parse(body);
    return DuoReenrolStateSchema.parse(profileRuntime.session.beginDuoReenrol(token));
  }));
  app.post("/api/v1/profile/duo/reenrol/read", c => serveDuoReenrol(c, (token, body) => {
    const request = CompleteProfileOnboardingRequestSchema.parse(body);
    return DuoReenrolStateSchema.parse(profileRuntime.session.readDuoReenrol(token, request.operationId));
  }));
  app.post("/api/v1/profile/duo/reenrol/browser", c => serveDuoReenrol(c, async (token, body) => {
    const request = CompleteProfileOnboardingRequestSchema.parse(body);
    return DuoReenrolStateSchema.parse(await profileRuntime.session.showDuoReenrolBrowser(token, request.operationId));
  }));
  app.post("/api/v1/profile/duo/reenrol/reopen", c => serveDuoReenrol(c, async (token, body) => {
    const request = ReopenProfileOnboardingBrowserRequestSchema.parse(body);
    return DuoReenrolStateSchema.parse(await profileRuntime.session.reopenDuoReenrolBrowser(token, request.operationId, request.generation));
  }));
  app.post("/api/v1/profile/duo/reenrol/portal", c => serveDuoReenrol(c, async (token, body) => {
    const request = CompleteProfileOnboardingRequestSchema.parse(body);
    return DuoReenrolStateSchema.parse(await profileRuntime.session.openDuoReenrolPortal(token, request.operationId));
  }));
  app.post("/api/v1/profile/duo/reenrol/start", c => serveDuoReenrol(c, async (token, body) => {
    const request = StartProfileOnboardingDuoRequestSchema.parse(body);
    return DuoReenrolStateSchema.parse(await profileRuntime.session.startDuoReenrol(token, request.operationId, request.method));
  }));
  app.post("/api/v1/profile/duo/reenrol/confirm", c => serveDuoReenrol(c, (token, body) => {
    const request = ConfirmProfileOnboardingDuoRequestSchema.parse(body);
    return DuoReenrolStateSchema.parse(profileRuntime.session.confirmDuoReenrol(token, request.operationId, request.method, request.attemptId));
  }));
  app.post("/api/v1/profile/duo/reenrol/cancel-attempt", c => serveDuoReenrol(c, async (token, body) => {
    const request = CancelProfileOnboardingDuoRequestSchema.parse(body);
    return DuoReenrolStateSchema.parse(await profileRuntime.session.cancelDuoReenrolAttempt(token, request.operationId, request.method, request.attemptId));
  }));
  app.post("/api/v1/profile/duo/reenrol/cancel", c => serveDuoReenrol(c, async (token, body) => {
    const request = CompleteProfileOnboardingRequestSchema.parse(body);
    const result = await profileRuntime.session.cancelDuoReenrol(token, request.operationId);
    return PublicProfileStateSchema.parse(activeState(result.profileId, result.epoch));
  }));
  app.post("/api/v1/profile/duo/reenrol/commit", c => serveDuoReenrol(c, async (token, body) => {
    const request = CompleteProfileOnboardingRequestSchema.parse(body);
    const result = await profileRuntime.session.commitDuoReenrol(token, request.operationId);
    return PublicProfileStateSchema.parse(activeState(result.profileId, result.epoch));
  }));
  app.post("/api/v1/profile/logout", c => endSession(c, false));
  app.post("/api/v1/profile/delete-account", c => endSession(c, true));
  if (bundle !== undefined) app.use("*", staticBundleHandler(bundle));
  app.notFound(c => c.json(PublicProfileStateSchema.parse({ state: "refused", code: "PROFILE_SESSION_STALE" }), 401));
  const listener = await (async () => {
    try { return await startDashboardHttpServer({ app, port: input.backendPortOverride ?? input.isolation.backendPort }); }
    catch (error) {
      try { await profileRuntime?.close(); } catch (cleanup) { throw new RuntimeCustodyUncertainError([error, cleanup]); }
      throw error;
    }
  })();
  registeredPort = listener.port;
  return Object.freeze({ port: listener.port, shutdownRequested, stop: composeApplicationStop({
    input, profileRuntime, listener, machine, installation, clock, retainedCustodyFailures,
    beginTransition: () => { transitioning = true; },
    readSelectedRuntime: () => selection?.runtime ?? pending?.runtime,
  }) });
}
