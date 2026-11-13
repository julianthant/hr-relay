import { mockBrowserRootPort } from "../../../support/helpers/browser/browser-roots.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright";
import { describe, it } from "vitest";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { BrowserProfileAdmissionSchema, PlaywrightWorkerSessionFactory, ProfileCustodyUnavailableError, workerProfileDirectory, DuoProvisioningError, assertFastDuoReady, type BrowserSessionFactoryOptions } from "../../../../src/backend/runtime/browser/browser-session-factory.js";
import { captureFullPage } from "../../../../src/backend/runtime/browser/full-page-capture.js";
import { AuthoritySourceClosureUnprovedError } from "../../../../src/backend/storage/source-closure.js";
import { FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBrowserSessionFactoryFixtures } from "../../../support/helpers/browser/session-factory-fixtures.js";
import { fixtureDuoSigningSource, fixtureWorkflowWorker } from "../../../support/helpers/browser/duo-signing.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";
import { BrowserSessionClosureUnprovedError } from "../../../../src/workflow-kit/session.js";
import { BrowserLoginError } from "../../../../src/backend/systems/browser-shared/login-contract.js";
import { createDebugEventWriter } from "../../../../src/backend/logs/debug-events.js";
import { debugTimelineFixture } from "../../../support/helpers/backend/debug-timeline-fixture.js";

describe("browser current-owner fence", () => {
  const clock = manualClock(new Date("2026-11-01T12:00:00Z"));
  const sessionId = "00000000-0000-4000-8000-000000000001";
  const scheduler = { schedule: () => ({ cancel() {} }) };
  const fixtures = createBrowserSessionFactoryFixtures(clock, sessionId, scheduler);
  const workerId = WorkerIdSchema.parse("person-lookup-worker-1");
  const input = { workerId, workflowId: WorkflowIdSchema.parse("person-lookup"), system: "ucpath", instance: "prod",
    configFingerprint: FingerprintSchema.parse("ab".repeat(32)), acceptDownloads: false, exclusive: false,
    signal: new AbortController().signal, duoCeremony: { withCeremony: async () => { throw new Error("fixture must not start a Duo ceremony"); } } } as const;

  function options(config: BrowserSessionFactoryOptions["config"], native: ReturnType<typeof fixtures.fakeLauncher>, assertCurrent: () => void): BrowserSessionFactoryOptions {
    return { ...mockBrowserRootPort(), config: { ...config, paths: { ...config.paths, browserProfileRoot: config.paths.browserProfileRoot } }, isolation: rebuildRuntimeIsolation, clock, scheduler, newSessionId: () => sessionId,
      protectedSecrets: protectedSecretSource({ ucpathUserId: "fixture-user", ucpathPassword: "fixture-password" }),
      slotOrdinal: () => 1, assertCurrent, bindings: fixtures.recordingBindings(), launcher: native.launcher,
      admitProfile: profile => Promise.resolve(BrowserProfileAdmissionSchema.parse({ ...profile, profileRevision: 1, resetRequired: false })) };
  }

  function epoch() {
    let current = true;
    return { revoke: () => { current = false; }, assertCurrent: () => { if (!current) throw new ProfileCustodyUnavailableError(); } };
  }

  it("retains value-free screenshot verification causes while refusing the capture", async () => {
    await fixtures.withTempRuntime(async ({ config }) => {
      const native = fixtures.fakeLauncher(), owner = epoch();
      const cause = new TypeError("Quillan, Petra; fictional private page");
      cause.stack = "TypeError: fictional private page\n    at verify (/private/project/src/backend/systems/crm/session.ts:42:7)";
      const debug: unknown[] = [];
      const factory = new PlaywrightWorkerSessionFactory({ ...options(config, native, owner.assertCurrent),
        bindings: fixtures.recordingBindings({ verify: async () => { throw cause; } }),
        onDebug: (_worker, event) => { if (event.reason === "capture-cause") debug.push(event); } });
      const resource = await factory.open(input);
      try {
        const capture = await resource.screenshot!();
        assert.equal(capture.state, "unavailable");
        if (capture.state === "unavailable") assert.equal(capture.reason, "verification-failed");
        assert.deepEqual(debug, [{ phase: "failed", correlationId: sessionId, reason: "capture-cause", code: "INTERNAL_FAILURE",
          message: "TypeError", stack: "TypeError\n    at src/backend/systems/crm/session.ts:42:7" }]);
        assert.equal(/Quillan|Petra|private|fictional/u.test(JSON.stringify(debug)), false);
      } finally { await resource.close({ reason: "worker-stop" }); }
    });
  });

  it("names the failed Playwright call and page error class on the capture cause from fixed names only", async () => {
    for (const [message, area] of [
      ["frame.evaluate: ReferenceError: __name is not defined", "frame-evaluate-referenceerror"],
      ["frame.evaluate: QuillanPrivateError: synthetic private text", "frame-evaluate-page-error"],
      ["quillanPrivate.petraCall: TypeError: synthetic private text", "unknown-call-typeerror"],
      ["frame.evaluate: Execution context was destroyed by Quillan", "frame-evaluate"],
    ] as const) {
      await fixtures.withTempRuntime(async ({ config }) => {
        const native = fixtures.fakeLauncher(), owner = epoch();
        const { records, repository } = debugTimelineFixture();
        const mirrored: string[] = [];
        const writer = createDebugEventWriter({ repository, clock, build: "test", development: true, writeStderr: line => { mirrored.push(line); } });
        const factory = new PlaywrightWorkerSessionFactory({ ...options(config, native, owner.assertCurrent),
          bindings: fixtures.recordingBindings({ verify: async () => { throw new Error(message); } }),
          onDebug: (debugWorkerId, event) => { writer.emit({ category: "session", ...event }, { kind: "worker", workerId: debugWorkerId }); } });
        const resource = await factory.open(input);
        try {
          const capture = await resource.screenshot!();
          assert.equal(capture.state === "unavailable" ? capture.reason : capture.state, "verification-failed");
          const causes = records.flatMap(record => record.payload.kind === "debug" && record.payload.event.reason === "capture-cause" ? [record.payload.event] : []);
          assert.deepEqual(causes.map(event => event.area), [area], message);
          assert.equal(mirrored.some(line => line.includes(`"area":"${area}"`)), true, message);
          assert.equal(/quillan|petra|private/iu.test(JSON.stringify(records) + mirrored.join("")), false, message);
        } finally { await resource.close({ reason: "worker-stop" }); }
      });
    }
  });

  it("names a failed neutral reset apart from a failed sign-in", async () => {
    await fixtures.withTempRuntime(async ({ config }) => {
      const native = fixtures.fakeLauncher(), owner = epoch();
      const debug: Array<{ phase: string; code?: string }> = [];
      const factory = new PlaywrightWorkerSessionFactory({ ...options(config, native, owner.assertCurrent),
        bindings: fixtures.recordingBindings({ verify: fixtures.verifierFor({ authenticated: false, reason: "the launch page is not the application" }).verify }),
        onDebug: (_worker, event) => { debug.push(event); } });
      const resource = await factory.open(input);
      try {
        await assert.rejects(resource.reset({ signal: new AbortController().signal }), BrowserLoginError);
        assert.deepEqual(debug.filter(event => event.phase === "failed").map(event => event.code), ["session-reset-failed"]);
      } finally { await resource.close({ reason: "poisoned" }); }
    });
  });

  it("refuses launch when ownership expires while profile admission resolves", async () => {
    await fixtures.withTempRuntime(async ({ config }) => {
      const owner = epoch(), native = fixtures.fakeLauncher();
      const base = options(config, native, owner.assertCurrent);
      const factory = new PlaywrightWorkerSessionFactory({ ...base, admitProfile: async profile => {
        const admitted = await base.admitProfile(profile); owner.revoke(); return admitted;
      } });
      await assert.rejects(factory.open(input), ProfileCustodyUnavailableError);
      assert.equal(native.launches().length, 0);
      assert.equal(existsSync(config.paths.browserProfileRoot), false);
    });
  });

  it("proves reset-probe closure after revocation but preserves the profile and refuses replacement launch", async () => {
    await fixtures.withTempRuntime(async ({ config }) => {
      const owner = epoch(), native = fixtures.fakeLauncher();
      const profile = workerProfileDirectory({ profileRoot: config.paths.browserProfileRoot, slotOrdinal: 1, system: "ucpath" });
      const base = options(config, native, owner.assertCurrent);
      const factory = new PlaywrightWorkerSessionFactory({ ...base,
        admitProfile: async identity => ({ ...await base.admitProfile(identity), resetRequired: true }),
        launcher: { launch: async launch => {
          const context = await native.launcher.launch(launch);
          writeFileSync(join(profile, "retained"), "preserve");
          const close = context.close.bind(context);
          context.close = async closeInput => { await close(closeInput); owner.revoke(); };
          return context;
        } },
      });
      await assert.rejects(factory.open(input), ProfileCustodyUnavailableError);
      assert.equal(native.contextClosed(), true);
      assert.equal(native.page.closed, true);
      assert.equal(native.launches().length, 1);
      assert.equal(existsSync(join(profile, "retained")), true);
    });
  });

  it("refuses stale resource callbacks while retaining actual close and disposal", async () => {
    await fixtures.withTempRuntime(async ({ config }) => {
      const owner = epoch(), native = fixtures.fakeLauncher();
      const debug: string[] = [], navigations: string[] = [];
      const factory = new PlaywrightWorkerSessionFactory({ ...options(config, native, owner.assertCurrent),
        onDebug: (_worker, event) => debug.push(event.phase), onNavigation: url => navigations.push(url) });
      const resource = await factory.open(input);
      resource.beginDiagnostics?.();
      owner.revoke();
      assert.doesNotThrow(() => native.page.emitFrameEvent("framenavigated", native.page.mainFrame()));
      assert.doesNotThrow(() => native.page.emitFrameEvent("frameattached", native.page.mainFrame()));
      assert.throws(() => resource.beginDiagnostics?.(), ProfileCustodyUnavailableError);
      assert.doesNotThrow(() => resource.endDiagnostics?.());
      await assert.rejects(resource.authentication.authenticate("ucpath", {}), ProfileCustodyUnavailableError);
      await assert.rejects(resource.reset({ signal: input.signal }), ProfileCustodyUnavailableError);
      await assert.rejects(resource.screenshot!(), ProfileCustodyUnavailableError);
      assert.equal(native.page.gotoUrls.length, 0);
      assert.deepEqual(await resource.close({ reason: "worker-stop" }), { sessionId, system: "ucpath", pagesClosed: true, contextClosed: true });
      assert.equal(native.contextClosed(), true);
      assert.equal(native.page.closed, true);
      assert.deepEqual(debug, []);
      assert.deepEqual(navigations, []);
    });
  });

  it("publishes release after proven close while the owner is current", async () => {
    await fixtures.withTempRuntime(async ({ config }) => {
      const owner = epoch(), native = fixtures.fakeLauncher();
      const debug: string[] = [];
      const factory = new PlaywrightWorkerSessionFactory({ ...options(config, native, owner.assertCurrent),
        onDebug: (_worker, event) => debug.push(event.phase) });
      const resource = await factory.open(input);
      await resource.close({ reason: "worker-stop" });
      assert.equal(native.contextClosed(), true);
      assert.equal(native.page.closed, true);
      assert.deepEqual(debug, ["released"]);
    });
  });

  it("closes a context returned by an in-flight launch after revocation before provisioning", async () => {
    await fixtures.withTempRuntime(async ({ config }) => {
      const owner = epoch(), native = fixtures.fakeLauncher();
      const factory = new PlaywrightWorkerSessionFactory({ ...options(config, native, owner.assertCurrent),
        launcher: { launch: async launch => { const context: BrowserContext = await native.launcher.launch(launch); owner.revoke(); return context; } } });
      await assert.rejects(factory.open(input), ProfileCustodyUnavailableError);
      assert.equal(native.launches().length, 1);
      assert.equal(native.contextClosed(), true);
      assert.equal(native.page.closed, true);
    });
  });

  it("restores capture state and permits close when ownership expires during viewport preparation", async () => {
    await fixtures.withTempRuntime(async ({ config }) => {
      const owner = epoch(), native = fixtures.fakeLauncher();
      const factory = new PlaywrightWorkerSessionFactory(options(config, native, owner.assertCurrent));
      const resource = await factory.open(input);
      const original = native.page.viewportSize();
      const setViewport = native.page.setViewportSize;
      let captures = 0, restores = 0;
      native.page.setViewportSize = async size => {
        await setViewport(size);
        if (size.width === original.width && size.height === original.height) restores++;
        else owner.revoke();
      };
      native.page.screenshot = async () => { captures++; throw new Error("stale capture must not run"); };
      await assert.rejects(resource.screenshot!(), ProfileCustodyUnavailableError);
      assert.equal(captures, 0);
      assert.equal(restores, 1);
      assert.deepEqual(native.page.viewportSize(), original);
      await resource.close({ reason: "worker-stop" });
      assert.equal(native.contextClosed(), true);
    });
  });

  it("refuses the label screenshot after the safety check settles stale and still removes its owned banner", async () => {
    const page = fixtures.fakePage(), owner = epoch(), evaluate = page.evaluate;
    let bannerOwned = false, captures = 0, removals = 0, published = false;
    page.evaluate = async (callback, arg) => {
      if (callback.toString().includes('document.createElement("div")')) {
        bannerOwned = true;
        return undefined as never;
      }
      return evaluate(callback, arg);
    };
    const frame = page.mainFrame(), evaluateFrame = frame.evaluate;
    frame.evaluate = async (callback, arg) => {
      const result = await evaluateFrame(callback, arg);
      if (bannerOwned && callback.toString().includes("return state.seen")) queueMicrotask(() => queueMicrotask(owner.revoke));
      return result;
    };
    page.locator = () => ({ count: async () => 0,
      screenshot: async () => { captures++; throw new Error("stale label screenshot must not run"); },
      evaluate: async () => { bannerOwned = false; removals++; },
    });
    await assert.rejects(async () => {
      await captureFullPage(page as unknown as Page, {
        assertCurrent: owner.assertCurrent,
        assertSafe: async () => {}, sampleLabels: ["synthetic dry run"], mask: () => [],
        secretControls: "input[type=password]", afterCapture: async () => {},
      });
      published = true;
    }, ProfileCustodyUnavailableError);
    assert.equal(captures, 0);
    assert.equal(removals, 1);
    assert.equal(bannerOwned, false);
    assert.equal(published, false);
  });

});

const clock = manualClock(new Date("2026-11-01T00:00:00Z"));
const { withTempRuntime, fakeLauncher, recordingBindings, factoryFor } = createBrowserSessionFactoryFixtures(clock,
  "00000000-0000-4000-8000-000000000001", { schedule: () => ({ cancel: () => undefined }) });
const input = { workerId: WorkerIdSchema.parse("worker-1"), workflowId: WorkflowIdSchema.parse("person-lookup"), system: "ucpath", instance: "prod",
  configFingerprint: FingerprintSchema.parse("a".repeat(64)), acceptDownloads: false, exclusive: false,
  signal: new AbortController().signal, duoCeremony: { withCeremony: async () => { throw new Error("unit test must not authenticate"); } } } as const;
const credential = { rpId: "duosecurity.com", credentialId: "synthetic-id", privateKey: "synthetic-key", signCount: 0, transport: "usb" };

describe("workflow Fast Duo launch", () => {
  for (const shape of [credential, [credential], { credentials: [credential] }]) it(`does not read or install retired credential shape ${Array.isArray(shape) ? "array" : "credentials" in shape ? "envelope" : "single"}`, async () => {
    await withTempRuntime(async ({ config }) => {
      writeFileSync(config.paths.duoCredential, JSON.stringify(shape));
      const broker = fixtureWorkflowWorker();
      const worker = broker.worker;
      const harness = fakeLauncher({ serviceWorker: worker });
      const resource = await factoryFor({ ...config, features: { ...config.features, duoWebAuthn: true } }, harness, recordingBindings()).open(input);
      try {
        const launch = harness.launches()[0];
        const extension = join(String(launch.profileDirectory), "relay-extension");
        assert.equal(launch.extensionDirectory, extension);
        assert.equal(launch.nativeOnly, undefined);
        const manifest = z.object({ background: z.object({ service_worker: z.string() }) }).parse(JSON.parse(readFileSync(join(extension, "manifest.json"), "utf8")));
        assert.equal(manifest.background.service_worker, "src/workflow-background.js");
        assert.deepEqual(broker.installed.map(args => [...args]), [[]]);
        assert.equal(JSON.stringify(broker.installed).includes("synthetic-key"), false);
      } finally { await resource.close({ reason: "worker-stop" }); }
    });
  });

  it("proves context closure when Fast Duo provisioning fails", async () => {
    await withTempRuntime(async ({ config }) => {
      writeFileSync(config.paths.duoCredential, JSON.stringify(credential));
      const harness = fakeLauncher();
      await assert.rejects(factoryFor({ ...config, features: { ...config.features, duoWebAuthn: true } }, harness, recordingBindings()).open(input), DuoProvisioningError);
      assert.equal(harness.contextClosed(), true);
    });
  });

  it("refuses old or missing extension assets before launch, while explicit manual mode loads no extension", async () => {
    await withTempRuntime(async ({ config, root }) => {
      assert.throws(() => assertFastDuoReady({ ...config, features: { ...config.features, duoWebAuthn: true },
        paths: { ...config.paths, duoExtensionDir: root } }), /Fast Duo extension/);
      const harness = fakeLauncher();
      const resource = await factoryFor(config, harness, recordingBindings()).open(input);
      assert.equal(harness.launches()[0].nativeOnly, true);
      await resource.close({ reason: "worker-stop" });
    });
  });
});

it("opens credential-free before a ceremony and refuses restored-page signing without reserving", async () => {
  await withTempRuntime(async ({ config }) => {
    const broker = fixtureWorkflowWorker();
    let didStop: () => void = () => { throw new Error("stop observer not bound"); };
    const stopped = new Promise<void>(resolve => { didStop = resolve; });
    const stop = broker.owner.stop.bind(broker.owner); broker.owner.stop = () => { stop(); didStop(); };
    let signs = 0;
    const source = fixtureDuoSigningSource({ async sign() { signs++; throw new Error("must not sign outside a lease"); } });
    const harness = fakeLauncher({ serviceWorker: broker.worker });
    const resource = await factoryFor({ ...config, features: { ...config.features, duoWebAuthn: true } }, harness,
      recordingBindings(), undefined, undefined, undefined, source).open(input);
    assert.equal(signs, 0); assert.equal(harness.contextClosed(), false);
    broker.request({ id: randomUUID(), request: { requestId: randomUUID(), origin: "https://test.duosecurity.com", rpId: "duosecurity.com",
      challenge: "AQID", allowCredentials: ["AQID"], accountNames: ["fixture-user"] } });
    await stopped; assert.equal(signs, 0);
    await resource.close({ reason: "worker-stop" }); assert.equal(harness.contextClosed(), true);
  });
});

it("drains the broker before closing its worker context without extending the proof deadline", async () => {
  await withTempRuntime(async ({ config }) => {
    const broker = fixtureWorkflowWorker(), testClock = manualClock(clock.now());
    let releaseStop: () => void = () => { throw new Error("stop not entered"); };
    let enteredStop: () => void = () => { throw new Error("stop observer not bound"); };
    const entered = new Promise<void>(resolve => { enteredStop = resolve; });
    const stop = broker.owner.stop.bind(broker.owner);
    broker.owner.stop = () => { stop(); enteredStop(); return new Promise<void>(resolve => { releaseStop = resolve; }); };
    const deadlines: number[] = [];
    const scheduler = { schedule: (deadline: number) => { deadlines.push(deadline); return { cancel() {} }; } };
    const harness = fakeLauncher({ serviceWorker: broker.worker });
    const local = createBrowserSessionFactoryFixtures(testClock, "00000000-0000-4000-8000-000000000001", scheduler);
    const resource = await local.factoryFor({ ...config, features: { ...config.features, duoWebAuthn: true } }, harness, recordingBindings(), scheduler).open(input);
    const closing = resource.close({ reason: "worker-stop" });
    await entered;
    assert.equal(harness.page.closed, false); assert.equal(harness.contextClosed(), false);
    testClock.advanceMonotonic(100);
    releaseStop(); await closing;
    assert.equal(harness.contextClosed(), true);
    assert.deepEqual(deadlines, [config.browser.closeProofMs, config.browser.closeProofMs]);
  });
});

it("preserves both broker-stop and native-close failures and keeps the profile reserved", async () => {
  await withTempRuntime(async ({ config }) => {
    const broker = fixtureWorkflowWorker();
    const stopFailure = new Error("synthetic broker stop failure");
    const stop = broker.owner.stop.bind(broker.owner); broker.owner.stop = () => { stop(); throw stopFailure; };
    const harness = fakeLauncher({ serviceWorker: broker.worker, emitCloseEvent: false });
    const factory = factoryFor({ ...config, features: { ...config.features, duoWebAuthn: true } }, harness, recordingBindings());
    const resource = await factory.open(input);
    await assert.rejects(resource.close({ reason: "worker-stop" }), error => {
      assert.ok(error instanceof BrowserSessionClosureUnprovedError); assert.equal(error.errors.length, 4);
      const broker: unknown = error.errors[0], native: unknown = error.errors[1], source: unknown = error.errors[3];
      assert.equal(error.cause, broker); assert.ok(broker instanceof AggregateError); assert.deepEqual(broker.errors, [stopFailure]);
      assert.ok(native instanceof Error); assert.equal(native.message, "ucpath browser session close (worker-stop) never emitted its context close event; closure cannot be proven");
      assert.ok(source instanceof AuthoritySourceClosureUnprovedError); assert.deepEqual(source.errors, [broker, native]);
      assert.equal(source.cause, broker); assert.equal(error.errors[2], source);
      return true;
    });
    await assert.rejects(factory.open(input), /custody is unavailable/u);
  });
});

it("bounds a nonsettling broker stop while still proving native context closure", async () => {
  await withTempRuntime(async ({ config }) => {
    const broker = fixtureWorkflowWorker();
    const stop = broker.owner.stop.bind(broker.owner);
    broker.owner.stop = () => { stop(); return new Promise<never>(() => undefined); };
    const deadlines: (() => void)[] = [];
    const scheduler = { schedule: (_deadline: number, expire: () => void) => { deadlines.push(expire); return { cancel() {} }; } };
    const harness = fakeLauncher({ serviceWorker: broker.worker });
    const factory = factoryFor({ ...config, features: { ...config.features, duoWebAuthn: true } }, harness, recordingBindings(), scheduler);
    const resource = await factory.open(input);
    const close = resource.close({ reason: "worker-stop" });
    const rejected = assert.rejects(close, error => {
      assert.ok(error instanceof BrowserSessionClosureUnprovedError); assert.equal(error.errors.length, 3);
      const broker: unknown = error.errors[0], source: unknown = error.errors[2];
      assert.equal(error.cause, broker); assert.ok(broker instanceof Error); assert.equal(broker.message, "duo-broker-close-unproved");
      assert.ok(source instanceof AuthoritySourceClosureUnprovedError); assert.deepEqual(source.errors, [broker]);
      assert.equal(source.cause, broker); assert.equal(error.errors[1], source);
      return true;
    });
    assert.ok(deadlines[0]); deadlines[0]();
    await rejected; assert.equal(harness.contextClosed(), true);
    await assert.rejects(factory.open(input), /custody is unavailable/u);
  });
});
