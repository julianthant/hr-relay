import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { DESCRIPTORS } from "../../../../src/backend/app/registries/workflow-registry.js";
import { WorkerRefusalStandingSchema } from "../../../../src/models/preflight/preflight-contract.js";
import { workerPoolMember, type WorkerSlotRecord } from "../../../../src/models/run/worker-slot.js";
import type { WorkerMemberView } from "../../../../src/backend/runtime/workers/worker-pool.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { createDashboardPoolTestWorld, type ControlHarness } from "../../../support/helpers/backend/dashboard-pool-world.js";

const { WORKFLOW, openControlHarness, settleMicrotasks, dashboardLaunch, launchCommands, cleanup } = createDashboardPoolTestWorld();
afterEach(cleanup);

function live(slot: WorkerSlotRecord, refusal?: ReturnType<typeof WorkerRefusalStandingSchema.parse>): WorkerMemberView {
  return {
    member: workerPoolMember(slot), lifetimeId: "aaaaaaaa-0001-4000-8000-000100000000", version: 1, state: "running", directive: "run",
    pid: 1, startedAt: slot.createdAt, activity: { state: "idle", ...(refusal === undefined ? {} : { refusal }) }, browsers: [], exit: undefined, held: undefined,
  };
}

function queuedRow(h: ControlHarness, members: readonly WorkerMemberView[]) {
  const run = h.database.authority.runs.listByWorkflow(WORKFLOW).find(record => record.lifecycle.state === "queued");
  assert.ok(run);
  const projection = createOperatorProjection({
    database: h.database, reader: h.lifecycle, workerMembers: () => members,
    descriptors: { resolve: workflowId => DESCRIPTORS.find(descriptor => descriptor.id === workflowId) },
    stateRoot: h.stateRoot, clock: h.clock, appVersion: "0.1.0", descriptorSetHash: FingerprintSchema.parse("a".repeat(64)),
    ledger: { foldActivityRange: () => { throw new Error("unrequested activity"); } },
  });
  const row = projection.queueSurface(run.envelope.runId);
  assert.ok(row);
  assert.equal(row.status, "queued");
  return row;
}

describe("a queued run behind refused workers", () => {
  it("serves the refusal when every live worker is refused, and omits it when one can still claim", async () => {
    const h = await openControlHarness();
    assert.equal((await launchCommands(h).submit(dashboardLaunch(h, "10873690", { items: 2 }).request)).state, "applied");
    await settleMicrotasks();
    const now = h.clock.now().toISOString();
    h.database.authority.workerSlots.allocate({ workflow: WORKFLOW, poolIndex: 2, now });
    const slots = [...h.database.authority.workerSlots.active(WORKFLOW)].sort((left, right) => left.workerId < right.workerId ? -1 : 1);
    assert.equal(slots.length, 2);
    const first = slots[0];
    const second = slots[1];
    assert.ok(first && second);
    const refusal = WorkerRefusalStandingSchema.parse({
      code: "PREFLIGHT_BLOCKED", summary: "Readiness checks blocked this worker.", retryAt: now,
    });
    const other = WorkerRefusalStandingSchema.parse({
      code: "PREFLIGHT_TIMEOUT", summary: "A readiness check took too long. Check again.", retryAt: now,
    });
    assert.deepEqual(queuedRow(h, [live(first, refusal)]).notStarting, { code: refusal.code, summary: refusal.summary });
    assert.deepEqual(queuedRow(h, [live(first, refusal), live(second, other)]).notStarting, { code: refusal.code, summary: refusal.summary });
    assert.equal(queuedRow(h, [live(first, refusal), live(second)]).notStarting, undefined);
    assert.equal(queuedRow(h, [live(first)]).notStarting, undefined);
  });
});
