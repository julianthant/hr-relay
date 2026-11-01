import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext } from "playwright";
import { describe, it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { BrowserProfileAdmissionSchema, PlaywrightWorkerSessionFactory, ProfileCustodyUnavailableError, workerProfileDirectory, type BrowserSessionFactoryOptions } from "../../../../src/backend/runtime/browser/browser-session-factory.js";
import { FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBrowserSessionFactoryFixtures } from "../../../support/helpers/browser/session-factory-fixtures.js";
import { protectedSecretSource } from "../../../support/helpers/protected-secret-source.js";

const clock = manualClock(new Date("2026-11-01T12:00:00Z"));
const sessionId = "00000000-0000-4000-8000-000000000001";
const scheduler = { schedule: () => ({ cancel() {} }) };
const fixtures = createBrowserSessionFactoryFixtures(clock, sessionId, scheduler);
const workerId = WorkerIdSchema.parse("person-lookup-worker-1");
const input = { workerId, workflowId: WorkflowIdSchema.parse("person-lookup"), system: "ucpath", instance: "prod",
  configFingerprint: FingerprintSchema.parse("ab".repeat(32)), acceptDownloads: false, exclusive: false,
  signal: new AbortController().signal, duoCeremony: { withCeremony: async () => { throw new Error("fixture must not start a Duo ceremony"); } } } as const;

function options(config: BrowserSessionFactoryOptions["config"], native: ReturnType<typeof fixtures.fakeLauncher>, assertCurrent: () => void): BrowserSessionFactoryOptions {
  return { config, isolation: rebuildRuntimeIsolation, clock, scheduler, newSessionId: () => sessionId,
    protectedSecrets: protectedSecretSource({ ucpathUserId: "fixture-user", ucpathPassword: "fixture-password" }),
    slotOrdinal: () => 1, assertCurrent, bindings: fixtures.recordingBindings(), launcher: native.launcher,
    admitProfile: profile => Promise.resolve(BrowserProfileAdmissionSchema.parse({ ...profile, profileRevision: 1, resetRequired: false })) };
}

function epoch() {
  let current = true;
  return { revoke: () => { current = false; }, assertCurrent: () => { if (!current) throw new ProfileCustodyUnavailableError(); } };
}

describe("browser current-owner fence", () => {
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

});
