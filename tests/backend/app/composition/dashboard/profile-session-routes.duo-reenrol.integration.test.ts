import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { z } from "zod";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { DuoReenrolStateSchema, PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
import { publicProfileShellFixture as fixture, readyPublicSignUp } from "../../../../support/helpers/backend/public-profile-shell.js";

const OPERATION = "00000000-0000-4000-8000-000000000010";
const ATTEMPT = "00000000-0000-4000-8000-000000000011";
const DOORS: readonly (readonly [string, unknown])[] = [
  ["begin", {}],
  ["read", { operationId: OPERATION }],
  ["browser", { operationId: OPERATION }],
  ["reopen", { operationId: OPERATION, generation: 0 }],
  ["portal", { operationId: OPERATION }],
  ["start", { operationId: OPERATION, method: "key" }],
  ["confirm", { operationId: OPERATION, method: "key", attemptId: ATTEMPT, operatorConfirmed: true }],
  ["cancel-attempt", { operationId: OPERATION, method: "key", attemptId: ATTEMPT }],
  ["cancel", { operationId: OPERATION }],
  ["commit", { operationId: OPERATION }],
];

async function boot(onboardingDuo: ReturnType<typeof syntheticOnboardingDuo> = syntheticOnboardingDuo()) {
  const f = await fixture();
  const runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
    backendPortOverride: 0, onboardingDuo, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
  const base = `http://127.0.0.1:${String(runtime.port)}`;
  return { f, runtime, base, stop: async () => { await runtime.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); } };
}

async function signedIn(base: string) {
  const ready = await readyPublicSignUp(base);
  const finished = await ready.finish();
  const state = PublicProfileStateSchema.parse(await finished.json());
  assert.equal(state.state, "active");
  if (state.state !== "active") throw new Error("active session required");
  const cookie = finished.headers.get("set-cookie")?.split(";", 1)[0];
  assert.ok(cookie);
  return { post: ready.post, cookie, state };
}

it("refuses every Duo re-enrolment route without the session cookie or the mutation guard, then returns the session result", async () => {
  let generation = 0;
  const synthetic = syntheticOnboardingDuo();
  const started = await boot({ ...synthetic,
    browserState() { return { state: "closed", generation }; },
    async recoverBrowser() { generation += 1; },
  });
  try {
    const { post, cookie, state } = await signedIn(started.base);
    for (const [route, body] of DOORS) {
      const path = `/api/v1/profile/duo/reenrol/${route}`;
      const missingCookie = await post(path, body);
      assert.deepEqual([route, missingCookie.status, await missingCookie.json()], [route, 409, { state: "refused", code: "PROFILE_SESSION_STALE" }]);
      const missingOrigin = await fetch(`${started.base}${path}`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
      assert.equal(missingOrigin.status, 403, route);
      assert.equal(z.object({ code: z.string() }).parse(await missingOrigin.json()).code, "OPERATOR_MUTATION_ORIGIN_REFUSED");
      const plain = await fetch(`${started.base}${path}`, { method: "POST", headers: { origin: started.base, "content-type": "text/plain", cookie }, body: "not-json" });
      assert.equal(plain.status, 415, route);
      assert.equal(z.object({ code: z.string() }).parse(await plain.json()).code, "OPERATOR_MUTATION_MEDIA_TYPE_REFUSED");
    }
    assert.equal((await post("/api/v1/profile/duo/reenrol/begin", { extra: true }, cookie)).status, 400);
    const begun = DuoReenrolStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/begin", {}, cookie)).json());
    assert.deepEqual([begun.state, begun.profileId, begun.step, begun.methods.key.state, begun.methods.touch.state], ["duo-reenrol", state.profileId, "duo", "idle", "idle"]);
    const read = DuoReenrolStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/read", { operationId: begun.operationId }, cookie)).json());
    assert.deepEqual(read, begun);
    assert.equal((await post("/api/v1/profile/duo/reenrol/read", { operationId: "nope" }, cookie)).status, 400);
    assert.equal((await post("/api/v1/profile/duo/reenrol/browser", { operationId: begun.operationId }, cookie)).status, 200);
    const reopened = DuoReenrolStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/reopen", { operationId: begun.operationId, generation: 0 }, cookie)).json());
    assert.equal(reopened.browser.generation, 1);
    assert.equal((await post("/api/v1/profile/duo/reenrol/portal", { operationId: begun.operationId }, cookie)).status, 200);
    const pending = DuoReenrolStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/start", { operationId: begun.operationId, method: "key" }, cookie)).json());
    assert.equal(pending.methods.key.state, "pending");
    const attemptId = pending.methods.key.attemptId;
    assert.ok(attemptId);
    const cancelledAttempt = DuoReenrolStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/cancel-attempt", { operationId: begun.operationId, method: "key", attemptId }, cookie)).json());
    assert.equal(cancelledAttempt.methods.key.state, "unknown");
    const abandoned = PublicProfileStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/cancel", { operationId: begun.operationId }, cookie)).json());
    assert.equal(abandoned.state, "active");
    const fresh = DuoReenrolStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/begin", {}, cookie)).json());
    const startedKey = DuoReenrolStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/start", { operationId: fresh.operationId, method: "key" }, cookie)).json());
    const confirmed = DuoReenrolStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/confirm", {
      operationId: fresh.operationId, method: "key", attemptId: startedKey.methods.key.attemptId, operatorConfirmed: true }, cookie)).json());
    assert.equal(confirmed.methods.key.state, "complete");
    const touch = DuoReenrolStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/start", { operationId: fresh.operationId, method: "touch" }, cookie)).json());
    assert.equal(touch.step, "ready");
    const committed = PublicProfileStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/commit", { operationId: fresh.operationId }, cookie)).json());
    assert.equal(committed.state, "active", JSON.stringify(committed));
    if (committed.state !== "active") throw new Error("committed re-enrolment required");
    assert.equal(committed.duoState, "ready");
    const gone = await post("/api/v1/profile/duo/reenrol/read", { operationId: fresh.operationId }, cookie);
    assert.deepEqual([gone.status, await gone.json()], [409, { state: "refused", code: "PROFILE_SESSION_STALE" }]);
    const foreign = await post("/api/v1/profile/duo/reenrol/begin", {}, "relay-profile-session=foreign");
    assert.deepEqual([foreign.status, await foreign.json()], [409, { state: "refused", code: "PROFILE_SESSION_STALE" }]);
  } finally { await started.stop(); }
});

it("closes an open Duo re-enrolment before logout and before delete account", async () => {
  const started = await boot();
  try {
    const { post, cookie, state } = await signedIn(started.base);
    const opened = DuoReenrolStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/begin", {}, cookie)).json());
    assert.equal((await post("/api/v1/profile/duo/reenrol/start", { operationId: opened.operationId, method: "key" }, cookie)).status, 200);
    const operation = join(started.f.machine.stateRoot, "machine", "operations", `${opened.operationId}.json`);
    assert.equal(existsSync(operation), true);
    const loggedOut = PublicProfileStateSchema.parse(await (await post("/api/v1/profile/logout", {}, cookie)).json());
    assert.deepEqual(loggedOut, { state: "signed-out", signUpRequired: false });
    assert.equal(existsSync(operation), false);
    const login = await post("/api/v1/profile/sign-in", { email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    const again = PublicProfileStateSchema.parse(await login.json());
    assert.equal(again.state, "active");
    if (again.state !== "active") throw new Error("sign-in after logout required");
    assert.equal(again.profileId, state.profileId);
    const session = login.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(session);
    const reopened = DuoReenrolStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/begin", {}, session)).json());
    assert.equal((await post("/api/v1/profile/duo/reenrol/start", { operationId: reopened.operationId, method: "key" }, session)).status, 200);
    const deletedResponse = await post("/api/v1/profile/delete-account", {
      confirmed: true, expectedProfileId: again.profileId, expectedEpoch: again.epoch }, session);
    const deleted = PublicProfileStateSchema.parse(await deletedResponse.json());
    assert.equal(existsSync(join(started.f.machine.stateRoot, "machine", "operations", `${reopened.operationId}.json`)), false);
    // Erasure proves the profile root is unused only on macOS. Elsewhere the re-enrolment is already gone and deletion refuses.
    if (process.platform === "darwin") {
      assert.deepEqual(deleted, { state: "signed-out", signUpRequired: true });
      const refused = PublicProfileStateSchema.parse(await (await post("/api/v1/profile/sign-in", { email: "fixture@ucsd.edu", password: "disposable-fixture-password" })).json());
      assert.equal(refused.state, "refused");
    } else {
      assert.deepEqual(deleted, { state: "refused", code: "PROFILE_ACCOUNT_DELETION_REFUSED" });
    }
  } finally { await started.stop(); }
});

it("leaves the session signed in when closing a re-enrolment for logout cannot prove the browser shut", async () => {
  let uncertain = false;
  const synthetic = syntheticOnboardingDuo();
  const started = await boot({ ...synthetic, async closeBrowser(...args) {
    return uncertain ? { state: "uncertain" } : synthetic.closeBrowser(...args);
  } });
  try {
    const { post, cookie } = await signedIn(started.base);
    const opened = DuoReenrolStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/begin", {}, cookie)).json());
    assert.equal((await post("/api/v1/profile/duo/reenrol/browser", { operationId: opened.operationId }, cookie)).status, 200);
    uncertain = true;
    const logout = await post("/api/v1/profile/logout", {}, cookie);
    assert.deepEqual([logout.status, await logout.json()], [409, { state: "refused", code: "BROWSER_CLOSURE_UNPROVED" }]);
    const still = PublicProfileStateSchema.parse(await (await fetch(`${started.base}/api/v1/profile/state`, { headers: { cookie } })).json());
    assert.equal(still.state, "active");
    const deleting = await post("/api/v1/profile/delete-account", { confirmed: true, expectedProfileId: still.state === "active" ? still.profileId : opened.profileId,
      expectedEpoch: still.state === "active" ? still.epoch : 1 }, cookie);
    assert.deepEqual([deleting.status, await deleting.json()], [409, { state: "refused", code: "BROWSER_CLOSURE_UNPROVED" }]);
    const kept = PublicProfileStateSchema.parse(await (await fetch(`${started.base}/api/v1/profile/state`, { headers: { cookie } })).json());
    assert.equal(kept.state, "active");
  } finally {
    // An unproved setup-browser close is retained custody, so shutdown refuses after the HTTP refusal.
    try { await started.runtime.stop(); } catch { /* retained closure */ }
    try { started.f.machine.release(); } catch { /* stop may already hold the admission */ }
    rmSync(started.f.root, { recursive: true, force: true });
  }
});
