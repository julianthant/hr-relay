import { hostConfigFacts } from "../../../../src/models/config/host-display.js";

import { default as assert } from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, type Worker } from "playwright";
import { describe, it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { BrowserProfileAdmissionSchema, PlaywrightWorkerSessionFactory, type BrowserDeadlineScheduler, type PersistentContextLauncher } from "../../../../src/backend/runtime/browser/browser-session-factory.js";
import { type BrowserSystemBindings } from "../../../../src/backend/runtime/browser/system-bindings.js";
import { type MonotonicDeadlineScheduler } from "../../../../src/backend/runtime/scheduling/deadline-scheduler.js";
import { type BrowserSessionCloseProof, type WorkerBrowserSessionFactory, type WorkerSessionEvent } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { type AuthenticatedApplicationVerifier, type AuthenticationProbe, type AuthenticationVerificationContext } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { type Config } from "../../../../src/models/config/schema.js";
import { type ProtectedSecretSource } from "../../../../src/models/config/secrets.js";
import { BrowserSessionIdSchema, FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { type TestClock } from "../../../../src/rules/time/clock.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { type RunBrowserScreenshotCapture } from "../../../../src/workflow-kit/diagnostics.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { FIXTURE_SESSION_ACQUIRE_MS, ManualScheduler } from "../../../support/helpers/phase1f-executor-harness.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";

{

const CLOCK = manualClock(new Date("2026-08-03T09:00:00.000Z"));
const WORKER_ID = WorkerIdSchema.parse("person-lookup-worker-1");
const FINGERPRINT = FingerprintSchema.parse("ab".repeat(32));
const SESSION_ID = "00000000-0000-4000-8000-000000000001";

const NEVER_SCHEDULER: BrowserDeadlineScheduler = {
  schedule: () => ({ cancel: () => undefined }),
};

interface FakePage {
  on: () => void;
  off: () => void;
  locator: () => { count: () => Promise<number> };
  closed: boolean;
  gotoUrls: string[];
  url: () => string;
  isClosed: () => boolean;
  close: () => Promise<void>;
  goto: (url: string) => Promise<null>;
  screenshot: (options: Readonly<{ type: "png" }>) => Promise<Buffer>;
}

function fakePage(options: Readonly<{ url?: string; refuseClose?: boolean }> = {}): FakePage {
  let current = options.url ?? "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/app";
  const page: FakePage = {
    on: () => undefined,
    off: () => undefined,
    locator: () => ({ count: async () => 0 }),
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
      return null;
    },
    screenshot: async () => Buffer.from([137, 80, 78, 71]),
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

const WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");

describe("worker browser session factory", () => {

  it("poisons the manager's ownership when a failed setup cannot prove closure", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher({ emitCloseEvent: false });
      const factory = factoryFor(
        config,
        harness,
        recordingBindings(),
        NEVER_SCHEDULER,
        protectedSecretSource(),
      );
      const manager = new WorkerSessionManager({
        workerId: WORKER_ID,
        workflowId: WORKFLOW_ID,
        stores: taskStoreRegistry,
        // The store's provider rejects (no credential); cleanup then cannot be
        // proven because this context never announces its close.
        factory,
        clock: CLOCK,
        scheduler: new ManualScheduler(CLOCK),
        acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
        duoCeremony: fixtureDuoCeremonyGates(CLOCK),
      });
      manager.bindRunConfigFingerprint(FINGERPRINT);
      await assert.rejects(
        manager.withDriver(
          { system: "ucpath", access: "read", session: "reuse-worker" },
          "prod",
          new AbortController().signal,
          async () => "must not run",
        ),
        (error: unknown) => error instanceof AggregateError
          && error.errors.some((failure: unknown) => failure instanceof Error
            && /ucpathUserId is missing/.test(failure.message))
          && error.errors.some((failure: unknown) => failure instanceof Error
            && /never emitted its context close event/.test(failure.message)),
      );
      assert.deepEqual(manager.activeSystems(), ["ucpath"], "an unprovable cleanup stays owned");
      await assert.rejects(
        manager.withDriver(
          { system: "ucpath", access: "read", session: "reuse-worker" },
          "prod",
          new AbortController().signal,
          async () => "must not run",
        ),
        /unresolved failed-close proof/,
      );
    });
  });
});
}

{

const WORKER_ID = WorkerIdSchema.parse("worker-session-fixture");
const WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");
const SIGNAL = new AbortController().signal;
const RUN_FINGERPRINT = FingerprintSchema.parse("1".repeat(64));
const OTHER_FINGERPRINT = FingerprintSchema.parse("2".repeat(64));

function sessionFactory(options: Readonly<{
  resetFailureAt?: number;
  loginFailure?: boolean;
  closeFailureAt?: number;
  omitExclusiveRelease?: boolean;
  screenshotFailure?: boolean;
  // The fake login waits for abort, reproducing a driver that never responds.
  loginHangs?: boolean;
}> = {}): Readonly<{
  factory: WorkerBrowserSessionFactory;
  opens: () => number;
  logins: () => number;
  resets: () => number;
  closes: () => number;
  screenshots: () => number;
}> {
  let opens = 0;
  let logins = 0;
  let resets = 0;
  let closes = 0;
  let screenshots = 0;
  return {
    factory: {
      async open(input) {
        opens += 1;
        const sessionId = BrowserSessionIdSchema.parse(
          `00000000-0000-4000-8000-${String(opens).padStart(12, "0")}`,
        );
        return {
          sessionId,
          system: input.system,
          ...(input.instance === undefined ? {} : { instance: input.instance }),
          configFingerprint: input.configFingerprint,
          signInFingerprint: input.configFingerprint,
          profileRevision: 1,
          ...(input.browserMode === undefined ? {} : { browserMode: input.browserMode }),
          acceptDownloads: input.acceptDownloads,
          exclusive: input.exclusive,
          driver: { system: input.system },
          async screenshot() {
            screenshots += 1;
            if (options.screenshotFailure === true) throw new Error("injected screenshot persistence failure");
            return { state: "available" as const, sessionId, pageVersion: 1, observedAt: "2026-08-02T18:00:00.000Z", bytes: new Uint8Array([137, 80, 78, 71]), width: 1280, height: 720 };
          },
          authentication: {
            authenticate(system, authOptions) {
              if (system !== input.system) {
                return Promise.reject(new Error(`${input.system} resource cannot authenticate ${system}`));
              }
              logins += 1;
              if (options.loginFailure === true) {
                return Promise.reject(new Error("injected login failure"));
              }
              if (options.loginHangs === true) {

                return new Promise<"logged-in">((_resolve, reject) => {
                  authOptions.signal?.addEventListener(
                    "abort",
                    () => reject(new Error("the hung login observed its abort")),
                    { once: true },
                  );
                });
              }
              return Promise.resolve("logged-in" as const);
            },
          },
          async reset() {
            resets += 1;
            if (resets === options.resetFailureAt) throw new Error("injected reset failure");
          },
          async close(): Promise<BrowserSessionCloseProof> {
            closes += 1;
            if (closes === options.closeFailureAt) throw new Error("injected close failure");
            return {
              sessionId,
              system: input.system,
              pagesClosed: true,
              contextClosed: true,
              ...(input.exclusive && options.omitExclusiveRelease !== true
                ? { exclusiveLeaseReleased: true as const }
                : {}),
            };
          },
        };
      },
    },
    opens: () => opens,
    logins: () => logins,
    resets: () => resets,
    closes: () => closes,
    screenshots: () => screenshots,
  };
}

function manager(
  harness: ReturnType<typeof sessionFactory>,
  events: WorkerSessionEvent[] = [],
  options: {
    clock?: TestClock;
    scheduler?: MonotonicDeadlineScheduler;
    browserScreenshotCapture?: RunBrowserScreenshotCapture;
    captureBrowserScreenshots?: boolean;
  } = {},
): WorkerSessionManager {
  const clock = options.clock ?? manualClock(new Date("2026-08-02T18:00:00.000Z"));
  const sessions = new WorkerSessionManager({
    workerId: WORKER_ID,
    workflowId: WORKFLOW_ID,
    stores: taskStoreRegistry,
    factory: harness.factory,
    clock,
    scheduler: options.scheduler ?? new ManualScheduler(clock),
    acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
    duoCeremony: fixtureDuoCeremonyGates(clock),
    onEvent: (event) => events.push(event),
    ...(options.browserScreenshotCapture === undefined
      ? { browserScreenshotCapture: { capture: async () => undefined } }
      : { browserScreenshotCapture: options.browserScreenshotCapture }),
  });

  sessions.bindRunConfigFingerprint(RUN_FINGERPRINT, undefined, {
    runId: "00000000-0000-4000-8000-000000000099",
    descriptorFingerprint: RUN_FINGERPRINT,
    ...(options.captureBrowserScreenshots === undefined
      ? {}
      : { captureBrowserScreenshots: options.captureBrowserScreenshots }),
  });
  return sessions;
}

const UCPATH_REUSE = {
  system: "ucpath" as const,
  access: "read" as const,
  session: "reuse-worker" as const,
};

describe("worker browser sessions", () => {

  it("proves an authored fresh boundary closes before starting the replacement", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent[] = [];
    const sessions = manager(harness, events);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "first");
    await sessions.withDriver(
      { ...UCPATH_REUSE, session: "fresh" },
      "prod",
      SIGNAL,
      async () => "second",
    );
    assert.equal(harness.opens(), 2);
    const relevant = events.filter(({ type }) => type !== "browser-session:reset");
    assert.deepEqual(relevant.map(({ type }) => type), [
      "browser-session:start",
      "browser-session:close",
      "browser-session:start",
    ]);
    assert.equal(
      relevant[1]?.type === "browser-session:close" ? relevant[1].reason : undefined,
      "fresh-boundary",
    );
    assert.notEqual(relevant[0]?.sessionId, relevant[2]?.sessionId);
  });

  it("requires a bound run config fingerprint before any driver lease", async () => {
    const harness = sessionFactory();
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: harness.factory,
      clock: manualClock(new Date("2026-08-02T18:00:00.000Z")),
      scheduler: new ManualScheduler(manualClock(new Date("2026-08-02T18:00:00.000Z"))),
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: fixtureDuoCeremonyGates(),
    });
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "must not run"),
      /requires the claimed run's bound config fingerprint/,
    );
    assert.equal(harness.opens(), 0);
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    assert.throws(
      () => sessions.bindRunConfigFingerprint(OTHER_FINGERPRINT),
      /already has a bound run config fingerprint/,
    );
    sessions.releaseRunConfigFingerprint();
    assert.throws(
      () => sessions.releaseRunConfigFingerprint(),
      /no bound run config fingerprint to release/,
    );
  });

  it("reuses only on an exact fingerprint match and proves the boundary on drift", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent[] = [];
    const sessions = manager(harness, events);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "first");
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "same-run-reuse");
    assert.equal(harness.opens(), 1);

    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(OTHER_FINGERPRINT);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "next-run");
    assert.equal(harness.opens(), 2);
    assert.equal(harness.logins(), 2);
    const relevant = events.filter(({ type }) => type !== "browser-session:reset");
    assert.deepEqual(relevant.map(({ type }) => type), [
      "browser-session:start",
      "browser-session:close",
      "browser-session:start",
    ]);
    assert.equal(
      relevant[1]?.type === "browser-session:close" ? relevant[1].reason : undefined,
      "fresh-boundary",
    );
    assert.notEqual(relevant[0]?.sessionId, relevant[2]?.sessionId);
  });

  it("treats a changed resolved instance as identity drift, not silent reuse", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent[] = [];
    const sessions = manager(harness, events);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "prod-run");
    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    await sessions.withDriver(UCPATH_REUSE, "test", SIGNAL, async () => "test-run");
    assert.equal(harness.opens(), 2);
    const closes = events.filter((event) => event.type === "browser-session:close");
    assert.deepEqual(closes.map((event) => event.reason), ["fresh-boundary"]);
  });

  it("treats a changed browser presentation as identity drift, not silent reuse", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent[] = [];
    const sessions = manager(harness, events);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "headless-run");
    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT, "headed");
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "headed-run");
    assert.equal(harness.opens(), 2);
    assert.deepEqual(
      events.filter((event) => event.type === "browser-session:close").map((event) => event.reason),
      ["fresh-boundary"],
    );
  });

  it("admits a legacy headless resource only at the configured default, never for a headed run", async () => {
    const harness = sessionFactory();
    const legacy: WorkerBrowserSessionFactory = {
      async open(input) {
        const resource = await harness.factory.open(input);
        const { browserMode: _browserMode, ...withoutMode } = resource;
        return withoutMode;
      },
    };
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: legacy,
      clock: manualClock(new Date("2026-08-02T18:00:00.000Z")),
      scheduler: new ManualScheduler(manualClock(new Date("2026-08-02T18:00:00.000Z"))),
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: fixtureDuoCeremonyGates(),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "legacy-headless");
    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT, "headed");
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "must not run"),
      /mismatched launch options/,
    );
    assert.equal(harness.opens(), 2, "headed identity drift must force a fresh acquisition before refusing its missing echo");
  });

  it("refuses a factory resource that echoes a different fingerprint", async () => {
    const harness = sessionFactory();
    const forging: WorkerBrowserSessionFactory = {
      async open(input) {
        const resource = await harness.factory.open(input);
        return { ...resource, configFingerprint: OTHER_FINGERPRINT };
      },
    };
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: forging,
      clock: manualClock(new Date("2026-08-02T18:00:00.000Z")),
      scheduler: new ManualScheduler(manualClock(new Date("2026-08-02T18:00:00.000Z"))),
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: fixtureDuoCeremonyGates(),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    await assert.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "must not run"),
      /mismatched launch options/,
    );
  });
});

describe("bounded browser-session acquisition", () => {
  const UCPATH_NEED = { system: "ucpath", access: "read", session: "reuse-worker" } as const;

  it("poison-closes a session whose non-cooperative login lands after the bound expired", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = sessionFactory();

    const stubborn: WorkerBrowserSessionFactory = {
      async open(input) {
        const resource = await base.factory.open(input);
        return {
          ...resource,
          authentication: {
            async authenticate(system: typeof input.system) {
              await gate;
              return resource.authentication.authenticate(system, {});
            },
          },
        };
      },
    };
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const scheduler = new ManualScheduler(clock);
    const events: WorkerSessionEvent[] = [];
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: stubborn,
      clock,
      scheduler,
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: fixtureDuoCeremonyGates(clock),
      onEvent: (event) => events.push(event),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);

    const lease = sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => "must not run");
    const rejection = assert.rejects(lease, /timeouts\.sessionAcquireMs bound/);
    await new Promise((resolve) => setImmediate(resolve));
    scheduler.pending()[0].fire();
    await rejection;

    release?.();
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(sessions.activeSystems(), []);
    assert.deepEqual(
      events.filter((event) => event.type === "browser-session:close").map((event) => event.reason),
      ["poisoned"],
    );
  });

  it("lets an abandoned acquisition run its OWN proven cleanup when it is cooperative", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = sessionFactory();
    const slowOpen: WorkerBrowserSessionFactory = {
      async open(input) {
        const resource = await base.factory.open(input);
        await gate;
        return resource;
      },
    };
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    const scheduler = new ManualScheduler(clock);
    const events: WorkerSessionEvent[] = [];
    const sessions = new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: slowOpen,
      clock,
      scheduler,
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS,
      duoCeremony: fixtureDuoCeremonyGates(clock),
      onEvent: (event) => events.push(event),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);

    const lease = sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => "must not run");
    const rejection = assert.rejects(lease, /timeouts\.sessionAcquireMs bound/);
    await new Promise((resolve) => setImmediate(resolve));
    scheduler.pending()[0].fire();
    await rejection;

    release?.();
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setImmediate(resolve));
    // The provider refuses to authenticate under an aborted signal, so
    // `#openAndLogin` proved its own close; nothing is left owned or leaked.
    assert.deepEqual(sessions.activeSystems(), []);
    assert.deepEqual(
      events.filter((event) => event.type === "browser-session:close").map((event) => event.reason),
      ["login-failed"],
    );
  });

  it("refuses to be built without a positive acquisition bound", () => {
    const harness = sessionFactory();
    const clock = manualClock(new Date("2026-08-02T18:00:00.000Z"));
    assert.throws(() => new WorkerSessionManager({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry,
      factory: harness.factory,
      clock,
      scheduler: new ManualScheduler(clock),
      acquireDeadlineMs: 0,
      duoCeremony: fixtureDuoCeremonyGates(clock),
    }));
  });
});
}
