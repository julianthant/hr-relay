import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { randomUUID as randomUUID_m1 } from "node:crypto";
import { it as it_m0,it as it_m1 } from "vitest";
import { defaultRuntimePaths as defaultRuntimePaths_m0,defaultRuntimePaths as defaultRuntimePaths_m1 } from "../../../../src/backend/app/config/runtime-paths.js";
import { createProviderClient as createProviderClient_m0,createProviderClient as createProviderClient_m1,type ProviderClientDependencies as ProviderClientDependencies_m0,type ProviderClientDependencies as ProviderClientDependencies_m1 } from "../../../../src/backend/processing/providers/provider-client.js";
import { ConfigSchema as ConfigSchema_m0,ConfigSchema as ConfigSchema_m1 } from "../../../../src/models/config/schema.js";
import { ProviderAdapterOutcomeSchema as ProviderAdapterOutcomeSchema_m1,ProviderRequestEnvelopeSchema as ProviderRequestEnvelopeSchema_m1 } from "../../../../src/models/providers/providers.js";
import { FingerprintSchema as FingerprintSchema_m1 } from "../../../../src/rules/identity/ids.js";
import { manualClock as manualClock_m1 } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify as canonicalJsonStringify_m0,canonicalJsonStringify as canonicalJsonStringify_m1 } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex as sha256Hex_m0,sha256Hex as sha256Hex_m1 } from "../../../../src/rules/validation/sha256.js";


{


it_m0("constructs disconnected OCR without budget or effects and preserves snapshot identity checks", async () => {
  const config = ConfigSchema_m0.parse({ paths: defaultRuntimePaths_m0() });
  assert_m0.deepEqual(Object.keys(config.providers).sort(), ["geocodeCensus", "geocodeNominatim"]);
  const snapshotId = "00000000-0000-4000-8000-000000000001";
  const fingerprint = sha256Hex_m0(canonicalJsonStringify_m0(config));
  const effects = new Proxy({}, { get() { throw new Error("disconnected OCR touched an effect"); } });
  const dependencies = {
    execution: { runId: snapshotId, attempt: 1, nodeId: "extract", taskId: "ocr/extract-form-page" },
    configSnapshotId: snapshotId, configFingerprint: fingerprint,
    configSnapshot: { configSnapshotId: snapshotId, revision: 1, fingerprint, config, provenance: {}, capturedAt: "2026-10-07T12:00:00Z", capturedBy: "local-operator" },
    adapters: {}, clock: effects, idFactory: effects, deadlineScheduler: effects,
    runSignal: new AbortController().signal,
  } as unknown as ProviderClientDependencies_m0;
  const client = createProviderClient_m0("ocr.extract", dependencies);
  assert_m0.deepEqual(await client.call({ schemaHash: fingerprint, value: {} } as never), {
    state: "unavailable", reason: { code: "adapter-unavailable", message: "OCR provider not connected" },
  });
  assert_m0.throws(() => createProviderClient_m0("ocr.extract", { ...dependencies, configFingerprint: "b".repeat(64) }), /inconsistent config snapshot/u);
});
}

{


const hash = FingerprintSchema_m1.parse("a".repeat(64));
const payload = { schemaHash: hash, value: { street: "1 Test Road" } };
const produced = ProviderAdapterOutcomeSchema_m1.parse({ response: { state: "produced", value: payload }, evidence: { summary: "synthetic", capturedAt: "2026-10-07T12:00:00Z" } });
function fixture() {
  const clock = manualClock_m1(new Date("2026-10-07T12:00:00Z"));
  const controller = new AbortController();
  let expired = () => {};
  let cancellations = 0;
  const config = ConfigSchema_m1.parse({ paths: defaultRuntimePaths_m1() });
  const id = randomUUID_m1();
  const configFingerprint = FingerprintSchema_m1.parse(sha256Hex_m1(canonicalJsonStringify_m1(config)));
  const events: unknown[] = [];
  const deps: ProviderClientDependencies_m1 = {
    execution: { runId: id, attempt: 1, nodeId: "search", taskId: "normalization/read-contact-advice" },
    configSnapshotId: id, configFingerprint,
    configSnapshot: { configSnapshotId: id, revision: 1, fingerprint: configFingerprint, config, provenance: {}, capturedAt: clock.now().toISOString(), capturedBy: "local-operator" },
    adapters: { "geocode.census": { capability: "geocode.census", invoke: async () => produced } },
    clock, idFactory: { next: randomUUID_m1 }, runSignal: controller.signal,
    deadlineScheduler: { schedule(_at, fire) { expired = fire; return { cancel() { cancellations++; } }; } },
    observe: event => events.push(event),
  };
  return { deps, controller, events, expire: () => expired(), cancellations: () => cancellations };
}
it_m1("validates execution, exact snapshot identity, strict request and adapter capability before effects", async () => {
  const f = fixture();
  assert_m1.throws(() => createProviderClient_m1("geocode.census", { ...f.deps, execution: { ...f.deps.execution, attempt: 0 } }));
  assert_m1.throws(() => createProviderClient_m1("geocode.census", { ...f.deps, configSnapshotId: randomUUID_m1() }), /inconsistent config snapshot/u);
  assert_m1.throws(() => createProviderClient_m1("geocode.census", { ...f.deps, configFingerprint: "b".repeat(64) }), /inconsistent config snapshot/u);
  const client = createProviderClient_m1("geocode.census", f.deps);
  await assert_m1.rejects(client.call({ ...payload, extra: true } as never));
  const invalid = { capability: "geocode.nominatim", invoke: async () => produced };
  await assert_m1.rejects(createProviderClient_m1("geocode.census", { ...f.deps, adapters: { "geocode.census": invalid } as never }).call(payload), /capability-mismatch/u);
});
it_m1("strictly parses produced, unavailable and malformed adapter outcomes, with request diagnostics", async () => {
  const f = fixture();
  assert_m1.deepEqual(await createProviderClient_m1("geocode.census", f.deps).call(payload), produced.response);
  assert_m1.equal(f.events.length, 1); assert_m1.equal(f.cancellations(), 1);
  const unavailable = { response: { state: "unavailable", reason: { code: "adapter-unavailable", message: "synthetic" } }, evidence: produced.evidence };
  for (const outcome of [unavailable, { ...produced, extra: true }]) {
    const deps = { ...f.deps, adapters: { "geocode.census": { capability: "geocode.census" as const, invoke: async () => outcome as never } } };
    const response = await createProviderClient_m1("geocode.census", deps).call(payload);
    assert_m1.equal(response.state, outcome === unavailable ? "unavailable" : "invalid-response");
  }
});
it_m1("refuses duplicate request identity, missing adapter, thrown invocation and pre-aborted runs without retry", async () => {
  const f = fixture(); const requestId = randomUUID_m1(); let calls = 0;
  const client = createProviderClient_m1("geocode.census", { ...f.deps, idFactory: { next: () => requestId }, adapters: { "geocode.census": { capability: "geocode.census", async invoke() { calls++; throw new Error("synthetic secret must not be exposed"); } } } });
  assert_m1.equal((await client.call(payload)).state, "unavailable");
  await assert_m1.rejects(client.call(payload), /identity-reused/u); assert_m1.equal(calls, 1);
  const missing = await createProviderClient_m1("geocode.census", { ...f.deps, adapters: {} }).call(payload);
  assert_m1.equal(missing.state, "unavailable");
  f.controller.abort();
  const aborted = await createProviderClient_m1("geocode.census", f.deps).call(payload);
  assert_m1.equal(aborted.state === "unavailable" && aborted.reason.code, "aborted");
});
for (const kind of ["abort", "deadline"] as const) it_m1(`propagates ${kind} during invocation and cleans the deadline`, async () => {
  const f = fixture(); let entered = () => {}; const entering = new Promise<void>(done => { entered = done; }); let signal: AbortSignal | undefined;
  const client = createProviderClient_m1("geocode.census", { ...f.deps, adapters: { "geocode.census": { capability: "geocode.census", async invoke(request, options) {
    ProviderRequestEnvelopeSchema_m1.parse(request); signal = options.signal; entered();
    return new Promise((_done, reject) => options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
  } } } });
  const pending = client.call(payload); await entering;
  if (kind === "abort") f.controller.abort(); else f.expire();
  const result = await pending; assert_m1.equal(result.state === "unavailable" && result.reason.code, kind === "abort" ? "aborted" : "timeout");
  assert_m1.equal(signal?.aborted, true); assert_m1.equal(f.cancellations(), 1);
});
it_m1("keeps OCR disconnected and never invokes an injected OCR adapter", async () => {
  const f = fixture();
  assert_m1.equal((await createProviderClient_m1("ocr.extract", { ...f.deps, adapters: {} }).call(payload)).state, "unavailable");
  assert_m1.throws(() => createProviderClient_m1("ocr.extract", { ...f.deps, adapters: { "ocr.extract": { capability: "ocr.extract", invoke: async () => produced } } }), /OCR provider policy not connected/u);
});
}
