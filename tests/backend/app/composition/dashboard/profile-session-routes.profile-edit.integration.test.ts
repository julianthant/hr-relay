import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { FrontendBootstrapWireSchema } from "../../../../../src/models/dashboard/bootstrap.js";
import { ProfileDetailsChangeResultSchema, PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
import { publicProfileShellFixture as fixture, readyPublicSignUp } from "../../../../support/helpers/backend/public-profile-shell.js";

it("serves a details change to the signed-in session only and serves the new values back on every read", async () => {
  const f = await fixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`, { post, finish } = await readyPublicSignUp(base);
    const finished = await finish();
    assert.equal(PublicProfileStateSchema.parse(await finished.json()).state, "active");
    const cookie = finished.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
    const change = async (body: unknown, session?: string) => {
      const response = await post("/api/v1/profile/account/details", body, session);
      return { status: response.status, body: await response.json() as unknown };
    };
    const account = async () => {
      const state = PublicProfileStateSchema.parse(await (await fetch(`${base}/api/v1/profile/state`, { headers: { cookie } })).json());
      return state.state === "active" ? state.account : undefined;
    };
    const actor = async () => FrontendBootstrapWireSchema.parse(await (await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie, origin: base } })).json()).actor.label;
    const original = await account();

    assert.deepEqual(await change({ initials: "FX" }), { status: 409, body: { state: "refused", code: "PROFILE_SESSION_STALE" } });
    const foreign = await fetch(`${base}/api/v1/profile/account/details`, { method: "POST", headers: { origin: "http://foreign.invalid", "content-type": "application/json", cookie },
      body: JSON.stringify({ initials: "FX" }) });
    assert.deepEqual([foreign.status, await foreign.json()], [403, { state: "refused", code: "PROFILE_SESSION_STALE" }]);
    for (const malformed of [{}, { initials: "FX", extra: true }, { name: { firstName: "Fixture" } }, { timekeeperName: "t".repeat(257) }]) {
      assert.equal((await change(malformed, cookie)).status, 400, JSON.stringify(malformed));
    }
    for (const initials of ["", "fx"]) {
      assert.deepEqual(await change({ initials }, cookie), { status: 200, body: { state: "refused", code: "PROFILE_INITIALS_REFUSED" } });
    }
    assert.deepEqual(await change({ name: { firstName: "", lastName: "Person" } }, cookie), { status: 200, body: { state: "refused", code: "PROFILE_DISPLAY_NAME_REFUSED" } });
    assert.deepEqual(await account(), original);

    const changed = await change({ name: { firstName: "Changed", lastName: "Person" }, initials: "CHP", timekeeperName: "Changed Timekeeper" }, cookie);
    assert.equal(changed.status, 200);
    const result = ProfileDetailsChangeResultSchema.parse(changed.body);
    assert.equal(result.state, "changed");
    assert.deepEqual(await account(), result.state === "changed" ? result.account : undefined);
    assert.deepEqual([result.state === "changed" && result.account.name, result.state === "changed" && result.account.initials,
      result.state === "changed" && result.account.timekeeper], ["Changed Person", "CHP", "Changed Timekeeper"]);
    assert.equal(await actor(), "Changed Person");
  } finally { await runtime?.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
});
