import { default as assert } from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { defaultRuntimePaths } from "../../../../src/backend/app/config/runtime-paths.js";
import { createProviderClient, type ProviderClientDependencies } from "../../../../src/backend/processing/providers/provider-client.js";
import { ConfigSchema } from "../../../../src/models/config/schema.js";
import { ProviderAdapterOutcomeSchema, ProviderRequestEnvelopeSchema } from "../../../../src/models/providers/providers.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";

{

it("constructs disconnected OCR without budget or effects and preserves snapshot identity checks", async () => {
  const config = ConfigSchema.parse({ paths: defaultRuntimePaths() });
  assert.deepEqual(Object.keys(config.providers).sort(), ["geocodeCensus", "geocodeNominatim"]);
  const snapshotId = "00000000-0000-4000-8000-000000000001";
  const fingerprint = sha256Hex(canonicalJsonStringify(config));
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
}

{

const hash = FingerprintSchema.parse("a".repeat(64));
const payload = { schemaHash: hash, value: { street: "1 Test Road" } };
const produced = ProviderAdapterOutcomeSchema.parse({ response: { state: "produced", value: payload }, evidence: { summary: "synthetic", capturedAt: "2026-10-07T12:00:00Z" } });
function fixture() {
  const clock = manualClock(new Date("2026-10-07T12:00:00Z"));
  const controller = new AbortController();
  let expired = () => {};
  let cancellations = 0;
  const config = ConfigSchema.parse({ paths: defaultRuntimePaths() });
  const id = randomUUID();
  const configFingerprint = FingerprintSchema.parse(sha256Hex(canonicalJsonStringify(config)));
  const events: unknown[] = [];
  const deps: ProviderClientDependencies = {
    execution: { runId: id, attempt: 1, nodeId: "search", taskId: "normalization/read-contact-advice" },
    configSnapshotId: id, configFingerprint,
    configSnapshot: { configSnapshotId: id, revision: 1, fingerprint: configFingerprint, config, provenance: {}, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" },
    adapters: { "geocode.census": { capability: "geocode.census", invoke: async () => produced } },
    clock, idFactory: { next: randomUUID }, runSignal: controller.signal,
    deadlineScheduler: { schedule(_at, fire) { expired = fire; return { cancel() { cancellations++; } }; } },
    observe: event => events.push(event),
  };
  return { deps, controller, events, expire: () => expired(), cancellations: () => cancellations };
}
it("validates execution, exact snapshot identity, strict request and adapter capability before effects", async () => {
  const f = fixture();
  assert.throws(() => createProviderClient("geocode.census", { ...f.deps, execution: { ...f.deps.execution, attempt: 0 } }));
  assert.throws(() => createProviderClient("geocode.census", { ...f.deps, configSnapshotId: randomUUID() }), /inconsistent config snapshot/u);
  assert.throws(() => createProviderClient("geocode.census", { ...f.deps, configFingerprint: "b".repeat(64) }), /inconsistent config snapshot/u);
  const client = createProviderClient("geocode.census", f.deps);
  await assert.rejects(client.call({ ...payload, extra: true } as never));
  const invalid = { capability: "geocode.nominatim", invoke: async () => produced };
  await assert.rejects(createProviderClient("geocode.census", { ...f.deps, adapters: { "geocode.census": invalid } as never }).call(payload), /capability-mismatch/u);
});
it("strictly parses produced, unavailable and malformed adapter outcomes, with request diagnostics", async () => {
  const f = fixture();
  assert.deepEqual(await createProviderClient("geocode.census", f.deps).call(payload), produced.response);
  assert.equal(f.events.length, 1); assert.equal(f.cancellations(), 1);
  const unavailable = { response: { state: "unavailable", reason: { code: "adapter-unavailable", message: "synthetic" } }, evidence: produced.evidence };
  for (const outcome of [unavailable, { ...produced, extra: true }]) {
    const deps = { ...f.deps, adapters: { "geocode.census": { capability: "geocode.census" as const, invoke: async () => outcome as never } } };
    const response = await createProviderClient("geocode.census", deps).call(payload);
    assert.equal(response.state, outcome === unavailable ? "unavailable" : "invalid-response");
  }
});
it("refuses duplicate request identity, missing adapter, thrown invocation and pre-aborted runs without retry", async () => {
  const f = fixture(); const requestId = randomUUID(); let calls = 0;
  const client = createProviderClient("geocode.census", { ...f.deps, idFactory: { next: () => requestId }, adapters: { "geocode.census": { capability: "geocode.census", async invoke() { calls++; throw new Error("synthetic secret must not be exposed"); } } } });
  assert.equal((await client.call(payload)).state, "unavailable");
  await assert.rejects(client.call(payload), /identity-reused/u); assert.equal(calls, 1);
  const missing = await createProviderClient("geocode.census", { ...f.deps, adapters: {} }).call(payload);
  assert.equal(missing.state, "unavailable");
  f.controller.abort();
  const aborted = await createProviderClient("geocode.census", f.deps).call(payload);
  assert.equal(aborted.state === "unavailable" && aborted.reason.code, "aborted");
});
for (const kind of ["abort", "deadline"] as const) it(`propagates ${kind} during invocation and cleans the deadline`, async () => {
  const f = fixture(); let entered = () => {}; const entering = new Promise<void>(done => { entered = done; }); let signal: AbortSignal | undefined;
  const client = createProviderClient("geocode.census", { ...f.deps, adapters: { "geocode.census": { capability: "geocode.census", async invoke(request, options) {
    ProviderRequestEnvelopeSchema.parse(request); signal = options.signal; entered();
    return new Promise((_done, reject) => options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  } } } });
  const pending = client.call(payload); await entering;
  if (kind === "abort") f.controller.abort(); else f.expire();
  const result = await pending; assert.equal(result.state === "unavailable" && result.reason.code, kind === "abort" ? "aborted" : "timeout");
  assert.equal(signal?.aborted, true); assert.equal(f.cancellations(), 1);
});
it("keeps OCR disconnected and never invokes an injected OCR adapter", async () => {
  const f = fixture();
  assert.equal((await createProviderClient("ocr.extract", { ...f.deps, adapters: {} }).call(payload)).state, "unavailable");
  assert.throws(() => createProviderClient("ocr.extract", { ...f.deps, adapters: { "ocr.extract": { capability: "ocr.extract", invoke: async () => produced } } as never }), /OCR provider policy not connected/u);
});
}
