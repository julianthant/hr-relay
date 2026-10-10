import { hostConfigFacts } from "../../../../../../src/models/config/host-display.js";

import { fixtureDuoCeremonyGate, fixtureDuoCeremonyGates } from "../../../../../support/helpers/duo-ceremony-fixtures.js";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve as resolvePath } from "node:path";
import { describe, it } from "vitest";
import type { BrowserContext } from "playwright";
import {
  BrowserProfileAdmissionSchema,
  ProfileCustodyUnavailableError,
  PlaywrightWorkerSessionFactory,
  assertDuoAutopilotReady,
  workerProfileDirectory,
  type BrowserDeadlineScheduler,
  type PersistentContextLauncher,
} from "../../../../../../src/backend/runtime/browser/browser-session-factory.js";
import { rebuildRuntimeIsolation } from "../../../../../../src/backend/app/config/runtime-isolation.js";
import { manualClock } from "../../../../../../src/rules/time/clock.js";
import { resolveConfigWithProvenance } from "../../../../../../src/backend/app/config/resolve.js";
import type { Config } from "../../../../../../src/models/config/schema.js";
import { FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../../../src/rules/identity/ids.js";
import { WorkerSessionManager } from "../../../../../../src/backend/runtime/workers/worker-sessions.js";
import { taskStoreRegistry } from "../../../../../../src/backend/app/registries/task-registry.js";
import { FIXTURE_SESSION_ACQUIRE_MS, ManualScheduler } from "../../../../../support/helpers/phase1f-executor-harness.js";
import type { BrowserSystemBindings } from "../../../../../../src/backend/runtime/browser/system-bindings.js";
import type {
  AuthenticatedApplicationEvidence,
  AuthenticatedApplicationVerifier,
  AuthenticationProbe,
  AuthenticationVerificationContext,
} from "../../../../../../src/backend/systems/browser-shared/login-contract.js";
import type { ProtectedSecretSource } from "../../../../../../src/models/config/secrets.js";
import { protectedSecretSource } from "../../../../../support/helpers/protected-secret-source.js";

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
  screenshot: (options: Readonly<{ type: "png" }>) => Promise<Buffer>;
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
): PlaywrightWorkerSessionFactory {
  return new PlaywrightWorkerSessionFactory({
    config,
    protectedSecrets,
    isolation: rebuildRuntimeIsolation,
    clock: CLOCK,
    scheduler,
    newSessionId: () => SESSION_ID,
    admitProfile: input => Promise.resolve(BrowserProfileAdmissionSchema.parse({ ...input, profileRevision: 7 })),
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
  duoCeremony: fixtureDuoCeremonyGate("ucpath", WORKER_ID, CLOCK),
} as const;

describe("worker browser session factory", () => {
  it("derives every profile segment from the isolation contract and an absolute root", () => {
    // Assert production path derivation as a string; never create or remove a real runtime profile root.
    const production = resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config.paths;
    assert.equal(production.browserProfileRoot, resolvePath(rebuildRuntimeIsolation.browserProfileRoot));
    assert.equal(production.duoCredential, join(production.browserProfileRoot, "duo-webauthn.json"));

    const profileRoot = join(tmpdir(), "hrauto-profile-derivation");
    const directory = workerProfileDirectory({
      profileRoot,
      isolation: rebuildRuntimeIsolation,
      workerId: WORKER_ID,
      system: "ucpath",
      instance: "prod",
      configFingerprint: FINGERPRINT,
    });
    assert.equal(
      directory,
      resolvePath(
        profileRoot,
        rebuildRuntimeIsolation.browserSessionNamespace,
        WORKER_ID,
        `ucpath-prod-${FINGERPRINT.slice(0, 12)}-headless`,
      ),
    );

    assert.doesNotMatch(directory, /\.auth\/|hrauto-legacy/u);


    assert.throws(
      () => workerProfileDirectory({
        profileRoot: rebuildRuntimeIsolation.browserProfileRoot,
        isolation: rebuildRuntimeIsolation,
        workerId: WORKER_ID,
        system: "ucpath",
        instance: "prod",
        configFingerprint: FINGERPRINT,
      }),
      /path must be absolute/,
    );

    const distinct = new Set([
      directory,
      workerProfileDirectory({ profileRoot, isolation: rebuildRuntimeIsolation, workerId: WORKER_ID, system: "crm", instance: "prod", configFingerprint: FINGERPRINT }),
      workerProfileDirectory({ profileRoot, isolation: rebuildRuntimeIsolation, workerId: WORKER_ID, system: "ucpath", instance: "test", configFingerprint: FINGERPRINT }),
      workerProfileDirectory({ profileRoot, isolation: rebuildRuntimeIsolation, workerId: WORKER_ID, system: "ucpath", instance: "prod", configFingerprint: OTHER_FINGERPRINT }),
      workerProfileDirectory({ profileRoot, isolation: rebuildRuntimeIsolation, workerId: WorkerIdSchema.parse("person-lookup-worker-2"), system: "ucpath", instance: "prod", configFingerprint: FINGERPRINT }),
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
          profileRoot: config.paths.browserProfileRoot,
          isolation: rebuildRuntimeIsolation,
          workerId: WORKER_ID,
          system: "ucpath",
          instance: "prod",
          configFingerprint: FINGERPRINT,
        }),
      );
      // The launch really created a profile directory — under the bound temp
      // root, never the operator's credential home.
      assert.ok(typeof launch.profileDirectory === "string");
      assert.equal(existsSync(launch.profileDirectory), true);
      assert.equal(launch.profileDirectory.startsWith(`${config.paths.browserProfileRoot}/`), true);
      assert.equal(resource.configFingerprint, FINGERPRINT);
      assert.equal(resource.system, "ucpath");
      await resource.close({ reason: "worker-stop" });
    });
  });

  it("captures only PNG bytes and the configured viewport dimensions", async () => {
    await withTempRuntime(async ({ config }) => {
      const factory = factoryFor(config, fakeLauncher(), recordingBindings());
      const resource = await factory.open(OPEN_INPUT);
      const screenshot = await resource.screenshot?.();
      assert.ok(screenshot);
      assert.deepEqual([...screenshot.bytes], [137, 80, 78, 71]);
      assert.deepEqual(
        { width: screenshot.width, height: screenshot.height },
        { width: config.display.screenWidth, height: config.display.screenHeight },
      );
      await resource.close({ reason: "worker-stop" });
    });
  });

  it("launches the run's headed presentation in its own profile partition", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher();
      const factory = factoryFor(config, harness, recordingBindings());
      const resource = await factory.open({ ...OPEN_INPUT, browserMode: "headed" });
      const launch = harness.launches()[0];
      assert.ok(launch);
      assert.equal(launch.headless, false);
      assert.match(String(launch.profileDirectory), /ucpath-prod-[a-f0-9]{12}-headed$/u);
      assert.equal((resource as { browserMode?: unknown }).browserMode, "headed");
      await resource.close({ reason: "worker-stop" });
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
        paths: { ...config.paths, duoCredential: join(root, "absent.json") },
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
            paths: { ...config.paths, duoCredential: loosePermissions },
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
      assert.equal(await resource.authentication.authenticate("ucpath", {}), "logged-in");
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
    });
  });

  it("reads rotated credentials on the next authentication of an existing session", async () => {
    await withTempRuntime(async ({ config }) => {
      let current = protectedSecretSource({ ucpathUserId: "first-user", ucpathPassword: "first-password" });
      const seen: Readonly<{ userId: string; password: string }>[] = [];
      const factory = factoryFor(config, fakeLauncher(), recordingBindings({
        onLogin: ({ credentials }) => seen.push(credentials),
      }), NEVER_SCHEDULER, { read: () => current.read() });
      const resource = await factory.open(OPEN_INPUT);
      await resource.authentication.authenticate("ucpath", {});
      current = protectedSecretSource({ ucpathUserId: "second-user", ucpathPassword: "second-password" });
      await resource.authentication.authenticate("ucpath", {});
      assert.deepEqual(seen, [
        { userId: "first-user", password: "first-password" },
        { userId: "second-user", password: "second-password" },
      ]);
      await resource.close({ reason: "worker-stop" });
    });
  });

  it("fails loud when a secret is missing rather than logging in blank", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher();
      const factory = factoryFor(
        config,
        harness,
        recordingBindings(),
        NEVER_SCHEDULER,
        protectedSecretSource(),
      );
      const resource = await factory.open(OPEN_INPUT);
      await assert.rejects(
        resource.authentication.authenticate("ucpath", {}),
        (error: unknown) => error instanceof Error
          && /ucpathUserId is missing from registered source protected-store/.test(error.message),
      );
      await resource.close({ reason: "login-failed" });
    });
  });

  it("runs the system's full authentication proof on the neutral reset", async () => {
    await withTempRuntime(async ({ config }) => {
      const page = fakePage();
      const harness = fakeLauncher({ page });
      const verifier = verifierFor();
      const evidence: AuthenticatedApplicationEvidence[] = [];
      const factory = new PlaywrightWorkerSessionFactory({
        config,
        protectedSecrets: protectedSecretSource({ ucpathUserId: "fixture-user", ucpathPassword: "fixture-value" }),
        isolation: rebuildRuntimeIsolation,
        clock: CLOCK,
        scheduler: NEVER_SCHEDULER,
        newSessionId: () => SESSION_ID,
    admitProfile: input => Promise.resolve(BrowserProfileAdmissionSchema.parse({ ...input, profileRevision: 7 })),
        bindings: recordingBindings({ verify: verifier.verify }),
        launcher: harness.launcher,
        onAuthenticationEvidence: (observed) => evidence.push(observed),
      });
      const resource = await factory.open(OPEN_INPUT);
      await resource.reset({ signal: new AbortController().signal });
      assert.deepEqual(page.gotoUrls, [config.urls.ucpath.prod.smartHr]);
      // The proof ran against the page AFTER the entry navigation, and what it
      // observed is surfaced rather than assumed.
      assert.deepEqual(verifier.seen(), [config.urls.ucpath.prod.smartHr]);
      assert.equal(evidence.length, 1);
      assert.equal(evidence[0]?.positive, "fake PS_TOKEN session cookie");

      // A PeopleSoft signon page passes a URL predicate and must NOT pass here.
      const droppedPage = fakePage();
      const droppedHarness = fakeLauncher({ page: droppedPage });
      const droppedFactory = factoryFor(
        config,
        droppedHarness,
        recordingBindings({
          verify: verifierFor({
            authenticated: false,
            reason: "the PeopleSoft signon form is still present on the page",
          }).verify,
        }),
      );
      const dropped = await droppedFactory.open(OPEN_INPUT);
      await assert.rejects(
        dropped.reset({ signal: new AbortController().signal }),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.match(error.message, /the neutral reset did not land on the authenticated application/);
          assert.match(error.message, /PeopleSoft signon form is still present/);
          return true;
        },
      );
      await resource.close({ reason: "worker-stop" });
      await dropped.close({ reason: "poisoned" });
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
    });
  });

  it("refuses a system with no landed binding and an exclusive lease it cannot honor", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher();
      const factory = factoryFor(
        config,
        harness,
        recordingBindings(),
        NEVER_SCHEDULER,
        protectedSecretSource(),
      );
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


describe("required profile custody admission", () => {
  it("refuses an unavailable owner before profile creation, launch and secret access", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher({ page: fakePage() });
      let launches = 0;
      const factory = new PlaywrightWorkerSessionFactory({ config, isolation: rebuildRuntimeIsolation, clock: CLOCK,
        scheduler: NEVER_SCHEDULER, newSessionId: () => SESSION_ID,
        protectedSecrets: protectedSecretSource({}), bindings: recordingBindings(),
        admitProfile: () => Promise.reject(new ProfileCustodyUnavailableError()),
        launcher: { launch: input => { launches += 1; return harness.launcher.launch(input); } },
      });
      await assert.rejects(factory.open(OPEN_INPUT), ProfileCustodyUnavailableError);
      assert.equal(launches, 0);
      assert.equal(existsSync(config.paths.browserProfileRoot), false);
    });
  });
  it("refuses a revision admitted for a different profile identity before launch", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher({ page: fakePage() });
      let launches = 0;
      const factory = new PlaywrightWorkerSessionFactory({ config, isolation: rebuildRuntimeIsolation, clock: CLOCK,
        scheduler: NEVER_SCHEDULER, newSessionId: () => SESSION_ID,
        protectedSecrets: protectedSecretSource({}), bindings: recordingBindings(),
        admitProfile: input => Promise.resolve(BrowserProfileAdmissionSchema.parse({ ...input, configFingerprint: OTHER_FINGERPRINT, profileRevision: 7 })),
        launcher: { launch: input => { launches += 1; return harness.launcher.launch(input); } },
      });
      await assert.rejects(factory.open(OPEN_INPUT), ProfileCustodyUnavailableError);
      assert.equal(launches, 0);
      assert.equal(existsSync(config.paths.browserProfileRoot), false);
    });
  });
});
