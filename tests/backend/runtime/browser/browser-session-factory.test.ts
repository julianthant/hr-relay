import { randomUUID } from "node:crypto";
import { BrowserSessionClosureUnprovedError } from "../../../../src/workflow-kit/session.js";
import { fixtureDuoSigningSource, fixtureWorkflowWorker } from "../../../support/helpers/browser/duo-signing.js";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";
import { z } from "zod";
import { createBrowserSessionFactoryFixtures } from "../../../support/helpers/browser/session-factory-fixtures.js";
import { DuoProvisioningError, assertFastDuoReady } from "../../../../src/backend/runtime/browser/browser-session-factory.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { FingerprintSchema, WorkerIdSchema, WorkflowIdSchema } from "../../../../src/rules/identity/ids.js";

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

it("preserves both broker-stop and native-close failures and keeps the profile reserved", async () => {
  await withTempRuntime(async ({ config }) => {
    const broker = fixtureWorkflowWorker();
    const stop = broker.owner.stop.bind(broker.owner); broker.owner.stop = () => { stop(); throw new Error("synthetic broker stop failure"); };
    const harness = fakeLauncher({ serviceWorker: broker.worker, emitCloseEvent: false });
    const factory = factoryFor({ ...config, features: { ...config.features, duoWebAuthn: true } }, harness, recordingBindings());
    const resource = await factory.open(input);
    await assert.rejects(resource.close({ reason: "worker-stop" }), error => error instanceof BrowserSessionClosureUnprovedError && error.errors.length === 2);
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
    const rejected = assert.rejects(close, error => error instanceof BrowserSessionClosureUnprovedError
      && error.errors.some(cause => cause instanceof Error && cause.message === "duo-broker-close-unproved"));
    assert.ok(deadlines[0]); deadlines[0]();
    await rejected; assert.equal(harness.contextClosed(), true);
    await assert.rejects(factory.open(input), /custody is unavailable/u);
  });
});
