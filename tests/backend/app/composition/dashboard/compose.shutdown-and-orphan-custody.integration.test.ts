import { assertRuntimeLifetimeHeld } from "../../../../support/helpers/backend/runtime-lifetime.js";
import { RuntimeLifetimeLock } from "../../../../../src/backend/storage/admission/lifetime-lock.js";
import { createDashboardChildTestWorld, type RealChildRecord } from "../../../../support/helpers/backend/dashboard-child-world.js";
import { workerPoolMember } from "../../../../../src/models/run/worker-slot.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { createBoundProfileFixture, releaseAdmissionFixture, releaseAdmissionFixtures } from "../../../../support/helpers/admission-fixture.js";
import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "vitest";
import { composeDashboardRuntime, type DashboardRuntime } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { type WorkerPoolMember } from "../../../../../src/models/run/worker-slot.js";
import { WorkflowIdSchema } from "../../../../../src/rules/identity/ids.js";
import { systemClock } from "../../../../../src/rules/time/clock.js";
import { composeProfileRuntime } from "../../../../../src/backend/app/composition/storage-compose.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";

const { stubLaunch, PL, required, cleanups, envelope, realStubSpawner, pidAlive, waitFor, cleanup } = createDashboardChildTestWorld(() => releaseAdmissionFixtures(), (root) => releaseAdmissionFixture(root));

const SEP = WorkflowIdSchema.parse("separations");

afterEach(cleanup, 30_000);

describe("real runtime: dashboard shutdown drains children before parent kernel custody releases", () => {
  it(
    "two real children over the real ingress; internal child shutdown, dashboard shutdown with one live child, then PID-proved teardown",
    async () => {
      const profile = await createBoundProfileFixture({ sharedMachine: true }), repoRoot = profile.workspace;
      copyFileSync(join(process.cwd(), "package.json"), join(repoRoot, "package.json"));
      copyFileSync(join(process.cwd(), "package-lock.json"), join(repoRoot, "package-lock.json"));
      const stateRoot = profile.stateRoot;
      const dbPath = join(stateRoot, "state.db");
      const records: RealChildRecord[] = [];
      const faultLines: string[] = [];
      const childOutput = (): string => records.map(record => record.argv.join(" ")).join("\n");
      const recordOf = (workerId: string) => records.find(record => record.argv.includes(workerId));

      const profileRuntime = composeProfileRuntime({ admission: profile.machine, clock: systemClock, hostFacts: { primaryDisplay: null } });
      cleanups.push(async () => { await profileRuntime.close(); await profile.close(); });
      const active = profileRuntime.session.signIn({ email: "fixture@ucsd.edu", password: "disposable-fixture-password", at: systemClock.now().toISOString() });
      assert.equal(active.state, "active");
      if (active.state !== "active") throw new Error("fixture-profile-sign-in-refused");
      const context = profileRuntime.selectedContext(active.token);
      const runtime: DashboardRuntime = await composeDashboardRuntime({ lifetimeLock: profile.lifetime, admission: profile.machine, profile: { runtime: profileRuntime, token: active.token }, preflightRunnerFactory: healthyRuntimePreflightRunners,
        isolation: rebuildRuntimeIsolation,
        backendPortOverride: 0,
        frontendPortOverride: 0,
        env: {},
        repoRoot,
        workerProcess: {
          launch: stubLaunch(profile.lifetime),
          spawn: realStubSpawner(records, profile.lifetime),
          faultSink: (line) => {
            faultLines.push(line);
          },
        },
      });
      const stops: (() => Promise<void>)[] = [() => runtime.stop()];
      cleanups.push(async () => {
        for (const stop of stops.splice(0)) await stop();
      });

      const post = async (body: Record<string, unknown>): Promise<{ status: number; state: string }> => {
        const origin = `http://127.0.0.1:${String(runtime.port)}`;
        const response = await fetch(`${origin}/api/v1/commands`, {
          method: "POST",
          headers: { "content-type": "application/json", origin },
          body: JSON.stringify(body),
        });
        return { status: response.status, state: ((await response.json()) as { state: string }).state };
      };

      // Two REAL children, two workflows, spawned concurrently over the real
      // ingress; each proves its own birth by writing its durable lease.
      for (const workflowId of [PL, SEP]) {
        assert.deepEqual(await post({ ...envelope(systemClock), type: "plan-worker-count",
          target: { workflowId, expectedVersion: 0 }, payload: { desiredWorkers: 1 } }), { status: 200, state: "applied" });
      }
      const roster = AuthorityDatabase.open(context.admission, { path: dbPath, busyTimeoutMs: 5_000, migrationOwner: "unit-test" }, systemClock, undefined, undefined, undefined, context.credentials);
      let PL_1: WorkerPoolMember; let SEP_1: WorkerPoolMember;
      try {
        PL_1 = workerPoolMember(required(roster.authority.workerSlots.list(PL).find(slot => slot.retiredAt === null), "PL slot"));
        SEP_1 = workerPoolMember(required(roster.authority.workerSlots.list(SEP).find(slot => slot.retiredAt === null), "SEP slot"));
      } finally { roster.close(); }
      await waitFor(() => recordOf(PL_1.workerId) !== undefined && recordOf(SEP_1.workerId) !== undefined, "both planned members to spawn", childOutput);
      const plRecord = required(recordOf(PL_1.workerId), "PL child");
      const sepRecord = required(recordOf(SEP_1.workerId), "SEP child");
      const plPid = required(plRecord.pid, "PL pid");
      const sepPid = required(sepRecord.pid, "SEP pid");
      assert.equal(pidAlive(plPid) && pidAlive(sepPid), true, childOutput());

      // A member that crashed earlier never blocks shutdown; its peer is stopped over IPC.
      assert.equal(plRecord.child.kill("SIGTERM"), true);
      await waitFor(() => !pidAlive(plPid), "the stopped child's pid to die", childOutput);

      // Composition drains children while its caller retains the kernel listener.
      await assertRuntimeLifetimeHeld(profile.lifetime);
      for (const stop of stops.splice(0)) await stop();
      await assertRuntimeLifetimeHeld(profile.lifetime);
      assert.deepEqual(faultLines, [], "owned children drain without shutdown faults");
      assert.equal(pidAlive(sepPid), false, "dashboard shutdown must drain its owned child");
      assert.deepEqual(
        [PL_1, SEP_1].map(member => ({ workerId: member.workerId, alive: pidAlive(required(recordOf(member.workerId)?.pid, "pid")) })),
        [
          { workerId: PL_1.workerId, alive: false },
          { workerId: SEP_1.workerId, alive: false },
        ],
      );
      await profileRuntime.close();
      await profile.closeController();
      assert.throws(() => profile.lifetime.assertHeld());
      const replacement = await RuntimeLifetimeLock.acquire(profile.lifetime.port);
      await replacement.close();
    },
    120_000,
  );
});
