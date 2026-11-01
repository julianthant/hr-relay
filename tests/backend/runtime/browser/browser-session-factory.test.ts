import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import type { Worker } from "playwright";
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
  for (const shape of [credential, [credential], { credentials: [credential] }]) it(`stages and provisions credential shape ${Array.isArray(shape) ? "array" : "credentials" in shape ? "envelope" : "single"}`, async () => {
    await withTempRuntime(async ({ config }) => {
      writeFileSync(config.paths.duoCredential, JSON.stringify(shape));
      let installed: unknown;
      const worker = { url: () => `chrome-extension://${"a".repeat(32)}/src/workflow-background.js`,
        evaluate: (callback: (value: unknown) => Promise<void>, value: unknown) => runInNewContext(`(${callback.toString()})(value)`, {
          value, relayWorkflow: { install: (data: unknown) => { installed = data; } },
        }) as Promise<void>,
      } as unknown as Worker;
      const harness = fakeLauncher({ serviceWorker: worker });
      const resource = await factoryFor({ ...config, features: { ...config.features, duoWebAuthn: true } }, harness, recordingBindings()).open(input);
      try {
        const launch = harness.launches()[0];
        const extension = join(String(launch.profileDirectory), "relay-extension");
        assert.equal(launch.extensionDirectory, extension);
        assert.equal(launch.nativeOnly, undefined);
        const manifest = z.object({ background: z.object({ service_worker: z.string() }) }).parse(JSON.parse(readFileSync(join(extension, "manifest.json"), "utf8")));
        assert.equal(manifest.background.service_worker, "src/workflow-background.js");
        assert.deepEqual(JSON.parse(JSON.stringify(installed)), { username: "fixture-user", credentials: [credential], nowMs: clock.now().getTime() });
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
