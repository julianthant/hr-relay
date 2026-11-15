import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { createDashboardPoolTestWorld } from "../../../support/helpers/backend/dashboard-pool-world.js";
import { createOperatorCommandIngress } from "../../../../src/backend/runs/commands/operator-command-ingress.js";

const { WORKFLOW, WORKER_1, openControlHarness, dashboardLaunch, launchCommands, planWorkers, nextCommandId, settleMicrotasks, view, cleanup } = createDashboardPoolTestWorld();
afterEach(cleanup);

describe("automatic Run capacity", () => {
  it("starts exactly one worker for a run with no member and replays without another", async () => {
    const h = await openControlHarness();
    const { request } = dashboardLaunch(h, "10873690", { items: 2 });
    assert.equal((await launchCommands(h).submit(request)).state, "applied");
    await settleMicrotasks();
    assert.equal(h.children.length, 1);
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
    assert.equal((await launchCommands(h).submit(request)).state, "already-applied");
    assert.equal(h.children.length, 1);
    assert.equal(h.database.authority.workerSlots.active(WORKFLOW).length, 1);
  });

  it("creates no workers for a preview plan", async () => {
    const h = await openControlHarness(); const { request } = dashboardLaunch(h, "10873690");
    const plan = h.database.authority.startPlans.get(request.target.startPlanId); assert.ok(plan);
    const preview = { ...plan, startPlanId: nextCommandId(), shape: "preview" };
    h.database.authority.startPlans.create(preview);
    const result = await launchCommands(h).submit({ ...request, target: { ...request.target, startPlanId: preview.startPlanId } });
    assert.equal(result.state, "applied");
    assert.equal(h.children.length, 0);
    assert.equal(h.database.authority.workerSlots.active(WORKFLOW).length, 0);
  });

  it("uses every running member without adding another", async () => {
    const h = await openControlHarness();
    await planWorkers(h, 2); await settleMicrotasks();
    assert.equal((await launchCommands(h).submit(dashboardLaunch(h).request)).state, "applied");
    await settleMicrotasks();
    assert.equal(h.children.length, 2);
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 2);
  });

  it("replaces a crashed sole member once without expanding the pool", async () => {
    const h = await openControlHarness();
    await planWorkers(h, 1); await settleMicrotasks();
    h.children[0]?.exit(null, "SIGKILL"); await settleMicrotasks();
    assert.equal(view(h).state, "exited");
    assert.equal((await launchCommands(h).submit(dashboardLaunch(h).request)).state, "applied");
    await settleMicrotasks();
    assert.equal(h.children.length, 2);
    assert.equal(view(h, WORKER_1).state, "running");
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
  });

  it("respawns the stopped sole member when a run is resumed, and the resumed run is queued for it", async () => {
    const h = await openControlHarness();
    const { request } = dashboardLaunch(h);
    const started = await launchCommands(h).submit(request); assert.ok(started.state === "applied"); await settleMicrotasks();
    const run = started.affectedTargets.find(target => target.family === "run"); assert.ok(run?.family === "run");
    const runCommand = (type: "pause" | "resume") => ({ commandId: nextCommandId(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
      source: "dashboard", family: "run", type, target: { runId: run.runId, expectedVersion: h.database.authority.runs.get(run.runId)?.version ?? 0 } });
    assert.equal((await launchCommands(h).submit(runCommand("pause"))).state, "applied");
    h.children[0]?.exit(0, null); await settleMicrotasks();
    assert.equal(view(h).state, "exited");
    const resumed = await launchCommands(h).submit(runCommand("resume")); await settleMicrotasks();
    assert.equal(resumed.state, "applied");
    assert.equal(resumed.state === "applied" ? resumed.workerStartup : "unexpected", undefined);
    assert.equal(h.children.length, 2);
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
    assert.equal(view(h, WORKER_1).state, "running");
    const current = h.database.authority.runs.get(run.runId);
    assert.equal(current?.lifecycle.state, "queued");
    assert.equal(current?.pause, undefined);
  });

  it("respawns the stopped sole member once when a bulk Resume re-queues its runs", async () => {
    const h = await openControlHarness();
    const { request } = dashboardLaunch(h, "10873690", { items: 2 });
    const started = await launchCommands(h).submit(request); assert.ok(started.state === "applied"); await settleMicrotasks();
    const runIds = started.affectedTargets.flatMap(target => target.family === "run" ? [target.runId] : []);
    assert.equal(runIds.length, 2);
    const bulk = (type: "pause" | "resume") => { const bulkCommandId = nextCommandId(); return { commandId: bulkCommandId, bulkCommandId,
      requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "run", type, mode: "best-effort",
      targets: runIds.map(runId => ({ runId, expectedVersion: h.database.authority.runs.get(runId)?.version ?? 0 })) }; };
    const commands = launchCommands(h);
    const ingress = createOperatorCommandIngress({ clock: h.clock, journal: h.database.authority.commands, protectedCommandAcceptedAt: () => undefined,
      bulkAcceptances: { withTransaction: work => h.database.withAuthorityTransaction(repositories => work({ get: repositories.commands.getBulk, insert: repositories.commands.acceptBulk })) },
      resolveIdentityGateAnswer: () => { throw new Error("a bulk run command must not resolve an identity answer"); },
      resolveGateArmAnswer: () => { throw new Error("a bulk run command must not resolve a gate-arm answer"); } });
    const executeBulk = (body: unknown) => ingress.executeBulk(body, accepted => commands.executeBulk(accepted));
    const paused = await executeBulk(bulk("pause"));
    assert.ok(paused.state === "vector" && paused.results.every(result => result.outcome === "applied"));
    h.children[0]?.exit(0, null); await settleMicrotasks();
    const resumed = await executeBulk(bulk("resume")); await settleMicrotasks();
    assert.ok(resumed.state === "vector");
    assert.deepEqual(resumed.results.map(result => result.outcome === "applied" && result.workerStartup === undefined), [true, true]);
    assert.equal(h.children.length, 2);
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
  });

  it("keeps the start applied and shows a member that never becomes ready as failed on its card", async () => {
    const h = await openControlHarness({ ready: false });
    const pending = launchCommands(h).submit(dashboardLaunch(h).request);
    await vi.waitFor(() => assert.equal(h.children.length, 1));
    h.clock.advanceMonotonic(60_000);
    for (const entry of h.scheduler.pending()) entry.fire();
    await settleMicrotasks();
    h.children[0]?.exit(null, "SIGKILL"); await settleMicrotasks();
    assert.equal((await pending).state, "applied");
    assert.deepEqual(h.children[0]?.kills, ["SIGKILL"]);
    assert.deepEqual(h.faults.map(fault => "code" in fault ? fault.code : fault.message), ["WORKER_START_TIMED_OUT"]);
    assert.equal(view(h).state, "exited");
  });
});
