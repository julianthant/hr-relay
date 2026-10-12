import { randomUUID } from "node:crypto";
import { createNominatimGeocodeAdapter } from "../../../../src/backend/processing/providers/geocode-adapters.js";
import { ProviderRequestEnvelopeSchema } from "../../../../src/models/providers/providers.js";
import { systemClock } from "../../../../src/rules/time/clock.js";

const root = process.argv[2];
if (root === undefined) throw new Error("synthetic-nominatim-lock-root-required");
const owner = process.argv[3] === "owner";
let calls = 0;
const adapter = createNominatimGeocodeAdapter({ processLockRoot: root, clock: systemClock, fetchFn: async (_url, init) => {
  if (!owner) throw new Error("client performed direct fetch");
  if (++calls === 1) return Response.json([]);
  process.send?.({ kind: "fetch-start", pid: process.pid });
  return new Promise<Response>((_done, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
} });
process.on("message", async message => {
  if (message === "stop") { await adapter.stop(); process.disconnect?.(); return; }
  const request = ProviderRequestEnvelopeSchema.parse({ capability: "geocode.nominatim", payload: { schemaHash: "a".repeat(64), value: { street: "1 Test Road", country: "US" } } });
  const result = await adapter.invoke(request, { requestId: randomUUID(), signal: new AbortController().signal, deadlineMonotonicMs: systemClock.monotonicMs() + 10_000 });
  process.send?.({ kind: "result", state: result.response.state });
  if (!owner) { await adapter.stop(); process.disconnect?.(); }
});
process.send?.({ kind: "ready" });
