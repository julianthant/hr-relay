import { randomUUID } from "node:crypto";
import { prepareDuoPlatformAuthenticator, type DuoPlatformAuthenticator } from "./duo-platform-authenticator.js";
import { createDuoBrowserFocus, type DuoBrowserFocus, type NativeFocusTarget } from "./native-browser-focus.js";
import { createNativeBrowserProbe, DEFAULT_BROWSER_LAUNCHER, type OwnedBrowserProcess, type PersistentContextLauncher } from "./native-browser.js";
import type { ProfileOnboardingBrowser } from "../../../models/profiles/public-profile.js";
import { privatePathRejects } from "../../storage/private-path.js";
import { DuoAssertionRequestSchema } from "../../storage/configuration/duo-signing.js";
import { stageFastDuoExtension } from "./fast-duo-extension.js";
import { lstatSync, mkdirSync, realpathSync, readdirSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { waitForUcsdDuoSignIn } from "../../systems/browser-shared/ucsd-sso.js";
import type { BrowserContext, Page, Worker } from "playwright";
import { z } from "zod";
import { BrowserDocumentIdSchema, PROFILE_ENROLLMENT_EXTENSION_MODE } from "../../../models/config/duo-credential-store.js";
import type { Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { type BrowserRoots, type BrowserRootLaunch, type BrowserRootLaunchInput, type SignupBrowserRootInput } from "../../storage/browser-roots.js";
import { createTimeoutDeadlineScheduler } from "../scheduling/timeout-deadline-scheduler.js";
import type { DraftDuoAttempt, DraftDuoBrowserOwner, DraftDuoCapability, DraftDuoObservedContext, ProfileOnboardingDuoProvider } from "../../profiles/onboarding-duo.js";
import { DuoDiagnosticExceptionTypeSchema, DuoPortalDiagnosticCodeSchema, ProfileOnboardingDuoEventSchema, type ProfileOnboardingDuoEvent, type ProfileOnboardingDuoFailure } from "../../../models/profiles/profile.js";

export class ProfileOnboardingDuoProviderError extends Error {
  constructor(readonly kind: "unavailable" | "refused" | "unknown",
    readonly reason: ProfileOnboardingDuoFailure["causeTag"],
    cause?: unknown) {
    super("Duo onboarding provider could not complete.", cause === undefined ? undefined : { cause });
    this.name = "ProfileOnboardingDuoProviderError";
  }
}

class DuoDiagnosticReportError extends Error {
  constructor(error: unknown, original?: unknown) {
    super("Duo diagnostic reporting failed.", { cause: original === undefined ? error : new AggregateError([original, error]) });
    this.name = "DuoDiagnosticReportError";
  }
}

function reportDuoEvent(owner: DraftDuoBrowserOwner, event: ProfileOnboardingDuoEvent): void {
  try { owner.reportEvent(event); }
  catch (error) { throw new DuoDiagnosticReportError(error); }
}

const IdSchema = z.string().min(1).max(4096);
const ReceiptSchema = z.strictObject({ credentialId: IdSchema, requestId: z.uuid() });
const PendingSchema = z.strictObject({
  credentialId: IdSchema, privateKeyPkcs8: z.string().min(1).max(16384), publicKeySpki: z.string().min(1).max(16384),
  userHandle: z.string().min(1).max(4096).optional(), transport: z.enum(["usb", "internal"]),
  isResidentCredential: z.boolean(), createdAt: z.iso.datetime(),
});
const BrokerRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({ id: z.uuid(), kind: z.literal("enrollment-failed"), data: z.strictObject({ requestId: z.uuid(), reason: z.enum(["aborted", "timed-out", "request-refused"]) }) }),
  z.strictObject({ id: z.uuid(), kind: z.literal("bind"), data: z.strictObject({
    documentId: BrowserDocumentIdSchema, tabId: z.number().int().nonnegative(), origin: z.url(), rpId: z.literal("duosecurity.com"),
  }) }),
  z.strictObject({ id: z.uuid(), kind: z.literal("persist"), data: PendingSchema }),
  z.strictObject({ id: z.uuid(), kind: z.literal("sign"), data: DuoAssertionRequestSchema }),
  z.strictObject({ id: z.uuid(), kind: z.enum(["native-failed", "scope-lost"]), data: z.strictObject({ requestId: z.uuid() }) }),
  ...(["software-created", "native-created", "portal-accepted", "exact-request"] as const).map(kind =>
    z.strictObject({ id: z.uuid(), kind: z.literal(kind), data: ReceiptSchema })),
]);
type BrokerRequest = z.infer<typeof BrokerRequestSchema>;

function trustedPortalUrl(value: string): boolean {
  const url = URL.parse(value);
  return url !== null && url.protocol === "https:" && !url.port && !url.username && !url.password
    && (url.hostname === "a5.ucsd.edu" && url.pathname.startsWith("/tritON/")
      || url.hostname === "duo.ucsd.edu" || url.hostname === "duosecurity.com" || url.hostname.endsWith(".duosecurity.com"));
}

function duoSignInHost(value: string): boolean {
  const url = URL.parse(value);
  return url !== null && url.protocol === "https:" && url.port === "" && url.username === "" && url.password === ""
    && (url.hostname === "duo.ucsd.edu" || url.hostname === "duosecurity.com" || url.hostname.endsWith(".duosecurity.com"));
}

export interface OnboardingDuoProviderOptions {
  readonly browserRoots: BrowserRoots;
  readonly browserRoot: string;
  readonly extensionDirectory: string;
  readonly clock: Clock;
  readonly closeProofMs: number;
  readonly launcher?: PersistentContextLauncher;
  readonly platform?: NodeJS.Platform;
  readonly focus?: DuoBrowserFocus;
}


async function workerCall(worker: Worker, method: "install" | "next" | "reply" | "stop" | "assertContext" | "browserInstall" | "browserFocus" | "browserPage" | "browserSelect" | "browserBounds" | "browserNext" | "browserReply" | "browserStop", args: readonly unknown[] = []): Promise<unknown> {
  try { return await worker.evaluate(async input => {
    const owner: unknown = Reflect.get(globalThis, "relayOnboarding");
    if (typeof owner !== "object" || owner === null) throw new Error("ONBOARDING_DUO_WORKER_UNAVAILABLE");
    const operation: unknown = Reflect.get(owner, input.method);
    if (typeof operation !== "function") throw new Error("ONBOARDING_DUO_WORKER_UNAVAILABLE");
    const result: unknown = await Reflect.apply(operation, owner, input.args);
    return result;
  }, { method, args }); }
  catch (error) {
    if (method === "next" || method === "browserNext") throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime", error);
    throw error;
  }
}

export function createProfileOnboardingDuoProvider(options: OnboardingDuoProviderOptions): ProfileOnboardingDuoProvider {
  const workersClosedBeforeContext = new WeakSet<Worker>();
  function closingPollFailure(error: unknown, context: BrowserContext | undefined, worker: Worker | undefined): boolean {
    // Playwright's bundled target-close subtype inherits Error.name.
    return error instanceof ProfileOnboardingDuoProviderError && error.reason === "browser-lifetime"
      && error.cause instanceof Error && /^TargetClosedError\d*$/u.test(error.cause.constructor.name)
      && worker !== undefined && !workersClosedBeforeContext.has(worker) && context?.isClosed() === true;
  }
  function failureEvent(error: unknown, operation?: ProfileOnboardingDuoEvent["operation"], durationMs?: number): ProfileOnboardingDuoEvent {
    const exceptionType = DuoDiagnosticExceptionTypeSchema.safeParse(error instanceof Error ? error.name : undefined);
    const portalCode = DuoPortalDiagnosticCodeSchema.safeParse(error instanceof Error ? error.message : undefined);
    return { stage: "refused", detail: error instanceof ProfileOnboardingDuoProviderError ? error.reason : "backend", code: portalCode.success ? portalCode.data : error instanceof Error && error.message === "ONBOARDING_DUO_WORKER_UNAVAILABLE" ? "ONBOARDING_DUO_WORKER_UNAVAILABLE" : "ONBOARDING_DUO_PROVIDER_FAILED",
      ...(exceptionType.success ? { exceptionType: exceptionType.data } : {}),
      ...(operation === undefined ? {} : { operation }), ...(durationMs === undefined ? {} : { durationMs }) };
  }
  function slowOperation(owner: DraftDuoBrowserOwner, operation: NonNullable<ProfileOnboardingDuoEvent["operation"]>, started: number, original?: unknown): void {
    const durationMs = Math.max(0, options.clock.monotonicMs() - started);
    if (durationMs < 1000) return;
    try { reportDuoEvent(owner, { stage: "slow-operation", code: "ONBOARDING_DUO_SLOW_OPERATION", operation, durationMs }); }
    catch (error) { throw new DuoDiagnosticReportError(error, original); }
  }
  const browserLauncher = options.launcher ?? DEFAULT_BROWSER_LAUNCHER;
  const focus = options.focus ?? createDuoBrowserFocus(options.closeProofMs, options.platform);
  const probeOptions = createNativeBrowserProbe({ clock: options.clock, scheduler: createTimeoutDeadlineScheduler(options.clock),
    closeProofMs: options.closeProofMs, launchTimeoutMs: options.closeProofMs, signal: new AbortController().signal, launcher: browserLauncher });
  type ProviderSession = {
    attempt: DraftDuoAttempt; profileDirectory: string; context?: BrowserContext; launching?: Promise<BrowserContext>; worker?: Worker;
    capability?: DraftDuoCapability; platform?: DuoPlatformAuthenticator; credentialId?: string; requestId?: string; keyRequested?: boolean; accepted: boolean; revoked: boolean;
    startup?: Promise<void>; pump?: Promise<void>;
    pollFailures: Set<ProfileOnboardingDuoProviderError>;
    reportFailure: (error: Error) => Promise<void>; reporting?: Promise<void>; failure?: ProfileOnboardingDuoProviderError; retentionFailed?: boolean; stopFailureAfterSettlement?: ProfileOnboardingDuoProviderError; expiry?: ReturnType<typeof setTimeout>; close?: Promise<Readonly<{ state: "closed" | "uncertain" }>>;
    enrollmentRequestId?: string;
  };

  type OwnedBrowser = {
    owner: DraftDuoBrowserOwner; profileDirectory: string; launch: BrowserRootLaunch; rootInput: BrowserRootLaunchInput; context?: BrowserContext; worker?: Worker;
    launching?: Promise<BrowserContext>; startup?: Promise<void>; pump?: Promise<void>; setup?: Page; setupOpening?: Promise<Page>; portal?: Page; portalOpening?: Promise<void>;
    revoked: boolean; contextClosed: boolean; launchStarted: boolean; closureFailure?: unknown; pumpFailure?: unknown; close?: Promise<Readonly<{ state: "closed" | "uncertain" }>>;
    targets: Map<Page, { tabId: number; windowId: number }>; platforms: Map<Page, Promise<DuoPlatformAuthenticator>>; relayTarget?: NativeFocusTarget;
    process?: OwnedBrowserProcess; draining?: Promise<void>; profileRemovalProved?: true;
  };
  let browser: OwnedBrowser | undefined;
  let windowState: ProfileOnboardingBrowser = { state: "closed", generation: 0 };
  let reopening: Promise<void> | undefined;
  let reopeningGeneration: number | undefined;
  let reopeningOwner: DraftDuoBrowserOwner | undefined;
  function browserState(operationId: string): ProfileOnboardingBrowser {
    if (browser && browser.owner.operationId !== operationId) return { state: "checking", generation: 0 };
    return windowState;
  }
  const closedWindow = () => { if (windowState.state !== "reopening") windowState = { state: "closed", generation: windowState.generation }; };
  let active: ProviderSession | undefined;
  let stopping: Promise<void> | undefined;
  function browserCurrent(session: OwnedBrowser): void {
    if (stopping !== undefined || browser !== session || session.revoked) throw new ProfileOnboardingDuoProviderError("refused", "revoked");
    session.owner.assertCurrent();
  }
  const sameOwner = (a: DraftDuoBrowserOwner, b: Pick<DraftDuoBrowserOwner, "operationId" | "profileId" | "accountId" | "generation">): boolean =>
    a.operationId === b.operationId && a.profileId === b.profileId && a.accountId === b.accountId && a.generation === b.generation;


  const keyMayExist = (session: ProviderSession): boolean => session.keyRequested === true || session.requestId !== undefined;
  const failureKind = (session: ProviderSession) => keyMayExist(session) ? "unknown" as const : "refused" as const;

  function current(session: ProviderSession): void {
    if (active !== session || session.revoked || options.clock.nowMs() >= Date.parse(session.attempt.expiresAt)) throw new ProfileOnboardingDuoProviderError("refused", "revoked");
    if (!browser || !sameOwner(browser.owner, session.attempt)) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    browserCurrent(browser);
    session.capability?.assertCurrent();
  }

  async function observedCurrent(session: ProviderSession): Promise<void> {
    current(session);
    if (!session.worker) throw new ProfileOnboardingDuoProviderError("unknown", "scope");
    await workerCall(session.worker, "assertContext");
    current(session);
  }

  async function scoped<T>(session: ProviderSession, operation: () => Promise<T>): Promise<T> {
    await observedCurrent(session);
    const result = await operation();
    await observedCurrent(session);
    return result;
  }

  async function dispatch(session: ProviderSession, request: BrokerRequest): Promise<unknown> {
    current(session);
    if (request.kind === "enrollment-failed") {
      if (session.enrollmentRequestId !== request.data.requestId) throw new ProfileOnboardingDuoProviderError("unknown", "scope");
      if (browser) reportDuoEvent(browser.owner, { stage: request.data.reason === "request-refused" ? "refused" : request.data.reason, requestId: request.data.requestId });
      throw new ProfileOnboardingDuoProviderError(failureKind(session), request.data.reason);
    }
    if (request.kind === "scope-lost" || request.kind === "native-failed") throw new ProfileOnboardingDuoProviderError(failureKind(session), request.kind === "scope-lost" ? "scope" : "request-refused");
    if (request.kind === "bind") throw new ProfileOnboardingDuoProviderError("refused", "scope");
    const capability = session.capability;
    if (!capability) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    if (request.kind === "persist") {
      if (session.attempt.method !== "key" || session.credentialId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      session.keyRequested = true;
      const result = await scoped(session, () => capability.persistPending(request.data));
      current(session);
      session.credentialId = request.data.credentialId;
      return result;
    }
    if (request.kind === "sign") {
      if (session.attempt.method !== "key" || request.data.credentialId !== session.credentialId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      return scoped(session, () => capability.signAssertion(request.data));
    }
    if (!("credentialId" in request.data)) throw new ProfileOnboardingDuoProviderError("unknown", "provider");
    const { credentialId, requestId } = request.data;
    if (request.kind === "software-created" || request.kind === "native-created") {
      const native = request.kind === "native-created";
      if (native !== (session.attempt.method === "touch") || session.requestId || !native && credentialId !== session.credentialId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      if (native && session.platform?.mechanism === "chromium-platform") {
        const platform = session.platform;
        session.keyRequested = true;
        await scoped(session, async () => capability.persistPending(await platform.credential(credentialId, capability.scope.rpId, options.clock.now().toISOString())));
      }
      const mechanism = native ? session.platform?.mechanism : "fast-duo";
      if (mechanism === undefined) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      await scoped(session, () => capability.recordCeremony({ credentialId, requestId, mechanism, softwareInterceptionDisabled: native }));
      current(session);
      session.credentialId = credentialId; session.requestId = requestId;
      return { observed: true };
    }
    if (credentialId !== session.credentialId || !session.requestId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    if (request.kind === "portal-accepted" && requestId !== session.requestId || request.kind === "exact-request" && session.attempt.method !== "key") throw new ProfileOnboardingDuoProviderError("refused", "scope");
    const enrollmentRequestId = session.requestId;
    await scoped(session, async () => {
      await capability.recordPortalAcceptance({ credentialId, requestId: enrollmentRequestId,
        acceptance: request.kind === "portal-accepted" ? "portal-accepted" : "exact-credential-request" });
      session.accepted = true;
    });
    current(session);
    await selectSetup(session);
    return { observed: true };
  }

  async function platformForPage(session: OwnedBrowser, page: Page): Promise<DuoPlatformAuthenticator> {
    browserCurrent(session);
    const context = session.context;
    if (!context) throw new ProfileOnboardingDuoProviderError("unavailable", "provider");
    let platform = session.platforms.get(page);
    if (!platform) {
      platform = prepareDuoPlatformAuthenticator(context, page, { purpose: "enrollment" });
      session.platforms.set(page, platform);
    }
    const result = await platform;
    browserCurrent(session);
    reportDuoEvent(session.owner, { stage: "platform-virtual" });
    return result;
  }

  function reportFailure(session: ProviderSession, error: unknown, operation?: ProfileOnboardingDuoEvent["operation"], durationMs?: number): Promise<void> {
    if (session.reporting) return session.reporting;
    if (session.accepted) { session.revoked = true; clearTimeout(session.expiry); return Promise.resolve(); }
    session.revoked = true;
    clearTimeout(session.expiry);
    const failure = error instanceof ProfileOnboardingDuoProviderError
      ? keyMayExist(session) && error.kind !== "unknown" ? new ProfileOnboardingDuoProviderError("unknown", error.reason, error) : error
      : new ProfileOnboardingDuoProviderError(failureKind(session), "provider", error);
    session.failure = failure;
    session.reporting = (async () => {
      try {
        if (session.capability && failure.kind === "unknown") await session.capability.retainUnknown({ kind: failure.kind, causeTag: failure.reason });
        // A captured key stays Unknown; physical closure still proves custody.
        if (!(failure.reason === "browser-lifetime" && session.attempt.method === "key" && session.capability && session.requestId)) {
          await session.reportFailure(failure);
        }
      } catch (retentionError) {
        session.retentionFailed = true;
        session.failure = new ProfileOnboardingDuoProviderError("unknown", "provider", new AggregateError([error, retentionError]));
      }
      try { await selectSetup(session); }
      catch (selectionError) { session.failure = new ProfileOnboardingDuoProviderError(session.failure?.kind ?? failure.kind, session.failure?.reason ?? failure.reason,
        new AggregateError([session.failure ?? failure, selectionError], "onboarding-setup-selection-failed")); }
      if (browser && !(error instanceof DuoDiagnosticReportError)
        && !(error instanceof ProfileOnboardingDuoProviderError && error.cause instanceof DuoDiagnosticReportError)) {
        try { reportDuoEvent(browser.owner, failureEvent(error, operation, durationMs)); }
        catch (reportError) { session.failure = new ProfileOnboardingDuoProviderError(session.failure?.kind ?? failure.kind,
          session.failure?.reason ?? failure.reason, new AggregateError([session.failure, reportError])); }
      }
    })();
    return session.reporting;
  }

  function retainPollFailure(session: ProviderSession, error: ProfileOnboardingDuoProviderError): void {
    session.pollFailures.add(error);
    if (session.failure !== error) session.failure = new ProfileOnboardingDuoProviderError(
      session.failure?.kind ?? "unknown", session.failure?.reason ?? "browser-lifetime",
      session.failure === undefined ? error : new AggregateError([session.failure, ...session.pollFailures]));
  }

  async function close(session: ProviderSession): Promise<Readonly<{ state: "closed" | "uncertain" }>> {
    if (session.close) return session.close;
    session.revoked = true; clearTimeout(session.expiry);
    session.close = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let expired = false;
      let stopFailure: ProfileOnboardingDuoProviderError | undefined;
      try {
        await Promise.race([(async () => {
          await Promise.allSettled([session.startup]);
          clearTimeout(session.expiry);
          if (expired) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
          await session.reporting;
          if (session.retentionFailed) throw session.failure ?? new ProfileOnboardingDuoProviderError("unknown", "provider");
          if (session.capability && keyMayExist(session) && !session.accepted) await session.capability.retainUnknown({ kind: "unknown", causeTag: "browser-lifetime" });
          if (expired) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
          if (!session.worker) throw new ProfileOnboardingDuoProviderError("unknown", "worker");
          if (!browser?.contextClosed) {
            try { await workerCall(session.worker, "stop"); }
            catch (error) { stopFailure = new ProfileOnboardingDuoProviderError("unknown", "worker", error); }
          }
          await session.pump;
          await session.reporting;
          if (session.retentionFailed) throw session.failure ?? new ProfileOnboardingDuoProviderError("unknown", "provider");
          if (expired) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
          if (stopFailure !== undefined) { session.stopFailureAfterSettlement = stopFailure; throw stopFailure; }
          if (active === session) active = undefined;
        })(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { expired = true; reject(new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime")); }, options.closeProofMs); })]);
        return { state: "closed" as const };
      } catch (error) {
        const causes = [...new Set([session.failure, ...session.pollFailures, stopFailure, error].filter(value => value !== undefined))];
        session.failure = new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime", causes.length === 1
          ? causes[0] : new AggregateError(causes, "onboarding attempt closure unproved"));
        return { state: "uncertain" as const };
      } finally { clearTimeout(timer); }
    })();
    return session.close;
  }
  async function closeBrowser(session: OwnedBrowser): Promise<Readonly<{ state: "closed" | "uncertain" }>> {
    if (session.close) return session.close;
    session.revoked = true;
    session.close = (async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      let expired = false;
      let workerStopFailure: unknown;
      const started = options.clock.monotonicMs();
      const progress: { operation: NonNullable<ProfileOnboardingDuoEvent["operation"]> } = { operation: "close-attempt" };
      try {
        session.draining = (async () => {
          const attempt = active;
          if (attempt) {
            if (!sameOwner(session.owner, attempt.attempt) || attempt.profileDirectory !== session.profileDirectory
              || attempt.context !== session.context || attempt.worker !== session.worker) throw new ProfileOnboardingDuoProviderError("unknown", "scope");
            if ((await close(attempt)).state !== "closed") {
              if (attempt.stopFailureAfterSettlement === undefined) throw attempt.failure ?? new ProfileOnboardingDuoProviderError("unknown", "provider");
              workerStopFailure = attempt.stopFailureAfterSettlement;
            }
          }
          progress.operation = "close-launch";
          await session.launching;
          session.launch.closing();
          if (session.launchStarted) {
            if (!session.context) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
            if (session.worker && !session.contextClosed) {
              progress.operation = "close-worker";
              try { await workerCall(session.worker, "browserStop"); }
              catch (error) { workerStopFailure = workerStopFailure === undefined ? error : new AggregateError([workerStopFailure, error]); }
            }
            const pages = [...new Set([...session.context.pages(), ...(session.setup ? [session.setup] : []), ...(session.portal ? [session.portal] : [])])];
            progress.operation = "close-pages";
            for (const page of pages) if (!page.isClosed()) await page.close({ runBeforeUnload: false });
            progress.operation = "close-context";
            if (session.process) await session.process.stop(options.closeProofMs, true);
            await session.context.close();
            if (!session.contextClosed || session.context.pages().length || pages.some(page => !page.isClosed())) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
          }
          progress.operation = "close-callbacks";
          await Promise.allSettled([session.startup, session.setupOpening, session.portalOpening]);
          progress.operation = "close-pump";
          await session.pump;
          if (expired) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
          if (browser !== session || active !== undefined && active !== attempt) throw new ProfileOnboardingDuoProviderError("unknown", "scope");
          session.launch.closed();
          progress.operation = "close-native-proof";
          await options.browserRoots.withUnused(session.profileDirectory, probeOptions, async ({ remove }) => {
            if (expired) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
            remove();
          }, session.rootInput);
          session.profileRemovalProved = true;
          if (expired) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
          if (active === attempt) active = undefined;
          if (browser === session) browser = undefined;
          closedWindow();
        })();
        await Promise.race([session.draining, new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { expired = true; reject(new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime")); }, options.closeProofMs * 2); })]);
        return { state: "closed" as const };
      } catch (error) {
        let closureFailure = error;
        try { reportDuoEvent(session.owner, failureEvent(error, progress.operation, Math.max(0, options.clock.monotonicMs() - started))); }
        catch (diagnostic) { closureFailure = new DuoDiagnosticReportError(diagnostic, error); }
        try { session.launch.uncertain(closureFailure); } catch (failure) { closureFailure = failure; }
        windowState = { state: "failed", generation: windowState.generation, code: progress.operation === "close-native-proof" ? "DUO_SETUP_FILES_BUSY" : "DUO_SETUP_STOP_FAILED" };
        session.closureFailure = workerStopFailure === undefined ? closureFailure : new AggregateError([workerStopFailure, closureFailure], "onboarding browser closure unproved"); return { state: "uncertain" as const }; }
      finally { clearTimeout(timer); }
    })();
    return session.close;
  }
  async function ownedPage(session: OwnedBrowser, url: string, install = false): Promise<Page> {
    const { context, worker } = session;
    if (!context || !worker) throw new ProfileOnboardingDuoProviderError("unavailable", "worker");
    const token = randomUUID(), marker = `${install ? "about:blank" : url}#relay-target=${token}`;
    const opened = context.waitForEvent("page", { predicate: page => page.waitForURL(marker, { waitUntil: "commit", timeout: options.closeProofMs }).then(() => true, () => false), timeout: options.closeProofMs });
    const [page, raw] = await Promise.all([opened, workerCall(worker, install ? "browserInstall" : "browserPage", [install ? token : marker])]);
    const target = z.strictObject({ tabId: z.number().int().nonnegative(), windowId: z.number().int().nonnegative(), url: z.literal(marker) }).parse(raw);
    browserCurrent(session);
    if (page.url() !== target.url) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    session.targets.set(page, target);
    if (!install) await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.closeProofMs });
    browserCurrent(session);
    return page;
  }
  async function selectPage(session: OwnedBrowser, page: Page): Promise<void> {
    browserCurrent(session);
    const target = session.targets.get(page);
    if (!target || !session.worker || page.isClosed()) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    const url = page.url();
    await workerCall(session.worker, "browserSelect", [target.tabId, target.windowId]);
    browserCurrent(session);
    if (page.url() !== url) throw new ProfileOnboardingDuoProviderError("refused", "scope");
  }
  async function selectSetup(resource: ProviderSession): Promise<void> {
    const session = browser;
    if (!session || session.revoked || !session.setup || session.setup.isClosed()) return;
    if (session.context !== resource.context || session.worker !== resource.worker || session.profileDirectory !== resource.profileDirectory || !sameOwner(session.owner, resource.attempt)) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    if (!session.worker || session.setup.url() !== new URL("options.html", session.worker.url()).href) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    await selectPage(session, session.setup);
  }
  async function recoverBrowser(owner: DraftDuoBrowserOwner, generation: number): Promise<void> {
    if (stopping !== undefined) throw new ProfileOnboardingDuoProviderError("refused", "revoked");
    if (reopening) {
      if (reopeningGeneration !== generation || reopeningOwner === undefined || !sameOwner(reopeningOwner, owner)) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      return reopening;
    }
    owner.assertCurrent();
    if (generation !== windowState.generation || browser && !sameOwner(browser.owner, owner)) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    reopeningGeneration = generation;
    reopeningOwner = owner;
    const previous = browser;
    windowState = { state: "reopening", generation };
    reopening = (async () => {
      if (previous) {
        previous.revoked = true;
        let expired = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let code: "DUO_SETUP_STOP_FAILED" | "DUO_SETUP_FILES_BUSY" = "DUO_SETUP_STOP_FAILED";
        try {
          const check = () => { if (expired || browser !== previous) throw new Error("DUO_SETUP_STOP_FAILED"); };
          await Promise.race([(async () => {
            if (!previous.process) throw new Error("DUO_SETUP_STOP_FAILED");
            await previous.process.stop(options.closeProofMs); check();
            await Promise.allSettled([previous.launching, previous.draining, previous.startup, previous.setupOpening, previous.portalOpening, previous.pump]); check();
            const attempt = active;
            if (attempt) {
              if (!sameOwner(owner, attempt.attempt)) throw new Error("DUO_SETUP_STOP_FAILED");
              await Promise.allSettled([attempt.startup, attempt.pump, attempt.reporting]); check();
              if (attempt.retentionFailed) throw attempt.failure ?? new Error("DUO_SETUP_STOP_FAILED");
              if (!attempt.accepted && attempt.capability && keyMayExist(attempt)) await attempt.capability.retainUnknown({ kind: "unknown", causeTag: "browser-lifetime" });
              check(); clearTimeout(attempt.expiry);
            }
            if (previous.context && (!previous.contextClosed || previous.context.pages().some(page => !page.isClosed()))) throw new Error("DUO_SETUP_STOP_FAILED");
            code = "DUO_SETUP_FILES_BUSY";
            await previous.launch.recover(probeOptions, check, async () => {
              check();
              if (previous.profileRemovalProved) {
                if (lstatSync(previous.profileDirectory, { throwIfNoEntry: false }) !== undefined) throw new Error("DUO_SETUP_FILES_BUSY");
              } else {
                await options.browserRoots.withUnused(previous.profileDirectory, probeOptions, async ({ remove }) => { check(); remove(); }, previous.rootInput);
                previous.profileRemovalProved = true;
              }
              check();
            });
            check();
            if (active === attempt) active = undefined;
            browser = undefined;
          })(), new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => { expired = true; reject(new Error(code)); }, options.closeProofMs * 2);
          })]);
        } catch (cause) {
          windowState = { state: "failed", generation, code };
          throw new Error(code, { cause });
        } finally { clearTimeout(timer); }
      }
      owner.assertCurrent();
      windowState = { state: "closed", generation };
    })();
    try { await reopening; }
    finally { reopening = undefined; reopeningGeneration = undefined; reopeningOwner = undefined; }
  }
  async function waitForManualUcsdSignIn(page: Page, session: OwnedBrowser): Promise<void> {
    const attempt = active !== undefined && sameOwner(session.owner, active.attempt) ? active : undefined;
    // shortcut: same 10-minute sign-up attempt window as profile-onboarding start, including when the portal opens before a method starts
    const deadline = attempt === undefined ? options.clock.nowMs() + 600_000 : Date.parse(attempt.attempt.expiresAt);
    while (options.clock.nowMs() < deadline) {
      browserCurrent(session);
      if (duoSignInHost(page.url())) return;
      const remaining = deadline - options.clock.nowMs();
      await new Promise(resolve => setTimeout(resolve, Math.min(20, Math.max(1, remaining))));
    }
    if (duoSignInHost(page.url())) return;
    const cause = new Error("sign-in wait");
    cause.name = "TimeoutError";
    throw new Error("UCSD_SSO_SUBMIT_TIMEOUT", { cause });
  }
  async function openPortal(session: OwnedBrowser): Promise<void> {
    browserCurrent(session);
    const context = session.context;
    if (!context) throw new ProfileOnboardingDuoProviderError("unavailable", "provider");
    if (session.portal?.isClosed()) { session.portal = undefined; session.portalOpening = undefined; }
    if (!session.portalOpening) session.portalOpening = (async () => {
      const started = options.clock.monotonicMs();
      try {
        const page = session.portal ?? await ownedPage(session, "about:blank");
        session.portal = page; browserCurrent(session);
        await selectPage(session, page);
        await page.goto("https://duo.ucsd.edu", { waitUntil: "domcontentloaded", timeout: options.closeProofMs }).catch((cause: unknown) => {
          if (cause instanceof Error && cause.name === "TimeoutError") throw new Error("UCSD_DUO_NAVIGATION_TIMEOUT", { cause });
          throw cause;
        });
        browserCurrent(session);
        const landing = await waitForUcsdDuoSignIn(page, () => browserCurrent(session), options.closeProofMs);
        browserCurrent(session);
        if (landing === "sso-form") await waitForManualUcsdSignIn(page, session);
        browserCurrent(session);
      } catch (error) {
        try { reportDuoEvent(session.owner, failureEvent(error, "portal-open", Math.max(0, options.clock.monotonicMs() - started))); }
        catch (diagnostic) { throw new DuoDiagnosticReportError(diagnostic, error); }
        throw new ProfileOnboardingDuoProviderError("refused", "scope", error);
      }
    })();
    const opening = session.portalOpening;
    try { await opening; }
    catch (error) {
      if (session.portalOpening === opening) delete session.portalOpening;
      if (session.portal && trustedPortalUrl(session.portal.url())) await focusPage(session, session.portal);
      throw error;
    }
    browserCurrent(session);
    const page = session.portal;
    if (!page || page.isClosed()) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    const url = new URL(page.url());
    if (!trustedPortalUrl(url.href)) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    await focusPage(session, page);
    if (page.url() !== url.href) throw new ProfileOnboardingDuoProviderError("refused", "scope");
  }
  async function focusPage(session: OwnedBrowser, page: Page): Promise<void> {
    browserCurrent(session);
    await selectPage(session, page); browserCurrent(session);
    try {
      if (!session.worker) throw new ProfileOnboardingDuoProviderError("unavailable", "worker");
      await workerCall(session.worker, "browserFocus"); browserCurrent(session);
      if (!session.context) throw new ProfileOnboardingDuoProviderError("unavailable", "provider");
      await focus.show(session.context, page);
    }
    catch (error) {
      browserCurrent(session);
      reportDuoEvent(session.owner, { ...failureEvent(error, "browser-focus"), code: "ONBOARDING_DUO_FOCUS_FAILED" });
      if ((options.platform ?? process.platform) !== "darwin") throw new ProfileOnboardingDuoProviderError("unavailable", "provider", error);
    }
    browserCurrent(session);
  }
  async function showBrowser(owner: DraftDuoBrowserOwner): Promise<void> {
    if (stopping !== undefined) throw new ProfileOnboardingDuoProviderError("refused", "revoked");
    owner.assertCurrent();
    if (browser) {
      if (!sameOwner(browser.owner, owner)) throw new ProfileOnboardingDuoProviderError("refused", "busy");
      const previous = browser;
      if (previous.revoked || previous.contextClosed) {
        if ((await closeBrowser(previous)).state !== "closed") throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime", previous.closureFailure);
        owner.assertCurrent();
        if (previous.pumpFailure !== undefined) throw new ProfileOnboardingDuoProviderError("unknown", "worker", previous.pumpFailure);
        return showBrowser(owner);
      }
      browserCurrent(previous); await previous.startup; browserCurrent(previous);
      if (!previous.worker || !previous.context) throw new ProfileOnboardingDuoProviderError("unavailable", "provider");
      const setupUrl = new URL("options.html", previous.worker.url()).href;
      if (previous.setupOpening || !previous.setup || previous.setup.isClosed()) {
        previous.setupOpening ??= (async () => {
          const page = await ownedPage(previous, setupUrl); browserCurrent(previous);
          return page;
        })();
        previous.setup = await previous.setupOpening; browserCurrent(previous);
        previous.setupOpening = undefined;
      }
      if (previous.setup.url() !== setupUrl) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      await focusPage(previous, previous.setup);
      if (previous.setup.url() !== setupUrl) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      return;
    }
    if (!Number.isFinite(options.closeProofMs) || options.closeProofMs <= 0) throw new ProfileOnboardingDuoProviderError("refused", "revoked");
    try {
      if (!isAbsolute(options.browserRoot) || realpathSync(options.browserRoot) !== options.browserRoot || !isAbsolute(options.extensionDirectory)) throw new Error("root");
      const root = process.platform === "win32" ? lstatSync(options.browserRoot, { bigint: true }) : lstatSync(options.browserRoot);
      if (!root.isDirectory() || root.isSymbolicLink() || privatePathRejects(options.browserRoot, root, "private")) throw new Error("root");
    } catch { throw new ProfileOnboardingDuoProviderError("unavailable", "browser-root"); }
    const ownerIdentity={operationId:owner.operationId,profileId:owner.profileId,accountId:owner.accountId,generation:owner.generation};
    const assertOwner=()=>{if(stopping!==undefined)throw new ProfileOnboardingDuoProviderError("refused","revoked");owner.assertCurrent();if(!sameOwner(owner,ownerIdentity))throw new ProfileOnboardingDuoProviderError("refused","scope");};
    const request: SignupBrowserRootInput = { profileId: owner.profileId, profileRoot: options.browserRoot,
      credentialFingerprint: null, owner: { kind: "signup", operationId: owner.operationId, accountId: owner.accountId, providerGeneration: owner.generation } };
    const prior = options.browserRoots.signupRoot(request);
    if(readdirSync(options.browserRoot).some(name=>prior === undefined || name!==basename(prior.profileDirectory))) {
      throw new ProfileOnboardingDuoProviderError("unknown","browser-root");
    }
    if (prior !== undefined && lstatSync(prior.profileDirectory, { throwIfNoEntry: false }) !== undefined) {
      await options.browserRoots.withUnused(prior.profileDirectory, probeOptions, async ({ remove }) => { assertOwner(); remove(); }, prior);
      assertOwner();
    }
    assertOwner();
    const relayTarget = await focus.captureRelay().catch((error: unknown) => {
      throw new ProfileOnboardingDuoProviderError("unavailable", "provider", error);
    });
    assertOwner();
    const launch = options.browserRoots.beginSignupLaunch(request), rootInput = launch.input, profileDirectory = rootInput.profileDirectory;
    windowState = { state: "opening", generation: windowState.generation + 1 };
    const generation = windowState.generation;
    const session: OwnedBrowser = { owner, profileDirectory, launch, rootInput, revoked: false, contextClosed: false, launchStarted: false, targets: new Map(), platforms: new Map(), relayTarget };
    browser = session;
    const setupStarted = options.clock.monotonicMs();
    session.startup = (async () => {
      mkdirSync(session.profileDirectory, { mode: 0o700 });
      mkdirSync(join(session.profileDirectory, "Default"), { mode: 0o700 });
      writeFileSync(join(session.profileDirectory, "Default", "Preferences"), JSON.stringify({ credentials_enable_service: false, profile: { password_manager_enabled: false } }), { mode: 0o600, flag: "wx" });
      const extensionDirectory = join(session.profileDirectory, "relay-extension");
      try { stageFastDuoExtension(options.extensionDirectory, extensionDirectory, PROFILE_ENROLLMENT_EXTENSION_MODE); }
      catch (error) { throw new ProfileOnboardingDuoProviderError("unavailable", "browser-root", error); }
      session.launchStarted = true;
      session.launching = browserLauncher.launch({ profileDirectory: session.profileDirectory, headless: false,
        extensionDirectory, acceptDownloads: false, downloadsPath: session.profileDirectory, viewport: { width: 640, height: 720 }, timeoutMs: options.closeProofMs, ownedProcess: process => { session.process = process; process.onExit(() => { if (browser === session) closedWindow(); }); }, disablePasswordManager: true, defaultContextOptions: true }).then(context => {
        session.context = context;
        context.on("close", () => {
          session.contextClosed = true;
          if (browser === session) {
            if (session.process?.exited()) closedWindow();
            else if (windowState.state === "open" || windowState.state === "opening") windowState = { state: "checking", generation: windowState.generation };
          }
          // Context closure precedes native profile release; the next owner operation proves cleanup.
          if (!session.close) {
            session.revoked = true;
            if (active) {
              if (active.accepted || active.attempt.method === "key" && active.requestId) active.revoked = true;
              else void reportFailure(active, new ProfileOnboardingDuoProviderError(keyMayExist(active) ? "unknown" : "unavailable", "browser-lifetime"));
              void close(active);
            }
          }
        });
        return context;
      });
      const context = await session.launching;
      browserCurrent(session);
      session.launch.opened();
      if (session.contextClosed) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
      session.worker = context.serviceWorkers().find(worker => worker.url().startsWith("chrome-extension://") && worker.url().endsWith("/src/relay-background.js"))
        ?? await context.waitForEvent("serviceworker", { predicate: worker => worker.url().startsWith("chrome-extension://") && worker.url().endsWith("/src/relay-background.js"), timeout: options.closeProofMs });
      browserCurrent(session);
      const worker = session.worker;
      worker.on("close", () => { if (!context.isClosed()) workersClosedBeforeContext.add(worker); });
      const setupUrl = new URL("options.html", worker.url()).href;
      session.setup = await ownedPage(session, setupUrl, true);
      browserCurrent(session);
      session.pump = (async () => {
        while (!session.revoked) {
          const raw = await workerCall(worker, "browserNext");
          if (raw === null && session.revoked) return;
          const request = z.discriminatedUnion("kind", [
            z.strictObject({ id: z.uuid(), kind: z.enum(["state", "portal", "portal-show", "start", "cancel", "confirm"]), method: z.enum(["key", "touch"]).optional(), attemptId: z.uuid().optional() }),
            z.strictObject({ id: z.uuid(), kind: z.literal("return") }),
            z.strictObject({ id: z.uuid(), kind: z.literal("window-closed") }),
            z.strictObject({ id: z.uuid(), kind: z.literal("event"), event: ProfileOnboardingDuoEventSchema }),
            z.strictObject({ id: z.uuid(), kind: z.literal("platform"), url: z.url() }),
          ]).parse(raw);
          const started = options.clock.monotonicMs();
          let operationFailure: unknown;
          try {
            browserCurrent(session);
            if (request.kind === "window-closed") { closedWindow(); continue; }
            if (request.kind === "event") {
              if (request.event.stage === "intercepted" && active) {
                if (active.enrollmentRequestId && active.enrollmentRequestId !== request.event.requestId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
                active.enrollmentRequestId = request.event.requestId;
              }
              reportDuoEvent(owner, request.event);
              await workerCall(worker, "browserReply", [request.id, { ok: true, value: { observed: true } }]);
              continue;
            }
            if (request.kind === "platform") {
              const url = new URL(request.url);
              if (url.protocol !== "https:" || url.port || url.username || url.password || !(url.hostname === "duosecurity.com" || url.hostname.endsWith(".duosecurity.com"))) throw new ProfileOnboardingDuoProviderError("refused", "scope");
              const pages = context.pages().filter(page => !page.isClosed() && page.url() === request.url);
              if (pages.length !== 1 || !pages[0]) throw new ProfileOnboardingDuoProviderError("refused", "scope");
              await platformForPage(session, pages[0]);
              browserCurrent(session);
              await workerCall(worker, "browserReply", [request.id, { ok: true, value: true }]);
              continue;
            }
            if (request.kind === "portal") await openPortal(session);
            else if (request.kind === "portal-show") {
              if (!session.portal || !trustedPortalUrl(session.portal.url())) throw new ProfileOnboardingDuoProviderError("refused", "scope");
              await focusPage(session, session.portal);
            }
            else if (request.kind === "return") {
              if (!session.relayTarget) throw new ProfileOnboardingDuoProviderError("refused", "provider");
              try { await focus.returnToRelay(session.relayTarget); }
              catch (error) {
                browserCurrent(session);
                reportDuoEvent(owner, { ...failureEvent(error, "browser-return"), code: "ONBOARDING_DUO_FOCUS_FAILED" });
                if ((options.platform ?? process.platform) !== "darwin") throw error;
              }
            }
            else if (request.kind === "start") { if (!request.method || request.attemptId) throw new Error("scope"); await owner.start(request.method); }
            else if (request.kind === "cancel" || request.kind === "confirm") {
              if (!request.method || !request.attemptId) throw new Error("scope");
              if (request.kind === "cancel") await owner.cancel(request.method, request.attemptId);
              else owner.confirm(request.method, request.attemptId);
            }
            browserCurrent(session);
            await workerCall(worker, "browserReply", [request.id, { ok: true, value: owner.readState() }]);
          } catch (error) {
            operationFailure = error;
            let portalFailure: "untrusted" | "sign-in" | undefined;
            const page = session.portal;
            if (request.kind === "portal" && page && !page.isClosed()) {
              const original = error instanceof ProfileOnboardingDuoProviderError ? error.cause : error;
              if (!trustedPortalUrl(page.url())) portalFailure = "untrusted";
              else if (original instanceof Error && ["UCSD_DUO_NAVIGATION_TIMEOUT", "UCSD_SSO_REDIRECT_TIMEOUT", "UCSD_SSO_FORM_TIMEOUT", "UCSD_SSO_SUBMIT_TIMEOUT"].includes(original.message)) portalFailure = "sign-in";
            }
            try {
              if (!(error instanceof DuoDiagnosticReportError)) reportDuoEvent(owner, failureEvent(error, "browser-request", Math.max(0, options.clock.monotonicMs() - started)));
            } catch (reportError) { operationFailure = new DuoDiagnosticReportError(reportError, error); }
            finally { await workerCall(worker, "browserReply", [request.id, { ok: false, ...(portalFailure === undefined ? {} : { portalFailure }) }]); }
            if (operationFailure instanceof DuoDiagnosticReportError) throw operationFailure;
          } finally {
            if (!(operationFailure instanceof DuoDiagnosticReportError)) {
              slowOperation(owner, "browser-request", started, operationFailure);
            }
          }
        }
      })().catch(async error => {
        const pollFailure = error instanceof ProfileOnboardingDuoProviderError && error.reason === "browser-lifetime";
        if (closingPollFailure(error, context, worker) || session.revoked && !pollFailure) return;
        session.revoked = true;
        session.pumpFailure = error;
        if (browser === session && windowState.state !== "reopening" && windowState.state !== "failed") windowState = { state: "checking", generation: windowState.generation };
        try {
          const attempt = active;
          if (attempt) { await reportFailure(attempt, error); if (pollFailure) retainPollFailure(attempt, error); await close(attempt); }
          else if (!(error instanceof DuoDiagnosticReportError)) reportDuoEvent(owner, failureEvent(error));
        } catch (reportError) { session.pumpFailure = new AggregateError([error, reportError]); }
      });
      if (!session.setup) throw new ProfileOnboardingDuoProviderError("unavailable", "scope");
      await session.setup.goto(setupUrl, { waitUntil: "domcontentloaded", timeout: options.closeProofMs });
      browserCurrent(session);
      for (const page of context.pages()) if (page !== session.setup && page.url() === "about:blank") await page.close();
      await session.setup.waitForLoadState("domcontentloaded");
      if (relayTarget?.workArea) {
        const frame = await session.setup.evaluate(() => ({ width: Math.max(0, window.outerWidth - window.innerWidth), height: Math.max(0, window.outerHeight - window.innerHeight) }));
        await workerCall(worker, "browserBounds", [relayTarget.workArea, frame]); browserCurrent(session);
      }
      session.setup.on("close", () => { if (browser === session && context.pages().every(page => page.isClosed())) closedWindow(); });
      windowState = { state: "open", generation: windowState.generation };
      browserCurrent(session);
    })();
    let failure: { error: unknown } | undefined;
    try {
      await session.startup;
      if (!session.setup) throw new ProfileOnboardingDuoProviderError("unavailable", "provider");
      await focusPage(session, session.setup);
    } catch (error) {
      failure = { error };
      if (!(error instanceof DuoDiagnosticReportError)) {
        try { reportDuoEvent(owner, failureEvent(error, "browser-setup", Math.max(0, options.clock.monotonicMs() - setupStarted))); }
        catch (reportError) { failure.error = new DuoDiagnosticReportError(reportError, error); }
      }
    }
    if (!(failure?.error instanceof DuoDiagnosticReportError)) {
      try { slowOperation(owner, "browser-setup", setupStarted); }
      catch (error) { failure = { error: new DuoDiagnosticReportError(error, failure?.error) }; }
    }
    if (failure !== undefined) {
      windowState = { state: "failed", generation: windowState.generation, code: "DUO_SETUP_OPEN_FAILED" };
      const closure = await closeBrowser(session);
      if (closure.state !== "closed") throw new AggregateError([failure.error, session.closureFailure], "Duo setup and closure failed.");
      if (browser === undefined && windowState.generation === generation) windowState = { state: "failed", generation, code: "DUO_SETUP_OPEN_FAILED" };
      throw failure.error;
    }
  }

  return Object.freeze({
    stop(): Promise<void> {
      stopping ??= (async () => {
        const owned = browser;
        if (owned !== undefined) {
          if ((await closeBrowser(owned)).state !== "closed") throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime", owned.closureFailure);
        } else if (active !== undefined) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
      })();
      return stopping;
    },
    browserState,
    recoverBrowser,
    async showBrowser(owner: DraftDuoBrowserOwner) {
      const previous = browser, generation = windowState.generation;
      try { await showBrowser(owner); }
      catch (cause) {
        if (windowState.state !== "failed" && browser === previous && windowState.generation === generation && (!previous || sameOwner(previous.owner, owner))) windowState = { state: "failed", generation, code: "DUO_SETUP_OPEN_FAILED" };
        throw cause;
      }
    },
    async openPortal(owner: DraftDuoBrowserOwner) { await showBrowser(owner); if (!browser) throw new ProfileOnboardingDuoProviderError("unavailable", "provider"); await openPortal(browser); },
    async closeBrowser(owner: DraftDuoBrowserOwner) {
      if (!browser) return { state: "closed" as const };
      if (!sameOwner(browser.owner, owner)) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      const session = browser, closure = await closeBrowser(session);
      return closure.state === "closed" ? { state: "closed" as const } : { state: "uncertain" as const, cause: session.closureFailure };
    },
    async start(attempt: DraftDuoAttempt, bindObservedContext: (context: DraftDuoObservedContext) => Promise<DraftDuoCapability>, onFailure: (error: Error) => Promise<void>): Promise<void> {
      if (active) {
        if (canonicalJsonStringify(active.attempt) !== canonicalJsonStringify(attempt) || active.revoked) throw new ProfileOnboardingDuoProviderError("refused", "busy");
        return active.startup;
      }
      if (!(Date.parse(attempt.expiresAt) > options.clock.nowMs()) || !browser || !sameOwner(browser.owner, attempt)) throw new ProfileOnboardingDuoProviderError("refused", "revoked");
      browserCurrent(browser);
      await browser.startup;
      browserCurrent(browser);
      const session: ProviderSession = { attempt, profileDirectory: browser.profileDirectory,
        context: browser.context, worker: browser.worker,
        reportFailure: onFailure, pollFailures: new Set(), accepted: false, revoked: false };
      active = session;
      session.startup = (async () => {
        if (!session.worker) throw new ProfileOnboardingDuoProviderError("unavailable", "worker");
        const setupStarted = options.clock.monotonicMs();
        let setupFailure: unknown;
        try { await workerCall(session.worker, "install", [{ method: attempt.method, nowMs: options.clock.nowMs() }]); }
        catch (error) { setupFailure = error; throw error; }
        finally { if (browser) slowOperation(browser.owner, "attempt-setup", setupStarted, setupFailure); }
        const worker = session.worker;
        session.pump = (async () => {
          while (!session.revoked) {
            const raw = await workerCall(worker, "next");
            if (raw === null && session.revoked) return;
            const request = BrokerRequestSchema.parse(raw);
            const started = options.clock.monotonicMs();
            let operationFailure: unknown;
            try {
              if (request.kind === "bind" && browser) reportDuoEvent(browser.owner, { stage: "backend-received", ...(session.enrollmentRequestId ? { requestId: session.enrollmentRequestId } : {}) });
              let result: unknown;
              if (request.kind === "bind") {
                current(session);
                if (session.capability) throw new ProfileOnboardingDuoProviderError("refused", "scope");
                const url = new URL(request.data.origin);
                if (url.protocol !== "https:" || url.port || url.username || url.password || url.origin !== request.data.origin || !(url.hostname === "duosecurity.com" || url.hostname.endsWith(".duosecurity.com"))) throw new ProfileOnboardingDuoProviderError("refused", "scope");
                await observedCurrent(session);
                if (attempt.method === "touch") {
                  const context = session.context;
                  const pages = context?.pages().filter(page => !page.isClosed() && new URL(page.url()).origin === request.data.origin);
                  if (!context || pages?.length !== 1 || !pages[0]) throw new ProfileOnboardingDuoProviderError("refused", "scope");
                  if (!browser || !session.worker) throw new ProfileOnboardingDuoProviderError("refused", "scope");
                  session.platform = await platformForPage(browser, pages[0]);
                  await observedCurrent(session);
                }
                const capability = await bindObservedContext({ contextId: request.data.documentId, tabId: request.data.tabId,
                  origin: request.data.origin, rpId: request.data.rpId });
                if (canonicalJsonStringify(capability.attempt) !== canonicalJsonStringify(attempt)
                  || capability.scope.contextId !== request.data.documentId || capability.scope.tabId !== request.data.tabId
                  || capability.scope.accountId !== attempt.accountId || capability.scope.origin !== request.data.origin
                  || capability.scope.rpId !== request.data.rpId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
                capability.assertCurrent();
                session.capability = capability;
                await observedCurrent(session);
                result = { accountId: attempt.accountId };
              } else result = await dispatch(session, request);
              await observedCurrent(session);
              await workerCall(worker, "reply", [request.id, { ok: true, value: result }]);
            } catch (error) {
              operationFailure = error;
              await reportFailure(session, error, "broker-request", Math.max(0, options.clock.monotonicMs() - started));
              try { await workerCall(worker, "reply", [request.id, { ok: false }]); }
              finally { queueMicrotask(() => { void close(session); }); }
              return;
            } finally { if (browser) slowOperation(browser.owner, "broker-request", started, operationFailure); }
          }
        })().catch(async error => {
          if (error instanceof DuoDiagnosticReportError && session.failure) {
            session.failure = new ProfileOnboardingDuoProviderError(session.failure.kind, session.failure.reason, new AggregateError([session.failure, error]));
          }
          const pollFailure = error instanceof ProfileOnboardingDuoProviderError && error.reason === "browser-lifetime";
          if (closingPollFailure(error, session.context, session.worker) || session.revoked && !pollFailure) return;
          await reportFailure(session, error);
          if (pollFailure) retainPollFailure(session, error);
          queueMicrotask(() => { void close(session); });
        });
        session.expiry = setTimeout(() => {
          void reportFailure(session, new ProfileOnboardingDuoProviderError(failureKind(session), "timed-out")).then(() => close(session));
        }, Math.max(1, Date.parse(attempt.expiresAt) - options.clock.nowMs()));

      })();
      try { await session.startup; }
      catch (error) {
        await reportFailure(session, error instanceof ProfileOnboardingDuoProviderError ? error
          : new ProfileOnboardingDuoProviderError("unavailable", "worker", error));
        await close(session);
        throw session.failure ?? new ProfileOnboardingDuoProviderError("unknown", "provider", error);
      }
    },
    async cancel(attempt: DraftDuoAttempt): Promise<Readonly<{ state: "closed" | "uncertain" }>> {
      if (!active) return { state: "closed" };
      if (canonicalJsonStringify(active.attempt) !== canonicalJsonStringify(attempt)) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      const session = active;
      const result = await close(session);
      if (result.state === "uncertain" && session.failure) throw session.failure;
      return result;
    },
  });
}
