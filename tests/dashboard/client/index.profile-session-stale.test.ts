import assert from "node:assert/strict";
import { it } from "vitest";
import { createDashboardClient, DashboardClientError, type DashboardClient } from "../../../src/dashboard/client/index.js";
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
    captureProfileSessionStale: () => () => { calls++; } });
  await assert.rejects(mode === "json" ? transport.requestJson("/api/v1/bootstrap")
    : mode === "binary" ? transport.requestBinary("/api/v1/artifacts/fixture")
    : transport.openStream("/events", { onMessage() { throw new Error("refused stream cannot emit"); } }).done);
  assert.equal(calls, 1);
});

for (const path of ["/api/v1/profile/state", "/api/v1/profile/resume", "/api/v1/debug/errors"]) it(`does not turn ${path} into a recursive refresh trigger`, async () => {
  let calls = 0;
  const transport = createDashboardTransport({ baseUrl: "http://fixture.test", fetchImpl: async () => Response.json(refusal, { status: 401 }),
    captureProfileSessionStale: () => () => { calls++; } });
  await assert.rejects(transport.requestJson(path)); assert.equal(calls, 0);
});

function protectedRequest(client: DashboardClient, mode: "json" | "binary" | "stream"): Promise<unknown> {
  if (mode === "json") return client.bootstrap();
  if (mode === "binary") return client.exportXlsx({ requestVersion: 3,
    selection: { kind: "activity", from: "2026-08-01", to: "2026-08-28", snapshotToken: "as1.test.token" } });
  const result = Promise.withResolvers<never>();
  const stream = client.subscribeDay({ day: "2026-08-03", onDay() { throw new Error("refused stream cannot publish a day"); },
    onState(state) { if (state.state === "stopped") result.reject(state.error); },
    schedule() { throw new Error("an HTTP session refusal must not reconnect"); } });
  return result.promise.finally(() => stream.close());
}

for (const mode of ["json", "binary", "stream"] as const) for (const recovery of ["sign-in", "resume"] as const) {
  it(`discards a deferred old ${mode} refusal after successful ${recovery}, while a new refusal remains observable`, async () => {
    const old = Promise.withResolvers<Response>(), dispatched = Promise.withResolvers<void>();
    let requests = 0, observations = 0;
    const active = (epoch: number) => ({ state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch, duoState: "ready" });
    const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async url => {
      const path = new URL(url).pathname;
      if (path.endsWith("/state")) return Response.json(active(1));
      if (path.endsWith("/sign-in") || path.endsWith("/resume")) return Response.json(active(2));
      if (++requests === 1) { dispatched.resolve(); return old.promise; }
      return Response.json(refusal, { status: 401 });
    } });
    await client.readProfileSession();
    const unsubscribe = client.subscribeProfileSessionStale(() => { observations++; });
    const isRefused = (error: unknown) => error instanceof DashboardClientError && error.status === 401;
    const pending = assert.rejects(protectedRequest(client, mode), isRefused); await dispatched.promise;
    try {
      const recovered = recovery === "resume" ? await client.resumeProfile()
        : await client.signInProfile({ email: "fixture@ucsd.edu", password: "fixture-password" });
      assert.deepEqual(recovered, active(2));
      old.resolve(Response.json(refusal, { status: 401 })); await pending;
      assert.equal(observations, 0, "the delayed response belongs to superseded dispatch authority");
      await assert.rejects(protectedRequest(client, mode), isRefused);
      assert.equal(observations, 1); assert.equal(requests, 2);
    } finally { old.resolve(Response.json(refusal, { status: 401 })); await pending; unsubscribe(); }
  });
}

it("does not deliver an old request to a replacement subscription using the same listener", async () => {
  const old = Promise.withResolvers<Response>(); let requests = 0, observations = 0;
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async () => ++requests === 1 ? old.promise : Response.json(refusal, { status: 401 }) });
  const listener = () => { observations++; };
  const first = client.subscribeProfileSessionStale(listener), pending = assert.rejects(client.bootstrap());
  first(); const replacement = client.subscribeProfileSessionStale(listener);
  try {
    old.resolve(Response.json(refusal, { status: 401 })); await pending;
    assert.equal(observations, 0);
    await assert.rejects(client.bootstrap()); assert.equal(observations, 1);
  } finally { old.resolve(Response.json(refusal, { status: 401 })); await pending; replacement(); }
});

for (const epoch of [1, 2]) it(`binds a public active-state observation to its actual authority (epoch ${epoch})`, async () => {
  const old = Promise.withResolvers<Response>(); let observedEpoch = 1, requests = 0, observations = 0;
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async url => {
    if (new URL(url).pathname.endsWith("/state")) return Response.json({ state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch: observedEpoch, duoState: "ready" });
    return ++requests === 1 ? old.promise : Response.json(refusal, { status: 401 });
  } });
  await client.readProfileSession();
  const unsubscribe = client.subscribeProfileSessionStale(() => { observations++; }), pending = assert.rejects(client.bootstrap());
  try {
    observedEpoch = epoch; await client.readProfileSession();
    old.resolve(Response.json(refusal, { status: 401 })); await pending;
    assert.equal(observations, epoch === 1 ? 1 : 0);
    await assert.rejects(client.bootstrap()); assert.equal(observations, epoch === 1 ? 2 : 1);
  } finally { old.resolve(Response.json(refusal, { status: 401 })); await pending; unsubscribe(); }
});

it("does not let a delayed old public-state read replace successful resume authority", async () => {
  const publicRead = Promise.withResolvers<Response>(), protectedRead = Promise.withResolvers<Response>();
  let reads = 0, observations = 0;
  const active = (epoch: number) => Response.json({ state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch, duoState: "ready" });
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async url => {
    const path = new URL(url).pathname;
    if (path.endsWith("/state")) return ++reads === 1 ? active(1) : publicRead.promise;
    if (path.endsWith("/resume")) return active(2);
    return protectedRead.promise;
  } });
  await client.readProfileSession(); const old = client.readProfileSession();
  const unsubscribe = client.subscribeProfileSessionStale(() => { observations++; });
  let pending: Promise<void> | undefined;
  try {
    await client.resumeProfile(); pending = assert.rejects(client.bootstrap());
    publicRead.resolve(active(1)); await old;
    protectedRead.resolve(Response.json(refusal, { status: 401 })); await pending;
    assert.equal(observations, 1);
  } finally { publicRead.resolve(active(1)); protectedRead.resolve(Response.json(refusal, { status: 401 })); await old; await pending; unsubscribe(); }
});
