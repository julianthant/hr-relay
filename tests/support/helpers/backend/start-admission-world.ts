import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { composeDashboardRuntime } from "../../../../src/backend/app/composition/dashboard/compose.js";
import { composeProfileRuntime } from "../../../../src/backend/app/composition/storage-compose.js";
import { rebuildRuntimeIsolation } from "../../../../src/backend/app/config/runtime-isolation.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import { createBoundProfileFixture } from "../admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../fixtures/preflight-seams.js";

/** A signed-in dashboard whose worker spawner counts and refuses every spawn; `realDoctor` lets a test race the authority doctor. */
export async function startAdmissionFixture(realDoctor = false) {
  const profile = await createBoundProfileFixture();
  const clock = manualClock(new Date("2026-10-21T12:00:00.000Z"));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(profile.workspace, name));
  const runtime = composeProfileRuntime({ admission: profile.machine, clock, hostFacts: { primaryDisplay: null } });
  const active = runtime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: clock.now().toISOString() });
  assert.equal(active.state, "active");
  if (active.state !== "active") throw new Error("profile activation required");
  const context = runtime.selectedContext(active.token);
  let doctorRace = false;
  const detectorErrors: unknown[] = [];
  let spawns = 0;
  try {
    const dashboard = await composeDashboardRuntime({ lifetimeLock: profile.lifetime, admission: profile.machine, profile: { runtime, token: active.token },
      repoRoot: profile.workspace, clock, isolation: rebuildRuntimeIsolation, env: {}, backendPortOverride: 0, frontendPortOverride: 0,
      preflightRunnerFactory: input => healthyRuntimePreflightRunners(input).map(runner => !realDoctor || runner.check !== "authority.health" ? runner : {
        ...runner, async run(check) {
          const checking = input.dashboard.authorityHealth.run(check);
          if (doctorRace) context.database.authority.notifications.create({ notificationId: randomUUID(), actorId: "local-operator", dedupeFingerprint: "e".repeat(64),
            trigger: "failed", channel: "ping", status: "unread", snooze: { state: "not-snoozed" }, title: "Fixture notice", summary: "Concurrent fixture write",
            links: [{ kind: "run", runId: "00010001-0001-4001-8001-000100010001" }], count: 1, lastSeenAt: clock.now().toISOString(), version: 1,
            createdAt: clock.now().toISOString(), updatedAt: clock.now().toISOString() });
          try { return await checking; } catch (error) { detectorErrors.push(error); throw error; }
        },
      }),
      workerProcess: { spawn: () => { spawns += 1; throw new Error("refused start must not spawn a worker"); } } });
    const origin = `http://127.0.0.1:${String(dashboard.port)}`;
    return { profile, runtime, dashboard, token: active.token, clock, context, spawns: () => spawns, detectorErrors, armDoctorRace() { doctorRace = true; }, disarmDoctorRace() { doctorRace = false; },
      post: (path: string, input: unknown) => fetch(`${origin}/api/v1/${path}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify(input) }),
      async close() { try { await dashboard.stop(); } finally { await profile.close(); } } };
  } catch (error) { await runtime.close(); await profile.close(); throw error; }
}
