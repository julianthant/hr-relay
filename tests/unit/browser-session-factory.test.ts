/**
 * The real worker browser-session factory (doc 05 §4 · doc 11 §4).
 *
 * The Playwright launch itself is the ONE injected seam; everything the factory
 * decides — profile isolation, Duo prerequisites, authentication dispatch,
 * reset verification, and provable teardown — runs for real here, against the
 * real config resolver and the real `WorkerSessionManager`.
 *
 * A live login is NOT exercised here (that is the live smoke's job); what IS
 * exercised is every arm that must fail loud before or around one.
 */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { describe, it } from "vitest";
import type { BrowserContext } from "playwright";
import {
  PlaywrightWorkerSessionFactory,
  assertDuoAutopilotReady,
  workerProfileDirectory,
  type BrowserDeadlineScheduler,
  type PersistentContextLauncher,
} from "../../src/infra/browser/browser-session-factory.js";
import { rebuildRuntimeIsolation } from "../../src/config/runtime-isolation.js";
import { manualClock } from "../../src/domain/clock.js";
import { resolveConfig } from "../../src/domain/config/resolve.js";
import type { Config } from "../../src/domain/config/schema.js";
import { FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../src/domain/ids.js";
import { WorkerSessionManager } from "../../src/core/worker-sessions.js";
import { taskStoreRegistry } from "../../src/stores/index.js";
import type { BrowserSystemBindings } from "../../src/infra/browser/system-bindings.js";

const CLOCK = manualClock(new Date("2026-08-03T09:00:00.000Z"));
const WORKER_ID = WorkerIdSchema.parse("person-lookup-worker-1");
const FINGERPRINT = FingerprintSchema.parse("ab".repeat(32));
const OTHER_FINGERPRINT = FingerprintSchema.parse("cd".repeat(32));
const SESSION_ID = "00000000-0000-4000-8000-000000000001";

/** Fires every scheduled deadline immediately, so the close-proof bound is real. */
const IMMEDIATE_SCHEDULER: BrowserDeadlineScheduler = {
  schedule: (_deadline, onDeadline) => {
    const handle = setTimeout(onDeadline, 0);
    return { cancel: () => { clearTimeout(handle); } };
  },
};

const NEVER_SCHEDULER: BrowserDeadlineScheduler = {
  schedule: () => ({ cancel: () => undefined }),
};

interface FakePage {
  closed: boolean;
  gotoUrls: string[];
  url: () => string;
  isClosed: () => boolean;
  close: () => Promise<void>;
  goto: (url: string) => Promise<null>;
}

function fakePage(options: Readonly<{ url?: string; refuseClose?: boolean }> = {}): FakePage {
  let current = options.url ?? "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/app";
  const page: FakePage = {
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
  };
  return page;
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
}> = {}): FakeContextHarness {
  const page = options.page ?? fakePage();
  const launches: Readonly<Record<string, unknown>>[] = [];
  let closed = false;
  let emitClose = (): void => undefined;
  const context = {
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
      async launch(input) {
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
  authenticatedUrl?: (url: string) => boolean;
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
      isAuthenticatedUrl: options.authenticatedUrl
        ?? ((url: string) => url.includes("universityofcalifornia.edu")),
    },
  };
}

function withTempRuntime(body: (input: Readonly<{ config: Config; root: string }>) => void | Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "hrauto-browser-factory-"));
  const extensionDir = join(root, "duo-autopilot");
  const credential = join(root, "duo-webauthn.json");
  mkdirSync(extensionDir, { recursive: true });
  writeFileSync(join(extensionDir, "manifest.json"), "{}\n");
  writeFileSync(credential, "{\"credentials\":[]}\n");
  chmodSync(credential, 0o600);
  const base = resolveConfig({}, {}, CLOCK);
  const config: Config = {
    ...base,
    paths: { ...base.paths, duoExtensionDir: extensionDir, duoCredential: credential as typeof base.paths.duoCredential },
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
): PlaywrightWorkerSessionFactory {
  return new PlaywrightWorkerSessionFactory({
    config,
    isolation: rebuildRuntimeIsolation,
    clock: CLOCK,
    scheduler,
    newSessionId: () => SESSION_ID,
    bindings,
    launcher: harness.launcher,
  });
}

const WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");

const OPEN_INPUT = {
  workerId: WORKER_ID,
  workflowId: WORKFLOW_ID,
  system: "ucpath",
  instance: "prod",
  configFingerprint: FINGERPRINT,
  acceptDownloads: false,
  exclusive: false,
  signal: new AbortController().signal,
} as const;

describe("worker browser session factory", () => {
  it("derives every profile segment from the isolation contract, not literals", () => {
    const directory = workerProfileDirectory({
      isolation: rebuildRuntimeIsolation,
      workerId: WORKER_ID,
      system: "ucpath",
      instance: "prod",
      configFingerprint: FINGERPRINT,
    });
    assert.equal(
      directory,
      resolvePath(
        rebuildRuntimeIsolation.browserProfileRoot,
        rebuildRuntimeIsolation.browserSessionNamespace,
        WORKER_ID,
        `ucpath-prod-${FINGERPRINT.slice(0, 12)}`,
      ),
    );
    // The legacy runtime's profile root and session namespace must be
    // unreachable from this derivation, whatever the identity.
    assert.doesNotMatch(directory, /\.auth\/|hrauto-legacy/u);

    const distinct = new Set([
      directory,
      workerProfileDirectory({ isolation: rebuildRuntimeIsolation, workerId: WORKER_ID, system: "crm", instance: "prod", configFingerprint: FINGERPRINT }),
      workerProfileDirectory({ isolation: rebuildRuntimeIsolation, workerId: WORKER_ID, system: "ucpath", instance: "test", configFingerprint: FINGERPRINT }),
      workerProfileDirectory({ isolation: rebuildRuntimeIsolation, workerId: WORKER_ID, system: "ucpath", instance: "prod", configFingerprint: OTHER_FINGERPRINT }),
      workerProfileDirectory({ isolation: rebuildRuntimeIsolation, workerId: WorkerIdSchema.parse("person-lookup-worker-2"), system: "ucpath", instance: "prod", configFingerprint: FINGERPRINT }),
    ]);
    assert.equal(distinct.size, 5, "every identity axis must partition the profile directory");
  });

  it("launches full Chromium with the configured extension and profile", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher();
      const factory = factoryFor(config, harness, recordingBindings());
      const resource = await factory.open(OPEN_INPUT);
      const launch = harness.launches()[0];
      assert.ok(launch);
      assert.equal(launch.extensionDirectory, config.paths.duoExtensionDir);
      assert.equal(launch.headless, config.browser.headless);
      assert.equal(launch.downloadsPath, config.paths.downloadsDir);
      assert.deepEqual(launch.viewport, {
        width: config.display.screenWidth,
        height: config.display.screenHeight,
      });
      assert.equal(
        launch.profileDirectory,
        workerProfileDirectory({
          isolation: rebuildRuntimeIsolation,
          workerId: WORKER_ID,
          system: "ucpath",
          instance: "prod",
          configFingerprint: FINGERPRINT,
        }),
      );
      assert.equal(resource.configFingerprint, FINGERPRINT);
      assert.equal(resource.system, "ucpath");
      await resource.close({ reason: "worker-stop" });
      rmSync(rebuildRuntimeIsolation.browserProfileRoot, { recursive: true, force: true });
    });
  });

  it("refuses to launch when the Duo extension or credential is not ready", async () => {
    await withTempRuntime(async ({ config, root }) => {
      const missingExtension: Config = {
        ...config,
        paths: { ...config.paths, duoExtensionDir: join(root, "absent-extension") },
      };
      assert.throws(
        () => { assertDuoAutopilotReady(missingExtension); },
        /Duo Autopilot extension is not loadable/,
      );

      const missingCredential: Config = {
        ...config,
        paths: { ...config.paths, duoCredential: join(root, "absent.json") as typeof config.paths.duoCredential },
      };
      assert.throws(
        () => { assertDuoAutopilotReady(missingCredential); },
        /duoWebauthnCredential is unavailable/,
      );

      const loosePermissions = join(root, "loose.json");
      writeFileSync(loosePermissions, "{}\n");
      chmodSync(loosePermissions, 0o644);
      assert.throws(
        () => {
          assertDuoAutopilotReady({
            ...config,
            paths: { ...config.paths, duoCredential: loosePermissions as typeof config.paths.duoCredential },
          });
        },
        /duoWebauthnCredential is unavailable/,
      );

      // Feature off is an explicit operator decision, not a silent skip.
      assert.doesNotThrow(() => {
        assertDuoAutopilotReady({
          ...missingExtension,
          features: { ...config.features, duoWebAuthn: false },
        });
      });
    });
  });

  it("hands the login recipe resolved credentials and never names a value", async () => {
    await withTempRuntime(async ({ config }) => {
      const seen: { userId: string; password: string; label: string; instance: string }[] = [];
      const harness = fakeLauncher();
      const factory = factoryFor(config, harness, recordingBindings({
        onLogin: (context) => seen.push({ ...context.credentials, label: context.label, instance: context.instance }),
      }));
      const resource = await factory.open(OPEN_INPUT);
      const previousUser = process.env.UCPATH_USER_ID;
      const previousSecret = process.env.UCPATH_PASSWORD;
      process.env.UCPATH_USER_ID = "fixture-user";
      process.env.UCPATH_PASSWORD = "fixture-value";
      try {
        assert.equal(await resource.authentication.authenticate("ucpath", {}), "logged-in");
      } finally {
        if (previousUser === undefined) delete process.env.UCPATH_USER_ID;
        else process.env.UCPATH_USER_ID = previousUser;
        if (previousSecret === undefined) delete process.env.UCPATH_PASSWORD;
        else process.env.UCPATH_PASSWORD = previousSecret;
      }
      assert.deepEqual(seen, [{
        userId: "fixture-user",
        password: "fixture-value",
        label: `worker ${WORKER_ID} ucpath session`,
        instance: "prod",
      }]);

      // A cross-system or cross-instance authentication is a bug, not a hint.
      await assert.rejects(
        resource.authentication.authenticate("crm", {}),
        /cannot authenticate crm/,
      );
      await assert.rejects(
        resource.authentication.authenticate("ucpath", { instance: "test" }),
        /opened for instance prod but login requested test/,
      );
      await resource.close({ reason: "worker-stop" });
      rmSync(rebuildRuntimeIsolation.browserProfileRoot, { recursive: true, force: true });
    });
  });

  it("fails loud when a secret is missing rather than logging in blank", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher();
      const factory = factoryFor(config, harness, recordingBindings());
      const resource = await factory.open(OPEN_INPUT);
      const previousUser = process.env.UCPATH_USER_ID;
      const previousSecret = process.env.UCPATH_PASSWORD;
      delete process.env.UCPATH_USER_ID;
      delete process.env.UCPATH_PASSWORD;
      try {
        await assert.rejects(
          resource.authentication.authenticate("ucpath", {}),
          (error: unknown) => error instanceof Error
            && /ucpathUserId is missing from registered source environment UCPATH_USER_ID/.test(error.message),
        );
      } finally {
        if (previousUser !== undefined) process.env.UCPATH_USER_ID = previousUser;
        if (previousSecret !== undefined) process.env.UCPATH_PASSWORD = previousSecret;
      }
      await resource.close({ reason: "login-failed" });
      rmSync(rebuildRuntimeIsolation.browserProfileRoot, { recursive: true, force: true });
    });
  });

  it("verifies the neutral reset landed instead of assuming reuse is safe", async () => {
    await withTempRuntime(async ({ config }) => {
      const page = fakePage();
      const harness = fakeLauncher({ page });
      const factory = factoryFor(config, harness, recordingBindings());
      const resource = await factory.open(OPEN_INPUT);
      await resource.reset({ signal: new AbortController().signal });
      assert.deepEqual(page.gotoUrls, [config.urls.ucpath.prod.smartHr]);

      const droppedPage = fakePage();
      const droppedHarness = fakeLauncher({ page: droppedPage });
      const droppedFactory = factoryFor(
        config,
        droppedHarness,
        recordingBindings({ authenticatedUrl: () => false }),
      );
      const dropped = await droppedFactory.open(OPEN_INPUT);
      await assert.rejects(
        dropped.reset({ signal: new AbortController().signal }),
        /the neutral reset did not land on the authenticated application/,
      );
      await resource.close({ reason: "worker-stop" });
      await dropped.close({ reason: "poisoned" });
      rmSync(rebuildRuntimeIsolation.browserProfileRoot, { recursive: true, force: true });
    });
  });

  it("returns a close proof only when page AND context closure are observed", async () => {
    await withTempRuntime(async ({ config }) => {
      const clean = fakeLauncher();
      const cleanResource = await factoryFor(config, clean, recordingBindings()).open(OPEN_INPUT);
      const proof = await cleanResource.close({ reason: "fresh-boundary" });
      assert.deepEqual(proof, {
        sessionId: SESSION_ID,
        system: "ucpath",
        pagesClosed: true,
        contextClosed: true,
      });
      assert.equal(clean.contextClosed(), true);

      // The context never announced its own close: unprovable, so it throws.
      const silent = fakeLauncher({ emitCloseEvent: false });
      const silentResource = await factoryFor(config, silent, recordingBindings()).open(OPEN_INPUT);
      await assert.rejects(
        silentResource.close({ reason: "worker-stop" }),
        /never emitted its context close event/,
      );

      // A page that refuses to close is not "closed enough".
      const stuck = fakeLauncher({ page: fakePage({ refuseClose: true }) });
      const stuckResource = await factoryFor(config, stuck, recordingBindings()).open(OPEN_INPUT);
      await assert.rejects(
        stuckResource.close({ reason: "worker-stop" }),
        /injected page close failure/,
      );

      // A close that hangs must hit its bounded proof deadline, not wait forever.
      const hanging = fakeLauncher({ hangOnClose: true });
      const hangingResource = await factoryFor(
        config,
        hanging,
        recordingBindings(),
        IMMEDIATE_SCHEDULER,
      ).open(OPEN_INPUT);
      await assert.rejects(
        hangingResource.close({ reason: "worker-stop" }),
        /did not complete within its .*proof deadline/,
      );
      rmSync(rebuildRuntimeIsolation.browserProfileRoot, { recursive: true, force: true });
    });
  });

  it("refuses a system with no landed binding and an exclusive lease it cannot honor", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher();
      const factory = factoryFor(config, harness, recordingBindings());
      await assert.rejects(
        factory.open({ ...OPEN_INPUT, system: "onbase" }),
        /onbase has no landed browser-session binding/,
      );
      await assert.rejects(
        factory.open({ ...OPEN_INPUT, exclusive: true }),
        /exclusive OnBase lease is not landed/,
      );
      assert.deepEqual(harness.launches(), [], "no browser may be launched for a refused session");
    });
  });

  it("poisons the manager's ownership when a failed setup cannot prove closure", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher({ emitCloseEvent: false });
      const factory = factoryFor(config, harness, recordingBindings());
      const manager = new WorkerSessionManager({
        workerId: WORKER_ID,
        workflowId: WORKFLOW_ID,
        stores: taskStoreRegistry,
        // The store's provider rejects (no credential); cleanup then cannot be
        // proven because this context never announces its close.
        factory,
        clock: CLOCK,
      });
      manager.bindRunConfigFingerprint(FINGERPRINT);
      const previousUser = process.env.UCPATH_USER_ID;
      delete process.env.UCPATH_USER_ID;
      try {
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
      } finally {
        if (previousUser !== undefined) process.env.UCPATH_USER_ID = previousUser;
      }
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
      rmSync(rebuildRuntimeIsolation.browserProfileRoot, { recursive: true, force: true });
    });
  });
});
