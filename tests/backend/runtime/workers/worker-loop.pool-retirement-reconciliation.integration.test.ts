import { createPoolRuntimeTestWorld } from "../../../support/helpers/backend/pool-runtime-world.js";
import assert from "node:assert/strict";
import { setImmediate } from "node:timers";
import { afterEach, describe, it } from "vitest";
import { createWorkerPoolRuntimeExecutor } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { NOW, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { ITEM_ID, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";

const {workerBrowserCommand, admittedAdapterRoster, admitAdapterPlan, OBSERVED_GRACEFUL, STOP_ESCALATION, cleanup } = createPoolRuntimeTestWorld();

afterEach(cleanup);



describe("pool-capable worker runtime executor seam", () => {
  const requestedAt = NOW;
  const envelope = {
    commandId: UUID_7,
    requestedBy: "local-operator",
    requestedAt,
    source: "dashboard",
  };

  it("preserves reconciling escalation facts but refuses unproved retirement", async () => {

    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          {
            member: native.members[1],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "reconciling",
            escalation: STOP_ESCALATION,
            observed: [
              { stage: "graceful-stop-requested", at: "2026-07-31T16:58:00.000Z" },
              { stage: "sigterm-sent", at: "2026-07-31T16:59:00.000Z" },
            ],
          },
          { member: native.members[2], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    const roster = admitAdapterPlan(native, plan);
    const before = native.authority.database.authority.workerPools.get(WORKFLOW_ID);
    await assert.rejects(() => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster }), /worker-retirement-not-proved/u);
    assert.equal(before?.desiredWorkers, 3);
    assert.deepEqual(native.authority.database.authority.workerPools.get(WORKFLOW_ID), before);
    assert.deepEqual(native.authority.database.authority.workerSlots.list(WORKFLOW_ID), [...roster.selected, ...roster.excess]);
  });

  it("bounds a reconciling plan fact's observed stages by the command's now", async () => {
    const native = await admittedAdapterRoster();

    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          {
            member: native.members[1],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "reconciling",
            escalation: STOP_ESCALATION,
            observed: [
              { stage: "graceful-stop-requested", at: NOW },
              { stage: "sigterm-sent", at: "2026-07-31T17:00:00.001Z" },
            ],
          },
          { member: native.members[2], stage: "unmet", reason: "not-started" },
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    await assert.rejects(
      () => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster: admitAdapterPlan(native, plan) }),
      /person-lookup-worker-2 reports sigterm-sent observed at 2026-07-31T17:00:00\.001Z, after the command's now/,
    );
  });

  it("refuses a plan fact that omits the initiating/reconciling attestation", async () => {
    const native = await admittedAdapterRoster();

    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          {
            member: native.members[1],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            escalation: STOP_ESCALATION,
            observed: OBSERVED_GRACEFUL,
          },
          { member: native.members[2], stage: "unmet", reason: "not-started" },
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    await assert.rejects(
      () => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster: admitAdapterPlan(native, plan) }),
      /phase/,
    );
  });

  it("refuses a malformed command now instead of silently unbounding observed stages", async () => {
    // Date.parse can return NaN; validate the command instant before comparing observed stages.
    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "stop-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "supervised",
        escalation: STOP_ESCALATION,
        observed: OBSERVED_GRACEFUL,
      }),
    }, native.authority.database.authority.workerSlots);
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    await assert.rejects(
      () => executor.stopPoolWorker({ command: stop, now: "not-an-instant" }),
      /stop-worker received an unparseable command now "not-an-instant"/,
    );
  });

  it.each([
    { method: "planPoolWorkerCount" },
    { method: "spawnPoolWorker" },
    { method: "stopPoolWorker" },
    { method: "pausePoolWorker" },
    { method: "resumePoolWorker" },
    { method: "refreshPoolBrowser" },
    { method: "reopenPoolBrowser" },
  ] as const)("$method names itself when mis-dispatched a foreign command", async ({ method }) => {

    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => {
        throw new Error("supervisor must not be called on a mis-dispatch");
      },
    }, native.authority.database.authority.workerSlots);
    const foreignType = method === "planPoolWorkerCount" ? "spawn-worker" : "plan-worker-count";
    const command = method === "planPoolWorkerCount"
      ? workerBrowserCommand({
          ...envelope,
          family: "worker-browser",
          type: "spawn-worker",
          target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
          payload: { workerId: "person-lookup-worker-1" },
        })
      : workerBrowserCommand({
          ...envelope,
          family: "worker-browser",
          type: "plan-worker-count",
          target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
          payload: { desiredWorkers: 1 },
        });

    await assert.rejects(
      () => executor[method]({ command, now: requestedAt }),
      new RegExp(`${method} received a ${foreignType} command`),
    );
  });

  it.each([
    {
      type: "plan-worker-count",
      request: {
        family: "worker-browser",
        type: "plan-worker-count",
        target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
        payload: { desiredWorkers: 2 },
      },
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 2,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          { member: native.members[1], stage: "running", ownership: "external" },
          { member: native.members[2], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
        ],
      }),
    },
    {
      type: "spawn-worker",
      request: {
        family: "worker-browser",
        type: "spawn-worker",
        target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
        payload: { workerId: "person-lookup-worker-2" },
      },
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "spawn-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "external",
        stage: "started",
      }),
    },
    {
      type: "stop-worker",
      request: {
        family: "worker-browser",
        type: "stop-worker",
        target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
      },
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "stop-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "external",
        escalation: STOP_ESCALATION,
        observed: OBSERVED_GRACEFUL,
      }),
    },
    {
      type: "pause-worker",
      request: {
        family: "worker-browser",
        type: "pause-worker",
        target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
      },
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "pause-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "external",
        stage: "pause-requested",
      }),
    },
    {
      type: "resume-worker",
      request: {
        family: "worker-browser",
        type: "resume-worker",
        target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
      },
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "resume-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "external",
        stage: "resume-requested",
      }),
    },
    {
      type: "refresh-browser",
      request: {
        family: "worker-browser",
        type: "refresh-browser",
        target: { workerId: "person-lookup-worker-2", browserSessionId: ITEM_ID, expectedVersion: 1 },
      },
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "refresh-browser",
        state: "acknowledged",
        member: native.members[1],
        ownership: "external",
        browserSessionId: ITEM_ID,
        stage: "refreshed",
      }),
    },
    {
      type: "reopen-browser",
      request: {
        family: "worker-browser",
        type: "reopen-browser",
        target: { workerId: "person-lookup-worker-2", browserSessionId: ITEM_ID, expectedVersion: 1 },
      },
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "reopen-browser",
        state: "acknowledged",
        member: native.members[1],
        ownership: "external",
        browserSessionId: ITEM_ID,
        stage: "reopened",
      }),
    },
  ])("refuses a $type acknowledgement for an externally owned member", async ({ type, request, acknowledgement }) => {
    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({ execute: () => acknowledgement(native) }, native.authority.database.authority.workerSlots);
    const command = workerBrowserCommand({ ...envelope, ...request });
    const context = { command, now: requestedAt, ...(command.type === "plan-worker-count" ? { roster: admitAdapterPlan(native, command) } : {}) };
    const message = new RegExp(
      `${type} touches externally owned member person-lookup-worker-2 at index 2; `
      + "a mutating control requires durable supervisor ownership",
    );

    switch (type) {
      case "plan-worker-count":
        await assert.rejects(() => executor.planPoolWorkerCount(context), message);
        break;
      case "spawn-worker":
        await assert.rejects(() => executor.spawnPoolWorker(context), message);
        break;
      case "stop-worker":
        await assert.rejects(() => executor.stopPoolWorker(context), message);
        break;
      case "pause-worker":
        await assert.rejects(() => executor.pausePoolWorker(context), message);
        break;
      case "resume-worker":
        await assert.rejects(() => executor.resumePoolWorker(context), message);
        break;
      case "refresh-browser":
        await assert.rejects(() => executor.refreshPoolBrowser(context), message);
        break;
      case "reopen-browser":
        await assert.rejects(() => executor.reopenPoolBrowser(context), message);
        break;
    }
  });



  it("refuses a stop acknowledgement with no observed stages", async () => {

    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "stop-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "supervised",
        escalation: STOP_ESCALATION,
        observed: [],
      }),
    }, native.authority.database.authority.workerSlots);
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    await assert.rejects(
      () => executor.stopPoolWorker({ command: stop, now: requestedAt }),
      /Too small: expected array to have >=1 items/,
    );
  });

  it("names the authoritative excess members but refuses unproved scale-down", async () => {
    const requests: unknown[] = [];
    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "plan-worker-count",
          state: "acknowledged",
          desiredWorkers: 1,
          members: [
            { member: native.members[0], stage: "running", ownership: "supervised" },
            { member: native.members[1], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
            { member: native.members[2], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
          ],
        };
      },
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    const roster = admitAdapterPlan(native, plan);
    const before = native.authority.database.authority.workerPools.get(WORKFLOW_ID);
    await assert.rejects(() => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster }), /worker-retirement-not-proved/u);
    assert.equal(before?.desiredWorkers, 3);
    assert.deepEqual(native.authority.database.authority.workerPools.get(WORKFLOW_ID), before);
    assert.deepEqual(native.authority.database.authority.workerSlots.list(WORKFLOW_ID), [...roster.selected, ...roster.excess]);
    assert.deepEqual(requests, [{
      command: "plan-worker-count",
      commandId: "77777777-7777-4777-8777-777777777777",
      workflowId: WORKFLOW_ID,
      desiredWorkers: 1,
      members: [native.members[0]],
      excessMembers: [native.members[1], native.members[2]],
      directive: { commandId: "77777777-7777-4777-8777-777777777777", requestedAt: NOW, requestedBy: "local-operator" },
    }]);
  });

  it("preserves honest unmet excess facts but refuses unproved scale-down", async () => {

    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          { member: native.members[1], stage: "unmet", reason: "crashed" },
          { member: native.members[2], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    const roster = admitAdapterPlan(native, plan);
    const before = native.authority.database.authority.workerPools.get(WORKFLOW_ID);
    await assert.rejects(() => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster }), /worker-retirement-not-proved/u);
    assert.equal(before?.desiredWorkers, 3);
    assert.deepEqual(native.authority.database.authority.workerPools.get(WORKFLOW_ID), before);
    assert.deepEqual(native.authority.database.authority.workerSlots.list(WORKFLOW_ID), [...roster.selected, ...roster.excess]);
  });

  it("refuses a scale-down acknowledgement that omits an authoritative excess member", async () => {
    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          { member: native.members[1], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
          // person-lookup-worker-3 silently omitted: its stop is never covered.
        ],
      }),
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 1 },
    });

    await assert.rejects(
      () => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster: admitAdapterPlan(native, plan) }),
      /requires a bounded graceful stop acknowledgement for excess member person-lookup-worker-3 at index 3/,
    );
  });

  it("refuses a supervisor that mutates the spawn request member after submission", async () => {
    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {

        const mutable = request as unknown as { member: { poolIndex: number; workerId: string } };
        mutable.member.poolIndex = 2;
        mutable.member.workerId = "person-lookup-worker-2";
        return {
          command: "spawn-worker",
          state: "acknowledged",
          ownership: "supervised",
          member: native.members[1],
          stage: "started",
        };
      },
    }, native.authority.database.authority.workerSlots);
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-1" },
    });


    await assert.rejects(
      () => executor.spawnPoolWorker({ command: spawn, now: requestedAt }),
      { name: "TypeError", message: /read only property 'poolIndex'/ },
    );
  });

  it("refuses a supervisor that mutates the plan request roster after submission", async () => {
    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        // Rewriting a submitted roster entry must never leak into the accepted
        // plan's workerIds — the acknowledged ids are the ORIGINAL scalars.
        const mutable = request as unknown as { members: { workerId: string }[] };
        const second = mutable.members[1];
        if (second === undefined) throw new Error("fixture expected a three-member roster");
        second.workerId = "person-lookup-worker-hijacked";
        return {
          command: "plan-worker-count",
          state: "acknowledged",
          desiredWorkers: 3,
          members: native.members.map((member) => ({
            member,
            stage: "running",
            ownership: "supervised",
          })),
        };
      },
    }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: 3 },
    });


    await assert.rejects(
      () => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster: admitAdapterPlan(native, plan) }),
      { name: "TypeError", message: /read only property 'workerId'/ },
    );
  });

  it("awaits an asynchronous supervisor effect before acknowledging a spawn", async () => {
    let effectProved = false;
    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: async () => {
        await new Promise((resolve) => setImmediate(resolve));
        effectProved = true;
        return {
          command: "spawn-worker",
          state: "acknowledged",
          ownership: "supervised",
          member: native.members[1],
          stage: "started",
        };
      },
    }, native.authority.database.authority.workerSlots);
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-2" },
    });

    const acknowledged = await executor.spawnPoolWorker({ command: spawn, now: requestedAt });
    assert.equal(effectProved, true, "the acknowledgement settled before the supervisor proved the effect");
    assert.deepEqual(acknowledged, { state: "accepted" });
  });

  it("never settles the acknowledgement before the supervisor's effect settles", async () => {
    let release: (() => void) | undefined;
    const effect = new Promise<void>((resolve) => {
      release = resolve;
    });
    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => effect.then(() => ({
        command: "spawn-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[1],
        stage: "started",
      })),
    }, native.authority.database.authority.workerSlots);
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-2" },
    });

    let settled = false;
    const acknowledging = (async () => executor.spawnPoolWorker({ command: spawn, now: requestedAt }))();
    const watched = acknowledging.then(
      (value) => {
        settled = true;
        return value;
      },
      (error: unknown) => {
        settled = true;
        throw error;
      },
    );
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false, "the spawn was acknowledged while the process effect was still pending");
    release?.();
    assert.deepEqual(await watched, { state: "accepted" });
  });

  it("propagates a failed asynchronous effect instead of fabricating success", async () => {
    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => Promise.reject(new Error("spawn failed: EAGAIN forking person-lookup-worker-2")),
    }, native.authority.database.authority.workerSlots);
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId: "person-lookup-worker-2" },
    });

    await assert.rejects(
      () => executor.spawnPoolWorker({ command: spawn, now: requestedAt }),
      /EAGAIN forking person-lookup-worker-2/,
    );
  });

  it("refuses an invalid negative count before calling the supervisor", async () => {
    let calls = 0;
    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => {
        calls += 1;
        throw new Error("supervisor must not be called");
      },
    }, native.authority.database.authority.workerSlots);
    assert.throws(() => workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers: -1 },
    }), /Too small: expected number to be >=0/u);
    assert.equal(calls, 0);
    assert.ok(executor);
  });

  it.each([
    { workerId: "person-lookup-worker", message: /worker-slot-not-admitted/ },
    { workerId: "person-lookup-worker-4", message: /worker-slot-not-admitted/ },
    { workerId: "onboarding-worker-1", message: /worker-slot-workflow-mismatch/ },
  ])("refuses absent or wrong-workflow admitted spawn identity $workerId before calling the supervisor", async ({ workerId, message }) => {
    let calls = 0;
    const native = await admittedAdapterRoster(workerId.startsWith("onboarding-") ? "onboarding" : WORKFLOW_ID);
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => {
        calls += 1;
        throw new Error("supervisor must not be called");
      },
    }, native.authority.database.authority.workerSlots);
    const spawn = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "spawn-worker",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { workerId },
    });

    await assert.rejects(() => executor.spawnPoolWorker({ command: spawn, now: requestedAt }), message);
    assert.equal(calls, 0);
  });
});
