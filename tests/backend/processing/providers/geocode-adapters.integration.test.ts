import { PREFERENCES_SNAPSHOT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { testProcessImport } from "../../../support/compiled-process.js";
import assert from "node:assert/strict";
import { fork,type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { join } from "node:path";
import { afterEach,it,vi } from "vitest";
import { defaultRuntimePaths } from "../../../../src/backend/app/config/runtime-paths.js";
import { createNominatimGeocodeAdapter } from "../../../../src/backend/processing/providers/geocode-adapters.js";
import { createIpcRouter } from "../../../../src/backend/runtime/workers/worker-ipc-router.js";
import { createProviderClient } from "../../../../src/backend/processing/providers/provider-client.js";
import { ConfigSchema } from "../../../../src/models/config/schema.js";
import { ProviderAdapterOutcomeSchema, ProviderRequestEnvelopeSchema } from "../../../../src/models/providers/providers.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { GeocodeOutcomeSchema } from "../../../../src/rules/normalization/geocode.js";
import { manualClock, systemClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { scaledMs } from "../../../support/time-scale.js";


const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const request = ProviderRequestEnvelopeSchema.parse({ capability: "geocode.nominatim", payload: { schemaHash: "a".repeat(64), value: { street: "1 Test Road", country: "US" } } });
function options(milliseconds = 10_000, controller = new AbortController(), clock = systemClock) { return { requestId: randomUUID(), signal: controller.signal, deadlineMonotonicMs: clock.monotonicMs() + milliseconds }; }
function child(owner: ReturnType<typeof createNominatimGeocodeAdapter>) {
  const process = fork(join(import.meta.dirname, "../../../support/helpers/geocode/nominatim-client.ts"), [], { execArgv: ["--import", testProcessImport()], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const router = createIpcRouter({ on: (event, listener) => process.on(event, listener), off: (event, listener) => process.off(event, listener),
    disconnect: () => { process.disconnect(); } }, error => { throw error; });
  owner.attach(process, router);
  for (const kind of ["ready", "fetch-start", "result"]) router.register(kind, () => undefined);
  cleanups.push(async () => { if (process.exitCode === null && process.signalCode === null) { process.kill("SIGKILL"); await once(process, "exit"); } });
  return process;
}
function message(process: ChildProcess, kind: string): Promise<Record<string, unknown>> {
  return new Promise((done, reject) => {
    const timer = setTimeout(() => { process.removeListener("message", receive); reject(new Error(`synthetic child did not send ${kind}`)); }, 8000);
    const receive = (value: unknown) => { if (typeof value === "object" && value !== null && "kind" in value && value.kind === kind) { clearTimeout(timer); process.removeListener("message", receive); done(value); } };
    process.on("message", receive);
  });
}
it("spaces actual owned fetch starts across process workers and config snapshots, preserves UA, and never overlaps fetch", async () => {
  const starts: number[] = []; let active = 0; let maximumActive = 0; const urls: URL[] = [];
  const releaseFirst = Promise.withResolvers<void>();
  const owner = createNominatimGeocodeAdapter({ clock: systemClock, fetchFn: async (url, init) => {
    starts.push(performance.now()); active++; maximumActive = Math.max(maximumActive, active); urls.push(new URL(url instanceof Request ? url.url : url));
    assert.equal(new Headers(init?.headers).get("User-Agent"), "hr-automation/1.0 (UCSD HR automation; address enrichment)");
    if (starts.length === 1) await releaseFirst.promise;
    active--;
    return Response.json([{ importance: 0.8, display_name: "1 Test Road", address: { house_number: "1", road: "Test Road", town: "Test", state: "CA", postcode: "92000" } }]);
  } });
  cleanups.push(async () => { releaseFirst.resolve(); await owner.stop(); });
  const cold = performance.now();
  const firstCall = owner.invoke(request, options());
  await vi.waitFor(() => assert.equal(starts.length, 1, "first Nominatim fetch did not start"), { timeout: 5_000 });
  assert.ok((starts[0] ?? 0) - cold >= 1000);
  const config = ConfigSchema.parse({ paths: defaultRuntimePaths() });
  const snapshotClient = (timeoutMs: number) => {
    const id = randomUUID(); const selectedConfig = { ...config, providers: { ...config.providers, geocodeNominatim: { timeoutMs } } }; const snapshot = { ...PREFERENCES_SNAPSHOT, configSnapshotId: id, revision: 1, fingerprint: sha256Hex(canonicalJsonStringify(selectedConfig)), config: selectedConfig, provenance: {}, capturedAt: IsoInstantSchema.parse(systemClock.now().toISOString()), capturedBy: "local-operator" };
    return createProviderClient("geocode.nominatim", { execution: { runId: randomUUID(), attempt: 1, nodeId: "contact", taskId: "normalization/read-contact-advice" }, configSnapshotId: id, configFingerprint: snapshot.fingerprint, configSnapshot: snapshot, adapters: { "geocode.nominatim": owner }, clock: systemClock, idFactory: { next: randomUUID }, runSignal: new AbortController().signal, deadlineScheduler: { schedule(deadline, fire) { const timer = setTimeout(fire, Math.max(0, deadline - performance.now())); return { cancel: () => clearTimeout(timer) }; } } });
  };
  const a = child(owner); const b = child(owner); await Promise.all([message(a, "ready"), message(b, "ready")]);
  const results = [message(a, "result"), message(b, "result")];
  const routed = Promise.all([message(a, "nominatim-request"), message(b, "nominatim-request")]);
  a.send("call"); b.send("call");
  const remaining = Promise.all([snapshotClient(12_000).call(request.payload), snapshotClient(13_000).call(request.payload), ...results]);
  const [parentResults, first] = await Promise.all([remaining, routed.then(() => {
    assert.equal(active, 1, "the first fetch stays in flight while worker requests enter the owner");
    releaseFirst.resolve();
    return firstCall;
  })]);
  assert.equal(first.response.state, "produced"); if (first.response.state !== "produced") throw new Error("missing result");
  const answer = GeocodeOutcomeSchema.parse(first.response.value.value); assert.equal(answer.state === "resolved" && answer.street, "1 Test Road");
  assert.equal(parentResults.length, 4); for (const result of parentResults) assert.equal(result.state, "produced");
  assert.equal(starts.length, 5); for (let i = 1; i < starts.length; i++) assert.ok((starts[i] ?? 0) - (starts[i - 1] ?? 0) >= 1000, JSON.stringify(starts));
  assert.equal(maximumActive, 1); assert.equal(urls[0]?.searchParams.get("countrycodes"), "us"); assert.equal(urls[0]?.searchParams.get("limit"), "1");
}, scaledMs(15_000));
it("cancels queued requests and honors their original deadline before any fetch", async () => {
  let calls = 0;
  const clock = manualClock(new Date("2026-01-01T00:00:00.000Z"));
  const owner = createNominatimGeocodeAdapter({ clock, fetchFn: async () => { calls++; return Response.json([]); } });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "hrtime"] });
  try {
    const cancelled = new AbortController();
    const waiting = owner.invoke(request, options(5000, cancelled, clock));
    await vi.advanceTimersByTimeAsync(0);
    cancelled.abort();
    const result = await waiting; assert.equal(result.response.state === "unavailable" && result.response.reason.code, "aborted");
    const expiring = owner.invoke(request, options(50, undefined, clock));
    await vi.advanceTimersByTimeAsync(0);
    clock.advanceMonotonic(1000);
    await vi.advanceTimersByTimeAsync(1000);
    const expired = await expiring; assert.equal(expired.response.state === "unavailable" && expired.response.reason.code, "timeout");
    assert.equal(calls, 0);
  } finally {
    vi.useRealTimers();
    await owner.stop();
  }
});
it("keeps Nominatim no-match and remote failures explicit without provider-body excerpts", async () => {
  const responses = [Response.json([]), new Response("private body", { status: 429 }), new Response("private body", { status: 503 }), new Response("private body"), Response.json({ unexpected: true })];
  const owner = createNominatimGeocodeAdapter({ clock: systemClock, fetchFn: async () => { const response = responses.shift(); if (response === undefined) throw new Error("synthetic response exhausted"); return response; } }); cleanups.push(() => owner.stop());
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "hrtime"] });
  try {
    for (const state of ["produced", "unavailable", "unavailable", "invalid-response", "unavailable"]) {
      let settled = false;
      const pending = owner.invoke(request, options()).finally(() => { settled = true; });
      await vi.advanceTimersByTimeAsync(1000);
      assert.equal(settled, true, "Nominatim did not settle at its next paced fetch");
      const result = await pending; assert.equal(result.response.state, state);
      assert.equal(JSON.stringify(result).includes("private body"), false);
      if (result.response.state === "produced") assert.deepEqual(GeocodeOutcomeSchema.parse(result.response.value.value), { state: "no-match" });
    }
    assert.equal(responses.length, 0);
  } finally {
    vi.useRealTimers();
    await owner.stop();
  }
}, scaledMs(10_000));
it("cancels a worker queued behind the parent without starting its fetch", async () => {
  let calls = 0;
  const release = Promise.withResolvers<void>();
  const owner = createNominatimGeocodeAdapter({ clock: systemClock, fetchFn: async () => {
    if (++calls === 1) await release.promise;
    return Response.json([]);
  } });
  cleanups.push(async () => { release.resolve(); await owner.stop(); });
  const first = owner.invoke(request, options());
  await vi.waitFor(() => assert.equal(calls, 1, "parent Nominatim fetch did not start"), { timeout: 5_000 });
  const client = child(owner); await message(client, "ready");
  const queued = message(client, "nominatim-request"), result = message(client, "result");
  client.send("call");
  await queued;
  const cancelled = message(client, "nominatim-cancel"); client.send("cancel");
  assert.equal((await result).state, "unavailable");
  await cancelled;
  assert.equal(calls, 1);
  // A subsequent invocation drains the queue past the cancelled request before counting fetches.
  const following = owner.invoke(request, options());
  release.resolve();
  await first;
  assert.equal((await following).response.state, "produced");
  assert.equal(calls, 2);
});

it("fails in-flight and queued worker requests when their parent dies without replay", async () => {
  const parent=fork(join(import.meta.dirname,"../../../support/helpers/geocode/nominatim-parent.ts"),[],{execArgv:["--import",testProcessImport()],stdio:["ignore","pipe","pipe","ipc"]});
  cleanups.push(async()=>{if(parent.exitCode===null&&parent.signalCode===null){parent.kill("SIGKILL");await once(parent,"exit");}});
  let output="";parent.stdout?.on("data",(chunk:unknown)=>{assert.ok(chunk instanceof Uint8Array);output+=Buffer.from(chunk).toString("utf8");});
  await message(parent,"ready");
  const started=message(parent,"fetch-start");parent.send("call");await started;
  const queued = message(parent, "request-routed"); parent.send("call"); await queued;
  const closed=once(parent,"close");parent.kill("SIGKILL");await closed;
  const results=output.trim().split("\n").map(line=>ProviderAdapterOutcomeSchema.parse(JSON.parse(line)));
  assert.equal(results.length,2);
  for(const result of results)assert.equal(result.response.state,"unavailable");
  const starts:number[]=[];
  const replacement=createNominatimGeocodeAdapter({clock:systemClock,fetchFn:async()=>{starts.push(performance.now());return Response.json([]);}});cleanups.push(()=>replacement.stop());
  const attempt=performance.now();assert.equal((await replacement.invoke(request,options())).response.state,"produced");
  assert.ok((starts[0]??0)-attempt>=1000);assert.equal(starts.length,1);
}, scaledMs(10000));

it("fails a worker's pending and later Nominatim requests in its adapter on a malformed reply", async () => {
  const release = Promise.withResolvers<void>();
  let entered = false;
  const owner = createNominatimGeocodeAdapter({ clock: systemClock, fetchFn: async () => {
    entered = true;
    await release.promise;
    return Response.json([]);
  } });
  cleanups.push(async () => { release.resolve(); await owner.stop(); });
  const client = child(owner); await message(client, "ready");
  const first = message(client, "result"); client.send("call");
  await vi.waitFor(() => assert.ok(entered, "worker Nominatim fetch did not start"), { timeout: 5_000 });
  client.send({ kind: "nominatim-reply", requestId: "not-a-request-id" });
  assert.equal((await first).state, "unavailable");
  const second = message(client, "result"); client.send("call");
  assert.equal((await second).state, "unavailable");
  assert.equal(client.connected, true);
});
