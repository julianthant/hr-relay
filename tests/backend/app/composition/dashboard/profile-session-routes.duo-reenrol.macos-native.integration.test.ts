import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { DuoReenrolStateSchema, PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { syntheticOnboardingDuo } from "../../../../support/helpers/admission-fixture.js";
import { publicProfileShellFixture, readyPublicSignUp } from "../../../../support/helpers/backend/public-profile-shell.js";

it("erases the account on macOS with a Duo re-enrolment open", async () => {
  assert.equal(process.platform, "darwin", "account erasure requires the macOS closure proof");
  const fixture = await publicProfileShellFixture();
  const runtime = await composeDashboardApplication({ lifetimeLock: fixture.lifetime, admission: fixture.machine, isolation: rebuildRuntimeIsolation, repoRoot: fixture.root,
    backendPortOverride: 0, onboardingDuo: syntheticOnboardingDuo(), env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners });
  try {
    const { post, finish } = await readyPublicSignUp(`http://127.0.0.1:${String(runtime.port)}`);
    const finished = await finish();
    const active = PublicProfileStateSchema.parse(await finished.json());
    assert.equal(active.state, "active");
    const cookie = finished.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);

    const opened = DuoReenrolStateSchema.parse(await (await post("/api/v1/profile/duo/reenrol/begin", {}, cookie)).json());
    assert.equal((await post("/api/v1/profile/duo/reenrol/start", { operationId: opened.operationId, method: "key" }, cookie)).status, 200);
    const operation = join(fixture.machine.stateRoot, "machine", "operations", `${opened.operationId}.json`);
    assert.equal(existsSync(operation), true);
    const response = await post("/api/v1/profile/delete-account", {
      confirmed: true, expectedProfileId: active.profileId, expectedEpoch: active.epoch }, cookie);
    const deleted = PublicProfileStateSchema.parse(await response.json());
    assert.equal(existsSync(operation), false);
    assert.deepEqual(deleted, { state: "signed-out", signUpRequired: true });
    const signIn = await post("/api/v1/profile/sign-in", { email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    assert.equal(PublicProfileStateSchema.parse(await signIn.json()).state, "refused");
  } finally {
    await runtime.stop();
    fixture.machine.release();
    rmSync(fixture.root, { recursive: true, force: true });
  }
});
