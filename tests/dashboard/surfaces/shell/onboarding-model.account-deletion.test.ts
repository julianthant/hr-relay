// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { createDashboardClient, type DashboardClient } from "../../../../src/dashboard/client/index.js";
import { usePublicProfileSession } from "../../../../src/dashboard/surfaces/shell/onboarding-model.js";
import { PublicProfileStateSchema, type PublicProfileState } from "../../../../src/models/profiles/public-profile.js";

const active = (epoch = 1) => PublicProfileStateSchema.parse({ state: "active", profileId: "00000000-0000-4000-8000-000000000001", epoch, duoState: "ready" });
const cleanups: (() => Promise<void>)[] = [];
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); vi.useRealTimers(); });

function clientFor(initial: PublicProfileState, deletion: () => Promise<Response>, login = active(2)) {
  const calls: { path: string; body: unknown }[] = [];
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const path = new URL(url).pathname;
    calls.push({ path, body: typeof init?.body === "string" ? JSON.parse(init.body) as unknown : null });
    if (path.endsWith("/state")) return Response.json(initial);
    if (path.endsWith("/delete-account")) return deletion();
    if (path.endsWith("/sign-in")) return Response.json(login);
    if (path.endsWith("/logout")) return Response.json({ state: "signed-out" });
    throw new Error(`unexpected fixture request ${path}`);
  } });
  return { client, calls, deletes: () => calls.filter(call => call.path.endsWith("/delete-account")) };
}

async function mount(client: DashboardClient, enabled = true) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  let value!: ReturnType<typeof usePublicProfileSession>;
  let open = true;
  function Probe({ current, enabled }: { current: DashboardClient; enabled: boolean }) { value = usePublicProfileSession(current, enabled); return null; }
  const render = async (current = client, nextEnabled = enabled) => { await act(async () => root.render(createElement(Probe, { current, enabled: nextEnabled }))); };
  const close = async () => { if (open) { open = false; await act(async () => root.unmount()); host.remove(); } };
  cleanups.push(close);
  await render();
  return { session: () => value, render, close };
}

it("dispatches once from a ready profile and settles only its signed-out acknowledgment", async () => {
  const response = Promise.withResolvers<Response>();
  const f = clientFor(active(), () => response.promise), h = await mount(f.client);
  assert.equal(h.session().accountDeletion.state, "idle");
  assert.equal(f.deletes().length, 0);
  let pending!: Promise<void>;
  await act(async () => { pending = h.session().deleteAccount(); await h.session().deleteAccount(); await h.session().logout(); });
  assert.equal(h.session().accountDeletion.state, "deleting");
  assert.deepEqual(f.deletes(), [{ path: "/api/v1/profile/delete-account", body: { confirmed: true } }]);
  assert.equal(f.calls.some(call => call.path.endsWith("/logout")), false);
  await act(async () => { response.resolve(Response.json({ state: "signed-out", signUpRequired: true })); await pending; });
  assert.deepEqual(h.session().state, { state: "signed-out", signUpRequired: true });
  await act(async () => h.session().deleteAccount());
  assert.equal(f.deletes().length, 1);
});

for (const outcome of ["refused", "error", "cancelling", "active", "lost"] as const) it(`retains ${outcome} without inferring erasure, polling or resending`, async () => {
  vi.useFakeTimers();
  const f = clientFor(active(), async () => {
    if (outcome === "lost") throw new Error("private diagnostic");
    return Response.json(outcome === "active" ? active() : outcome === "cancelling"
      ? { state: "cancelling", operationId: "00000000-0000-4000-8000-000000000002" }
      : { state: outcome, code: "PROFILE_ACCOUNT_DELETION_REFUSED" });
  });
  const h = await mount(f.client);
  await act(async () => h.session().deleteAccount());
  assert.deepEqual(h.session().state, active());
  assert.deepEqual(h.session().accountDeletion, outcome === "refused" || outcome === "error"
    ? { state: "refused", code: "PROFILE_ACCOUNT_DELETION_REFUSED" } : { state: "uncertain" });
  await act(async () => { await vi.advanceTimersByTimeAsync(3000); await h.session().deleteAccount(); await h.session().logout(); });
  assert.equal(f.calls.length, 2);
  assert.equal(f.deletes().length, 1);
});

for (const replacement of ["client", "epoch", "unmount"] as const) it(`ignores a late deletion reply after ${replacement} replacement`, async () => {
  const response = Promise.withResolvers<Response>();
  const f = clientFor(active(), () => response.promise), h = await mount(f.client);
  const oldDelete = h.session().deleteAccount;
  let pending!: Promise<void>;
  await act(async () => { pending = oldDelete(); });
  if (replacement === "client") {
    const next = clientFor(active(2), async () => Response.json({ state: "signed-out" }));
    await h.render(next.client);
  } else if (replacement === "epoch") {
    await act(async () => { await h.session().port.submit("login", { firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "synthetic-password" }); });
  } else await h.close();
  await act(async () => { response.resolve(Response.json({ state: "signed-out", signUpRequired: true })); await pending; await oldDelete(); });
  assert.equal(f.deletes().length, 1);
  if (replacement !== "unmount") {
    assert.deepEqual(h.session().state, active(2));
    assert.equal(h.session().accountDeletion.state, "idle");
  }
});

for (const enabled of [true, false]) it(`refuses deletion without active ready authority, enabled=${enabled}`, async () => {
  const f = clientFor({ state: "signed-out" }, async () => { throw new Error("must not dispatch"); }), h = await mount(f.client, enabled);
  await act(async () => h.session().deleteAccount());
  assert.equal(f.deletes().length, 0);
});

it("refuses deletion until the active profile's Duo setup is ready", async () => {
  const initial = PublicProfileStateSchema.parse({ ...active(), duoState: "not-set-up" });
  const f = clientFor(initial, async () => { throw new Error("must not dispatch"); }), h = await mount(f.client);
  await act(async () => h.session().deleteAccount());
  assert.equal(f.deletes().length, 0);
  assert.equal(h.session().accountDeletion.state, "idle");
});

it("does not dispatch deletion while logout is already in flight", async () => {
  const response = Promise.withResolvers<PublicProfileState>();
  const f = clientFor(active(), async () => { throw new Error("must not dispatch"); });
  const h = await mount({ ...f.client, logOutProfile: () => response.promise });
  let pending!: Promise<void>;
  await act(async () => { pending = h.session().logout(); await h.session().deleteAccount(); });
  assert.equal(f.deletes().length, 0);
  await act(async () => { response.resolve({ state: "signed-out" }); await pending; });
  assert.deepEqual(h.session().state, { state: "signed-out" });
});

it("rejects an old confirmation after the same session loses Duo readiness", async () => {
  const unready = PublicProfileStateSchema.parse({ ...active(), duoState: "not-set-up" });
  const f = clientFor(active(), async () => Response.json({ state: "signed-out" }), unready), h = await mount(f.client);
  const previousDelete = h.session().deleteAccount;
  await act(async () => { await h.session().port.submit("login", { firstName: "Fixture", lastName: "Operator", email: "fixture@ucsd.edu", password: "synthetic-password" }); });
  assert.deepEqual(h.session().state, unready);
  await act(async () => previousDelete());
  assert.equal(f.deletes().length, 0);
  assert.deepEqual(h.session().state, unready);
});
