import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readFileSync, lstatSync, mkdirSync, mkdtempSync, readlinkSync, realpathSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { isAbsolute, join } from "node:path";
import { chromium } from "playwright";
import type { BrowserContext, Worker } from "playwright";
import { z } from "zod";
import type { Clock } from "../../rules/time/clock.js";
import { canonicalJsonStringify } from "../../rules/validation/canonical-json.js";
import { deleteOwnedBrowserProfile } from "../runtime/browser/browser-session-factory.js";
import { observeProcessIdentity } from "../storage/sqlite/runtime-process-locks.js";
import type { PersistentContextLauncher } from "../runtime/browser/browser-session-factory.js";
import type { DraftDuoAttempt, DraftDuoCapability, DraftDuoObservedContext, ProfileOnboardingDuoProvider } from "./onboarding-duo.js";

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
    tabId: z.number().int().nonnegative(), origin: z.url(), rpId: z.literal("duosecurity.com"), username: z.string().min(1).max(128),
  }) }),
  z.strictObject({ id: z.uuid(), kind: z.literal("persist"), data: PendingSchema }),
  z.strictObject({ id: z.uuid(), kind: z.literal("reserve"), data: ReceiptSchema }),
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

const launcher: PersistentContextLauncher = {
  async launch(input) {
    return chromium.launchPersistentContext(input.profileDirectory, {
      channel: "chromium", headless: false, acceptDownloads: false,
      args: [`--disable-extensions-except=${input.extensionDirectory}`, `--load-extension=${input.extensionDirectory}`,
        "--disable-features=PasswordManagerOnboarding,PasswordImport,PasswordManagerEnabled"],
    });
  },
};

async function workerCall(worker: Worker, method: "install" | "next" | "reply" | "stop", args: readonly unknown[] = []): Promise<unknown> {
  return worker.evaluate(async input => {
    const owner: unknown = Reflect.get(globalThis, "relayOnboarding");
    if (typeof owner !== "object" || owner === null) throw new Error("ONBOARDING_DUO_WORKER_UNAVAILABLE");
    const operation: unknown = Reflect.get(owner, input.method);
    if (typeof operation !== "function") throw new Error("ONBOARDING_DUO_WORKER_UNAVAILABLE");
    const result: unknown = await Reflect.apply(operation, owner, input.args);
    return result;
  }, { method, args });
}

function observeOwnedProcess(profileDirectory: string, pid?: number) {
  if (pid !== undefined) return { pid, observation: observeProcessIdentity(pid) };
  const lock = readlinkSync(join(profileDirectory, "SingletonLock"));
  const prefix = `${hostname()}-`;
  if (!lock.startsWith(prefix)) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
  const observedPid = z.number().int().positive().parse(Number(lock.slice(prefix.length)));
  return { pid: observedPid, observation: observeProcessIdentity(observedPid) };
}

const RELAY_EXTENSION_FILES = ["relay-manifest.json", "src/relay-background.js", "src/relay-content.js", "src/relay-inpage.js",
  "src/service.js", "src/crypto.js", "src/accounts.js", "src/sign-count.js", "src/username.js"] as const;

function stageRelayExtension(sourceRoot: string, destination: string): void {
  if (realpathSync(sourceRoot) !== sourceRoot) throw new ProfileOnboardingDuoProviderError("unavailable", "browser-root");
  mkdirSync(join(destination, "src"), { recursive: true, mode: 0o700 });
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
  const browserLauncher = options.launcher ?? launcher;
  const observe = browserLauncher.observeProcess ?? observeOwnedProcess;
  let active: {
    attempt: DraftDuoAttempt; profileDirectory: string; contextId: string; context?: BrowserContext; launching?: Promise<BrowserContext>; worker?: Worker;
    capability?: DraftDuoCapability; credentialId?: string; requestId?: string; accepted: boolean; revoked: boolean;
    contextClosed: boolean; launchStarted: boolean; process?: ReturnType<typeof observe>; startup?: Promise<void>; pump?: Promise<void>;
    reportFailure: (error: Error) => Promise<void>; reporting?: Promise<void>; failure?: ProfileOnboardingDuoProviderError; retentionFailed?: boolean; expiry?: ReturnType<typeof setTimeout>; close?: Promise<Readonly<{ state: "closed" | "uncertain" }>>;
  };

  function current(session: NonNullable<typeof active>): void {
    if (active !== session || session.revoked || options.clock.nowMs() >= Date.parse(session.attempt.expiresAt)) throw new ProfileOnboardingDuoProviderError("refused", "revoked");
    session.capability?.assertCurrent();
  }

  async function dispatch(session: NonNullable<typeof active>, request: BrokerRequest): Promise<unknown> {
    current(session);
    if (request.kind === "bind") throw new ProfileOnboardingDuoProviderError("refused", "scope");
    const capability = session.capability;
    if (!capability) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    if (request.kind === "persist") {
      if (session.attempt.method !== "key" || session.credentialId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      const result = await capability.persistPending(request.data);
      current(session);
      session.credentialId = request.data.credentialId;
      return result;
    }
    if (request.kind === "reserve") {
      if (session.attempt.method !== "key" || request.data.credentialId !== session.credentialId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      const provisioned = await capability.provision(request.data.credentialId);
      current(session);
      if (provisioned.credentialId !== session.credentialId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      const reservation = await capability.reserveSignCount({ credentialId: request.data.credentialId, attemptId: request.data.requestId });
      current(session);
      if (!Number.isSafeInteger(reservation.count) || reservation.count <= provisioned.highWater || reservation.count >= 0xffffffff) throw new ProfileOnboardingDuoProviderError("unknown", "counter");
      return reservation;
    }
    const { credentialId, requestId } = request.data;
    if (request.kind === "software-created" || request.kind === "native-created") {
      const native = request.kind === "native-created";
      if (native !== (session.attempt.method === "touch") || session.requestId || !native && credentialId !== session.credentialId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
      await capability.recordCeremony({ credentialId, requestId, mechanism: native ? "native-platform" : "fast-duo", softwareInterceptionDisabled: native });
      current(session);
      session.credentialId = credentialId; session.requestId = requestId;
      return { observed: true };
    }
    if (credentialId !== session.credentialId || !session.requestId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
    if (request.kind === "portal-accepted" && requestId !== session.requestId || request.kind === "exact-request" && session.attempt.method !== "key") throw new ProfileOnboardingDuoProviderError("refused", "scope");
    await capability.recordPortalAcceptance({ credentialId, requestId: session.requestId,
      acceptance: request.kind === "portal-accepted" ? "portal-accepted" : "exact-credential-request" });
    current(session); session.accepted = true;
    return { observed: true };
  }

  function reportFailure(session: NonNullable<typeof active>, error: unknown): Promise<void> {
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

  async function close(session: NonNullable<typeof active>): Promise<Readonly<{ state: "closed" | "uncertain" }>> {
    if (session.close) return session.close;
    session.revoked = true;
    clearTimeout(session.expiry);
    session.close = (async (): Promise<Readonly<{ state: "closed" | "uncertain" }>> => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let expired = false;
      try {
        await Promise.race([(async () => {
          await session.reporting;
          if (session.retentionFailed) throw new ProfileOnboardingDuoProviderError("unknown", "provider");
          if (!session.launchStarted) {
            deleteOwnedBrowserProfile(options.browserRoot, session.profileDirectory);
            return;
          }
          await session.launching;
          if (session.capability && session.credentialId && !session.accepted) await session.capability.retainUnknown();
          if (!session.context || !session.process) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
          if (session.worker && !session.contextClosed) await workerCall(session.worker, "stop");
          const pages = session.context.pages();
          for (const page of pages) await page.close({ runBeforeUnload: false });
          await session.context.close();
          if (!session.contextClosed || session.context.pages().length !== 0 || pages.some(page => !page.isClosed())) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
          const deadline = options.clock.monotonicMs() + options.closeProofMs;
          for (;;) {
            if (expired) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
            const process = observe(session.profileDirectory, session.process.pid);
            if (process.pid !== session.process.pid) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
            if (process.observation.state === "gone") break;
            if (session.process.observation.state !== "alive" || canonicalJsonStringify(process.observation.identity) !== canonicalJsonStringify(session.process.observation.identity)) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
            if (options.clock.monotonicMs() >= deadline) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
            await new Promise<void>(resolve => setTimeout(resolve, 25));
          }
          await session.pump;
          if (expired) throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
          deleteOwnedBrowserProfile(options.browserRoot, session.profileDirectory);
        })(), new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => { expired = true; reject(new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime")); }, options.closeProofMs * 2); })]);
        if (active === session) active = undefined;
        return { state: "closed" };
      } catch (error) { session.failure = new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime", session.failure ? new AggregateError([session.failure, error]) : error); return { state: "uncertain" }; }
      finally { clearTimeout(timeout); }
    })();
    return session.close;
  }

  return Object.freeze({
    async start(attempt: DraftDuoAttempt, bindObservedContext: (context: DraftDuoObservedContext) => Promise<DraftDuoCapability>, onFailure: (error: Error) => Promise<void>): Promise<void> {
      if (active) {
        if (canonicalJsonStringify(active.attempt) !== canonicalJsonStringify(attempt) || active.revoked) throw new ProfileOnboardingDuoProviderError("refused", "busy");
        return active.startup;
      }
      if (!(Date.parse(attempt.expiresAt) > options.clock.nowMs()) || !Number.isFinite(options.closeProofMs) || options.closeProofMs <= 0) throw new ProfileOnboardingDuoProviderError("refused", "revoked");
      try {
        if (!isAbsolute(options.browserRoot) || realpathSync(options.browserRoot) !== options.browserRoot || !isAbsolute(options.extensionDirectory)) throw new ProfileOnboardingDuoProviderError("unavailable", "browser-root");
        const root = lstatSync(options.browserRoot);
        if (!root.isDirectory() || root.isSymbolicLink() || root.uid !== process.getuid?.() || (root.mode & 0o077) !== 0) throw new ProfileOnboardingDuoProviderError("unavailable", "browser-root");
      } catch (error) { throw new ProfileOnboardingDuoProviderError("unavailable", "browser-root", error); }
      const session: NonNullable<typeof active> = { attempt, profileDirectory: mkdtempSync(join(options.browserRoot, "onboarding-")),
        contextId: randomUUID(), reportFailure: onFailure, accepted: false, revoked: false, contextClosed: false, launchStarted: false };
      active = session;
      session.startup = (async () => {
        mkdirSync(join(session.profileDirectory, "Default"), { mode: 0o700 });
        writeFileSync(join(session.profileDirectory, "Default", "Preferences"), JSON.stringify({ credentials_enable_service: false, profile: { password_manager_enabled: false } }), { mode: 0o600, flag: "wx" });
        const extensionDirectory = join(session.profileDirectory, "relay-extension");
        stageRelayExtension(options.extensionDirectory, extensionDirectory);
        session.launchStarted = true;
        session.launching = browserLauncher.launch({ profileDirectory: session.profileDirectory, headless: false,
          extensionDirectory, acceptDownloads: false, downloadsPath: session.profileDirectory, viewport: { width: 1100, height: 800 } }).then(context => {
          session.context = context;
          context.on("close", () => {
            session.contextClosed = true;
            if (!session.revoked) {
              if (session.accepted) void close(session);
              else void reportFailure(session, new ProfileOnboardingDuoProviderError(session.capability ? "unknown" : "unavailable", "browser-lifetime")).then(() => close(session));
            }
          });
          session.process = observe(session.profileDirectory);
          return context;
        });
        session.context = await session.launching;
        if (!session.process || session.process.observation.state !== "alive") throw new ProfileOnboardingDuoProviderError("unknown", "browser-lifetime");
        current(session);
        session.worker = session.context.serviceWorkers().find(worker => worker.url().startsWith("chrome-extension://") && worker.url().endsWith("/src/relay-background.js"))
          ?? await session.context.waitForEvent("serviceworker", { predicate: worker => worker.url().startsWith("chrome-extension://") && worker.url().endsWith("/src/relay-background.js"), timeout: options.closeProofMs });
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
                const capability = await bindObservedContext({ contextId: session.contextId, tabId: request.data.tabId, accountName: request.data.username,
                  origin: request.data.origin, rpId: request.data.rpId });
                current(session);
                if (canonicalJsonStringify(capability.attempt) !== canonicalJsonStringify(attempt)
                  || capability.scope.contextId !== session.contextId || capability.scope.tabId !== request.data.tabId
                  || capability.scope.accountId !== attempt.accountId || capability.scope.origin !== request.data.origin
                  || capability.scope.rpId !== request.data.rpId) throw new ProfileOnboardingDuoProviderError("refused", "scope");
                capability.assertCurrent();
                session.capability = capability;
                result = { accountId: attempt.accountId };
              } else result = await dispatch(session, request);
              current(session);
              await workerCall(worker, "reply", [request.id, { ok: true, value: result }]);
            } catch (error) {
              await workerCall(worker, "reply", [request.id, { ok: false }]);
              throw error;
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
        const page = session.context.pages()[0] ?? await session.context.newPage();
        await page.goto("https://duo.ucsd.edu", { waitUntil: "domcontentloaded" });
      })();
      try { await session.startup; }
      catch (error) {
        await reportFailure(session, error instanceof ProfileOnboardingDuoProviderError ? error
          : new ProfileOnboardingDuoProviderError(session.launchStarted ? "unknown" : "unavailable", "provider", error));
        await close(session);
        throw session.failure;
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
