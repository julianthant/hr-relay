import assert from "node:assert/strict";
import { it } from "vitest";
import { createCensusGeocodeAdapter } from "../../../../../src/backend/processing/providers/geocode-adapters.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
import { ProviderRequestEnvelopeSchema } from "../../../../../src/models/providers/providers.js";
import { GeocodeOutcomeSchema } from "../../../../../src/rules/normalization/geocode.js";
const request = (address = { street: "1 Test Road" }) => ProviderRequestEnvelopeSchema.parse({ capability: "geocode.census", payload: { schemaHash: "a".repeat(64), value: address } });
const options = () => ({ requestId: "00000000-0000-4000-8000-000000000001", signal: new AbortController().signal, deadlineMonotonicMs: performance.now() + 5000 });
it("preserves Census locality/oneline URLs and street components rather than block ranges", async () => {
  const urls: URL[] = [];
  const adapter = createCensusGeocodeAdapter({ clock: systemClock, fetchFn: async url => { urls.push(new URL(url instanceof Request ? url.url : url)); return Response.json({ result: { addressMatches: [{ matchedAddress: "1 TEST RD", addressComponents: { fromAddress: "1", toAddress: "99", preDirection: "N", streetName: "TEST", suffixType: "RD", city: "Test", state: "CA", zip: "92000" } }] } }); } });
  for (const address of [{ street: "1 Test Road" }, { street: "1 Test Road", city: "Test", state: "CA", zip: "92000" }]) {
    const result = await adapter.invoke(request(address), options()); assert.equal(result.response.state, "produced");
    if (result.response.state !== "produced") throw new Error("missing geocode");
    const answer = GeocodeOutcomeSchema.parse(result.response.value.value); assert.equal(answer.state === "resolved" && answer.street, "N TEST RD");
  }
  assert.equal(urls[0]?.pathname.endsWith("onelineaddress"), true); assert.equal(urls[1]?.searchParams.get("street"), "1 Test Road"); assert.equal(urls[1]?.searchParams.get("benchmark"), "4");
});
it("keeps no-match, HTTP error/429, malformed JSON and invalid provider shape explicit", async () => {
  for (const [response, state] of [[Response.json({ result: { addressMatches: [] } }), "produced"], [new Response("secret text", { status: 503 }), "unavailable"], [new Response("secret text", { status: 429 }), "unavailable"], [new Response("secret text"), "invalid-response"], [Response.json({ result: [] }), "unavailable"]] as const) {
    const adapter = createCensusGeocodeAdapter({ clock: systemClock, fetchFn: async () => response });
    const result = await adapter.invoke(request(), options()); assert.equal(result.response.state, state); assert.equal(JSON.stringify(result).includes("secret text"), false);
  }
});
