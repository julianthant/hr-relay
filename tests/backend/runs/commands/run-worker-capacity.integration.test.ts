import { testWorkerLifetime } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { RunIdSchema } from "../../../../src/rules/identity/ids.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createDashboardPoolTestWorld } from "../../../support/helpers/backend/dashboard-pool-world.js";
import { WorkerControlRefusal } from "../../../../src/models/run/worker-control.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { RunRecordService, requireLifecycleApplied } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { createRunWorkerCapacity, runCapacityCommandId } from "../../../../src/backend/runs/commands/run-worker-capacity.js";
import { createOperatorCommandIngress } from "../../../../src/backend/runs/commands/operator-command-ingress.js";

const { NOW, WORKFLOW, WORKER_1, openControlHarness, dashboardLaunch, launchCommands, proveLaunchBirth,
  spawnPoolWorker, envelope, nextCommandId, settleMicrotasks, cleanup } = createDashboardPoolTestWorld();
afterEach(cleanup);

describe("automatic worker admission and retained capacity commands", () => {
  it("starts one worker for accepted items and retains its idle membership", async () => {
    const h = await openControlHarness();
    const { request } = dashboardLaunch(h, "10873690", { items: 2 });
    const pending = launchCommands(h).submit(request);
    const count = 1;
    for (let index = 0; index < count; index++) await proveLaunchBirth(h);
    assert.equal((await pending).state, "applied");
    assert.equal(h.children.length, count);
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, count);
    for (const spawn of h.spawnRequests) {
      h.database.authority.workerLeases.reportLifecycle({ workerId: spawn.member.workerId, leaseGeneration: 1,
        lifecycle: { state: "idle", startedAt: NOW, heartbeatAt: NOW }, now: NOW });
    }
    assert.equal((await launchCommands(h).submit(request)).state, "already-applied");
    assert.equal(h.children.length, count);
    assert.equal(h.database.authority.workerSlots.list(WORKFLOW).filter(slot => slot.retiredAt === null).length, count);
    assert.ok(h.database.authority.workerLeases.listLive(WORKFLOW).every(lease => lease.lifecycle.state === "idle" && lease.control.directive === "run"));
  });

  it("creates no workers for a preview plan", async () => {
    const h = await openControlHarness(); const { request } = dashboardLaunch(h, "10873690");
    const plan = h.database.authority.startPlans.get(request.target.startPlanId); assert.ok(plan);
    const preview = { ...plan, startPlanId: nextCommandId(), shape: "preview" };
    h.database.authority.startPlans.create(preview);
    const result = await launchCommands(h).submit({ ...request, target: { ...request.target, startPlanId: preview.startPlanId } });
    assert.equal(result.state, "applied");
    assert.equal(h.database.authority.workerControls.list().length, 0);
    assert.equal(h.children.length, 0);
  });

  it("lets a worker added during the run claim an unclaimed item through the shared claim path", async () => {
    const h = await openControlHarness();
    const { request } = dashboardLaunch(h, "10873690", { items: 2 });
    const pending = launchCommands(h).submit(request); await proveLaunchBirth(h); await pending;
    const lifecycle = new RunRecordService({ database: h.database, clock: h.clock, ids: sequentialIdFactory("c"), publishQueued: () => {} });
    const active = h.database.authority.runtimeConfig.get(); assert.ok(active);
    const runtimeConfig = { generation: active.generation, settingsRevision: active.settingsRevision,
      settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint };
    const first = requireLifecycleApplied(lifecycle.claimNext({ commandId: nextCommandId(), workflow: WORKFLOW, workerId: WORKER_1, workerLifetime: testWorkerLifetime(h.database, WORKFLOW, 1).workerLifetime, runtimeConfig }));
    const busy = lifecycle.claimNext({ commandId: nextCommandId(), workflow: WORKFLOW, workerId: WORKER_1, workerLifetime: testWorkerLifetime(h.database, WORKFLOW, 1).workerLifetime, runtimeConfig });
    assert.ok(busy.state === "refused" && busy.refusal.reason === "worker-busy");
    const pool = h.database.authority.workerPools.get(WORKFLOW); assert.ok(pool);
    assert.equal((await h.kernel.executeWorkerPool({ ...envelope(h), type: "plan-worker-count",
      target: { workflowId: WORKFLOW, expectedVersion: pool.version }, payload: { desiredWorkers: 2 } })).state, "applied");
    const member = h.database.authority.workerSlots.list(WORKFLOW).find(slot => slot.workerId !== WORKER_1); assert.ok(member);
    const spawned = h.kernel.executeWorkerPool({ ...envelope(h), type: "spawn-worker",
      target: { workflowId: WORKFLOW, expectedVersion: pool.version + 1 }, payload: { workerId: member.workerId } });
    await proveLaunchBirth(h); assert.equal((await spawned).state, "applied");
    const second = requireLifecycleApplied(lifecycle.claimNext({ commandId: nextCommandId(), workflow: WORKFLOW, workerId: member.workerId, workerLifetime: testWorkerLifetime(h.database, WORKFLOW, member.poolIndex).workerLifetime, runtimeConfig }));
    assert.notEqual(second.envelope.runId, first.envelope.runId);
    assert.equal(h.database.authority.runs.get(first.envelope.runId)?.lifecycle.state, "claimed");
    assert.equal(h.database.authority.runs.listByWorkflow(WORKFLOW).filter(run => run.lifecycle.state === "queued").length, 0);
  });

  it("caps by the stored accepted items even when the result also lists superseded runs", async () => {
    const h = await openControlHarness(); const { request } = dashboardLaunch(h, "10873690");
    const result = h.kernel.execute(request); assert.ok(result.state === "applied");
    const capacity = createRunWorkerCapacity({ kernel: h.kernel, authority: h.database.authority, reconcileWorker: workerId => h.database.authority.workerLeases.get(workerId)?.lifecycle.state !== "stopped" });
    const command = CommandRequestSchema.parse(request); assert.ok(command.family === "start");
    const pending = capacity.ensure(command, { ...result, affectedTargets: [...result.affectedTargets,
      { family: "run", runId: RunIdSchema.parse(nextCommandId()) }, { family: "run", runId: RunIdSchema.parse(nextCommandId()) }] });
    await proveLaunchBirth(h); await pending;
    assert.equal(h.children.length, 1);
  });

  it("reuses a failed standing member without expanding the pool", async () => {
    const h = await openControlHarness();
    await spawnPoolWorker(h);
    h.database.authority.workerLeases.reportLifecycle({ workerId: WORKER_1, leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: NOW, reason: "crashed" }, now: NOW });
    h.children[0]?.emitExit(1, null);
    const { request } = dashboardLaunch(h, "10873690", { items: 2 });
    const pending = launchCommands(h).submit(request);
    await proveLaunchBirth(h);
    assert.equal((await pending).state, "applied");
    assert.equal(h.children.length, 2);
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
    assert.equal(h.database.authority.workerLeases.get(WORKER_1)?.leaseGeneration, 2);
    const lease = h.database.authority.workerLeases.get(WORKER_1); assert.ok(lease);
    assert.notEqual(lease.lifecycle.state, "stopped");
    assert.equal(lease.processId, h.children[1]?.pid);
    assert.notEqual(lease.processId, h.children[0]?.pid);
    const active = h.database.authority.runtimeConfig.get(); assert.ok(active);
    const lifecycle = new RunRecordService({ database: h.database, clock: h.clock, ids: sequentialIdFactory("c"), publishQueued: () => {} });
    const claimed = requireLifecycleApplied(lifecycle.claimNext({ commandId: nextCommandId(), workflow: WORKFLOW, workerId: WORKER_1, workerLifetime: testWorkerLifetime(h.database, WORKFLOW, 1).workerLifetime,
      runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision,
        settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } }));
    assert.ok(claimed.lifecycle.state === "claimed");
    assert.equal(claimed.lifecycle.workerId, WORKER_1);
    assert.equal(claimed.claimGeneration, 1);
    assert.equal(h.database.authority.runs.get(claimed.envelope.runId)?.lifecycle.state, "claimed");
  });

  it.each(["refused", "uncertain"] as const)("retains a partial multi-spawn %s and never repeats either child", async outcome => {
    let calls = 0;
    const h = await openControlHarness({ interceptPool: pool => ({ ...pool, spawnPoolWorker: async context => {
      calls++;
      if (calls === 2) {
        if (outcome === "refused") throw new WorkerControlRefusal("injected-second-spawn-refusal");
        throw new Error("injected-second-spawn-loss");
      }
      return pool.spawnPoolWorker(context);
    } }) });
    const { request } = dashboardLaunch(h, "10873690", { items: 3 });
    assert.equal(h.kernel.execute(request).state, "applied");
    assert.equal((await h.kernel.executeWorkerPool({ commandId: runCapacityCommandId(request.commandId, "plan-worker-count", 1),
      requestedAt: request.requestedAt, requestedBy: request.requestedBy, source: request.source,
      family: "worker-browser", type: "plan-worker-count", target: { workflowId: WORKFLOW, expectedVersion: 0 }, payload: { desiredWorkers: 3 } })).state, "applied");
    const pending = launchCommands(h).submit(request);
    await proveLaunchBirth(h);
    const landed = await pending;
    assert.equal(landed.state, "already-applied");
    if (landed.state !== "already-applied") throw new Error("original enqueue must remain applied");
    assert.equal(landed.workerStartup?.state, outcome === "refused" ? "refused" : "unknown");
    assert.match(landed.workerStartup?.detail ?? "", /spawn/u);
    assert.equal(calls, 2);
    const first = runCapacityCommandId(request.commandId, "spawn-worker", 1);
    const second = runCapacityCommandId(request.commandId, "spawn-worker", 2);
    const third = runCapacityCommandId(request.commandId, "spawn-worker", 3);
    assert.equal(h.database.authority.workerControls.get(first)?.phase.state, "succeeded");
    assert.equal(h.database.authority.workerControls.get(second)?.phase.state, outcome);
    assert.equal(h.database.authority.commands.get(third), undefined);
    const controls = h.database.authority.workerControls.list();
    const replay = await launchCommands(h).submit(request);
    assert.equal(replay.state, "already-applied");
    if (replay.state !== "already-applied") throw new Error("exact enqueue replay required");
    assert.equal(replay.workerStartup?.state, landed.workerStartup?.state);
    assert.equal(replay.workerStartup?.commandId, landed.workerStartup?.commandId);
    assert.equal(replay.workerStartup?.code, landed.workerStartup?.code);
    assert.equal(replay.workerStartup?.message, landed.workerStartup?.message);
    assert.equal(calls, 2);
    assert.deepEqual(h.database.authority.workerControls.list(), controls);
    assert.equal(h.children.length, 1);
  });

  it("finishes only the unadmitted spawns from a settled retained Plan", async () => {
    const h = await openControlHarness();
    const { request } = dashboardLaunch(h, "10873690", { items: 2 });
    assert.equal(h.kernel.execute(request).state, "applied");
    const plan = { commandId: runCapacityCommandId(request.commandId, "plan-worker-count", 1),
      requestedAt: request.requestedAt, requestedBy: request.requestedBy, source: request.source,
      family: "worker-browser", type: "plan-worker-count", target: { workflowId: WORKFLOW, expectedVersion: 0 }, payload: { desiredWorkers: 2 } };
    assert.equal((await h.kernel.executeWorkerPool(plan)).state, "applied");
    const pending = launchCommands(h).submit(request);
    await proveLaunchBirth(h);
    await proveLaunchBirth(h);
    assert.equal((await pending).state, "already-applied");
    await settleMicrotasks();
    assert.equal(h.children.length, 2);
    assert.equal((await launchCommands(h).submit(request)).state, "already-applied");
    assert.equal(h.children.length, 2);
  });
});


describe("automatic Run capacity", () => {
  it("starts exactly one worker for a run with no standing worker", async () => {
    const h = await openControlHarness();
    const { request } = dashboardLaunch(h, "10873690", { items: 3 });
    const pending = launchCommands(h).submit(request);
    await proveLaunchBirth(h);
    assert.equal((await pending).state, "applied");
    assert.equal(h.children.length, 1);
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
    assert.equal((await launchCommands(h).submit(request)).state, "already-applied");
    assert.equal(h.children.length, 1);
  });

  it("uses the live standing worker without adding another", async () => {
    const h = await openControlHarness();
    await spawnPoolWorker(h);
    const controls = h.database.authority.workerControls.list();
    const { request } = dashboardLaunch(h);
    assert.equal((await launchCommands(h).submit(request)).state, "applied");
    assert.equal(h.children.length, 1);
    assert.deepEqual(h.database.authority.workerControls.list(), controls);
  });

  it("respawns the stopped sole member when a run is resumed, and that worker claims it", async () => {
    const h = await openControlHarness();
    await spawnPoolWorker(h);
    const { request } = dashboardLaunch(h);
    const started = h.kernel.execute(request); assert.ok(started.state === "applied");
    const runTarget = started.affectedTargets.find(target => target.family === "run"); assert.ok(runTarget?.family === "run");
    const run = () => { const current = h.database.authority.runs.get(runTarget.runId); assert.ok(current); return current; };
    const runCommand = (type: "pause" | "resume") => ({ commandId: nextCommandId(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
      source: "dashboard", family: "run", type, target: { runId: runTarget.runId, expectedVersion: run().version } });
    assert.equal((await launchCommands(h).submit(runCommand("pause"))).state, "applied");
    h.database.authority.workerLeases.reportLifecycle({ workerId: WORKER_1, leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: NOW, reason: "shutdown" }, now: NOW });
    h.children[0]?.emitExit(0, null);
    const pending = launchCommands(h).submit(runCommand("resume"));
    await proveLaunchBirth(h);
    const resumed = await pending;
    assert.equal(resumed.state, "applied");
    assert.equal(resumed.state === "applied" ? resumed.workerStartup : "unexpected", undefined);
    assert.equal(h.children.length, 2);
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
    assert.equal(h.database.authority.workerLeases.get(WORKER_1)?.leaseGeneration, 2);
    const active = h.database.authority.runtimeConfig.get(); assert.ok(active);
    const lifecycle = new RunRecordService({ database: h.database, clock: h.clock, ids: sequentialIdFactory("c"), publishQueued: () => {} });
    const claimed = requireLifecycleApplied(lifecycle.claimNext({ commandId: nextCommandId(), workflow: WORKFLOW, workerId: WORKER_1, workerLifetime: testWorkerLifetime(h.database, WORKFLOW, 1).workerLifetime,
      runtimeConfig: { generation: active.generation, settingsRevision: active.settingsRevision,
        settingsFingerprint: active.settingsFingerprint, configFingerprint: active.configFingerprint } }));
    assert.equal(claimed.envelope.runId, runTarget.runId);
  });

  it("respawns the stopped sole member once when a bulk Resume re-queues its runs", async () => {
    const h = await openControlHarness();
    await spawnPoolWorker(h);
    const { request } = dashboardLaunch(h, "10873690", { items: 2 });
    const started = h.kernel.execute(request); assert.ok(started.state === "applied");
    const runIds = started.affectedTargets.flatMap(target => target.family === "run" ? [target.runId] : []);
    assert.equal(runIds.length, 2);
    const bulk = (type: "pause" | "resume") => { const bulkCommandId = nextCommandId(); return { commandId: bulkCommandId, bulkCommandId,
      requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "run", type, mode: "best-effort",
      targets: runIds.map(runId => ({ runId, expectedVersion: h.database.authority.runs.get(runId)?.version ?? 0 })) }; };
    const commands = launchCommands(h);
    const ingress = createOperatorCommandIngress({ clock: h.clock, journal: h.database.authority.commands, protectedCommandAcceptedAt: () => undefined,
      bulkAcceptances: { withTransaction: work => h.database.withAuthorityTransaction(repositories => work({ get: repositories.commands.getBulk, insert: repositories.commands.acceptBulk })) } });
    const executeBulk = (body: unknown) => ingress.executeBulk(body, accepted => commands.executeBulk(accepted));
    const paused = await executeBulk(bulk("pause"));
    assert.ok(paused.state === "vector" && paused.results.every(result => result.outcome === "applied"));
    h.database.authority.workerLeases.reportLifecycle({ workerId: WORKER_1, leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: NOW, reason: "shutdown" }, now: NOW });
    h.children[0]?.emitExit(0, null);
    const pending = executeBulk(bulk("resume"));
    await proveLaunchBirth(h);
    const resumed = await pending;
    assert.ok(resumed.state === "vector");
    assert.deepEqual(resumed.results.map(result => result.outcome === "applied" && result.workerStartup === undefined), [true, true]);
    assert.equal(h.children.length, 2);
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
    assert.equal(h.database.authority.workerLeases.get(WORKER_1)?.leaseGeneration, 2);
  });

  it("replaces a dead sole member once and retains its stopped reason before replacement", async () => {
    const h = await openControlHarness();
    await spawnPoolWorker(h);
    h.database.authority.workerLeases.reportLifecycle({ workerId: WORKER_1, leaseGeneration: 1,
      lifecycle: { state: "stopped", startedAt: NOW, stoppedAt: NOW, reason: "crashed" }, now: NOW });
    h.children[0]?.emitExit(1, null);
    const dead = h.database.authority.workerLeases.get(WORKER_1);
    assert.ok(dead?.lifecycle.state === "stopped");
    assert.equal(dead.lifecycle.reason, "crashed");
    const { request } = dashboardLaunch(h);
    const pending = launchCommands(h).submit(request);
    await settleMicrotasks();
    assert.equal(h.children.length, 2, "a dead retained slot must not satisfy Run capacity");
    await proveLaunchBirth(h);
    assert.equal((await pending).state, "applied");
    assert.equal(h.database.authority.workerPools.get(WORKFLOW)?.desiredWorkers, 1);
    assert.equal(h.database.authority.workerLeases.get(WORKER_1)?.leaseGeneration, 2);
    assert.equal((await launchCommands(h).submit(request)).state, "already-applied");
    assert.equal(h.children.length, 2);
  });
});
