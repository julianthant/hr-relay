import { createPoolRuntimeTestWorld } from "../../../support/helpers/backend/pool-runtime-world.js";
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createWorkerPoolRuntimeExecutor } from "../../../../src/backend/runtime/workers/worker-loop.js";
import { NOW, UUID_5, UUID_7 } from "../../../support/fixtures/phase1c-contract-fixtures.js";
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

  it.each([
    {
      name: "different desired count",
      desiredWorkers: 2,
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [{ member: native.members[0], stage: "running", ownership: "supervised" }],
      }),
      message: /requested 2 workers but the supervisor acknowledged 1/,
    },
    {
      name: "missing desired member",
      desiredWorkers: 2,
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 2,
        members: [{ member: native.members[0], stage: "running", ownership: "supervised" }],
      }),
      message: /requires acknowledgement for desired member person-lookup-worker-2 at index 2/,
    },
    {
      name: "out-of-order member",
      desiredWorkers: 2,
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 2,
        members: [
          { member: native.members[1], stage: "running", ownership: "supervised" },
          { member: native.members[0], stage: "running", ownership: "supervised" },
        ],
      }),
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
    {
      name: "stop on a desired member",
      desiredWorkers: 2,
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 2,
        members: [
          { member: native.members[0], stage: "graceful-stop-requested", ownership: "supervised", phase: "initiating", escalation: STOP_ESCALATION, observed: OBSERVED_GRACEFUL },
          { member: native.members[1], stage: "running", ownership: "supervised" },
        ],
      }),
      message: /cannot stop desired member person-lookup-worker-1 at index 1/,
    },
    {
      name: "running excess member without stop coverage",
      desiredWorkers: 1,
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "plan-worker-count",
        state: "acknowledged",
        desiredWorkers: 1,
        members: [
          { member: native.members[0], stage: "running", ownership: "supervised" },
          { member: native.members[1], stage: "running", ownership: "supervised" },
        ],
      }),
      message: /must select running excess member person-lookup-worker-2 for bounded graceful stop/,
    },
  ])("refuses a plan acknowledgement with $name", async ({ desiredWorkers, acknowledgement, message }) => {
    const native = await admittedAdapterRoster();
    const executor = createWorkerPoolRuntimeExecutor({ execute: () => acknowledgement(native) }, native.authority.database.authority.workerSlots);
    const plan = workerBrowserCommand({
      ...envelope,
      family: "worker-browser",
      type: "plan-worker-count",
      target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
      payload: { desiredWorkers },
    });

    await assert.rejects(() => executor.planPoolWorkerCount({ command: plan, now: requestedAt, roster: admitAdapterPlan(native, plan) }), message);
  });

  it.each([
    {
      type: "spawn-worker",
      command: {
        ...envelope,
        family: "worker-browser",
        type: "spawn-worker",
        target: { workflowId: WORKFLOW_ID, expectedVersion: 1 },
        payload: { workerId: "person-lookup-worker-1" },
      },
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "spawn-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[1],
        stage: "started",
      }),
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
    {
      type: "stop-worker",
      command: {
        ...envelope,
        family: "worker-browser",
        type: "stop-worker",
        target: { workerId: "person-lookup-worker-1", expectedVersion: 1 },
      },
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "stop-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[1],
        escalation: STOP_ESCALATION,
        observed: OBSERVED_GRACEFUL,
      }),
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
    {
      type: "pause-worker",
      command: {
        ...envelope,
        family: "worker-browser",
        type: "pause-worker",
        target: { workerId: "person-lookup-worker-1", expectedVersion: 1 },
      },
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "pause-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[1],
        stage: "pause-requested",
      }),
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
    {
      type: "resume-worker",
      command: {
        ...envelope,
        family: "worker-browser",
        type: "resume-worker",
        target: { workerId: "person-lookup-worker-1", expectedVersion: 1 },
      },
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "resume-worker",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[1],
        stage: "resume-requested",
      }),
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
    {
      type: "refresh-browser",
      command: {
        ...envelope,
        family: "worker-browser",
        type: "refresh-browser",
        target: { workerId: "person-lookup-worker-1", browserSessionId: ITEM_ID, expectedVersion: 1 },
      },
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "refresh-browser",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[0],
        browserSessionId: UUID_5,
        stage: "refreshed",
      }),
      message: new RegExp(`requested session ${ITEM_ID}.*acknowledged ${UUID_5}`),
    },
    {
      type: "reopen-browser",
      command: {
        ...envelope,
        family: "worker-browser",
        type: "reopen-browser",
        target: { workerId: "person-lookup-worker-1", browserSessionId: ITEM_ID, expectedVersion: 1 },
      },
      acknowledgement: (native: Awaited<ReturnType<typeof admittedAdapterRoster>>) => ({
        command: "reopen-browser",
        state: "acknowledged",
        ownership: "supervised",
        member: native.members[1],
        browserSessionId: ITEM_ID,
        stage: "reopened",
      }),
      message: /requested member person-lookup-worker-1 at index 1.*acknowledged person-lookup-worker-2 at index 2/,
    },
  ])("refuses mismatched $type acknowledgement facts", async ({ type, command: request, acknowledgement, message }) => {
    const native = await admittedAdapterRoster();
    const command = workerBrowserCommand(request);
    const context = { command, now: requestedAt, ...(command.type === "plan-worker-count" ? { roster: admitAdapterPlan(native, command) } : {}) };
    const executor = createWorkerPoolRuntimeExecutor({ execute: () => acknowledgement(native) }, native.authority.database.authority.workerSlots);

    switch (type) {
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
});
