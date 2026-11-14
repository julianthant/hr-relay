import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { createDashboardPoolTestWorld } from "../../../support/helpers/backend/dashboard-pool-world.js";
import { createOperatorCommandIngress } from "../../../../src/backend/runs/commands/operator-command-ingress.js";
import { RunWorkerStartupError } from "../../../../src/backend/runs/commands/run-worker-capacity.js";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { stoppedWorkerToasts } from "../../../../src/dashboard/app/commands/worker-startup-toast.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import type { ControlHarness } from "../../../support/helpers/backend/dashboard-pool-world.js";

const { WORKFLOW, WORKER_1, openControlHarness, dashboardLaunch, launchCommands, planWorkers, nextCommandId, settleMicrotasks, view, cleanup } = createDashboardPoolTestWorld();
afterEach(cleanup);

/** What the dashboard serves for the fixture workflow: its worker cards, its queued rows' no-worker flag, and the sticky queued-run notices. */
function served(h: ControlHarness, startupPending: (workflowId: string) => boolean) {
  const projection = createOperatorProjection({ database: h.database, reader: h.lifecycle, workerMembers: () => h.workers.pool.snapshot(), workerStartupPending: startupPending,
    descriptors: { resolve: workflowId => DESCRIPTORS.find(descriptor => descriptor.id === workflowId) },
    stateRoot: h.stateRoot, clock: h.clock, appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
    ledger: { foldActivityRange: () => { throw new Error("unrequested activity"); } } });
  const day = projection.buildDashboardDayWire(h.clock.now().toISOString().slice(0, 10));
  return { cards: day.workerCards.map(card => card.state), notStarting: day.queueSurfaces.flatMap(row => row.status === "queued" && row.notStarting !== undefined ? [row.notStarting.code] : []),
    notices: stoppedWorkerToasts(day, workflowId => workflowId).length };
}

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
    assert.deepEqual(h.detachedStartupFailures, []);
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
      resolveIdentityGateAnswer: () => { throw new Error("a bulk run command must not resolve an identity answer"); } });
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

  for (const path of ["no worker slot", "a slot whose member is not live"] as const) {
    it(`replies to Start once the run is created while the worker for ${path} is still starting`, async () => {
      const h = await openControlHarness({ ready: false });
      if (path === "a slot whose member is not live") {
        const planned = planWorkers(h, 1);
        await vi.waitFor(() => assert.equal(h.children.length, 1));
        h.children[0]?.ready(); await planned;
        h.children[0]?.exit(null, "SIGKILL"); await settleMicrotasks();
      }
      const before = h.children.length;
      const submitted = launchCommands(h).submit(dashboardLaunch(h).request);
      const reply = await Promise.race([submitted, settleMicrotasks(20).then(() => undefined)]);
      assert.ok(reply !== undefined, "Start's reply waited for the worker's ready message");
      assert.ok(reply.state === "applied", JSON.stringify(reply));
      assert.equal(reply.workerStartup, undefined);
      assert.equal(h.database.authority.runs.listByWorkflow(WORKFLOW).filter(run => run.lifecycle.state === "queued").length, 1);
      await vi.waitFor(() => assert.equal(h.children.length, before + 1));
      assert.equal(view(h).state, "starting");
      h.children.at(-1)?.ready(); await settleMicrotasks();
      assert.equal(view(h).state, "running");
      assert.deepEqual(h.faults, []);
    });
  }

  it("reports a member that never becomes ready once, after Start has replied, and shows it failed on its card", async () => {
    const h = await openControlHarness({ ready: false });
    const reply = await Promise.race([launchCommands(h).submit(dashboardLaunch(h).request), settleMicrotasks(20).then(() => undefined)]);
    assert.ok(reply?.state === "applied" && reply.workerStartup === undefined, JSON.stringify(reply));
    await vi.waitFor(() => assert.equal(h.children.length, 1));
    assert.equal(h.detachedStartupFailures.length, 0);
    h.clock.advanceMonotonic(60_000);
    for (const entry of h.scheduler.pending()) entry.fire();
    await settleMicrotasks();
    h.children[0]?.exit(null, "SIGKILL"); await settleMicrotasks();
    assert.deepEqual(h.children[0]?.kills, ["SIGKILL"]);
    assert.deepEqual(h.faults.map(fault => "code" in fault ? fault.code : fault.message), ["WORKER_START_TIMED_OUT"]);
    assert.equal(view(h).state, "exited");
    assert.deepEqual(h.detachedStartupFailures.map(error => error instanceof RunWorkerStartupError ? [error.failure.state, error.failure.detail] : error),
      [["refused", "the planned worker did not start"]]);
    assert.equal(h.database.authority.runs.listByWorkflow(WORKFLOW)[0]?.lifecycle.state, "queued");
  });

  it("keeps a second Start's reply off the first Start's worker startup, and starts one worker for both", async () => {
    const h = await openControlHarness({ ready: false });
    const commands = launchCommands(h);
    const first = await Promise.race([commands.submit(dashboardLaunch(h, "10873690").request), settleMicrotasks(20).then(() => undefined)]);
    const second = await Promise.race([commands.submit(dashboardLaunch(h, "10873691").request), settleMicrotasks(20).then(() => undefined)]);
    assert.deepEqual([first?.state, second?.state], ["applied", "applied"]);
    assert.equal(h.children.length, 1);
    h.children[0]?.ready(); await settleMicrotasks();
    assert.equal(h.children.length, 1);
    assert.equal(h.database.authority.workerSlots.active(WORKFLOW).length, 1);
    assert.deepEqual([h.faults, h.detachedStartupFailures], [[], []]);
  });

  it("serves a first Start's pending worker as starting, with no queued-run notice, until it runs", async () => {
    const h = await openControlHarness({}, undefined, { holdPreflight: true });
    const commands = launchCommands(h);
    const reply = await Promise.race([commands.submit(dashboardLaunch(h).request), settleMicrotasks(20).then(() => undefined)]);
    assert.equal(reply?.state, "applied");
    await vi.waitFor(() => assert.equal(h.preflight.entered(), 1));
    assert.deepEqual(served(h, commands.startupPending), { cards: ["starting"], notStarting: [], notices: 0 });
    h.preflight.release(); await settleMicrotasks();
    assert.deepEqual(served(h, commands.startupPending), { cards: ["idle"], notStarting: [], notices: 0 });
    assert.deepEqual([h.startupPending, h.faults, h.detachedStartupFailures], [[true, false], [], []]);
  });

  it("serves a restarted worker as starting until its startup fails, then raises the queued-run notice once", async () => {
    const h = await openControlHarness({ ready: false }, undefined, { holdPreflight: true });
    const planned = planWorkers(h, 1);
    await vi.waitFor(() => assert.equal(h.preflight.entered(), 1));
    h.preflight.release(); await vi.waitFor(() => assert.equal(h.children.length, 1));
    h.children[0]?.ready(); await planned;
    h.children[0]?.exit(null, "SIGKILL"); await settleMicrotasks();
    const commands = launchCommands(h);
    const reply = await Promise.race([commands.submit(dashboardLaunch(h).request), settleMicrotasks(20).then(() => undefined)]);
    assert.equal(reply?.state, "applied");
    await vi.waitFor(() => assert.equal(h.preflight.entered(), 2));
    const phases = [served(h, commands.startupPending)];
    h.preflight.release(); await vi.waitFor(() => assert.equal(h.children.length, 2));
    phases.push(served(h, commands.startupPending));
    h.clock.advanceMonotonic(60_000);
    for (const entry of h.scheduler.pending()) entry.fire();
    await settleMicrotasks();
    h.children[1]?.exit(null, "SIGKILL"); await settleMicrotasks();
    phases.push(served(h, commands.startupPending));
    assert.deepEqual(phases, [{ cards: ["starting"], notStarting: [], notices: 0 }, { cards: ["starting"], notStarting: [], notices: 0 },
      { cards: ["failed"], notStarting: ["NO_WORKER"], notices: 1 }]);
    assert.equal(h.detachedStartupFailures.length, 1);
  });

  it("closes a pending worker preflight when the pool stops after Start, and settles the detached startup before the stop returns", async () => {
    const h = await openControlHarness({}, undefined, { holdPreflight: true });
    const commands = launchCommands(h);
    const reply = await Promise.race([commands.submit(dashboardLaunch(h).request), settleMicrotasks(20).then(() => undefined)]);
    assert.equal(reply?.state, "applied");
    await vi.waitFor(() => assert.equal(h.preflight.entered(), 1));
    await h.workers.pool.stopAll("shutdown");
    assert.deepEqual(h.detachedStartupFailures.map(error => error instanceof RunWorkerStartupError ? error.failure.state : error), ["refused"]);
    assert.equal(h.startupPending.at(-1), false);
    h.preflight.release(); await settleMicrotasks();
    assert.equal(h.children.length, 0, "no member starts once the pool has stopped");
    assert.equal(h.database.authority.runs.listByWorkflow(WORKFLOW)[0]?.lifecycle.state, "queued");
  });
});
