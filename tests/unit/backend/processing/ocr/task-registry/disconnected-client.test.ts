import assert from "node:assert/strict";
import { it } from "vitest";
import { createProviderClient, type ProviderClientDependencies } from "../../../../../../src/backend/processing/providers/provider-client.js";
import { ConfigSchema } from "../../../../../../src/models/config/schema.js";
import { defaultRuntimePaths } from "../../../../../../src/backend/app/config/runtime-paths.js";

it("constructs disconnected OCR without budget or effects and preserves snapshot identity checks", async () => {
  const config = ConfigSchema.parse({ paths: defaultRuntimePaths() });
  assert.deepEqual(Object.keys(config.providers).sort(), ["geocodeCensus", "geocodeNominatim"]);
  const snapshotId = "00000000-0000-4000-8000-000000000001";
  const fingerprint = "a".repeat(64);
  const effects = new Proxy({}, { get() { throw new Error("disconnected OCR touched an effect"); } });
  const dependencies = {
    execution: { runId: snapshotId, attempt: 1, nodeId: "extract", taskId: "ocr/extract-form-page" },
    configSnapshotId: snapshotId, configFingerprint: fingerprint,
    configSnapshot: { configSnapshotId: snapshotId, revision: 1, fingerprint, config, provenance: {}, capturedAt: "2026-10-07T12:00:00Z", capturedBy: "local-operator" },
    adapters: {}, clock: effects, idFactory: effects, deadlineScheduler: effects,
    runSignal: new AbortController().signal,
  } as unknown as ProviderClientDependencies;
  const client = createProviderClient("ocr.extract", dependencies);
  assert.deepEqual(await client.call({ schemaHash: fingerprint, value: {} } as never), {
    state: "unavailable", reason: { code: "adapter-unavailable", message: "OCR provider not connected" },
  });
  assert.throws(() => createProviderClient("ocr.extract", { ...dependencies, configFingerprint: "b".repeat(64) }), /inconsistent config snapshot/u);
});
