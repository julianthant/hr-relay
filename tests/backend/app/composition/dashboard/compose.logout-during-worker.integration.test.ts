import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { it, vi } from "vitest";
import * as profiles from "../../../../../src/backend/app/composition/storage-compose.js";
import { composeDashboardApplication } from "../../../../../src/backend/app/composition/dashboard/compose.js";
import { rebuildRuntimeIsolation } from "../../../../../src/backend/app/config/runtime-isolation.js";
import { AuthorityDatabase } from "../../../../../src/backend/storage/sqlite/authority-database.js";
import { createCredentialStore } from "../../../../../src/backend/storage/configuration/credential-store.js";
import { RunRecordService, requireLifecycleApplied } from "../../../../../src/backend/runs/lifecycle/run-record-service.js";
import { selectRunRuntime } from "../../../../../src/backend/runs/settings/run-settings.js";
import { CommandResultSchema } from "../../../../../src/rules/commands/commands.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { StartPlanWireSchema } from "../../../../../src/models/dashboard/start-plan.js";
import { PublicProfileStateSchema } from "../../../../../src/models/profiles/public-profile.js";
import { FakeWorkerChild } from "../../../../support/helpers/backend/dashboard-pool-world.js";
import { ManualScheduler } from "../../../../support/helpers/phase1f-executor-harness.js";
import { createBoundProfileFixture } from "../../../../support/helpers/admission-fixture.js";
import { healthyRuntimePreflightRunners } from "../../../../support/fixtures/preflight-seams.js";
import { testWorkerLifetime } from "../../../../support/fixtures/run-lifecycle-fixtures.js";

vi.mock("../../../../../src/backend/app/composition/storage-compose.js", { spy: true });

it("drains an owned claimed worker under its admitted epoch before public logout revokes it", async () => {
  const f = await createBoundProfileFixture(), clock = manualClock(new Date("2026-11-04T12:00:00.000Z"));
  for (const name of ["package.json", "package-lock.json"]) copyFileSync(name, join(f.workspace, name));
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>(), spawned = Promise.withResolvers<void>();
  const actual = (await vi.importActual<typeof profiles>("../../../../../src/backend/app/composition/storage-compose.js")).composeProfileRuntime;
  let context: ReturnType<ReturnType<typeof actual>["selectedContext"]> | undefined;
  const factory = vi.spyOn(profiles, "composeProfileRuntime").mockImplementation(input => {
    const runtime = actual(input);
    return { ...runtime, selectedContext(token) { context = runtime.selectedContext(token); return context; },
      bindSupervisor(token, supervisor) { runtime.bindSupervisor(token, { ...supervisor,
        async drainOwnedChildren(directive) { entered.resolve(); await release.promise; return supervisor.drainOwnedChildren(directive); } }); } };
  });
  const scheduler = new ManualScheduler(clock, 0), child = new FakeWorkerChild(7001);
  let app: Awaited<ReturnType<typeof composeDashboardApplication>> | undefined, worker: AuthorityDatabase | undefined;
  let workerOwner: ReturnType<typeof f.machine.admitProfile> | undefined, logout: Promise<Response> | undefined, exited = false, primary: unknown;
  try {
    app = await composeDashboardApplication({ lifetimeLock: f.lifetime, admission: f.machine, repoRoot: f.workspace, isolation: rebuildRuntimeIsolation,
      backendPortOverride: 0, frontendPortOverride: 0, clock, env: {}, preflightRunnerFactory: healthyRuntimePreflightRunners,
      workerProcess: { scheduler, spawn() { spawned.resolve(); return child; } } });
    const origin = `http://127.0.0.1:${app.port}`;
    const post = (path: string, body: unknown, cookie?: string) => fetch(`${origin}/api/v1/${path}`, { method: "POST",
      headers: { origin, "content-type": "application/json", ...(cookie === undefined ? {} : { cookie }) }, body: JSON.stringify(body) });
    const login = await post("profile/sign-in", { email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    assert.equal(login.status, 200); assert.equal(PublicProfileStateSchema.parse(await login.json()).state, "active");
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0]; assert.ok(cookie); assert.ok(context);
    const profileId = f.machine.readProfileRegistry().activeProfileId; assert.ok(profileId);
    workerOwner = f.machine.admitProfile(profileId);
    worker = AuthorityDatabase.open(workerOwner, { path: f.path, busyTimeoutMs: 250, migrationOwner: "logout-worker-fixture" }, clock,
      undefined, undefined, undefined, createCredentialStore({ admission: workerOwner, stateRoot: f.stateRoot }));
    const plan = StartPlanWireSchema.parse(await (await post("start-plans", { workflowId: "person-lookup", submissions: [{ emplId: "10873698" }], dryRun: false }, cookie)).json());
    const starting = post("commands", { commandId: randomUUID(), requestedAt: clock.now().toISOString(), requestedBy: "local-operator", source: "run-start", family: "start", type: "start-run",
      target: { workflowId: plan.workflowId, startPlanId: plan.startPlanId, expectedVersion: plan.expectedVersion }, payload: plan.fingerprints }, cookie);
    await spawned.promise;
    const member = worker.authority.workerSlots.list("person-lookup")[0]; assert.ok(member);
    assert.equal(worker.authority.workerLeases.start({ workerId: member.workerId, workflow: "person-lookup", browserSystems: ["ucpath", "crm"], processId: 7001,
      requestedBy: "local-operator", now: clock.now().toISOString() }).state, "started");
    for (const timer of scheduler.pending()) timer.fire();
    assert.equal(CommandResultSchema.parse(await (await starting).json()).state, "applied");
    const service = new RunRecordService({ database: worker, clock, ids: { uuid: randomUUID }, publishQueued() { throw new Error("no fixture enqueue"); } });
    const claimed = requireLifecycleApplied(service.claimNext({ commandId: randomUUID(), workflow: "person-lookup", workerId: member.workerId,
      workerLifetime: testWorkerLifetime(worker, "person-lookup", 1).workerLifetime, runtimeConfig: selectRunRuntime(worker.authority) }));
    assert.equal(claimed.lifecycle.state, "claimed");
    const epoch = f.machine.readProfileRegistry().sessionGeneration;
    logout = post("profile/logout", {}, cookie);
    await Promise.race([entered.promise, logout.then(response => { throw new Error(`logout returned before the drain barrier: ${response.status}`); })]);
    assert.equal(f.machine.readProfileRegistry().sessionGeneration, epoch, "the running worker must retain its admitted epoch throughout drainage");
    assert.equal(f.machine.readProfileRegistry().activeProfileId, profileId);
    assert.equal(worker.authority.runs.admission().state, "draining");
    const refused = await post("commands", {}, cookie);
    assert.equal(refused.status, 401); assert.deepEqual(PublicProfileStateSchema.parse(await refused.json()), { state: "refused", code: "PROFILE_SESSION_STALE" });
    release.resolve();
    const database = worker;
    await vi.waitFor(() => assert.equal(database.authority.workerLeases.get(member.workerId)?.control.directive, "stop"));
    const lease = worker.authority.workerLeases.get(member.workerId); assert.ok(lease);
    assert.equal(worker.authority.workerLeases.reportLifecycle({ workerId: member.workerId, leaseGeneration: lease.leaseGeneration,
      lifecycle: { state: "stopped", startedAt: lease.lifecycle.startedAt, stoppedAt: clock.now().toISOString(), reason: "operator" }, now: clock.now().toISOString() }).state, "applied");
    worker.close(); worker = undefined; workerOwner.release(); workerOwner = undefined;
    exited = true; child.emitExit(0, null);
    const response = await logout;
    assert.equal(response.status, 200); assert.equal(PublicProfileStateSchema.parse(await response.json()).state, "signed-out");
    assert.equal(f.machine.readProfileRegistry().sessionGeneration, epoch + 1);
    assert.throws(() => context?.admission.assertProfileRuntime());
    const next = await post("profile/sign-in", { email: "fixture@ucsd.edu", password: "disposable-fixture-password" });
    assert.equal(next.status, 200); assert.equal(PublicProfileStateSchema.parse(await next.json()).state, "active");
    assert.equal(context.database.authority.runs.admission().state, "open", "fresh login must not inherit the prior generation's drain hold");
  } catch (error) { primary = error; }
  const failures: unknown[] = primary === undefined ? [] : [primary];
  release.resolve();
  worker?.close(); workerOwner?.release();
  if (!exited) child.emitExit(0, null);
  if (logout !== undefined) await logout.catch(error => { failures.push(error); });
  try { await app?.stop(); } catch (error) { failures.push(error); }
  if (context !== undefined) { try { await context.account.close(); context.database.close(); context.admission.release(); } catch (error) { failures.push(error); } }
  factory.mockRestore();
  try { await f.close(); } catch (error) { failures.push(error); }
  if (failures.length > 0) throw new AggregateError(failures, "logout worker proof or owned fixture closure failed");
});
