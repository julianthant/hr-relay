import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/profile-session-routes.js";
import { acquireEntrypointAdmission } from "../../../../../src/backend/storage/admission/bootstrap-admission.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { createDashboardClient } from "../../../../../src/dashboard/client/index.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";

it("resumes current authority after a real restart and plans both workflows while old and foreign cookies remain refused", async () => {
  const f = await createBoundProfileFixture({ sharedMachine: true }), clock = manualClock(new Date("2026-11-04T12:00:00Z"));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(f.workspace, name));
  let machine = f.machine, app: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined;
  let origin = "", cookie: string | undefined, spawns = 0;
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async (url, init) => {
    const response = await fetch(`${origin}${new URL(url).pathname}`, { ...init,
      headers: { ...init?.headers, origin, ...(cookie === undefined ? {} : { cookie }) } });
    const next = response.headers.get("set-cookie"); if (next !== null) cookie = next.split(";", 1)[0];
    return response;
  } });
  const start = async () => {
    app = await composeDashboardApplication({ admission: machine, lifetimeLock: f.lifetime, repoRoot: f.workspace, isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0, frontendPortOverride: 0, clock, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      workerProcess: { spawn() { spawns++; throw new Error("planning must not spawn a worker"); } } });
    origin = `http://127.0.0.1:${app.port}`;
  };
  try {
    await start();
    const first = await client.signInProfile({ email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    assert.equal(first.state, "active"); if (first.state !== "active") throw new Error("actual initial sign-in required");
    await client.bootstrap(); assert.ok(cookie); const oldCookie = cookie;
    await app?.stop(); app = undefined;
    machine = acquireEntrypointAdmission(f.workspace, "shared", f.lifetime);
    await start();
    await assert.rejects(client.bootstrap());
    assert.deepEqual(await client.readProfileSession(), { state: "signed-out", signUpRequired: false, resumable: true });
    const resumed = await client.resumeProfile();
    assert.equal(resumed.state, "active"); if (resumed.state !== "active") throw new Error("current resume authority required");
    assert.equal(resumed.profileId, first.profileId); assert.ok(resumed.epoch > first.epoch); assert.notEqual(cookie, oldCookie);
    await client.bootstrap();
    for (const rejectedCookie of [oldCookie, oldCookie.replace(/=.*/u, "=foreign")]) {
      const response = await fetch(`${origin}/api/v1/bootstrap`, { headers: { cookie: rejectedCookie } });
      assert.equal(response.status, 401); assert.deepEqual(await response.json(), { state: "refused", code: "PROFILE_SESSION_STALE" });
    }
    for (const input of [
      { workflowId: "person-lookup", submissions: [{ emplId: "10873698" }], dryRun: false },
      { workflowId: "separations", submissions: [{ documentNumber: "4510" }], dryRun: true },
    ]) assert.deepEqual((await client.submitStartPlan({ ...input, browserMode: "headless", captureBrowserScreenshots: false })).refused, []);
    assert.equal(spawns, 0);
    assert.equal((await client.logOutProfile()).state, "signed-out");
    assert.equal((await client.readProfileSession()).state, "signed-out");
    assert.deepEqual(await client.resumeProfile(), { state: "refused", code: "PROFILE_SIGN_IN_REFUSED" });
    await assert.rejects(client.bootstrap());
  } finally { await app?.stop(); await f.close(); }
});
