import { hostConfigFacts as hostConfigFacts_m0 } from "../../../../src/models/config/host-display.js";

import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { chmodSync as chmodSync_m0,mkdirSync as mkdirSync_m0,mkdtempSync as mkdtempSync_m0,rmSync as rmSync_m0,writeFileSync as writeFileSync_m0 } from "node:fs";
import { tmpdir as tmpdir_m0 } from "node:os";
import { join as join_m0 } from "node:path";
import type { BrowserContext as BrowserContext_m0,Worker as Worker_m0 } from "playwright";
import { describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from "vitest";
import { resolveConfigWithProvenance as resolveConfigWithProvenance_m0 } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation as rebuildRuntimeIsolation_m0 } from "../../../../src/backend/app/config/runtime-isolation.js";
import { taskStoreRegistry as taskStoreRegistry_m0,taskStoreRegistry as taskStoreRegistry_m1 } from "../../../../src/backend/app/registries/task-registry.js";
import {
BrowserProfileAdmissionSchema as BrowserProfileAdmissionSchema_m0,
PlaywrightWorkerSessionFactory as PlaywrightWorkerSessionFactory_m0,
type BrowserDeadlineScheduler as BrowserDeadlineScheduler_m0,
type PersistentContextLauncher as PersistentContextLauncher_m0
} from "../../../../src/backend/runtime/browser/browser-session-factory.js";
import type { BrowserSystemBindings as BrowserSystemBindings_m0 } from "../../../../src/backend/runtime/browser/system-bindings.js";
import type { MonotonicDeadlineScheduler as MonotonicDeadlineScheduler_m1 } from "../../../../src/backend/runtime/scheduling/deadline-scheduler.js";
import type {
BrowserSessionCloseProof as BrowserSessionCloseProof_m1,
WorkerBrowserSessionFactory as WorkerBrowserSessionFactory_m1,
WorkerSessionEvent as WorkerSessionEvent_m1
} from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { WorkerSessionManager as WorkerSessionManager_m0,WorkerSessionManager as WorkerSessionManager_m1 } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import type {
AuthenticatedApplicationVerifier as AuthenticatedApplicationVerifier_m0,
AuthenticationProbe as AuthenticationProbe_m0,
AuthenticationVerificationContext as AuthenticationVerificationContext_m0
} from "../../../../src/backend/systems/browser-shared/login-contract.js";
import type { Config as Config_m0 } from "../../../../src/models/config/schema.js";
import type { ProtectedSecretSource as ProtectedSecretSource_m0 } from "../../../../src/models/config/secrets.js";
import { BrowserSessionIdSchema as BrowserSessionIdSchema_m1,FingerprintSchema as FingerprintSchema_m0,FingerprintSchema as FingerprintSchema_m1,WorkerIdSchema as WorkerIdSchema_m0,WorkerIdSchema as WorkerIdSchema_m1,WorkflowIdSchema as WorkflowIdSchema_m0,WorkflowIdSchema as WorkflowIdSchema_m1 } from "../../../../src/rules/identity/ids.js";
import type { TestClock as TestClock_m1 } from "../../../../src/rules/time/clock.js";
import { manualClock as manualClock_m0,manualClock as manualClock_m1 } from "../../../../src/rules/time/clock.js";
import type { RunBrowserScreenshotCapture as RunBrowserScreenshotCapture_m1 } from "../../../../src/workflow-kit/diagnostics.js";
import { fixtureDuoCeremonyGates as fixtureDuoCeremonyGates_m0,fixtureDuoCeremonyGates as fixtureDuoCeremonyGates_m1 } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { FIXTURE_SESSION_ACQUIRE_MS as FIXTURE_SESSION_ACQUIRE_MS_m0,FIXTURE_SESSION_ACQUIRE_MS as FIXTURE_SESSION_ACQUIRE_MS_m1,ManualScheduler as ManualScheduler_m0,ManualScheduler as ManualScheduler_m1 } from "../../../support/helpers/phase1f-executor-harness.js";
import { protectedSecretSource as protectedSecretSource_m0 } from "../../../support/helpers/protected-secret-source.js";


{


const CLOCK = manualClock_m0(new Date("2026-08-03T09:00:00.000Z"));
const WORKER_ID = WorkerIdSchema_m0.parse("person-lookup-worker-1");
const FINGERPRINT = FingerprintSchema_m0.parse("ab".repeat(32));
const SESSION_ID = "00000000-0000-4000-8000-000000000001";

const NEVER_SCHEDULER: BrowserDeadlineScheduler_m0 = {
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
    verify: async (context: AuthenticationVerificationContext_m0): Promise<AuthenticationProbe_m0> => {
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
  readonly launcher: PersistentContextLauncher_m0;
  readonly launches: () => readonly Readonly<Record<string, unknown>>[];
  readonly page: FakePage;
  readonly contextClosed: () => boolean;
}

function fakeLauncher(options: Readonly<{
  page?: FakePage;
  emitCloseEvent?: boolean;
  hangOnClose?: boolean;
  serviceWorker?: Worker_m0;
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
        mkdirSync_m0(input.profileDirectory, { recursive: true, mode: 0o700 });
        launches.push({ ...input });
        return context as unknown as BrowserContext_m0;
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
  verify?: AuthenticatedApplicationVerifier_m0;
}> = {}): BrowserSystemBindings_m0 {
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
function withTempRuntime(body: (input: Readonly<{ config: Config_m0; root: string }>) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync_m0(join_m0(tmpdir_m0(), "hrauto-browser-factory-"));
  const extensionDir = join_m0(root, "duo-autopilot");
  const credential = join_m0(root, "duo-webauthn.json");
  const profileRoot = join_m0(root, "profiles");
  mkdirSync_m0(extensionDir, { recursive: true });
  writeFileSync_m0(join_m0(extensionDir, "manifest.json"), "{}\n");
  writeFileSync_m0(credential, "{\"credentials\":[]}\n");
  chmodSync_m0(credential, 0o600);
  const base = resolveConfigWithProvenance_m0({}, hostConfigFacts_m0({}), CLOCK).config;
  const config: Config_m0 = {
    ...base,
    features: { ...base.features, duoWebAuthn: false },
    paths: { ...base.paths, browserProfileRoot: profileRoot, duoExtensionDir: extensionDir, duoCredential: credential },
  };
  return Promise.resolve(body({ config, root })).finally(() => {
    rmSync_m0(root, { recursive: true, force: true });
  });
}

function factoryFor(
  config: Config_m0,
  harness: FakeContextHarness,
  bindings: BrowserSystemBindings_m0,
  scheduler: BrowserDeadlineScheduler_m0 = NEVER_SCHEDULER,
  protectedSecrets: ProtectedSecretSource_m0 = protectedSecretSource_m0({
    ucpathUserId: "fixture-user",
    ucpathPassword: "fixture-value",
  }),
  Factory: typeof PlaywrightWorkerSessionFactory_m0 = PlaywrightWorkerSessionFactory_m0,
): PlaywrightWorkerSessionFactory_m0 {
  return new Factory({
    config,
    protectedSecrets,
    isolation: rebuildRuntimeIsolation_m0,
    clock: CLOCK,
    scheduler,
    slotOrdinal: () => 1,
    newSessionId: () => SESSION_ID,
    admitProfile: input => Promise.resolve(BrowserProfileAdmissionSchema_m0.parse({ ...input, profileRevision: 7, resetRequired: false })),
    bindings,
    launcher: harness.launcher,
  });
}

const WORKFLOW_ID = WorkflowIdSchema_m0.parse("person-lookup");

describe_m0("worker browser session factory", () => {

  it_m0("poisons the manager's ownership when a failed setup cannot prove closure", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher({ emitCloseEvent: false });
      const factory = factoryFor(
        config,
        harness,
        recordingBindings(),
        NEVER_SCHEDULER,
        protectedSecretSource_m0(),
      );
      const manager = new WorkerSessionManager_m0({
        workerId: WORKER_ID,
        workflowId: WORKFLOW_ID,
        stores: taskStoreRegistry_m0,
        // The store's provider rejects (no credential); cleanup then cannot be
        // proven because this context never announces its close.
        factory,
        clock: CLOCK,
        scheduler: new ManualScheduler_m0(CLOCK),
        acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS_m0,
        duoCeremony: fixtureDuoCeremonyGates_m0(CLOCK),
      });
      manager.bindRunConfigFingerprint(FINGERPRINT);
      await assert_m0.rejects(
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
      assert_m0.deepEqual(manager.activeSystems(), ["ucpath"], "an unprovable cleanup stays owned");
      await assert_m0.rejects(
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


const WORKER_ID = WorkerIdSchema_m1.parse("worker-session-fixture");
const WORKFLOW_ID = WorkflowIdSchema_m1.parse("person-lookup");
const SIGNAL = new AbortController().signal;
const RUN_FINGERPRINT = FingerprintSchema_m1.parse("1".repeat(64));
const OTHER_FINGERPRINT = FingerprintSchema_m1.parse("2".repeat(64));

function sessionFactory(options: Readonly<{
  resetFailureAt?: number;
  loginFailure?: boolean;
  closeFailureAt?: number;
  omitExclusiveRelease?: boolean;
  screenshotFailure?: boolean;
  // The fake login waits for abort, reproducing a driver that never responds.
  loginHangs?: boolean;
}> = {}): Readonly<{
  factory: WorkerBrowserSessionFactory_m1;
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
        const sessionId = BrowserSessionIdSchema_m1.parse(
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
          async close(): Promise<BrowserSessionCloseProof_m1> {
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
  events: WorkerSessionEvent_m1[] = [],
  options: {
    clock?: TestClock_m1;
    scheduler?: MonotonicDeadlineScheduler_m1;
    browserScreenshotCapture?: RunBrowserScreenshotCapture_m1;
    captureBrowserScreenshots?: boolean;
  } = {},
): WorkerSessionManager_m1 {
  const clock = options.clock ?? manualClock_m1(new Date("2026-08-02T18:00:00.000Z"));
  const sessions = new WorkerSessionManager_m1({
    workerId: WORKER_ID,
    workflowId: WORKFLOW_ID,
    stores: taskStoreRegistry_m1,
    factory: harness.factory,
    clock,
    scheduler: options.scheduler ?? new ManualScheduler_m1(clock),
    acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS_m1,
    duoCeremony: fixtureDuoCeremonyGates_m1(clock),
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

describe_m1("worker browser sessions", () => {

  it_m1("proves an authored fresh boundary closes before starting the replacement", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent_m1[] = [];
    const sessions = manager(harness, events);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "first");
    await sessions.withDriver(
      { ...UCPATH_REUSE, session: "fresh" },
      "prod",
      SIGNAL,
      async () => "second",
    );
    assert_m1.equal(harness.opens(), 2);
    const relevant = events.filter(({ type }) => type !== "browser-session:reset");
    assert_m1.deepEqual(relevant.map(({ type }) => type), [
      "browser-session:start",
      "browser-session:close",
      "browser-session:start",
    ]);
    assert_m1.equal(
      relevant[1]?.type === "browser-session:close" ? relevant[1].reason : undefined,
      "fresh-boundary",
    );
    assert_m1.notEqual(relevant[0]?.sessionId, relevant[2]?.sessionId);
  });

  it_m1("requires a bound run config fingerprint before any driver lease", async () => {
    const harness = sessionFactory();
    const sessions = new WorkerSessionManager_m1({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry_m1,
      factory: harness.factory,
      clock: manualClock_m1(new Date("2026-08-02T18:00:00.000Z")),
      scheduler: new ManualScheduler_m1(manualClock_m1(new Date("2026-08-02T18:00:00.000Z"))),
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS_m1,
      duoCeremony: fixtureDuoCeremonyGates_m1(),
    });
    await assert_m1.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "must not run"),
      /requires the claimed run's bound config fingerprint/,
    );
    assert_m1.equal(harness.opens(), 0);
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    assert_m1.throws(
      () => sessions.bindRunConfigFingerprint(OTHER_FINGERPRINT),
      /already has a bound run config fingerprint/,
    );
    sessions.releaseRunConfigFingerprint();
    assert_m1.throws(
      () => sessions.releaseRunConfigFingerprint(),
      /no bound run config fingerprint to release/,
    );
  });

  it_m1("reuses only on an exact fingerprint match and proves the boundary on drift", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent_m1[] = [];
    const sessions = manager(harness, events);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "first");
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "same-run-reuse");
    assert_m1.equal(harness.opens(), 1);


    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(OTHER_FINGERPRINT);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "next-run");
    assert_m1.equal(harness.opens(), 2);
    assert_m1.equal(harness.logins(), 2);
    const relevant = events.filter(({ type }) => type !== "browser-session:reset");
    assert_m1.deepEqual(relevant.map(({ type }) => type), [
      "browser-session:start",
      "browser-session:close",
      "browser-session:start",
    ]);
    assert_m1.equal(
      relevant[1]?.type === "browser-session:close" ? relevant[1].reason : undefined,
      "fresh-boundary",
    );
    assert_m1.notEqual(relevant[0]?.sessionId, relevant[2]?.sessionId);
  });

  it_m1("treats a changed resolved instance as identity drift, not silent reuse", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent_m1[] = [];
    const sessions = manager(harness, events);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "prod-run");
    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    await sessions.withDriver(UCPATH_REUSE, "test", SIGNAL, async () => "test-run");
    assert_m1.equal(harness.opens(), 2);
    const closes = events.filter((event) => event.type === "browser-session:close");
    assert_m1.deepEqual(closes.map((event) => event.reason), ["fresh-boundary"]);
  });

  it_m1("treats a changed browser presentation as identity drift, not silent reuse", async () => {
    const harness = sessionFactory();
    const events: WorkerSessionEvent_m1[] = [];
    const sessions = manager(harness, events);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "headless-run");
    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT, "headed");
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "headed-run");
    assert_m1.equal(harness.opens(), 2);
    assert_m1.deepEqual(
      events.filter((event) => event.type === "browser-session:close").map((event) => event.reason),
      ["fresh-boundary"],
    );
  });

  it_m1("admits a legacy headless resource only at the configured default, never for a headed run", async () => {
    const harness = sessionFactory();
    const legacy: WorkerBrowserSessionFactory_m1 = {
      async open(input) {
        const resource = await harness.factory.open(input);
        const { browserMode: _browserMode, ...withoutMode } = resource;
        return withoutMode;
      },
    };
    const sessions = new WorkerSessionManager_m1({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry_m1,
      factory: legacy,
      clock: manualClock_m1(new Date("2026-08-02T18:00:00.000Z")),
      scheduler: new ManualScheduler_m1(manualClock_m1(new Date("2026-08-02T18:00:00.000Z"))),
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS_m1,
      duoCeremony: fixtureDuoCeremonyGates_m1(),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    await sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "legacy-headless");
    sessions.releaseRunConfigFingerprint();
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT, "headed");
    await assert_m1.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "must not run"),
      /mismatched launch options/,
    );
    assert_m1.equal(harness.opens(), 2, "headed identity drift must force a fresh acquisition before refusing its missing echo");
  });

  it_m1("refuses a factory resource that echoes a different fingerprint", async () => {
    const harness = sessionFactory();
    const forging: WorkerBrowserSessionFactory_m1 = {
      async open(input) {
        const resource = await harness.factory.open(input);
        return { ...resource, configFingerprint: OTHER_FINGERPRINT };
      },
    };
    const sessions = new WorkerSessionManager_m1({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry_m1,
      factory: forging,
      clock: manualClock_m1(new Date("2026-08-02T18:00:00.000Z")),
      scheduler: new ManualScheduler_m1(manualClock_m1(new Date("2026-08-02T18:00:00.000Z"))),
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS_m1,
      duoCeremony: fixtureDuoCeremonyGates_m1(),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);
    await assert_m1.rejects(
      sessions.withDriver(UCPATH_REUSE, "prod", SIGNAL, async () => "must not run"),
      /mismatched launch options/,
    );
  });
});


describe_m1("bounded browser-session acquisition", () => {
  const UCPATH_NEED = { system: "ucpath", access: "read", session: "reuse-worker" } as const;

  it_m1("poison-closes a session whose non-cooperative login lands after the bound expired", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = sessionFactory();

    const stubborn: WorkerBrowserSessionFactory_m1 = {
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
    const clock = manualClock_m1(new Date("2026-08-02T18:00:00.000Z"));
    const scheduler = new ManualScheduler_m1(clock);
    const events: WorkerSessionEvent_m1[] = [];
    const sessions = new WorkerSessionManager_m1({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry_m1,
      factory: stubborn,
      clock,
      scheduler,
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS_m1,
      duoCeremony: fixtureDuoCeremonyGates_m1(clock),
      onEvent: (event) => events.push(event),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);

    const lease = sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => "must not run");
    const rejection = assert_m1.rejects(lease, /timeouts\.sessionAcquireMs bound/);
    await new Promise((resolve) => setImmediate(resolve));
    scheduler.pending()[0].fire();
    await rejection;


    release?.();
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setImmediate(resolve));
    assert_m1.deepEqual(sessions.activeSystems(), []);
    assert_m1.deepEqual(
      events.filter((event) => event.type === "browser-session:close").map((event) => event.reason),
      ["poisoned"],
    );
  });

  it_m1("lets an abandoned acquisition run its OWN proven cleanup when it is cooperative", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = sessionFactory();
    const slowOpen: WorkerBrowserSessionFactory_m1 = {
      async open(input) {
        const resource = await base.factory.open(input);
        await gate;
        return resource;
      },
    };
    const clock = manualClock_m1(new Date("2026-08-02T18:00:00.000Z"));
    const scheduler = new ManualScheduler_m1(clock);
    const events: WorkerSessionEvent_m1[] = [];
    const sessions = new WorkerSessionManager_m1({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry_m1,
      factory: slowOpen,
      clock,
      scheduler,
      acquireDeadlineMs: FIXTURE_SESSION_ACQUIRE_MS_m1,
      duoCeremony: fixtureDuoCeremonyGates_m1(clock),
      onEvent: (event) => events.push(event),
    });
    sessions.bindRunConfigFingerprint(RUN_FINGERPRINT);

    const lease = sessions.withDriver(UCPATH_NEED, "prod", SIGNAL, async () => "must not run");
    const rejection = assert_m1.rejects(lease, /timeouts\.sessionAcquireMs bound/);
    await new Promise((resolve) => setImmediate(resolve));
    scheduler.pending()[0].fire();
    await rejection;

    release?.();
    for (let tick = 0; tick < 5; tick += 1) await new Promise((resolve) => setImmediate(resolve));
    // The provider refuses to authenticate under an aborted signal, so
    // `#openAndLogin` proved its own close; nothing is left owned or leaked.
    assert_m1.deepEqual(sessions.activeSystems(), []);
    assert_m1.deepEqual(
      events.filter((event) => event.type === "browser-session:close").map((event) => event.reason),
      ["login-failed"],
    );
  });

  it_m1("refuses to be built without a positive acquisition bound", () => {
    const harness = sessionFactory();
    const clock = manualClock_m1(new Date("2026-08-02T18:00:00.000Z"));
    assert_m1.throws(() => new WorkerSessionManager_m1({
      workerId: WORKER_ID,
      workflowId: WORKFLOW_ID,
      stores: taskStoreRegistry_m1,
      factory: harness.factory,
      clock,
      scheduler: new ManualScheduler_m1(clock),
      acquireDeadlineMs: 0,
      duoCeremony: fixtureDuoCeremonyGates_m1(clock),
    }));
  });
});
}
