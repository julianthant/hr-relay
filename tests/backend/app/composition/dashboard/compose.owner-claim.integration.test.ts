import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { it, vi } from "vitest";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { acquireDashboardEntrypointAdmission, acquireEntrypointAdmission } from "../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { createHistoricalFlatProfileFixture, historicalFlatFields } from "../../../../support/fixtures/storage/historical-flat-profile-fixture.js";
import { join } from "node:path";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
import { createHistoricalIncompleteProfileFixture, historicalIncompleteProfileFields } from "../../../../support/fixtures/storage/historical-incomplete-profile-fixture.js";

it("admits an explicit in-app claim after its response settles, then reopens only the original private draft", async () => {
  const f = await createHistoricalIncompleteProfileFixture(), machine = acquireEntrypointAdmission(f.workspace, "shared");
  const paths = [f.databasePath, f.protectedPath, f.keyPath], before = paths.map(path => readFileSync(path));
  let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    application = await composeDashboardApplication({ admission: machine, isolation: rebuildRuntimeIsolation, repoRoot: f.workspace,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      onboardingDuo: syntheticOnboardingDuo(() => historicalIncompleteProfileFields.email) });
    const base = `http://127.0.0.1:${String(application.port)}`, endpoint = `${base}/api/v1/profile/claim-existing-data`;
    const request = { ...historicalIncompleteProfileFields, claimId: randomUUID(), claimExistingData: true };
    const post = (body: unknown, origin = base) => fetch(endpoint, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(body) });
    const foreign = await post(request, "https://foreign.invalid"); assert.equal(foreign.status, 403); await foreign.arrayBuffer();
    assert.equal(existsSync(f.operationPath), false);
    const wrong = await post({ ...request, password: "wrong-owner" });
    assert.deepEqual(PublicProfileStateSchema.parse(await wrong.json()), { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
    const accepted = await post(request);
    assert.equal(accepted.headers.get("set-cookie"), null);
    assert.deepEqual(PublicProfileStateSchema.parse(await accepted.json()), { state: "refused", code: "PROFILE_OWNER_CLAIM_STARTING" });
    await Promise.race([application.failure, vi.waitFor(async () => {
      assert.equal(existsSync(f.operationPath), true);
      const state = await fetch(`${base}/api/v1/profile/state`);
      assert.equal(state.status, 200); assert.deepEqual(await state.json(), { state: "signed-out" });
    }, { timeout: 15_000, interval: 100 })]);
    const resumed = await post({ ...request, claimId: randomUUID() });
    const draft = PublicProfileStateSchema.parse(await resumed.json());
    assert.equal(draft.state, "onboarding");
    if (draft.state !== "onboarding") throw new Error("same private draft required");
    assert.equal(draft.profileId, f.profileId); assert.equal(draft.operationId, f.operation.operationId);
    const cookie = resumed.headers.get("set-cookie"); assert.ok(cookie); assert.match(cookie, /relay-profile-onboarding=/u);
    assert.equal((await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie: cookie.split(";", 1)[0] ?? "" } })).status, 401);
    const signup = await fetch(`${base}/api/v1/profile/sign-up`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify(historicalIncompleteProfileFields) });
    assert.equal(PublicProfileStateSchema.parse(await signup.json()).state, "refused");
    for (const [index, path] of paths.entries()) assert.deepEqual(readFileSync(path), before[index]);
  } finally {
    await application?.stop(); machine.release(); await f.close();
  }
});

it("serves the same explicit owner-claim flow for flat data and reconnects only to its authenticated private draft", async () => {
  const f = createHistoricalFlatProfileFixture({ laterProtectedChange: true }), machine = await acquireDashboardEntrypointAdmission(f.workspace, "shared");
  let application: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    application = await composeDashboardApplication({ admission: machine, isolation: rebuildRuntimeIsolation, repoRoot: f.workspace,
      backendPortOverride: 0, frontendPortOverride: 0, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      onboardingDuo: syntheticOnboardingDuo(() => historicalFlatFields.email) });
    const base = `http://127.0.0.1:${String(application.port)}`, claimId = randomUUID();
    const request = { ...historicalFlatFields, claimId: claimId.toUpperCase(), claimExistingData: true };
    const post = (body: unknown) => fetch(`${base}/api/v1/profile/claim-existing-data`, { method: "POST",
      headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify(body) });
    const accepted = await post(request);
    assert.equal(accepted.headers.get("set-cookie"), null);
    assert.deepEqual(await accepted.json(), { state: "refused", code: "PROFILE_OWNER_CLAIM_STARTING" });
    await Promise.race([application.failure, vi.waitFor(async () => {
      assert.ok(existsSync(join(f.stateRoot, "profiles", claimId, "state.db")));
      const state = await fetch(`${base}/api/v1/profile/state`);
      assert.equal(state.status, 200); assert.deepEqual(await state.json(), { state: "signed-out" });
    }, { timeout: 15_000, interval: 100 })]);
    const wrong = await post({ ...request, password: "wrong-owner" });
    assert.deepEqual(await wrong.json(), { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
    const resumed = await post({ ...request, claimId: randomUUID() }), draft = PublicProfileStateSchema.parse(await resumed.json());
    assert.equal(draft.state, "onboarding");
    if (draft.state !== "onboarding") throw new Error("actual flat private draft required");
    assert.equal(draft.profileId, claimId);
    const cookie = resumed.headers.get("set-cookie"); assert.ok(cookie?.startsWith("relay-profile-onboarding="));
    assert.equal((await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie: cookie?.split(";", 1)[0] ?? "" } })).status, 401);
  } finally { await application?.stop(); machine.release(); f.close(); }
});
