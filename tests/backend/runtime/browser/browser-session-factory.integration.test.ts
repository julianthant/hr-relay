import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import { createBrowserSessionFactoryFixtures } from "../../../support/helpers/browser/session-factory-fixtures.js";
import { BrowserLoginError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { hostConfigFacts } from "../../../../src/models/config/host-display.js";

import assert from "node:assert/strict";
import { PNG } from "pngjs";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve as resolvePath } from "node:path";
import { runInNewContext } from "node:vm";
import type { Worker } from "playwright";
import { tsImport } from "tsx/esm/api";
import { beforeEach, describe,it } from "vitest";
import { resolveConfigWithProvenance } from "../../../../src/backend/app/config/resolve.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import {
assertDuoAutopilotReady,
BrowserProfileAdmissionSchema,
BrowserProfileStillClosingError,
browserSignInFingerprint,
DuoProvisioningError,
PlaywrightWorkerSessionFactory,
ProfileCustodyUnavailableError,
workerProfileDirectory,
probeClosedBrowserProfile,
type BrowserDeadlineScheduler
} from "../../../../src/backend/runtime/browser/browser-session-factory.js";

import type {
AuthenticatedApplicationEvidence, SystemLoginContext
} from "../../../../src/backend/systems/browser-shared/login-contract.js";
import type { Config } from "../../../../src/models/config/schema.js";

import { FingerprintSchema,WorkerIdSchema,WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { fixtureDuoCeremonyGate } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";

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

const { fakePage, verifierFor, fakeLauncher, recordingBindings, withTempRuntime, factoryFor } =
  createBrowserSessionFactoryFixtures(CLOCK, SESSION_ID, NEVER_SCHEDULER);

const WORKFLOW_ID = WorkflowIdSchema.parse("person-lookup");

const OPEN_INPUT_BASE = {
  workerId: WORKER_ID,
  workflowId: WORKFLOW_ID,
  system: "ucpath",
  instance: "prod",
  configFingerprint: FINGERPRINT,
  acceptDownloads: false,
  exclusive: false,
  signal: new AbortController().signal,
} as const;
let OPEN_INPUT: typeof OPEN_INPUT_BASE & { readonly duoCeremony: SystemLoginContext["duoCeremony"] };
beforeEach(() => {
  let ceremony: ReturnType<typeof fixtureDuoCeremonyGate> | undefined;
  OPEN_INPUT = { ...OPEN_INPUT_BASE, duoCeremony: {
    async withCeremony(run) {
      const gate = await (ceremony ??= fixtureDuoCeremonyGate("ucpath", WORKER_ID, CLOCK));
      return gate.withCeremony(run);
    },
  } };
});

describe("worker browser session factory", () => {
  it("probes native availability without profile reset, credential reads, provisioning or login", async () => {
    await withTempRuntime(async ({ config }) => {
      const native = fakeLauncher(); let profileAdmissions = 0, secretReads = 0, logins = 0;
      const binding = recordingBindings().ucpath; assert.ok(binding);
      const factory = new PlaywrightWorkerSessionFactory({ config, isolation: rebuildRuntimeIsolation, clock: CLOCK,
        scheduler: NEVER_SCHEDULER, slotOrdinal: () => 1, newSessionId: () => SESSION_ID,
        protectedSecrets: { read: () => { secretReads++; throw new Error("probe must not read credentials"); } },
        admitProfile: async input => { profileAdmissions++; return BrowserProfileAdmissionSchema.parse({ ...input, profileRevision: 1, resetRequired: true }); },
        bindings: { ucpath: { ...binding, login: async () => { logins++; throw new Error("probe must not log in"); } } }, launcher: native.launcher });
      await factory.probeProfile({ workerId: WORKER_ID, system: "ucpath", signal: new AbortController().signal });
      assert.equal(native.launches().length, 1); assert.equal(native.contextClosed(), true);
      assert.equal(profileAdmissions, 0); assert.equal(secretReads, 0); assert.equal(logins, 0);
      assert.equal(existsSync(workerProfileDirectory({ profileRoot: config.paths.browserProfileRoot, slotOrdinal: 1, system: "ucpath" })), true);
    });
  });
  it("refuses missing retained profile directories without launching or creating them", async () => {
    await withTempRuntime(async ({ config }) => {
      const native = fakeLauncher(), directory = workerProfileDirectory({profileRoot:config.paths.browserProfileRoot,slotOrdinal:1,system:"crm"});
      await assert.rejects(probeClosedBrowserProfile({profileRoot:config.paths.browserProfileRoot,
        launch:{profileDirectory:directory,extensionDirectory:config.paths.duoExtensionDir,downloadsPath:config.paths.downloadsDir,viewport:{width:800,height:600},timeoutMs:1000},
        clock:CLOCK,scheduler:NEVER_SCHEDULER,closeProofMs:1000,signal:new AbortController().signal,launcher:native.launcher}), ProfileCustodyUnavailableError);
      assert.equal(native.launches().length,0);assert.equal(existsSync(config.paths.browserProfileRoot),false);
    });
  });
  for (const closure of ["busy","missing-event","timeout"] as const) it(`refuses native ${closure} before an offline effect`, async () => {
    await withTempRuntime(async ({config})=>{
      const directory=workerProfileDirectory({profileRoot:config.paths.browserProfileRoot,slotOrdinal:1,system:"crm"});
      mkdirSync(directory,{recursive:true,mode:0o700});
      const native=fakeLauncher({emitCloseEvent:closure!=="missing-event",hangOnClose:closure==="timeout"});
      let effects=0;
      const operation=async()=>{
        await probeClosedBrowserProfile({profileRoot:config.paths.browserProfileRoot,
          launch:{profileDirectory:directory,extensionDirectory:config.paths.duoExtensionDir,downloadsPath:config.paths.downloadsDir,viewport:{width:800,height:600},timeoutMs:1000},
          clock:CLOCK,scheduler:IMMEDIATE_SCHEDULER,closeProofMs:1000,signal:new AbortController().signal,
          launcher:closure==="busy"?{launch:async()=>{throw new Error("Failed to create a ProcessSingleton for your profile directory.");}}:native.launcher});
        effects++;
      };
      await assert.rejects(operation(),closure==="busy"?BrowserProfileStillClosingError:AuthoritySourceClosureUnprovedError);
      assert.equal(effects,0);
      if(closure!=="busy") await assert.rejects(operation(),ProfileCustodyUnavailableError);
    });
  });
  it("maps Chromium profile-in-use refusal without reserving the queued run's next acquisition", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher(); let launches = 0;
      const factory = factoryFor(config, { ...harness, launcher: { launch: async input => {
        launches++;
        if (launches === 1) throw new Error("Failed to create a ProcessSingleton for your profile directory.");
        return harness.launcher.launch(input);
      } } }, recordingBindings());
      await assert.rejects(factory.open(OPEN_INPUT), BrowserProfileStillClosingError);
      const resource = await factory.open(OPEN_INPUT);
      assert.equal(launches, 2);
      await resource.close({ reason: "worker-stop" });
      assert.equal(harness.contextClosed(), true);
    });
  });
  it("refuses a second launch of the stable profile after an uncertain launcher rejection", async () => {
    await withTempRuntime(async ({config}) => {
      let launches = 0;
      const factory = factoryFor(config, {
        ...fakeLauncher(),
        launcher: {launch: () => { launches += 1; return Promise.reject(new Error("uncertain launch failure")); }},
      }, recordingBindings());
      await assert.rejects(factory.open(OPEN_INPUT), error => error instanceof AggregateError
        && error.cause instanceof Error && /uncertain launch failure/u.test(error.cause.message)
        && error.errors.includes(error.cause) && /closure is unproved/u.test(error.message));
      await assert.rejects(factory.open(OPEN_INPUT), ProfileCustodyUnavailableError);
      assert.equal(launches, 1);
    });
  });
  it("derives every profile segment from the isolation contract and an absolute root", () => {
    // Assert production path derivation as a string; never create or remove a real runtime profile root.
    const production = resolveConfigWithProvenance({}, hostConfigFacts({}), CLOCK).config.paths;
    assert.equal(production.browserProfileRoot, resolvePath(rebuildRuntimeIsolation.browserProfileRoot));
    assert.equal(production.duoCredential, resolvePath(".tracker/data/credentials/duo-webauthn.json"));

    const profileRoot = join(tmpdir(), "hrauto-profile-derivation");
    const directory = workerProfileDirectory({ profileRoot: profileRoot, slotOrdinal: 1, system: "ucpath" });
    assert.equal(
      directory,
      resolvePath(profileRoot, "w1", "ucpath"),
    );

    assert.doesNotMatch(directory, /\.auth\/|hrauto-legacy/u);


    assert.throws(
      () => workerProfileDirectory({ profileRoot: rebuildRuntimeIsolation.browserProfileRoot, slotOrdinal: 1, system: "ucpath" }),
      /path must be absolute/,
    );

    const distinct = new Set([
      directory,
      workerProfileDirectory({ profileRoot: profileRoot, slotOrdinal: 1, system: "crm" }),
      workerProfileDirectory({ profileRoot: profileRoot, slotOrdinal: 1, system: "ucpath" }),
      workerProfileDirectory({ profileRoot: profileRoot, slotOrdinal: 1, system: "ucpath" }),
      workerProfileDirectory({ profileRoot: profileRoot, slotOrdinal: 2, system: "ucpath" }),
    ]);
    assert.equal(distinct.size, 3, "only global slot and system partition the profile directory");
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
        workerProfileDirectory({ profileRoot: config.paths.browserProfileRoot, slotOrdinal: 1, system: "ucpath" }),
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

  it("captures only PNG bytes and their actual dimensions", async () => {
    await withTempRuntime(async ({ config }) => {
      const launcher = fakeLauncher();
      const count = async () => 0;
      const frames = [0, 1, 2].map(frameId => ({ ...launcher.page.mainFrame(), locator: (selector: string) => ({ selector, frameId, count }) }));
      launcher.page.frames = () => frames;
      let screenshotOptions: unknown;
      const originalScreenshot = launcher.page.screenshot;
      launcher.page.screenshot = async options => { screenshotOptions = options; return originalScreenshot(options); };
      const factory = factoryFor(config, launcher, recordingBindings());
      const resource = await factory.open(OPEN_INPUT);
      await resource.authentication.authenticate("ucpath", {});
      const screenshot = await resource.screenshot?.();
      assert.ok(screenshot?.state === "available");
      assert.deepEqual(Buffer.from(screenshot.bytes), PNG.sync.write(new PNG({ width: config.display.screenWidth + 24, height: config.display.screenHeight })));
      assert.deepEqual(screenshotOptions, { type: "png", clip: { x: 0, y: 0, width: config.display.screenWidth + 24, height: Math.min(config.display.screenHeight, 1200) }, mask: frames.map((_, frameId) => ({ selector: '[id="DERIVED_HCR_SM_SM_CHAR_INPUT$0"]', frameId, count })) });
      assert.deepEqual(
        { width: screenshot.width, height: screenshot.height },
        { width: config.display.screenWidth + 24, height: config.display.screenHeight },
      );
      await resource.close({ reason: "worker-stop" });
    });
  });

  it("captures a freshly verified authenticated page after navigation", async () => {
    await withTempRuntime(async ({ config }) => {
      const launcher = fakeLauncher();
      const verifier = verifierFor();
      const factory = factoryFor(config, launcher, recordingBindings({ verify: verifier.verify }));
      const resource = await factory.open(OPEN_INPUT);
      try {
        await resource.authentication.authenticate("ucpath", {});
        const url = "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/results";
        await launcher.page.goto(url);
        const screenshot = await resource.screenshot?.();
        assert.equal(screenshot?.state, "available");
        assert.ok(screenshot?.state === "available");
        assert.deepEqual(Buffer.from(screenshot.bytes), PNG.sync.write(new PNG({ width: config.display.screenWidth + 24, height: config.display.screenHeight })));
        assert.equal(screenshot.pageVersion, 2);
        assert.deepEqual(verifier.seen(), [url, url]);
      } finally { await resource.close({ reason: "worker-stop" }); }
    });
  });

  for (const refusal of ["authentication-unverified", "secret-controls-present", "page-changed", "verification-failed", "page-closed"] as const) {
    it(`refuses ${refusal} after navigation without exposing image bytes`, async () => {
      await withTempRuntime(async ({ config }) => {
        const launcher = fakeLauncher();
        const verifier = verifierFor({ authenticated: refusal !== "authentication-unverified" });
        let imageReads = 0;
        launcher.page.screenshot = async () => {
          imageReads += 1;
          await launcher.page.goto("https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/changed");
          return Buffer.from([137, 80, 78, 71]);
        };
        if (refusal === "secret-controls-present") launcher.page.locator = () => ({ count: async () => 1 });
        const factory = factoryFor(config, launcher, recordingBindings({
          verify: refusal === "verification-failed" ? async () => { throw new Error("private verifier detail"); } : verifier.verify,
        }));
        const resource = await factory.open(OPEN_INPUT);
        try {
          await resource.authentication.authenticate("ucpath", {});
          await launcher.page.goto("https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/results");
          if (refusal === "page-closed") launcher.page.closed = true;
          const screenshot = await resource.screenshot?.();
          assert.deepEqual(screenshot, {
            state: "unavailable", reason: refusal, pageVersion: 2,
            sessionId: SESSION_ID, observedAt: CLOCK.now().toISOString(),
          });
          assert.equal(imageReads, refusal === "page-changed" ? 1 : 0);
        } finally { await resource.close({ reason: "worker-stop" }); }
      });
    });
  }

  it("captures stable child frames while reporting navigation only for the main frame", async () => {
    await withTempRuntime(async ({ config }) => {
      const navigation: string[] = [];
      class NavigationFactory extends PlaywrightWorkerSessionFactory {
        constructor(options: ConstructorParameters<typeof PlaywrightWorkerSessionFactory>[0]) {
          super({ ...options, onNavigation: url => navigation.push(url) });
        }
      }
      const launcher = fakeLauncher();
      const child = {
        ...launcher.page.mainFrame(),
        url: () => "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/embedded",
        locator: (selector: string) => ({ selector, count: async () => 0 }),
      };
      const frames = [...launcher.page.frames(), child];
      launcher.page.frames = () => frames;
      const resource = await factoryFor(config, launcher, recordingBindings(), NEVER_SCHEDULER,
        protectedSecretSource({ ucpathUserId: "fixture-user", ucpathPassword: "fixture-value" }), NavigationFactory).open(OPEN_INPUT);
      try {
        await resource.authentication.authenticate("ucpath", {});
        launcher.page.emitFrameEvent("frameattached", child);
        launcher.page.emitFrameEvent("framenavigated", child);
        assert.deepEqual(navigation, []);
        const url = "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/results";
        await launcher.page.goto(url);
        assert.deepEqual(navigation, [url]);
        const screenshot = await resource.screenshot?.();
        assert.ok(screenshot?.state === "available");
        assert.equal(screenshot.pageVersion, 4);
        assert.deepEqual(Buffer.from(screenshot.bytes), PNG.sync.write(new PNG({ width: config.display.screenWidth + 24, height: config.display.screenHeight })));
      } finally { await resource.close({ reason: "worker-stop" }); }
    });
  });

  for (const phase of ["before", "after"] as const) {
    for (const control of ['input[type="password"]', 'input[autocomplete="one-time-code"]']) {
      it(`refuses a child-frame ${control} ${phase} capture without returning bytes`, async () => {
        await withTempRuntime(async ({ config }) => {
          const launcher = fakeLauncher();
          let present = phase === "before";
          let imageReads = 0;
          const child = {
            ...launcher.page.mainFrame(),
            url: () => "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/embedded",
            locator: (selector: string) => ({ selector, count: async () => present && selector.includes(control) ? 1 : 0 }),
          };
          const frames = [...launcher.page.frames(), child];
          launcher.page.frames = () => frames;
          launcher.page.screenshot = async () => { imageReads += 1; present = true; return Buffer.from([137, 80, 78, 71]); };
          const resource = await factoryFor(config, launcher, recordingBindings()).open(OPEN_INPUT);
          try {
            await resource.authentication.authenticate("ucpath", {});
            assert.deepEqual(await resource.screenshot?.(), {
              state: "unavailable", reason: "secret-controls-present", pageVersion: 1,
              sessionId: SESSION_ID, observedAt: CLOCK.now().toISOString(),
            });
            assert.equal(imageReads, phase === "before" ? 0 : 1);
          } finally { await resource.close({ reason: "worker-stop" }); }
        });
      });
    }
  }

  for (const event of ["framenavigated", "frameattached", "framedetached"] as const) {
    it(`refuses child-frame ${event} during capture without returning bytes`, async () => {
      await withTempRuntime(async ({ config }) => {
        const launcher = fakeLauncher();
        const child = {
          ...launcher.page.mainFrame(),
          url: () => "https://ucphrprdpub.universityofcalifornia.edu/psc/ucphrprd/embedded",
          locator: (selector: string) => ({ selector, count: async () => 0 }),
        };
        const mainFrames = launcher.page.frames();
        let frames = event === "frameattached" ? mainFrames : [...mainFrames, child];
        launcher.page.frames = () => frames;
        let imageReads = 0;
        launcher.page.screenshot = async () => {
          imageReads += 1;
          frames = event === "framedetached" ? mainFrames : [...mainFrames, child];
          launcher.page.emitFrameEvent(event, child);
          return Buffer.from([137, 80, 78, 71]);
        };
        const resource = await factoryFor(config, launcher, recordingBindings()).open(OPEN_INPUT);
        try {
          await resource.authentication.authenticate("ucpath", {});
          assert.deepEqual(await resource.screenshot?.(), {
            state: "unavailable", reason: "page-changed", pageVersion: 1,
            sessionId: SESSION_ID, observedAt: CLOCK.now().toISOString(),
          });
          assert.equal(imageReads, 1);
        } finally { await resource.close({ reason: "worker-stop" }); }
      });
    });
  }

  it("launches the run's headed presentation in its own profile partition", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher();
      const factory = factoryFor(config, harness, recordingBindings());
      const resource = await factory.open({ ...OPEN_INPUT, browserMode: "headed" });
      const launch = harness.launches()[0];
      assert.ok(launch);
      assert.equal(launch.headless, false);
      assert.match(String(launch.profileDirectory), /w1\/ucpath$/u);
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
        () => { assertDuoAutopilotReady({ ...missingExtension, features: { ...config.features, duoWebAuthn: true } }); },
        /Duo Autopilot extension is not loadable/,
      );

      const missingCredential: Config = {
        ...config,
        paths: { ...config.paths, duoCredential: join(root, "absent.json") },
      };
      assert.throws(
        () => { assertDuoAutopilotReady({ ...missingCredential, features: { ...config.features, duoWebAuthn: true } }); },
        /duoWebauthnCredential is unavailable/,
      );

      const loosePermissions = join(root, "loose.json");
      writeFileSync(loosePermissions, "{}\n");
      chmodSync(loosePermissions, 0o644);
      assert.throws(
        () => {
          assertDuoAutopilotReady({
            ...config, features: { ...config.features, duoWebAuthn: true },
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
        slotOrdinal: () => 1,
    newSessionId: () => SESSION_ID,
    admitProfile: input => Promise.resolve(BrowserProfileAdmissionSchema.parse({ ...input, profileRevision: 7, resetRequired: false })),
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
      await resource.close({ reason: "worker-stop" });

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
          assert.ok(error instanceof BrowserLoginError);
          assert.equal(error.code, "UCPATH_SIGN_IN_FAILED");
          assert.equal(error.message, "UCPath sign-in failed.");
          assert.match(error.detail, /the neutral reset did not land on the authenticated application/);
          assert.match(error.detail, /PeopleSoft signon form is still present/);
          return true;
        },
      );
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
      const stuckResource = await factoryFor({ ...config, paths: { ...config.paths, browserProfileRoot: `${config.paths.browserProfileRoot}-stuck` } }, stuck, recordingBindings()).open(OPEN_INPUT);
      await assert.rejects(
        stuckResource.close({ reason: "worker-stop" }),
        /injected page close failure/,
      );

      // A close that hangs must hit its bounded proof deadline, not wait forever.
      const hanging = fakeLauncher({ hangOnClose: true });
      const hangingResource = await factoryFor(
        { ...config, paths: { ...config.paths, browserProfileRoot: `${config.paths.browserProfileRoot}-hanging` } },
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
});


describe("required profile custody admission", () => {
  it("names missing extension provisioning and proves its launched context closed", async () => {
    await withTempRuntime(async ({ config }) => {
      writeFileSync(config.paths.duoCredential, JSON.stringify({ rpId: "duosecurity.com", credentialId: "fixture-public-id", privateKey: "fixture-private-key", signCount: 0, transport: "internal" }));
      const harness = fakeLauncher();
      const factory = factoryFor({ ...config, features: { ...config.features, duoWebAuthn: true } }, harness, recordingBindings());
      await assert.rejects(factory.open(OPEN_INPUT), error => error instanceof DuoProvisioningError && error.code === "duo-extension-provisioning-unavailable");
      assert.equal(harness.contextClosed(), true);
    });
  });
  it("provisions only trusted session storage and verifies the injected credential", async () => {
    await withTempRuntime(async ({ config }) => {
      const credential = { rpId: "duosecurity.com", credentialId: "fixture-public-id", privateKey: "fixture-private-key", signCount: 0, transport: "internal" };
      writeFileSync(config.paths.duoCredential, JSON.stringify(credential));
      const calls: string[] = [];
      let stored: unknown;
      const serviceWorker = { url: () => `chrome-extension://${"a".repeat(32)}/src/background.js`,
        evaluate: async (operation: (credentials: unknown) => Promise<void>, credentials: unknown) => {
          const previous: unknown = Reflect.get(globalThis, "chrome");
          Reflect.set(globalThis, "chrome", { storage: { local: { get: () => { calls.push("local:get"); return {}; } }, session: {
            setAccessLevel: (value: unknown) => { assert.deepEqual(value, { accessLevel: "TRUSTED_CONTEXTS" }); calls.push("session:access"); },
            set: (value: unknown) => { stored = value; calls.push("session:set"); }, get: () => stored,
          } } });
          try { await operation(credentials); } finally { if (previous === undefined) Reflect.deleteProperty(globalThis, "chrome"); else Reflect.set(globalThis, "chrome", previous); }
        },
      } as unknown as Worker;
      const harness = fakeLauncher({ serviceWorker });
      const resource = await factoryFor({ ...config, features: { ...config.features, duoWebAuthn: true } }, harness, recordingBindings()).open(OPEN_INPUT);
      try {
        assert.deepEqual(calls, ["local:get", "session:access", "session:set"]);
        assert.deepEqual(stored, { duoCredentials: [credential] });
      } finally { await resource.close({ reason: "worker-stop" }); }
    });
  });
  it("provisions Duo from the runtime-compiled source in an isolated scope whose storage sorts keys", async () => {
    await withTempRuntime(async ({ config }) => {
      const credential = { rpId: "duosecurity.com", credentialId: "fixture-public-id", privateKey: "fixture-private-key", signCount: 0, transport: "internal" };
      writeFileSync(config.paths.duoCredential, JSON.stringify(credential));
      const runtime = await tsImport("../../../../src/backend/runtime/browser/browser-session-factory.ts", import.meta.url) as
        typeof import("../../../../src/backend/runtime/browser/browser-session-factory.js");
      let stored: unknown;
      const sortedKeys = (value: object) => Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
      const chrome = { storage: { local: { get: () => ({}) },
        session: { setAccessLevel: () => undefined, set: (value: unknown) => { stored = value; },
          get: () => ({ duoCredentials: (stored as { duoCredentials: object[] }).duoCredentials.map(sortedKeys) }) } } };
      const serviceWorker = { url: () => `chrome-extension://${"a".repeat(32)}/src/background.js`,
        evaluate: (operation: (credentials: unknown) => Promise<void>, credentials: unknown) =>
          runInNewContext(`(${operation.toString()})(credentials)`, { chrome, credentials }) as Promise<void>,
      } as unknown as Worker;
      const duoConfig = { ...config, features: { ...config.features, duoWebAuthn: true } };
      const resource = await factoryFor(duoConfig, fakeLauncher({ serviceWorker }), recordingBindings(), NEVER_SCHEDULER, undefined,
        runtime.PlaywrightWorkerSessionFactory).open(OPEN_INPUT);
      try {
        assert.equal(JSON.stringify(stored), JSON.stringify({ duoCredentials: [credential] }));
      } finally { await resource.close({ reason: "worker-stop" }); }
    });
  });
  it("separates sign-in identity from viewport, presentation and private values", async () => {
    await withTempRuntime(({ config }) => {
      const source = protectedSecretSource({ ucpathUserId: "fixture-user", ucpathPassword: "fixture-password" });
      const fingerprint = browserSignInFingerprint(config, source, "ucpath", "prod");
      assert.equal(browserSignInFingerprint({ ...config, display: { ...config.display, screenWidth: config.display.screenWidth + 1 },
        browser: { ...config.browser, headless: !config.browser.headless } }, source, "ucpath", "prod"), fingerprint);
      assert.equal(browserSignInFingerprint(config, protectedSecretSource({ ucpathUserId: "other-fixture-user", ucpathPassword: "other-fixture-password" }), "ucpath", "prod"), fingerprint);
      assert.notEqual(browserSignInFingerprint(config, protectedSecretSource({}), "ucpath", "prod"), fingerprint);
    });
  });
  it("performs zero DOM and image reads while unauthenticated, then refuses fresh secret controls", async () => {
    await withTempRuntime(async ({ config }) => {
      const page = fakePage();
      let domReads = 0, imageReads = 0;
      page.locator = () => ({ count: async () => { domReads += 1; return 1; } });
      page.screenshot = async () => { imageReads += 1; return Buffer.from([]); };
      const harness = fakeLauncher({ page });
      let authenticated = false;
      const factory = factoryFor(config, harness, recordingBindings({
        onLogin: () => { authenticated = true; },
        verify: async context => verifierFor({ authenticated }).verify(context),
      }));
      const resource = await factory.open(OPEN_INPUT);
      try {
        assert.equal((await resource.screenshot?.())?.state, "unavailable");
        assert.equal(domReads, 0);
        assert.equal(imageReads, 0);
        await resource.authentication.authenticate("ucpath", { signal: OPEN_INPUT.signal });
        const screenshot = await resource.screenshot?.();
        assert.equal(screenshot?.state, "unavailable");
        if (screenshot?.state === "unavailable") assert.equal(screenshot.reason, "secret-controls-present");
        assert.equal(domReads, 1);
        assert.equal(imageReads, 0);
      } finally { await resource.close({ reason: "worker-stop" }); }
    });
  });
  it("refuses an unavailable owner before profile creation, launch and secret access", async () => {
    await withTempRuntime(async ({ config }) => {
      const harness = fakeLauncher({ page: fakePage() });
      let launches = 0;
      const factory = new PlaywrightWorkerSessionFactory({ config, isolation: rebuildRuntimeIsolation, clock: CLOCK,
        scheduler: NEVER_SCHEDULER, slotOrdinal: () => 1, newSessionId: () => SESSION_ID,
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
        scheduler: NEVER_SCHEDULER, slotOrdinal: () => 1, newSessionId: () => SESSION_ID,
        protectedSecrets: protectedSecretSource({}), bindings: recordingBindings(),
        admitProfile: input => Promise.resolve(BrowserProfileAdmissionSchema.parse({ ...input, configFingerprint: OTHER_FINGERPRINT, profileRevision: 7, resetRequired: false })),
        launcher: { launch: input => { launches += 1; return harness.launcher.launch(input); } },
      });
      await assert.rejects(factory.open(OPEN_INPUT), ProfileCustodyUnavailableError);
      assert.equal(launches, 0);
      assert.equal(existsSync(config.paths.browserProfileRoot), false);
    });
  });
});
