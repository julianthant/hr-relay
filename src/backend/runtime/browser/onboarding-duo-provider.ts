import { prepareOnboardingPlatformAuthenticator, type OnboardingPlatformAuthenticator } from "./onboarding-platform-authenticator.js";
import { createNativeBrowserProbe, DEFAULT_BROWSER_LAUNCHER, type PersistentContextLauncher } from "./native-browser.js";
import { privatePathRejects } from "../../storage/private-path.js";
import { DuoAssertionRequestSchema } from "../../storage/configuration/duo-signing.js";
import { stageFastDuoExtension } from "./fast-duo-extension.js";
import { lstatSync, mkdirSync, realpathSync, readdirSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { submitPinnedUcsdSsoCredentials } from "../../systems/browser-shared/ucsd-sso.js";
import type { BrowserContext, Page, Worker } from "playwright";
import { z } from "zod";
import { BrowserDocumentIdSchema, PROFILE_ENROLLMENT_EXTENSION_MODE } from "../../../models/config/duo-credential-store.js";
import type { Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { onboardingProfileDirectory, type BrowserRoots, type BrowserRootLaunch, type BrowserRootLaunchInput } from "../../storage/browser-roots.js";
import { createTimeoutDeadlineScheduler } from "../scheduling/timeout-deadline-scheduler.js";
import type { DraftDuoAttempt, DraftDuoBrowserOwner, DraftDuoCapability, DraftDuoObservedContext, ProfileOnboardingDuoProvider } from "../../profiles/onboarding-duo.js";
import { ProfileOnboardingDuoEventSchema, type ProfileOnboardingDuoFailure } from "../../../models/profiles/profile.js";

export class ProfileOnboardingDuoProviderError extends Error {
  constructor(readonly kind: "unavailable" | "refused" | "unknown",
    readonly reason: ProfileOnboardingDuoFailure["causeTag"],
    cause?: unknown) {
    super("Duo onboarding provider could not complete.", cause === undefined ? undefined : { cause });
    this.name = "ProfileOnboardingDuoProviderError";
  }
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
    documentId: BrowserDocumentIdSchema, tabId: z.number().int().nonnegative(), origin: z.url(), rpId: z.literal("duosecurity.com"), username: z.string().min(1).max(128),
  }) }),
  z.strictObject({ id: z.uuid(), kind: z.literal("persist"), data: PendingSchema }),
  z.strictObject({ id: z.uuid(), kind: z.literal("sign"), data: DuoAssertionRequestSchema }),
  z.strictObject({ id: z.uuid(), kind: z.enum(["native-failed", "scope-lost"]), data: z.strictObject({ requestId: z.uuid() }) }),
  ...(["software-created", "native-created", "portal-accepted", "exact-request"] as const).map(kind =>
    z.strictObject({ id: z.uuid(), kind: z.literal(kind), data: ReceiptSchema })),
]);
type BrokerRequest = z.infer<typeof BrokerRequestSchema>;

export interface OnboardingDuoProviderOptions {
  readonly browserRoots: BrowserRoots;
  readonly browserRoot: string;
  readonly extensionDirectory: string;
  readonly clock: Clock;
  readonly closeProofMs: number;
  readonly launcher?: PersistentContextLauncher;
  readonly platform?: NodeJS.Platform;
}


async function workerCall(worker: Worker, method: "install" | "next" | "reply" | "stop" | "assertContext" | "platformAvailable" | "browserInstall" | "browserFocus" | "browserNext" | "browserReply" | "browserStop", args: readonly unknown[] = []): Promise<unknown> {
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
  const browserLauncher = options.launcher ?? DEFAULT_BROWSER_LAUNCHER;
  const nativePlatform = (options.platform ?? process.platform) === "darwin";
  const probeOptions = createNativeBrowserProbe({ clock: options.clock, scheduler: createTimeoutDeadlineScheduler(options.clock),
    closeProofMs: options.closeProofMs, launchTimeoutMs: options.closeProofMs, signal: new AbortController().signal, launcher: browserLauncher, ...(nativePlatform ? { nativePlatform: true } : {}) });
  type ProviderSession = {
    attempt: DraftDuoAttempt; profileDirectory: string; context?: BrowserContext; launching?: Promise<BrowserContext>; worker?: Worker;
    capability?: DraftDuoCapability; platform?: OnboardingPlatformAuthenticator; credentialId?: string; requestId?: string; accepted: boolean; revoked: boolean;
    contextClosed: boolean; launchStarted: boolean; startup?: Promise<void>; pump?: Promise<void>;
    reportFailure: (error: Error) => Promise<void>; reporting?: Promise<void>; failure?: ProfileOnboardingDuoProviderError; retentionFailed?: boolean; stopFailureAfterSettlement?: ProfileOnboardingDuoProviderError; expiry?: ReturnType<typeof setTimeout>; close?: Promise<Readonly<{ state: "closed" | "uncertain" }>>;
    enrollmentRequestId?: string;
  };

  type OwnedBrowser = {
    owner: DraftDuoBrowserOwner; profileDirectory: string; launch: BrowserRootLaunch; rootInput: BrowserRootLaunchInput; context?: BrowserContext; worker?: Worker;
    launching?: Promise<BrowserContext>; startup?: Promise<void>; pump?: Promise<void>; setup?: Page; setupOpening?: Promise<Page>; portal?: Page; portalOpening?: Promise<void>;
    revoked: boolean; contextClosed: boolean; launchStarted: boolean; closureFailure?: unknown; close?: Promise<Readonly<{ state: "closed" | "uncertain" }>>;
    platforms: Map<Page, Promise<OnboardingPlatformAuthenticator>>;
  };
  let browser: OwnedBrowser | undefined;
  let active: ProviderSession | undefined;
  function browserCurrent(session: OwnedBrowser): void {
    if (browser !== session || session.revoked) throw new ProfileOnboardingDuoProviderError("refused", "revoked");
    session.owner.assertCurrent();
  }
  const sameOwner = (a: DraftDuoBrowserOwner, b: Pick<DraftDuoBrowserOwner, "operationId" | "profileId" | "accountId" | "generation">): boolean =>
    a.operationId === b.operationId && a.profileId === b.profileId && a.accountId === b.accountId && a.generation === b.generation;


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
      browser?.owner.reportEvent({ stage: request.data.reason === "request-refused" ? "refused" : request.data.reason, requestId: request.data.requestId });
      throw new ProfileOnboardingDuoProviderError("unknown", request.data.reason);
    }
    if (request.kind === "scope-lost" || request.kind === "native-failed") throw new ProfileOnboardingDuoProviderError("unknown", request.kind === "scope-lost" ? "scope" : "request-refused");
    if (request.kind === "bind") throw new ProfileOnboardingDuoProviderError("refused", "scope");
    const capability = session.capability;
    if (!capability) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    if (request.kind === "persist") {
      if (session.attempt.method !== "key" || session.credentialId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
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
    await scoped(session, () => capability.recordPortalAcceptance({ credentialId, requestId: enrollmentRequestId,
      acceptance: request.kind === "portal-accepted" ? "portal-accepted" : "exact-credential-request" }));
    current(session); session.accepted = true;
    return { observed: true };
  }

  async function platformForPage(session: OwnedBrowser, page: Page, available: boolean): Promise<OnboardingPlatformAuthenticator> {
    browserCurrent(session);
    const context = session.context;
    if (!context) throw new ProfileOnboardingDuoProviderError("unavailable", "provider");
    let platform = session.platforms.get(page);
    if (!platform) {
      platform = prepareOnboardingPlatformAuthenticator(context, page, options.platform, available);
      session.platforms.set(page, platform);
    }
    const result = await platform;
    browserCurrent(session);
    session.owner.reportEvent({ stage: result.mechanism === "native-platform" ? "platform-native" : "platform-virtual" });
    return result;
  }

  function reportFailure(session: ProviderSession, error: unknown): Promise<void> {
    if (session.reporting) return session.reporting;
    session.revoked = true;
    clearTimeout(session.expiry);
    const failure = error instanceof ProfileOnboardingDuoProviderError
      ? session.capability && error.kind !== "unknown" ? new ProfileOnboardingDuoProviderError("unknown", error.reason, error) : error
      : new ProfileOnboardingDuoProviderError("unknown", "provider", error);
    session.failure = failure;
    session.reporting = (async () => {
      try {
        if (session.capability) await session.capability.retainUnknown({ kind: failure.kind, causeTag: failure.reason });
        await session.reportFailure(failure);
      } catch (retentionError) {
        session.retentionFailed = true;
        session.failure = new ProfileOnboardingDuoProviderError("unknown", "provider", new AggregateError([error, retentionError]));
      }
    })();
    return session.reporting;
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
          if (session.capability && session.credentialId && !session.accepted) await session.capability.retainUnknown({ kind: "unknown", causeTag: "browser-lifetime" });
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
        session.failure = new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime", stopFailure === undefined || stopFailure === error
          ? error : new AggregateError([stopFailure, error], "onboarding attempt closure unproved"));
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
      try {
        await Promise.race([(async () => {
          const attempt = active;
          if (attempt) {
            if (!sameOwner(session.owner, attempt.attempt) || attempt.profileDirectory !== session.profileDirectory
              || attempt.context !== session.context || attempt.worker !== session.worker) throw new ProfileOnboardingDuoProviderError("unknown", "scope");
            if ((await close(attempt)).state !== "closed") {
              if (attempt.stopFailureAfterSettlement === undefined) throw attempt.failure ?? new ProfileOnboardingDuoProviderError("unknown", "provider");
              workerStopFailure = attempt.stopFailureAfterSettlement;
            }
          }
          await session.launching;
          session.launch.closing();
          if (session.launchStarted) {
            if (!session.context) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
            if (session.worker && !session.contextClosed) {
              try { await workerCall(session.worker, "browserStop"); }
              catch (error) { workerStopFailure = workerStopFailure === undefined ? error : new AggregateError([workerStopFailure, error]); }
            }
            const pages = [...new Set([...session.context.pages(), ...(session.setup ? [session.setup] : []), ...(session.portal ? [session.portal] : [])])];
            for (const page of pages) if (!page.isClosed()) await page.close({ runBeforeUnload: false });
            await session.context.close();
            if (!session.contextClosed || session.context.pages().length || pages.some(page => !page.isClosed())) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
          }
          await Promise.allSettled([session.startup, session.setupOpening, session.portalOpening]);
          await session.pump;
          if (expired) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
          if (browser !== session || active !== undefined && active !== attempt) throw new ProfileOnboardingDuoProviderError("unknown", "scope");
          session.launch.closed();
          await options.browserRoots.withUnused(session.profileDirectory, probeOptions, async ({ remove }) => { remove(); }, session.rootInput);
          if (active === attempt) active = undefined;
          if (browser === session) browser = undefined;
        })(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { expired = true; reject(new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime")); }, options.closeProofMs * 2); })]);
        return { state: "closed" as const };
      } catch (error) {
        let closureFailure = error;
        try { session.launch.uncertain(error); } catch (failure) { closureFailure = failure; }
        session.closureFailure = workerStopFailure === undefined ? closureFailure : new AggregateError([workerStopFailure, closureFailure], "onboarding browser closure unproved"); return { state: "uncertain" as const }; }
      finally { clearTimeout(timer); }
    })();
    return session.close;
  }
  async function openPortal(session: OwnedBrowser): Promise<void> {
    browserCurrent(session);
    const context = session.context;
    if (!context) throw new ProfileOnboardingDuoProviderError("unavailable", "provider");
    if (!session.portalOpening) session.portalOpening = (async () => {
      const page = await context.newPage();
      session.portal = page; browserCurrent(session);
      try {
        await page.goto("https://duo.ucsd.edu", { waitUntil: "domcontentloaded" });
        browserCurrent(session);
        await submitPinnedUcsdSsoCredentials(page, () => session.owner.acquireCredentials(), () => browserCurrent(session), options.closeProofMs, "/tritON/profile/SAML2/Redirect/SSO");
        browserCurrent(session);
      } catch { throw new ProfileOnboardingDuoProviderError("refused", "scope"); }
    })();
    await session.portalOpening; browserCurrent(session);
    const page = session.portal;
    if (!page || page.isClosed()) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    const url = new URL(page.url());
    if (url.protocol !== "https:" || url.port || url.username || url.password
      || !(url.hostname === "a5.ucsd.edu" && url.pathname.startsWith("/tritON/")
        || url.hostname === "duo.ucsd.edu"
        || url.hostname === "duosecurity.com" || url.hostname.endsWith(".duosecurity.com"))) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    await focusPage(session, page);
    if (page.url() !== url.href) throw new ProfileOnboardingDuoProviderError("refused", "scope");
  }
  async function focusPage(session: OwnedBrowser, page: Page): Promise<void> {
    browserCurrent(session);
    await page.bringToFront(); browserCurrent(session);
    if (!session.worker) throw new ProfileOnboardingDuoProviderError("unavailable", "worker");
    await workerCall(session.worker, "browserFocus"); browserCurrent(session);
  }
  async function showBrowser(owner: DraftDuoBrowserOwner): Promise<void> {
    owner.assertCurrent();
    if (browser) {
      if (!sameOwner(browser.owner, owner)) throw new ProfileOnboardingDuoProviderError("refused", "busy");
      const previous = browser;
      if (previous.revoked || previous.contextClosed) {
        if ((await closeBrowser(previous)).state !== "closed") throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime", previous.closureFailure);
        owner.assertCurrent(); return showBrowser(owner);
      }
      browserCurrent(previous); await previous.startup; browserCurrent(previous);
      if (!previous.worker || !previous.context) throw new ProfileOnboardingDuoProviderError("unavailable", "provider");
      const setupUrl = new URL("options.html", previous.worker.url()).href;
      if (previous.setupOpening || !previous.setup || previous.setup.isClosed()) {
        const context = previous.context;
        previous.setupOpening ??= (async () => {
          const existing = context.pages().find(page => !page.isClosed() && page.url() === setupUrl);
          const page = existing ?? await context.newPage(); browserCurrent(previous);
          if (!existing) { await page.goto(setupUrl, { waitUntil: "domcontentloaded" }); browserCurrent(previous); }
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
      const root = lstatSync(options.browserRoot);
      if (!root.isDirectory() || root.isSymbolicLink() || privatePathRejects(options.browserRoot, root, "private")) throw new Error("root");
    } catch { throw new ProfileOnboardingDuoProviderError("unavailable", "browser-root"); }
    const ownerIdentity={operationId:owner.operationId,profileId:owner.profileId,accountId:owner.accountId,generation:owner.generation};
    const assertOwner=()=>{owner.assertCurrent();if(!sameOwner(owner,ownerIdentity))throw new ProfileOnboardingDuoProviderError("refused","scope");};
    const profileDirectory=onboardingProfileDirectory(options.browserRoot,ownerIdentity);
    if(readdirSync(options.browserRoot).some(name=>name!==basename(profileDirectory))) {
      throw new ProfileOnboardingDuoProviderError("unknown","browser-root");
    }
    const rootInput: BrowserRootLaunchInput = { profileId: owner.profileId, profileRoot: options.browserRoot, profileDirectory,
      credentialFingerprint: null, owner: { kind: "signup", operationId: owner.operationId, accountId: owner.accountId, providerGeneration: owner.generation } };
    if (lstatSync(profileDirectory, { throwIfNoEntry: false }) !== undefined) {
      await options.browserRoots.withUnused(profileDirectory, probeOptions, async ({ remove }) => { assertOwner(); remove(); }, rootInput);
      assertOwner();
    }
    assertOwner();
    const launch = options.browserRoots.beginLaunch(rootInput);
    const session: OwnedBrowser = { owner, profileDirectory, launch, rootInput, revoked: false, contextClosed: false, launchStarted: false, platforms: new Map() };
    browser = session;
    session.startup = (async () => {
      mkdirSync(session.profileDirectory, { mode: 0o700 });
      mkdirSync(join(session.profileDirectory, "Default"), { mode: 0o700 });
      writeFileSync(join(session.profileDirectory, "Default", "Preferences"), JSON.stringify({ credentials_enable_service: false, profile: { password_manager_enabled: false } }), { mode: 0o600, flag: "wx" });
      const extensionDirectory = join(session.profileDirectory, "relay-extension");
      try { stageFastDuoExtension(options.extensionDirectory, extensionDirectory, PROFILE_ENROLLMENT_EXTENSION_MODE); }
      catch (error) { throw new ProfileOnboardingDuoProviderError("unavailable", "browser-root", error); }
      session.launchStarted = true;
      session.launching = browserLauncher.launch({ profileDirectory: session.profileDirectory, headless: false,
        extensionDirectory, acceptDownloads: false, downloadsPath: session.profileDirectory, viewport: { width: 1100, height: 800 }, disablePasswordManager: true, defaultContextOptions: true, ...(nativePlatform ? { nativePlatform: { closeProofMs: options.closeProofMs } } : {}) }).then(context => {
        session.context = context;
        context.on("close", () => {
          session.contextClosed = true;
          // Context closure precedes native profile release; the next owner operation proves cleanup.
          if (!session.close) {
            session.revoked = true;
            if (active) {
              if (active.accepted || active.attempt.method === "key" && active.requestId) active.revoked = true;
              else void reportFailure(active, new ProfileOnboardingDuoProviderError(active.capability ? "unknown" : "unavailable", "browser-lifetime"));
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
      await workerCall(worker, "browserInstall"); browserCurrent(session);
      session.pump = (async () => {
        while (!session.revoked) {
          const raw = await workerCall(worker, "browserNext");
          if (raw === null && session.revoked) return;
          const request = z.discriminatedUnion("kind", [
            z.strictObject({ id: z.uuid(), kind: z.enum(["state", "portal", "start", "cancel", "confirm"]), method: z.enum(["key", "touch"]).optional(), attemptId: z.uuid().optional() }),
            z.strictObject({ id: z.uuid(), kind: z.literal("event"), event: ProfileOnboardingDuoEventSchema }),
            z.strictObject({ id: z.uuid(), kind: z.literal("platform"), url: z.url(), available: z.boolean() }),
          ]).parse(raw);
          try {
            browserCurrent(session);
            if (request.kind === "event") {
              if (request.event.stage === "intercepted" && active) {
                if (active.enrollmentRequestId && active.enrollmentRequestId !== request.event.requestId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
                active.enrollmentRequestId = request.event.requestId;
              }
              owner.reportEvent(request.event);
              await workerCall(worker, "browserReply", [request.id, { ok: true, value: { observed: true } }]);
              continue;
            }
            if (request.kind === "platform") {
              const url = new URL(request.url);
              if (url.protocol !== "https:" || url.port || url.username || url.password || !(url.hostname === "duosecurity.com" || url.hostname.endsWith(".duosecurity.com"))) throw new ProfileOnboardingDuoProviderError("refused", "scope");
              const pages = context.pages().filter(page => !page.isClosed() && page.url() === request.url);
              if (pages.length !== 1 || !pages[0]) throw new ProfileOnboardingDuoProviderError("refused", "scope");
              await platformForPage(session, pages[0], request.available);
              browserCurrent(session);
              await workerCall(worker, "browserReply", [request.id, { ok: true, value: true }]);
              continue;
            }
            if (request.kind === "portal") await openPortal(session);
            else if (request.kind === "start") { if (!request.method || request.attemptId) throw new Error("scope"); await owner.start(request.method); }
            else if (request.kind === "cancel" || request.kind === "confirm") {
              if (!request.method || !request.attemptId) throw new Error("scope");
              if (request.kind === "cancel") await owner.cancel(request.method, request.attemptId);
              else owner.confirm(request.method, request.attemptId);
            }
            browserCurrent(session);
            await workerCall(worker, "browserReply", [request.id, { ok: true, value: owner.readState() }]);
          } catch {
            owner.reportEvent({ stage: "refused", detail: "backend" });
            await workerCall(worker, "browserReply", [request.id, { ok: false }]);
          }
        }
      })().catch(async error => {
        if (!session.revoked) {
          if (active) { await reportFailure(active, error instanceof ProfileOnboardingDuoProviderError ? error : new ProfileOnboardingDuoProviderError("unknown", "worker", error)); await close(active); }
          else owner.reportEvent({ stage: "refused", detail: "backend" });
          session.revoked = true;
        }
      });
      session.setup = context.pages()[0] ?? await context.newPage();
      browserCurrent(session);
      await session.setup.goto(new URL("options.html", worker.url()).href, { waitUntil: "domcontentloaded" });
      browserCurrent(session);
    })();
    try {
      await session.startup;
      if (!session.setup) throw new ProfileOnboardingDuoProviderError("unavailable", "provider");
      await focusPage(session, session.setup);
    }
    catch (error) { await closeBrowser(session); throw error; }
  }

  return Object.freeze({
    showBrowser,
    async openPortal(owner: DraftDuoBrowserOwner) { await showBrowser(owner); if (!browser) throw new ProfileOnboardingDuoProviderError("unavailable", "provider"); await openPortal(browser); },
    async closeBrowser(owner: DraftDuoBrowserOwner) {
      if (!browser) return { state: "closed" as const };
      if (!sameOwner(browser.owner, owner)) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      return closeBrowser(browser);
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
        reportFailure: onFailure, accepted: false, revoked: false, contextClosed: false, launchStarted: true };
      active = session;
      session.startup = (async () => {
        if (!session.worker) throw new ProfileOnboardingDuoProviderError("unavailable", "worker");
        await workerCall(session.worker, "install", [{ method: attempt.method, nowMs: options.clock.nowMs() }]);
        const worker = session.worker;
        session.pump = (async () => {
          while (!session.revoked) {
            const raw = await workerCall(worker, "next");
            if (raw === null && session.revoked) return;
            const request = BrokerRequestSchema.parse(raw);
            try {
              if (request.kind === "bind") browser?.owner.reportEvent({ stage: "backend-received", ...(session.enrollmentRequestId ? { requestId: session.enrollmentRequestId } : {}) });
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
                  session.platform = await platformForPage(browser, pages[0], z.boolean().parse(await workerCall(session.worker, "platformAvailable")));
                  await observedCurrent(session);
                }
                const capability = await bindObservedContext({ contextId: request.data.documentId, tabId: request.data.tabId, accountName: request.data.username,
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
              await reportFailure(session, error);
              try { await workerCall(worker, "reply", [request.id, { ok: false }]); }
              finally { queueMicrotask(() => { void close(session); }); }
              return;
            }
          }
        })().catch(async error => {
          if (session.revoked) return;
          await reportFailure(session, error);
          queueMicrotask(() => { void close(session); });
        });
        session.expiry = setTimeout(() => {
          void reportFailure(session, new ProfileOnboardingDuoProviderError(session.capability || session.enrollmentRequestId ? "unknown" : "refused", "timed-out")).then(() => close(session));
        }, Math.max(1, Date.parse(attempt.expiresAt) - options.clock.nowMs()));

      })();
      try { await session.startup; }
      catch (error) {
        await reportFailure(session, error instanceof ProfileOnboardingDuoProviderError ? error
          : new ProfileOnboardingDuoProviderError(session.launchStarted ? "unknown" : "unavailable", "worker", error));
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
