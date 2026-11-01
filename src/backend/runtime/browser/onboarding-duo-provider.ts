import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, lstatSync, mkdirSync, realpathSync, readdirSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { submitOnboardingSsoCredentials } from "../../systems/browser-shared/ucsd-sso.js";
import type { BrowserContext, Page, Worker } from "playwright";
import { z } from "zod";
import { BrowserDocumentIdSchema } from "../../../models/config/duo-credential-store.js";
import type { Clock } from "../../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../../rules/validation/canonical-json.js";
import { deleteOwnedBrowserProfile } from "./browser-session-factory.js";
import { DEFAULT_BROWSER_LAUNCHER, onboardingProfileDirectory, probeClosedBrowserProfile, type PersistentContextLauncher } from "./native-profile-probe.js";
import { createTimeoutDeadlineScheduler } from "../scheduling/timeout-deadline-scheduler.js";
import type { DraftDuoAttempt, DraftDuoBrowserOwner, DraftDuoCapability, DraftDuoObservedContext, ProfileOnboardingDuoProvider } from "../../profiles/onboarding-duo.js";

export class ProfileOnboardingDuoProviderError extends Error {
  constructor(readonly kind: "unavailable" | "refused" | "unknown",
    readonly reason: "scope" | "revoked" | "busy" | "browser-root" | "browser-lifetime" | "counter" | "worker" | "provider",
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
  z.strictObject({ id: z.uuid(), kind: z.literal("bind"), data: z.strictObject({
    documentId: BrowserDocumentIdSchema, tabId: z.number().int().nonnegative(), origin: z.url(), rpId: z.literal("duosecurity.com"), username: z.string().min(1).max(128),
  }) }),
  z.strictObject({ id: z.uuid(), kind: z.literal("persist"), data: PendingSchema }),
  z.strictObject({ id: z.uuid(), kind: z.literal("reserve"), data: ReceiptSchema }),
  z.strictObject({ id: z.uuid(), kind: z.enum(["native-failed", "scope-lost"]), data: z.strictObject({ requestId: z.uuid() }) }),
  ...(["software-created", "native-created", "portal-accepted", "exact-request"] as const).map(kind =>
    z.strictObject({ id: z.uuid(), kind: z.literal(kind), data: ReceiptSchema })),
]);
type BrokerRequest = z.infer<typeof BrokerRequestSchema>;

export interface OnboardingDuoProviderOptions {
  readonly browserRoot: string;
  readonly extensionDirectory: string;
  readonly clock: Clock;
  readonly closeProofMs: number;
  readonly launcher?: PersistentContextLauncher;
}


async function workerCall(worker: Worker, method: "install" | "next" | "reply" | "stop" | "assertContext" | "browserInstall" | "browserNext" | "browserReply" | "browserStop", args: readonly unknown[] = []): Promise<unknown> {
  return worker.evaluate(async input => {
    const owner: unknown = Reflect.get(globalThis, "relayOnboarding");
    if (typeof owner !== "object" || owner === null) throw new Error("ONBOARDING_DUO_WORKER_UNAVAILABLE");
    const operation: unknown = Reflect.get(owner, input.method);
    if (typeof operation !== "function") throw new Error("ONBOARDING_DUO_WORKER_UNAVAILABLE");
    const result: unknown = await Reflect.apply(operation, owner, input.args);
    return result;
  }, { method, args });
}

const RELAY_EXTENSION_FILES = ["relay-manifest.json", "LICENSE", "THIRD_PARTY_NOTICES.md", "src/relay-background.js", "src/relay-content.js", "src/relay-inpage.js", "src/relay-native.js",
  "src/service.js", "src/crypto.js", "src/accounts.js", "src/sign-count.js", "src/username.js",
  "src/options.html", "src/options.js", "src/popup.html", "src/popup.js", "src/relay-options.js", "src/styles.css", "src/icons/autopilot.svg", "src/icons/key-round.svg", "src/icons/plus.svg", "src/icons/shield-check.svg"] as const;

function stageRelayExtension(sourceRoot: string, destination: string): void {
  if (realpathSync(sourceRoot) !== sourceRoot) throw new ProfileOnboardingDuoProviderError("unavailable", "browser-root");
  mkdirSync(join(destination, "src", "icons"), { recursive: true, mode: 0o700 });
  for (const name of RELAY_EXTENSION_FILES) {
    const path = join(sourceRoot, name);
    if (realpathSync(path) !== path) throw new ProfileOnboardingDuoProviderError("unavailable", "browser-root");
    const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = fstatSync(descriptor);
      if (!before.isFile() || before.nlink !== 1 || before.uid !== process.getuid?.() || (before.mode & 0o022) !== 0) throw new ProfileOnboardingDuoProviderError("unavailable", "browser-root");
      const bytes = readFileSync(descriptor);
      const after = fstatSync(descriptor);
      const observed = lstatSync(path);
      const check = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const checked = fstatSync(check);
        const hash = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");
        if (before.ino !== after.ino || before.dev !== after.dev || before.size !== after.size || before.mtimeMs !== after.mtimeMs
          || observed.ino !== after.ino || observed.dev !== after.dev || observed.isSymbolicLink() || observed.nlink !== 1
          || checked.ino !== after.ino || checked.dev !== after.dev || checked.nlink !== 1 || !checked.isFile()
          || hash(bytes) !== hash(readFileSync(check))) throw new ProfileOnboardingDuoProviderError("unavailable", "browser-root");
      } finally { closeSync(check); }
      writeFileSync(join(destination, name === "relay-manifest.json" ? "manifest.json" : name), bytes, { flag: "wx", mode: 0o600 });
    } finally { closeSync(descriptor); }
  }
}

export function createProfileOnboardingDuoProvider(options: OnboardingDuoProviderOptions): ProfileOnboardingDuoProvider {
  const browserLauncher = options.launcher ?? DEFAULT_BROWSER_LAUNCHER;
  type ProviderSession = {
    attempt: DraftDuoAttempt; profileDirectory: string; context?: BrowserContext; launching?: Promise<BrowserContext>; worker?: Worker;
    capability?: DraftDuoCapability; credentialId?: string; requestId?: string; accepted: boolean; revoked: boolean;
    contextClosed: boolean; launchStarted: boolean; startup?: Promise<void>; pump?: Promise<void>;
    reportFailure: (error: Error) => Promise<void>; reporting?: Promise<void>; failure?: ProfileOnboardingDuoProviderError; retentionFailed?: boolean; stopFailureAfterSettlement?: ProfileOnboardingDuoProviderError; expiry?: ReturnType<typeof setTimeout>; close?: Promise<Readonly<{ state: "closed" | "uncertain" }>>;
  };

  type OwnedBrowser = {
    owner: DraftDuoBrowserOwner; profileDirectory: string; context?: BrowserContext; worker?: Worker;
    launching?: Promise<BrowserContext>; startup?: Promise<void>; pump?: Promise<void>; setup?: Page; setupOpening?: Promise<Page>; portal?: Page; portalOpening?: Promise<void>;
    revoked: boolean; contextClosed: boolean; launchStarted: boolean; closureFailure?: unknown; close?: Promise<Readonly<{ state: "closed" | "uncertain" }>>;
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
    if (request.kind === "reserve") {
      if (session.attempt.method !== "key" || request.data.credentialId !== session.credentialId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      const provisioned = await scoped(session, () => capability.provision(request.data.credentialId));
      current(session);
      if (provisioned.credentialId !== session.credentialId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      const reservation = await scoped(session, () => capability.reserveSignCount({ credentialId: request.data.credentialId, attemptId: request.data.requestId }));
      current(session);
      if (!Number.isSafeInteger(reservation.count) || reservation.count <= provisioned.highWater || reservation.count >= 0xffffffff) throw new ProfileOnboardingDuoProviderError("unknown", "counter");
      return reservation;
    }
    if (!("credentialId" in request.data)) throw new ProfileOnboardingDuoProviderError("unknown", "provider");
    const { credentialId, requestId } = request.data;
    if (request.kind === "software-created" || request.kind === "native-created") {
      const native = request.kind === "native-created";
      if (native !== (session.attempt.method === "touch") || session.requestId || !native && credentialId !== session.credentialId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      await scoped(session, () => capability.recordCeremony({ credentialId, requestId, mechanism: native ? "native-platform" : "fast-duo", softwareInterceptionDisabled: native }));
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

  function reportFailure(session: ProviderSession, error: unknown): Promise<void> {
    if (session.reporting) return session.reporting;
    session.revoked = true;
    clearTimeout(session.expiry);
    const failure = error instanceof ProfileOnboardingDuoProviderError && !session.capability
      ? error : new ProfileOnboardingDuoProviderError("unknown", "provider", error);
    session.failure = failure;
    session.reporting = (async () => {
      try {
        if (session.capability) await session.capability.retainUnknown();
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
          await session.startup;
          clearTimeout(session.expiry);
          if (expired) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
          await session.reporting;
          if (session.retentionFailed) throw session.failure ?? new ProfileOnboardingDuoProviderError("unknown", "provider");
          if (session.capability && session.credentialId && !session.accepted) await session.capability.retainUnknown();
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
          deleteOwnedBrowserProfile(options.browserRoot, session.profileDirectory);
          if (active === attempt) active = undefined;
          if (browser === session) browser = undefined;
        })(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { expired = true; reject(new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime")); }, options.closeProofMs * 2); })]);
        return { state: "closed" as const };
      } catch (error) { session.closureFailure = workerStopFailure === undefined ? error : new AggregateError([workerStopFailure, error], "onboarding browser closure unproved"); return { state: "uncertain" as const }; }
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
        await submitOnboardingSsoCredentials(page, () => session.owner.acquireCredentials(), () => browserCurrent(session), options.closeProofMs);
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
    await page.bringToFront(); browserCurrent(session);
    if (page.url() !== url.href) throw new ProfileOnboardingDuoProviderError("refused", "scope");
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
      await previous.setup.bringToFront(); browserCurrent(previous);
      if (previous.setup.url() !== setupUrl) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      return;
    }
    if (!Number.isFinite(options.closeProofMs) || options.closeProofMs <= 0) throw new ProfileOnboardingDuoProviderError("refused", "revoked");
    try {
      if (!isAbsolute(options.browserRoot) || realpathSync(options.browserRoot) !== options.browserRoot || !isAbsolute(options.extensionDirectory)) throw new Error("root");
      const root = lstatSync(options.browserRoot);
      if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== process.getuid?.() || (root.mode & 0o077) !== 0) throw new Error("root");
    } catch { throw new ProfileOnboardingDuoProviderError("unavailable", "browser-root"); }
    const ownerIdentity={operationId:owner.operationId,profileId:owner.profileId,accountId:owner.accountId,generation:owner.generation};
    const assertOwner=()=>{owner.assertCurrent();if(!sameOwner(owner,ownerIdentity))throw new ProfileOnboardingDuoProviderError("refused","scope");};
    const profileDirectory=onboardingProfileDirectory(options.browserRoot,ownerIdentity);
    if(readdirSync(options.browserRoot).some(name=>name!==basename(profileDirectory))) {
      throw new ProfileOnboardingDuoProviderError("unknown","browser-root");
    }
    if(lstatSync(profileDirectory,{throwIfNoEntry:false})!==undefined){
      await probeClosedBrowserProfile({profileRoot:options.browserRoot,launcher:browserLauncher,
        launch:{profileDirectory,extensionDirectory:"",downloadsPath:profileDirectory,viewport:{width:1100,height:800},timeoutMs:options.closeProofMs},
        clock:options.clock,scheduler:createTimeoutDeadlineScheduler(options.clock),closeProofMs:options.closeProofMs,signal:new AbortController().signal});
      assertOwner();
      deleteOwnedBrowserProfile(options.browserRoot,profileDirectory);
    }
    assertOwner();
    mkdirSync(profileDirectory,{mode:0o700});
    const session: OwnedBrowser = { owner, profileDirectory, revoked: false, contextClosed: false, launchStarted: false };
    browser = session;
    session.startup = (async () => {
      mkdirSync(join(session.profileDirectory, "Default"), { mode: 0o700 });
      writeFileSync(join(session.profileDirectory, "Default", "Preferences"), JSON.stringify({ credentials_enable_service: false, profile: { password_manager_enabled: false } }), { mode: 0o600, flag: "wx" });
      const extensionDirectory = join(session.profileDirectory, "relay-extension");
      stageRelayExtension(options.extensionDirectory, extensionDirectory);
      session.launchStarted = true;
      session.launching = browserLauncher.launch({ profileDirectory: session.profileDirectory, headless: false,
        extensionDirectory, acceptDownloads: false, downloadsPath: session.profileDirectory, viewport: { width: 1100, height: 800 }, disablePasswordManager: true, defaultContextOptions: true }).then(context => {
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
          const request = z.strictObject({ id: z.uuid(), kind: z.enum(["state", "portal", "start", "cancel", "confirm"]),
            method: z.enum(["key", "touch"]).optional(), attemptId: z.uuid().optional() }).parse(raw);
          try {
            browserCurrent(session);
            if (request.kind === "portal") await openPortal(session);
            else if (request.kind === "start") { if (!request.method || request.attemptId) throw new Error("scope"); await owner.start(request.method); }
            else if (request.kind === "cancel" || request.kind === "confirm") {
              if (!request.method || !request.attemptId) throw new Error("scope");
              if (request.kind === "cancel") await owner.cancel(request.method, request.attemptId);
              else owner.confirm(request.method, request.attemptId);
            }
            browserCurrent(session);
            await workerCall(worker, "browserReply", [request.id, { ok: true, value: owner.readState() }]);
          } catch { await workerCall(worker, "browserReply", [request.id, { ok: false }]); }
        }
      })().catch(() => {
        if (!session.revoked) {
          session.revoked = true;
          if (active) void close(active);
        }
      });
      session.setup = context.pages()[0] ?? await context.newPage();
      browserCurrent(session);
      await session.setup.goto(new URL("options.html", worker.url()).href, { waitUntil: "domcontentloaded" });
      browserCurrent(session);
    })();
    try { await session.startup; }
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
              let result: unknown;
              if (request.kind === "bind") {
                current(session);
                if (session.capability) throw new ProfileOnboardingDuoProviderError("refused", "scope");
                const url = new URL(request.data.origin);
                if (url.protocol !== "https:" || url.port || url.username || url.password || url.origin !== request.data.origin || !(url.hostname === "duosecurity.com" || url.hostname.endsWith(".duosecurity.com"))) throw new ProfileOnboardingDuoProviderError("refused", "scope");
                await observedCurrent(session);
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
          void reportFailure(session, new ProfileOnboardingDuoProviderError(session.capability ? "unknown" : "refused", "revoked")).then(() => close(session));
        }, Math.max(1, Date.parse(attempt.expiresAt) - options.clock.nowMs()));

      })();
      try { await session.startup; }
      catch (error) {
        await reportFailure(session, error instanceof ProfileOnboardingDuoProviderError ? error
          : new ProfileOnboardingDuoProviderError(session.launchStarted ? "unknown" : "unavailable", "provider", error));
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
