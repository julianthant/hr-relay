import { createPoolRuntimeTestWorld } from "../../../support/helpers/backend/pool-runtime-world.js";
import { admitWorkerPoolRoster } from "../../../../src/backend/storage/sqlite/worker-slots.js";
import { workerPoolMember } from "../../../../src/models/run/worker-slot.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, describe, it } from "vitest";
import { createWorkerPoolRuntimeExecutor } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { NOW, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { ITEM_ID, WORKFLOW_ID } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { openAuthorityHarness } from "../../../support/helpers/phase1f-executor-harness.js";

const { disposers, workerBrowserCommand, admittedAdapterRoster, admitAdapterPlan, OBSERVED_GRACEFUL, STOP_ESCALATION, cleanup } = createPoolRuntimeTestWorld();

afterEach(cleanup);



describe("pool-capable worker runtime executor seam", () => {
  const requestedAt = NOW;
  const envelope = {
    commandId: UUID_7,
    requestedBy: "local-operator",
    requestedAt,
    source: "dashboard",
  };



  it("acknowledges an uncapped roster with four exact members", async () => {
    const authority = await openAuthorityHarness();
    disposers.push(authority.dispose);
    const plan = workerBrowserCommand({ ...envelope, family: "worker-browser", type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 0 }, payload: { desiredWorkers: 4 } });
    if (plan.type !== "plan-worker-count") throw new Error("fixture plan command required");
    const roster = authority.database.withAuthorityTransaction(repositories => {
      repositories.commands.insert(plan);
      return admitWorkerPoolRoster(repositories, plan, requestedAt);
    });
    const executor = createWorkerPoolRuntimeExecutor({ execute: async request => {
      if (request.command !== "plan-worker-count") throw new Error("unexpected runtime command");
      return { command: request.command, state: "acknowledged", desiredWorkers: request.desiredWorkers, members: request.members.map(member => ({ member, stage: "unmet", reason: "not-started" })) };
    } }, authority.database.authority.workerSlots);
    assert.deepEqual(await executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster }), {
      state: "accepted", retirements: [], workerIds: ["person-lookup-worker-1", "person-lookup-worker-2", "person-lookup-worker-3", "person-lookup-worker-4"],
    });
  });

  it("plans three deterministic members only after the supervisor acknowledges their lifecycle facts", async () => {
    const authority = await openAuthorityHarness();
    disposers.push(authority.dispose);
    const plan = workerBrowserCommand({
      ...envelope, family: "worker-browser", type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 0 }, payload: { desiredWorkers: 3 },
    });
    if (plan.type !== "plan-worker-count") throw new Error("fixture plan command required");
    const roster = authority.database.withAuthorityTransaction(repositories => {
      repositories.commands.insert(plan);
      return admitWorkerPoolRoster(repositories, plan, requestedAt);
    });
    const members = roster.selected.map(workerPoolMember);
    assert.deepEqual(members.map(({ ordinal, membershipRevision }) => ({ ordinal, membershipRevision })),
      [{ ordinal: 1, membershipRevision: 1 }, { ordinal: 2, membershipRevision: 1 }, { ordinal: 3, membershipRevision: 1 }]);
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "plan-worker-count",
          state: "acknowledged",
          desiredWorkers: 3,
          members: [
            {
              member: members[0],
              stage: "running",
              ownership: "supervised",
            },
            {
              member: members[1],
              stage: "running",
              ownership: "supervised",
            },
            {
              member: members[2],
              stage: "unmet",
              reason: "crashed",
            },
          ],
        };
      },
    }, authority.database.authority.workerSlots);

    assert.deepEqual(await executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster }), {
      state: "accepted",
      retirements: [],
      workerIds: [
        "person-lookup-worker-1",
        "person-lookup-worker-2",
        "person-lookup-worker-3",
      ],
    });
    assert.deepEqual(requests, [{
      command: "plan-worker-count",
      commandId: "77777777-7777-4777-8777-777777777777",
      workflowId: WORKFLOW_ID,
      desiredWorkers: 3,
      members: [
        { workflowId: WORKFLOW_ID, poolIndex: 1, ordinal: 1, membershipRevision: 1, workerId: "person-lookup-worker-1" },
        { workflowId: WORKFLOW_ID, poolIndex: 2, ordinal: 2, membershipRevision: 1, workerId: "person-lookup-worker-2" },
        { workflowId: WORKFLOW_ID, poolIndex: 3, ordinal: 3, membershipRevision: 1, workerId: "person-lookup-worker-3" },
      ],
      excessMembers: [],
      directive: { commandId: "77777777-7777-4777-8777-777777777777", requestedAt: NOW, requestedBy: "local-operator" },
    }]);
  });

  it("selects actual excess members for bounded stop but refuses count reduction without retirement proof", async () => {
    const authority = await openAuthorityHarness();
    disposers.push(authority.dispose);
    const initial = workerBrowserCommand({ ...envelope, commandId: randomUUID(), family: "worker-browser",
      type: "plan-worker-count", target: { workflowId: WORKFLOW_ID, expectedVersion: 0 }, payload: { desiredWorkers: 3 } });
    if (initial.type !== "plan-worker-count") throw new Error("fixture initial roster command required");
    authority.database.withAuthorityTransaction(repositories => {
      repositories.commands.insert(initial);
      admitWorkerPoolRoster(repositories, initial, requestedAt);
    });
    const plan = workerBrowserCommand({ ...envelope, family: "worker-browser", type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 }, payload: { desiredWorkers: 1 } });
    if (plan.type !== "plan-worker-count") throw new Error("fixture shrink command required");
    const roster = authority.database.withAuthorityTransaction(repositories => {
      repositories.commands.insert(plan);
      return admitWorkerPoolRoster(repositories, plan, requestedAt);
    });
    const members = [...roster.selected, ...roster.excess].map(workerPoolMember);
    const before = authority.database.authority.workerPools.get(WORKFLOW_ID);
    assert.equal(before?.desiredWorkers, 3);
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: request => { requests.push(request); return ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          {
            member: members[0],
            stage: "running",
            ownership: "supervised",
          },
          {
            member: members[1],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: OBSERVED_GRACEFUL,
          },
          {
            member: members[2],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: OBSERVED_GRACEFUL,
          },
        ],
      }); },
    }, authority.database.authority.workerSlots);
    await assert.rejects(() => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster }), /worker-retirement-not-proved/u);
    assert.deepEqual(requests, [{ command: "plan-worker-count", commandId: plan.commandId,
      workflowId: WORKFLOW_ID, desiredWorkers: 1, members: members.slice(0, 1), excessMembers: members.slice(1),
      directive: { commandId: plan.commandId, requestedAt: NOW, requestedBy: "local-operator" } }]);
    assert.deepEqual(authority.database.authority.workerPools.get(WORKFLOW_ID), before);
    assert.deepEqual(authority.database.authority.workerSlots.list(WORKFLOW_ID), [...roster.selected, ...roster.excess]);
  });

  it("spawns only the explicit pool member acknowledged as started", async () => {
    const native = await admittedAdapterRoster();
    const member = native.members[1];
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "spawn-worker",
          state: "acknowledged",
          ownership: "supervised",
          member,
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

    assert.deepEqual(await executor.spawnPoolWorker({ command: spawn, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "spawn-worker",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 2,
        ordinal: 2,
        membershipRevision: 1,
        workerId: "person-lookup-worker-2",
      },
    }]);
  });

  it("requests a bounded graceful stop for the explicit member", async () => {
    const native = await admittedAdapterRoster();
    const member = native.members[1];
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "stop-worker",
          state: "acknowledged",
          ownership: "supervised",
          member,
          escalation: STOP_ESCALATION,
          observed: OBSERVED_GRACEFUL,
        };
      },
    }, native.authority.database.authority.workerSlots);
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    assert.deepEqual(await executor.stopPoolWorker({ command: stop, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "stop-worker",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 2,
        ordinal: 2,
        membershipRevision: 1,
        workerId: "person-lookup-worker-2",
      },
      escalation: STOP_ESCALATION,
      directive: { commandId: "77777777-7777-4777-8777-777777777777", requestedAt: NOW, requestedBy: "local-operator" },
    }]);
  });

  it("acknowledges pause only at the explicit member's requested stage", async () => {
    const native = await admittedAdapterRoster();
    const member = native.members[0];
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "pause-worker",
          state: "acknowledged",
          ownership: "supervised",
          member,
          stage: "pause-requested",
        };
      },
    }, native.authority.database.authority.workerSlots);
    const pause = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "pause-worker",
      target: { workerId: "person-lookup-worker-1", expectedVersion: 1 },
    });

    assert.deepEqual(await executor.pausePoolWorker({ command: pause, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "pause-worker",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 1,
        ordinal: 1,
        membershipRevision: 1,
        workerId: "person-lookup-worker-1",
      },
    }]);
  });

  it("acknowledges resume only at the explicit member's requested stage", async () => {
    const native = await admittedAdapterRoster();
    const member = native.members[2];
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "resume-worker",
          state: "acknowledged",
          ownership: "supervised",
          member,
          stage: "resume-requested",
        };
      },
    }, native.authority.database.authority.workerSlots);
    const resume = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "resume-worker",
      target: { workerId: "person-lookup-worker-3", expectedVersion: 1 },
    });

    assert.deepEqual(await executor.resumePoolWorker({ command: resume, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "resume-worker",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 3,
        ordinal: 3,
        membershipRevision: 1,
        workerId: "person-lookup-worker-3",
      },
    }]);
  });

  it("acknowledges refresh only after the explicit member session is refreshed", async () => {
    const native = await admittedAdapterRoster();
    const member = native.members[1];
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "refresh-browser",
          state: "acknowledged",
          ownership: "supervised",
          member,
          browserSessionId: ITEM_ID,
          stage: "refreshed",
        };
      },
    }, native.authority.database.authority.workerSlots);
    const refresh = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "refresh-browser",
      target: { workerId: "person-lookup-worker-2", browserSessionId: ITEM_ID, expectedVersion: 1 },
    });

    assert.deepEqual(await executor.refreshPoolBrowser({ command: refresh, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "refresh-browser",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 2,
        ordinal: 2,
        membershipRevision: 1,
        workerId: "person-lookup-worker-2",
      },
      browserSessionId: ITEM_ID,
    }]);
  });

  it("acknowledges reopen only after the explicit member session is reopened", async () => {
    const native = await admittedAdapterRoster();
    const member = native.members[2];
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "reopen-browser",
          state: "acknowledged",
          ownership: "supervised",
          member,
          browserSessionId: ITEM_ID,
          stage: "reopened",
        };
      },
    }, native.authority.database.authority.workerSlots);
    const reopen = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "reopen-browser",
      target: { workerId: "person-lookup-worker-3", browserSessionId: ITEM_ID, expectedVersion: 1 },
    });

    assert.deepEqual(await executor.reopenPoolBrowser({ command: reopen, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "reopen-browser",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: {
        workflowId: WORKFLOW_ID,
        poolIndex: 3,
        ordinal: 3,
        membershipRevision: 1,
        workerId: "person-lookup-worker-3",
      },
      browserSessionId: ITEM_ID,
    }]);
  });

  it("acknowledges a stop with the timestamped observed graceful stage, policy carried separately", async () => {
    const native = await admittedAdapterRoster();
    const requests: unknown[] = [];
    const executor = createWorkerPoolRuntimeExecutor({
      execute: (request) => {
        requests.push(request);
        return {
          command: "stop-worker",
          state: "acknowledged",
          member: native.members[1],
          ownership: "supervised",
          escalation: STOP_ESCALATION,
          observed: OBSERVED_GRACEFUL,
        };
      },
    }, native.authority.database.authority.workerSlots);
    const stop = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "stop-worker",
      target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
    });

    assert.deepEqual(await executor.stopPoolWorker({ command: stop, now: requestedAt }), { state: "accepted" });
    assert.deepEqual(requests, [{
      command: "stop-worker",
      commandId: "77777777-7777-4777-8777-777777777777",
      member: native.members[1],
      escalation: STOP_ESCALATION,
      directive: { commandId: "77777777-7777-4777-8777-777777777777", requestedAt: NOW, requestedBy: "local-operator" },
    }]);
  });

  it.each([
    {
      seam: "stop",
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "stop-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "supervised",
        escalation: STOP_ESCALATION,
        observed: [{ stage: "graceful-stop-requested", at: "2026-07-31T17:00:00.001Z" }],
      }),
      request: {
        family: "worker-browser",
        type: "stop-worker",
        target: { workerId: "person-lookup-worker-2", expectedVersion: 1 },
      },
    },
    {
      seam: "plan",
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          {
            member: native.members[1],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: [{ stage: "graceful-stop-requested", at: "2026-07-31T17:00:00.001Z" }],
          },
          { member: native.members[2], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
        ],
      }),
      request: {
        family: "worker-browser",
        type: "plan-worker-count",
        target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
        payload: { desiredWorkers: 1 },
      },
    },
  ])("refuses a $seam observation timestamped after the command's now", async ({ seam, acknowledgement, request }) => {
    const native = await admittedAdapterRoster();
    // An observation is a record of something that HAPPENED; one postdating
    // the command's own clock is a claim about the future dressed as a fact.
    const executor = createWorkerPoolRuntimeExecutor({ execute: () => acknowledgement(native) }, native.authority.database.authority.workerSlots);
    const command = workerBrowserCommand({ ...envelope, ...request });
    const invoke = seam === "stop"
      ? () => executor.stopPoolWorker({ command, now: requestedAt })
      : () => executor.planPoolWorkerCount({ command, now: requestedAt, roster: admitAdapterPlan(native, command) });

    await assert.rejects(
      invoke,
      /person-lookup-worker-2 reports graceful-stop-requested observed at 2026-07-31T17:00:00\.001Z, after the command's now/,
    );
  });

  it("refuses an initial stop acknowledgement claiming future escalation stages", async () => {
    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "stop-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "supervised",
        escalation: STOP_ESCALATION,
        observed: [
          { stage: "graceful-stop-requested", at: NOW },
          { stage: "sigterm-sent", at: NOW },
        ],
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
      /may acknowledge only the observed graceful-stop-requested stage.*recorded as they occur/,
    );
  });

  it("refuses a stop observation that short-circuits past the graceful stage", async () => {
    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({
      execute: () => ({
        command: "stop-worker",
        state: "acknowledged",
        member: native.members[1],
        ownership: "supervised",
        escalation: STOP_ESCALATION,
        observed: [{ stage: "sigkill-sent", at: NOW }],
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
      /must follow the escalation policy in order/,
    );
  });

  it("refuses an illegal escalation transition in a reconciliation fact", async () => {
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
              // sigterm-sent skipped: graceful cannot jump straight to SIGKILL.
              { stage: "sigkill-sent", at: NOW },
            ],
          },
          {
            member: native.members[2],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: OBSERVED_GRACEFUL,
          },
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
      /must follow the escalation policy in order/,
    );
  });

  it("refuses observed escalation stages with regressing timestamps", async () => {
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
              { stage: "graceful-stop-requested", at: "2026-07-31T17:05:00.000Z" },
              { stage: "sigterm-sent", at: NOW },
            ],
          },
          {
            member: native.members[2],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: OBSERVED_GRACEFUL,
          },
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
      /non-decreasing timestamps/,
    );
  });

  it("refuses an initiating plan fact claiming escalation stages beyond the graceful request", async () => {
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
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: [
              { stage: "graceful-stop-requested", at: NOW },
              { stage: "sigterm-sent", at: NOW },
            ],
          },
          {
            member: native.members[2],
            stage: "graceful-stop-requested",
            ownership: "supervised",
            phase: "initiating",
            escalation: STOP_ESCALATION,
            observed: OBSERVED_GRACEFUL,
          },
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
      /plan-worker-count for person-lookup-worker-2 may acknowledge only the observed graceful-stop-requested stage.*sigterm-sent.*recorded as they occur/,
    );
  });
});
