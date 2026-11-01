import assert from "node:assert/strict";
import { fork,type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { join } from "node:path";
import { afterEach,it,vi } from "vitest";
import { defaultRuntimePaths } from "../../../../src/backend/app/config/runtime-paths.js";
import { createNominatimGeocodeAdapter } from "../../../../src/backend/processing/providers/geocode-adapters.js";
import { createProviderClient } from "../../../../src/backend/processing/providers/provider-client.js";
import { ConfigSchema } from "../../../../src/models/config/schema.js";
import { ProviderAdapterOutcomeSchema, ProviderRequestEnvelopeSchema } from "../../../../src/models/providers/providers.js";
import { IsoInstantSchema } from "../../../../src/rules/identity/ids.js";
import { GeocodeOutcomeSchema } from "../../../../src/rules/normalization/geocode.js";
import { systemClock } from "../../../../src/rules/time/clock.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { scaledMs } from "../../../support/time-scale.js";


const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const request = ProviderRequestEnvelopeSchema.parse({ capability: "geocode.nominatim", payload: { schemaHash: "a".repeat(64), value: { street: "1 Test Road", country: "US" } } });
function options(milliseconds = 10_000, controller = new AbortController()) { return { requestId: randomUUID(), signal: controller.signal, deadlineMonotonicMs: systemClock.monotonicMs() + milliseconds }; }
function child(owner: ReturnType<typeof createNominatimGeocodeAdapter>) {
  const process = fork(join(import.meta.dirname, "../../../support/helpers/geocode/nominatim-client.ts"), [], { execArgv: ["--import", "tsx"], stdio: ["ignore", "pipe", "pipe", "ipc"] });
  owner.attach(process);
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
  const owner = createNominatimGeocodeAdapter({ clock: systemClock, fetchFn: async (url, init) => {
    starts.push(performance.now()); active++; maximumActive = Math.max(maximumActive, active); urls.push(new URL(url instanceof Request ? url.url : url));
    assert.equal(new Headers(init?.headers).get("User-Agent"), "hr-automation/1.0 (UCSD HR automation; address enrichment)");
    await new Promise<void>(done => setTimeout(done, 20)); active--;
    return Response.json([{ importance: 0.8, display_name: "1 Test Road", address: { house_number: "1", road: "Test Road", town: "Test", state: "CA", postcode: "92000" } }]);
  } }); cleanups.push(() => owner.stop());
  const cold = performance.now(); const first = await owner.invoke(request, options()); assert.ok((starts[0] ?? 0) - cold >= 1000);
  assert.equal(first.response.state, "produced"); if (first.response.state !== "produced") throw new Error("missing result");
  const answer = GeocodeOutcomeSchema.parse(first.response.value.value); assert.equal(answer.state === "resolved" && answer.street, "1 Test Road");
  const config = ConfigSchema.parse({ paths: defaultRuntimePaths() });
  const snapshotClient = (timeoutMs: number) => {
    const id = randomUUID(); const selectedConfig = { ...config, providers: { ...config.providers, geocodeNominatim: { timeoutMs } } }; const snapshot = { configSnapshotId: id, revision: 1, fingerprint: sha256Hex(canonicalJsonStringify(selectedConfig)), config: selectedConfig, provenance: {}, capturedAt: IsoInstantSchema.parse(systemClock.now().toISOString()), capturedBy: "local-operator" };
    return createProviderClient("geocode.nominatim", { execution: { runId: randomUUID(), attempt: 1, nodeId: "contact", taskId: "normalization/read-contact-advice" }, configSnapshotId: id, configFingerprint: snapshot.fingerprint, configSnapshot: snapshot, adapters: { "geocode.nominatim": owner }, clock: systemClock, idFactory: { next: randomUUID }, runSignal: new AbortController().signal, deadlineScheduler: { schedule(deadline, fire) { const timer = setTimeout(fire, Math.max(0, deadline - performance.now())); return { cancel: () => clearTimeout(timer) }; } } });
  };
  const a = child(owner); const b = child(owner); await Promise.all([message(a, "ready"), message(b, "ready")]);
  const results = [message(a, "result"), message(b, "result")]; a.send("call"); b.send("call");
  const parentResults = await Promise.all([snapshotClient(12_000).call(request.payload), snapshotClient(13_000).call(request.payload), ...results]);
  assert.equal(parentResults.length, 4); for (const result of parentResults) assert.equal(result.state, "produced");
  assert.equal(starts.length, 5); for (let i = 1; i < starts.length; i++) assert.ok((starts[i] ?? 0) - (starts[i - 1] ?? 0) >= 1000, JSON.stringify(starts));
  assert.equal(maximumActive, 1); assert.equal(urls[0]?.searchParams.get("countrycodes"), "us"); assert.equal(urls[0]?.searchParams.get("limit"), "1");
}, scaledMs(15_000));
it("cancels queued requests and honors their original deadline before any fetch", async () => {
  let calls = 0;
  const owner = createNominatimGeocodeAdapter({ clock: systemClock, fetchFn: async () => { calls++; return Response.json([]); } }); cleanups.push(() => owner.stop());
  const cancelled = new AbortController(); const waiting = owner.invoke(request, options(5000, cancelled));
  await new Promise<void>(done => setTimeout(done, 50)); cancelled.abort();
  const result = await waiting; assert.equal(result.response.state === "unavailable" && result.response.reason.code, "aborted");
  const expired = await owner.invoke(request, options(50)); assert.equal(expired.response.state === "unavailable" && expired.response.reason.code, "timeout");
  await new Promise<void>(done => setTimeout(done, 1050)); assert.equal(calls, 0);
});
it("keeps Nominatim no-match and remote failures explicit without provider-body excerpts", async () => {
  const responses = [Response.json([]), new Response("private body", { status: 429 }), new Response("private body", { status: 503 }), new Response("private body"), Response.json({ unexpected: true })];
  const owner = createNominatimGeocodeAdapter({ clock: systemClock, fetchFn: async () => { const response = responses.shift(); if (response === undefined) throw new Error("synthetic response exhausted"); return response; } }); cleanups.push(() => owner.stop());
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "hrtime"] });
  try {
    for (const state of ["produced", "unavailable", "unavailable", "invalid-response", "unavailable"]) {
      let settled = false;
      const pending = owner.invoke(request, options()).finally(() => { settled = true; });
      for (let tick = 0; tick < 100 && !settled; tick++) {
        await new Promise<void>(done => setImmediate(done));
        await vi.advanceTimersByTimeAsync(100);
      }
      assert.equal(settled, true);
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
  const owner = createNominatimGeocodeAdapter({clock:systemClock,fetchFn:async()=>{calls++;return Response.json([]);}});
  cleanups.push(()=>owner.stop());
  await owner.invoke(request,options());
  const client=child(owner);await message(client,"ready");
  const result=message(client,"result");client.send("call");
  await new Promise<void>(done=>setTimeout(done,30));client.send("cancel");
  assert.equal((await result).state,"unavailable");
  await new Promise<void>(done=>setTimeout(done,1050));assert.equal(calls,1);
});

it("fails in-flight and queued worker requests when their parent dies without replay", async () => {
  const parent=fork(join(import.meta.dirname,"../../../support/helpers/geocode/nominatim-parent.ts"),[],{execArgv:["--import","tsx"],stdio:["ignore","pipe","pipe","ipc"]});
  cleanups.push(async()=>{if(parent.exitCode===null&&parent.signalCode===null){parent.kill("SIGKILL");await once(parent,"exit");}});
  let output="";parent.stdout?.on("data",(chunk:unknown)=>{assert.ok(chunk instanceof Uint8Array);output+=Buffer.from(chunk).toString("utf8");});
  await message(parent,"ready");
  const started=message(parent,"fetch-start");parent.send("call");await started;
  parent.send("call");await new Promise<void>(done=>setTimeout(done,50));
  const closed=once(parent,"close");parent.kill("SIGKILL");await closed;
  const results=output.trim().split("\n").map(line=>ProviderAdapterOutcomeSchema.parse(JSON.parse(line)));
  assert.equal(results.length,2);
  for(const result of results)assert.equal(result.response.state,"unavailable");
  const starts:number[]=[];
  const replacement=createNominatimGeocodeAdapter({clock:systemClock,fetchFn:async()=>{starts.push(performance.now());return Response.json([]);}});cleanups.push(()=>replacement.stop());
  const attempt=performance.now();assert.equal((await replacement.invoke(request,options())).response.state,"produced");
  assert.ok((starts[0]??0)-attempt>=1000);assert.equal(starts.length,1);
}, scaledMs(10000));
