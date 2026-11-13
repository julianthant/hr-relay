import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { FrontendBootstrapWireSchema } from "../../../../../src/models/dashboard/bootstrap.js";
import { ProfileDetailsChangeResultSchema, PublicProfileStateSchema, type ProfileAccount } from "../../../../../src/models/profiles/public-profile.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
import { publicProfileShellFixture as fixture, readyPublicSignUp } from "../../../../support/helpers/backend/public-profile-shell.js";

/** A served dashboard with one finished sign-up, and the details route, account and actor reads of that session. */
async function withSignedInDashboard(body: (served: Readonly<{ base: string; cookie: string; change(body: unknown, session?: string): Promise<{ status: number; body: unknown }>;
  account(): Promise<ProfileAccount | undefined>; actor(): Promise<string> }>) => Promise<void>): Promise<void> {
  const f = await fixture();
  let runtime: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  try {
    runtime = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, isolation: rebuildRuntimeIsolation, repoRoot: f.root,
      backendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
    const base = `http://127.0.0.1:${String(runtime.port)}`, { post, finish } = await readyPublicSignUp(base);
    const finished = await finish();
    assert.equal(PublicProfileStateSchema.parse(await finished.json()).state, "active");
    const cookie = finished.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie);
    await body({ base, cookie,
      async change(request, session) {
        const response = await post("/api/v1/profile/account/details", request, session);
        return { status: response.status, body: await response.json() as unknown };
      },
      async account() {
        const state = PublicProfileStateSchema.parse(await (await fetch(`${base}/api/v1/profile/state`, { headers: { cookie } })).json());
        return state.state === "active" ? state.account : undefined;
      },
      async actor() { return FrontendBootstrapWireSchema.parse(await (await fetch(`${base}/api/v1/bootstrap`, { headers: { cookie, origin: base } })).json()).actor.label; } });
  } finally { await runtime?.stop(); f.machine.release(); rmSync(f.root, { recursive: true, force: true }); }
}

it("serves a details change to the signed-in session only and serves the new values back on every read", async () => {
  await withSignedInDashboard(async ({ base, cookie, change, account, actor }) => {
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
  });
});

it("stores, accepts and serves the timekeeper initials apart from the timekeeper name", async () => {
  await withSignedInDashboard(async ({ cookie, change, account }) => {
    const original = await account(); assert.ok(original);
    assert.equal(original.timekeeperInitials, original.initials);
    for (const timekeeperInitials of ["", "fx", "F.X", "ABCDEFGHI"]) {
      assert.deepEqual(await change({ timekeeperInitials }, cookie), { status: 200, body: { state: "refused", code: "PROFILE_INITIALS_REFUSED" } }, timekeeperInitials);
    }
    assert.equal((await change({ timekeeperInitials: "F".repeat(65) }, cookie)).status, 400);
    assert.deepEqual(await account(), original);

    const renamed = ProfileDetailsChangeResultSchema.parse((await change({ timekeeperName: "Changed Timekeeper" }, cookie)).body);
    assert.deepEqual(renamed, { state: "changed", account: { ...original, timekeeper: "Changed Timekeeper" } });
    const relettered = ProfileDetailsChangeResultSchema.parse((await change({ timekeeperInitials: "TKX" }, cookie)).body);
    assert.deepEqual(relettered, { state: "changed", account: { ...original, timekeeper: "Changed Timekeeper", timekeeperInitials: "TKX" } });
    assert.deepEqual(await account(), { ...original, timekeeper: "Changed Timekeeper", timekeeperInitials: "TKX" });
  });
});
