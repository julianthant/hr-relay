import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardClient } from "../../../src/dashboard/client/index.js";
import { createDashboardTransport } from "../../../src/dashboard/client/transport.js";

const refusal = { state: "refused", code: "PROFILE_SESSION_STALE" };

it("delivers stale-session observations only to the owning client's live subscribers", async () => {
  const input = { baseUrl: "http://fixture.test", fetchImpl: async () => Response.json(refusal, { status: 401 }) };
  const a = createDashboardClient(input), b = createDashboardClient(input);
  let calls = 0; const unsubscribe = a.subscribeProfileSessionStale(() => { calls++; });
  await assert.rejects(b.bootstrap()); assert.equal(calls, 0);
  await assert.rejects(a.bootstrap()); assert.equal(calls, 1);
  unsubscribe(); await assert.rejects(a.bootstrap()); assert.equal(calls, 1);
});

for (const mode of ["json", "binary", "stream"] as const) it(`retains the ${mode} request failure while observing its exact stale refusal once`, async () => {
  let calls = 0;
  const transport = createDashboardTransport({ baseUrl: "http://fixture.test", fetchImpl: async () => Response.json(refusal, { status: 401 }),
    onProfileSessionStale() { calls++; } });
  await assert.rejects(mode === "json" ? transport.requestJson("/api/v1/bootstrap")
    : mode === "binary" ? transport.requestBinary("/api/v1/artifacts/fixture")
    : transport.openStream("/events", { onMessage() { throw new Error("refused stream cannot emit"); } }).done);
  assert.equal(calls, 1);
});

for (const path of ["/api/v1/profile/state", "/api/v1/profile/resume", "/api/v1/debug/errors"]) it(`does not turn ${path} into a recursive refresh trigger`, async () => {
  let calls = 0;
  const transport = createDashboardTransport({ baseUrl: "http://fixture.test", fetchImpl: async () => Response.json(refusal, { status: 401 }),
    onProfileSessionStale() { calls++; } });
  await assert.rejects(transport.requestJson(path)); assert.equal(calls, 0);
});
