// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { PublicProfileStateSchema, type PublicProfileState } from "../../../../src/models/profiles/public-profile.js";
import { usePublicProfileSession } from "../../../../src/dashboard/surfaces/shell/onboarding-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const active = (epoch = 1) => PublicProfileStateSchema.parse({ state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch, duoState: "ready" });

async function fixture(response: () => Response | Promise<Response> = () => Response.json({ state: "refused", code: "PROFILE_SESSION_STALE" }, { status: 401 })) {
  let reads = 0, resumes = 0;
  const requests: string[] = [];
  let current: () => Promise<PublicProfileState> = async () => active();
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async url => {
    const path = new URL(url).pathname;
    requests.push(path);
    if (path === "/api/v1/profile/state") { reads++; return Response.json(await current()); }
    if (path === "/api/v1/profile/resume") { resumes++; return Response.json(active(2)); }
    if (path === "/api/v1/profile/sign-in") return Response.json(active(3));
    if (path === "/api/v1/bootstrap") return response();
    throw new Error(`unexpected fixture request ${path}`);
  } });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let session!: ReturnType<typeof usePublicProfileSession>;
  function Probe() { session = usePublicProfileSession(client, true); return createElement("output", null, session.state?.state); }
  await act(async () => root.render(createElement(Probe)));
  return { client, session: () => session, reads: () => reads, resumes: () => resumes, requests: () => requests,
    next(read: () => Promise<PublicProfileState>) { current = read; },
    reject: () => act(async () => { await assert.rejects(client.bootstrap()); }),
    async close() { await act(async () => root.unmount()); host.remove(); } };
}

it("reconciles an open tab's revoked cookie through public session state and the existing resume action", async () => {
  const f = await fixture();
  try {
    f.next(async () => ({ state: "signed-out", resumable: true }));
    await f.reject();
    assert.deepEqual(f.session().state, { state: "signed-out", resumable: true });
    assert.equal(f.reads(), 2); assert.equal(f.resumes(), 0);
    assert.deepEqual(f.requests(), ["/api/v1/profile/state", "/api/v1/bootstrap", "/api/v1/profile/state"]);
    await act(async () => { await f.session().port.resume(); });
    assert.deepEqual(f.session().state, active(2)); assert.equal(f.resumes(), 1);
  } finally {
    await f.close();
    assert.equal(f.requests().some(path => path === "/api/v1/profile/sign-in" || path === "/api/v1/profile/logout"), false);
  }
});

for (const [status, body] of [
  [500, { state: "refused", code: "PROFILE_SESSION_STALE" }],
  [401, { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" }],
  [401, { state: "refused", code: "PROFILE_SESSION_STALE", extra: "malformed" }],
  [200, { state: "refused", code: "PROFILE_SESSION_STALE" }],
] as const) it(`does not reinterpret ${status} ${JSON.stringify(body)} as session invalidation`, async () => {
  const f = await fixture(() => Response.json(body, { status }));
  try { await f.reject(); assert.equal(f.reads(), 1); assert.deepEqual(f.session().state, active()); }
  finally { await f.close(); }
});

it("joins concurrent stale replies and ignores the refresh after a newer sign-in", async () => {
  const reply = Promise.withResolvers<PublicProfileState>(), f = await fixture();
  try {
    f.next(() => reply.promise);
    await act(async () => { await Promise.all([assert.rejects(f.client.bootstrap()), assert.rejects(f.client.bootstrap())]); });
    assert.equal(f.reads(), 2);
    assert.equal(f.session().state, undefined); assert.equal(f.session().failure, false);
    await act(async () => { await f.session().port.submit("login", { firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "fixture-password" }); });
    f.next(async () => active(3));
    await f.reject(); assert.equal(f.reads(), 3);
    await act(async () => { reply.resolve({ state: "signed-out", resumable: true }); });
    assert.deepEqual(f.session().state, active(3));
  } finally { reply.resolve({ state: "signed-out" }); await f.close(); }
});

it("preserves an unavailable reconciliation as failure without inferring sign-out or resuming", async () => {
  const f = await fixture();
  try {
    f.next(async () => { throw new Error("fixture public session unavailable"); });
    await f.reject();
    assert.equal(f.reads(), 2); assert.equal(f.session().failure, true);
    assert.equal(f.resumes(), 0); assert.equal(f.session().state, undefined);
  } finally { await f.close(); }
});

it("ignores an old protected 401 released after successful recovery while a new request still reconciles", async () => {
  const oldResponse = Promise.withResolvers<Response>(), publicResponse = Promise.withResolvers<PublicProfileState>();
  let requests = 0;
  const stale = () => Response.json({ state: "refused", code: "PROFILE_SESSION_STALE" }, { status: 401 });
  const f = await fixture(() => ++requests === 1 ? oldResponse.promise : stale());
  const oldFailure = assert.rejects(f.client.bootstrap());
  try {
    f.next(async () => ({ state: "signed-out", resumable: true }));
    await f.reject();
    await act(async () => { await f.session().port.resume(); });
    assert.deepEqual(f.session().state, active(2));
    const recovered = f.session().state;
    f.next(() => publicResponse.promise);
    await act(async () => { oldResponse.resolve(stale()); await oldFailure; });
    assert.equal(f.reads(), 2, "an old protected response must not read current public authority again");
    assert.equal(f.session().state, recovered, "old authority must not clear the active recovered selection");
    await f.reject();
    assert.equal(f.reads(), 3); assert.equal(f.session().state, undefined);
    await act(async () => { publicResponse.resolve({ state: "signed-out", resumable: true }); });
    assert.equal(requests, 3); assert.equal(f.resumes(), 1);
  } finally {
    oldResponse.resolve(stale()); publicResponse.resolve({ state: "signed-out" }); await oldFailure; await f.close();
  }
});
