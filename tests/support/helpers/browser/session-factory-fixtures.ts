import { PNG } from "pngjs";
import { runInNewContext } from "node:vm";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Worker } from "playwright";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { BrowserProfileAdmissionSchema, PlaywrightWorkerSessionFactory, type BrowserDeadlineScheduler, type PersistentContextLauncher } from "../../../../src/backend/runtime/browser/browser-session-factory.js";
import type { BrowserSystemBindings } from "../../../../src/backend/runtime/browser/system-bindings.js";
import type { AuthenticatedApplicationVerifier, AuthenticationProbe, AuthenticationVerificationContext } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";
import type { Config } from "../../../../src/models/config/schema.js";
import type { ProtectedSecretSource } from "../../../../src/models/config/secrets.js";
import type { TestClock } from "../../../../src/rules/time/clock.js";
import { protectedSecretSource } from "../protected-secret-source.js";

export function createBrowserSessionFactoryFixtures(
  CLOCK: TestClock,
  SESSION_ID: string,
  NEVER_SCHEDULER: BrowserDeadlineScheduler,
) {
  interface FakeFrame {
    url: () => string;
    locator: (selector: string) => { selector: string; count: () => Promise<number> };
    evaluate: <T, A>(callback: (arg: A) => T, arg: A) => Promise<T>;
    isDetached: () => boolean;
  }
  interface FakePage {
    on: (event: string, listener: (frame: { url: () => string }) => void) => void;
    mainFrame: () => FakeFrame;
    emitFrameEvent: (event: "framenavigated" | "frameattached" | "framedetached", frame: { url: () => string }) => void;
    off: () => void;
    locator: () => { count: () => Promise<number> };
    frames: () => readonly FakeFrame[];
    evaluate: FakeFrame["evaluate"];
    viewportSize: () => { width: number; height: number };
    setViewportSize: (size: { width: number; height: number }) => Promise<void>;
    waitForTimeout: () => Promise<void>;
    closed: boolean;
    gotoUrls: string[];
    url: () => string;
    isClosed: () => boolean;
    close: () => Promise<void>;
    goto: (url: string) => Promise<null>;
    screenshot: (options: Readonly<{ type: "png"; clip?: { width: number; height: number } }>) => Promise<Buffer>;
  }

  function fakePage(options: Readonly<{ url?: string; refuseClose?: boolean }> = {}): FakePage {
    let current = options.url ?? "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/app";
    const frameListeners = new Map<string, ((frame: { url: () => string }) => void)[]>();
    const realm = {
      innerWidth: 1920, innerHeight: 1080, scrollX: 0, scrollY: 0,
      scrollTo({ left, top }: { left: number; top: number }) { this.scrollX = left; this.scrollY = top; },
      document: { documentElement: { scrollHeight: 1080, scrollWidth: 1920 }, body: { scrollHeight: 1080, scrollWidth: 1920 },
        querySelector: () => null, querySelectorAll: () => [],
        createRange: () => ({ selectNodeContents: () => undefined, getBoundingClientRect: () => ({ bottom: realm.innerHeight }) }) },
      MutationObserver: class { observe() {} disconnect() {} },
    };
    let contentSize: { width: number; height: number } | undefined;
    const sandbox = { ...realm, window: realm };
    const evaluate: FakeFrame["evaluate"] = async <T, A>(callback: (arg: A) => T, arg: A): Promise<T> => {
      const result: unknown = runInNewContext(`(${callback.toString()})(arg)`, { ...sandbox, document: realm.document, arg });
      return result as T;
    };
    const mainFrame = { evaluate, isDetached: () => false, url: () => current, locator: async (selector: string) => ({ selector, ...await page.locator() }) };
    const page: FakePage = {
      evaluate,
      viewportSize: () => ({ width: realm.innerWidth, height: realm.innerHeight }),
      setViewportSize: async size => {
        contentSize ??= size;
        realm.innerWidth = size.width; realm.innerHeight = size.height;
        realm.document.documentElement.scrollHeight = Math.max(contentSize.height, size.height);
        realm.document.documentElement.scrollWidth = Math.max(contentSize.width, size.width);
        realm.document.body.scrollWidth = Math.max(contentSize.width, size.width);
        realm.document.body.scrollHeight = Math.max(contentSize.height, size.height);
      },
      waitForTimeout: async () => undefined,
      on: (event, listener) => { frameListeners.set(event, [...frameListeners.get(event) ?? [], listener]); },
      mainFrame: () => mainFrame,
      emitFrameEvent: (event, frame) => { for (const listener of frameListeners.get(event) ?? []) listener(frame); },
      off: () => undefined,
      locator: () => ({ count: async () => 0 }),
      frames: () => [mainFrame],
      closed: false,
      gotoUrls: [],
      url: () => current,
      isClosed: () => page.closed,
      close: async () => {
        if (options.refuseClose === true) throw new Error("injected page close failure");
        page.closed = true;
      },
      goto: async (url: string) => {
        page.gotoUrls.push(url);
        current = url;
        page.emitFrameEvent("framenavigated", mainFrame);
        return null;
      },
      screenshot: async options => PNG.sync.write(new PNG({ width: options.clip?.width ?? realm.innerWidth, height: options.clip?.height ?? realm.innerHeight })),
    };
    return page;
  }


  function verifierFor(options: Readonly<{ authenticated?: boolean; reason?: string }> = {}) {
    const seen: string[] = [];
    return {
      seen: () => Object.freeze([...seen]),
      verify: async (context: AuthenticationVerificationContext): Promise<AuthenticationProbe> => {
        const url = context.page.url();
        seen.push(url);
        if (options.authenticated === false) {
          return { authenticated: false, reason: options.reason ?? "the fake verifier refused" };
        }
        return {
          authenticated: true,
          evidence: {
            system: "ucpath",
            url,
            positive: "fake PS_TOKEN session cookie",
            negative: "fake: no sign-in form",
          },
        };
      },
    };
  }

  interface FakeContextHarness {
    readonly launcher: PersistentContextLauncher;
    readonly launches: () => readonly Readonly<Record<string, unknown>>[];
    readonly page: FakePage;
    readonly contextClosed: () => boolean;
  }

  function fakeLauncher(options: Readonly<{
    page?: FakePage;
    emitCloseEvent?: boolean;
    hangOnClose?: boolean;
    serviceWorker?: Worker;
  }> = {}): FakeContextHarness {
    const page = options.page ?? fakePage();
    const launches: Readonly<Record<string, unknown>>[] = [];
    let closed = false;
    let emitClose = (): void => undefined;
    const context = {
      serviceWorkers: () => options.serviceWorker === undefined ? [] : [options.serviceWorker],
      waitForEvent: async () => { throw new Error("fixture extension service worker unavailable"); },
      pages: () => (page.closed ? [] : [page]),
      newPage: async () => page,
      on: (event: string, listener: () => void) => {
        if (event === "close") emitClose = listener;
      },
      close: async () => {
        if (options.hangOnClose === true) await new Promise<never>(() => undefined);
        closed = true;
        if (options.emitCloseEvent !== false) emitClose();
      },
    };
    return {
      launcher: {
        observeProcess: (_directory, pid = 123) => ({ pid, observation: closed ? { state: "gone" } : { state: "alive", identity: { platform: "darwin", startToken: "fixture-process" } } }),
        async launch(input) {
          mkdirSync(input.profileDirectory, { recursive: true, mode: 0o700 });
          await page.setViewportSize(input.viewport);
          launches.push({ ...input });
          return context as unknown as BrowserContext;
        },
      },
      launches: () => Object.freeze([...launches]),
      page,
      contextClosed: () => closed,
    };
  }

  /** A binding pair that records what the factory hands a login recipe. */
  function recordingBindings(options: Readonly<{
    onLogin?: (context: { credentials: Readonly<{ userId: string; password: string }>; label: string; instance: string }) => void;
    fail?: Error;
    verify?: AuthenticatedApplicationVerifier;
  }> = {}): BrowserSystemBindings {
    return {
      ucpath: {
        system: "ucpath",
        createDriver: () => ({ system: "ucpath" }),
        login: async (context) => {
          options.onLogin?.({
            credentials: context.credentials,
            label: context.label,
            instance: context.instance,
          });
          if (options.fail !== undefined) throw options.fail;
          return "logged-in";
        },
        verifyAuthenticated: options.verify ?? verifierFor().verify,
      },
    };
  }

  // Confine every browser-factory filesystem effect to the test root.
  function withTempRuntime(body: (input: Readonly<{ config: Config; root: string }>) => void | Promise<void>): Promise<void> {
    const root = mkdtempSync(join(tmpdir(), "hrauto-browser-factory-"));
    const extensionDir = join(root, "duo-autopilot");
    const credential = join(root, "duo-webauthn.json");
    const profileRoot = join(root, "profiles");
    mkdirSync(extensionDir, { recursive: true });
    writeFileSync(join(extensionDir, "manifest.json"), "{}\n");
    writeFileSync(credential, "{\"credentials\":[]}\n");
    chmodSync(credential, 0o600);
    const base = resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config;
    const config: Config = {
      ...base,
      features: { ...base.features, duoWebAuthn: false },
      paths: { ...base.paths, browserProfileRoot: profileRoot, duoExtensionDir: extensionDir, duoCredential: credential },
    };
    return Promise.resolve(body({ config, root })).finally(() => {
      rmSync(root, { recursive: true, force: true });
    });
  }

  function factoryFor(
    config: Config,
    harness: FakeContextHarness,
    bindings: BrowserSystemBindings,
    scheduler: BrowserDeadlineScheduler = NEVER_SCHEDULER,
    protectedSecrets: ProtectedSecretSource = protectedSecretSource({
      ucpathUserId: "fixture-user",
      ucpathPassword: "fixture-value",
    }),
    Factory: typeof PlaywrightWorkerSessionFactory = PlaywrightWorkerSessionFactory,
  ): PlaywrightWorkerSessionFactory {
    return new Factory({
      config,
      protectedSecrets,
      isolation: rebuildRuntimeIsolation,
      clock: CLOCK,
      scheduler,
      slotOrdinal: () => 1,
      newSessionId: () => SESSION_ID,
      admitProfile: input => Promise.resolve(BrowserProfileAdmissionSchema.parse({ ...input, profileRevision: 7, resetRequired: false })),
      bindings,
      launcher: harness.launcher,
    });
  }
  return { fakePage, verifierFor, fakeLauncher, recordingBindings, withTempRuntime, factoryFor };
}
