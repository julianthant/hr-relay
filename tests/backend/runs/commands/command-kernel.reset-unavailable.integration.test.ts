import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { WorkerSessionManager } from "../../../../src/backend/runtime/workers/worker-sessions.js";
import { createWorkerResetControl } from "../../../../src/backend/runtime/workers/worker-browser-control.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { taskStoreRegistry } from "../../../../src/backend/app/registries/task-registry.js";
import { sequentialIdFactory } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { happySessionHarness, ManualScheduler, personLookupQueuedRun } from "../../../support/helpers/phase1f-executor-harness.js";
import { fixtureDuoCeremonyGates } from "../../../support/helpers/duo-ceremony-fixtures.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";
import { syntheticDatabasePath } from "../../../support/helpers/synthetic-database-admission.js";
import { afterEach, describe, expect, it } from "vitest";
import { createDashboardPoolTestWorld } from "../../../support/helpers/backend/dashboard-pool-world.js";
import { createOperatorCommandIngress } from "../../../../src/backend/runs/commands/operator-command-ingress.js";

const world = createDashboardPoolTestWorld();
afterEach(world.cleanup);

describe("public Stop admission", () => {
  it("requires exact authority and returns replayable pending without shutdown or premature audit", async () => {
    const h = await world.openControlHarness();
    await world.spawnPoolWorker(h);
    const workerId = world.WORKER_1;
    const slot = h.database.authority.workerSlots.get(workerId), lease = h.database.authority.workerLeases.get(workerId);
    if (slot === undefined || lease === undefined) throw new Error("missing fixture authority");
    for (const strict of [false, true]) {
      const request = { ...world.envelope(h), type: "stop-worker", target: { workerId, expectedVersion: lease.version,
        ...(strict ? { membershipRevision: slot.membershipRevision, controlBasis: { leaseGeneration: lease.leaseGeneration,
          controlRevision: lease.controlRevision } } : {}) } };
      const before = h.database.getMeta().authorityGeneration;
      const result = await h.kernel.executeWorkerPool(request);
      if (strict) {
        expect(result).toEqual({ state: "pending", commandId: request.commandId });
        expect(await h.kernel.executeWorkerPool(request)).toEqual(result);
        expect(h.database.authority.workerControls.get(request.commandId)?.reset?.member.membershipRevision).toBe(slot.membershipRevision);
        expect(h.database.authority.commandAudits.findByCommand(request.commandId)).toBeUndefined();
        const reset = h.database.authority.workerControls.get(request.commandId)?.reset;
        if (reset === undefined) throw new Error("missing accepted reset");
        const manager = new WorkerSessionManager({ workerId: slot.workerId, workflowId: slot.workflow, stores: taskStoreRegistry,
          factory: happySessionHarness().factory, clock: h.clock, scheduler: new ManualScheduler(h.clock), acquireDeadlineMs: 20_000,
          duoCeremony: await fixtureDuoCeremonyGates(h.clock), resetOwner: { member: reset.member, lifetime: reset.lifetime } });
        const lifecycle = new RunRecordService({ database: h.database, clock: h.clock, ids: sequentialIdFactory("e"), publishQueued: () => undefined });
        await createWorkerResetControl({ database: h.database, workerId, leaseGeneration: lease.leaseGeneration, clock: h.clock, lifecycle })(manager, reset);
        const settled = h.database.authority.workerControls.get(request.commandId);
        expect(await h.kernel.executeWorkerPool(request)).toMatchObject({ state: "already-applied", commandId: request.commandId });
        const reopened = AuthorityDatabase.open({ path: syntheticDatabasePath(h.database), busyTimeoutMs: 250, migrationOwner: "reset-readback-test" }, h.clock);
        try { expect(reopened.authority.workerControls.get(request.commandId)).toEqual(settled); }
        finally { reopened.close(); }
        world.dashboardLaunch(h);
        const active = h.database.authority.runtimeConfig.get();
        if (active === undefined) throw new Error("missing fixture runtime");
        const queued = RunRecordSchema.parse(personLookupQueuedRun());
        h.database.authority.runs.enqueue({ ...queued, envelope: { ...queued.envelope, configSnapshotId: active.configSnapshotId, configFingerprint: active.configFingerprint } });
        const next = h.database.authority.runs.claimNext({ workerId, workflow: slot.workflow, now: h.clock.now().toISOString() });
        expect(next.state).toBe("claimed");
        if (next.state !== "claimed") throw new Error("next work unavailable");
        expect(h.database.authority.workerLeases.reportLifecycle({ workerId, leaseGeneration: lease.leaseGeneration,
          lifecycle: { state: "busy", startedAt: lease.lifecycle.startedAt, heartbeatAt: h.clock.now().toISOString(), runId: next.run.envelope.runId }, now: h.clock.now().toISOString() }).state).toBe("applied");
        expect(await h.kernel.executeWorkerPool(request)).toMatchObject({ state: "already-applied", commandId: request.commandId });
        expect(h.database.authority.workerLeases.get(workerId)?.lifecycle.state).toBe("busy");
        expect(h.database.authority.workerControls.get(request.commandId)).toEqual(settled);

      } else {
        expect(result).toMatchObject({ state: "rejected", message: "worker-reset-authority-unavailable" });
        expect(h.database.getMeta().authorityGeneration).toBe(before);
        expect(h.database.authority.workerLeases.get(workerId)).toEqual(lease);
        expect(h.database.authority.workerControls.get(request.commandId)).toBeUndefined();
        expect(h.database.authority.commands.get(request.commandId)).toBeUndefined();
      }
      expect(h.children.flatMap(child => child.signalsSent)).toEqual([]);
    }
  });

  it("rejects missing Stop authority at operator ingress before invoking the kernel", async () => {
    const h = await world.openControlHarness();
    const ingress = createOperatorCommandIngress({ clock: h.clock, journal: h.database.authority.commands,
      protectedCommandAcceptedAt: () => undefined, bulkAcceptances: { withTransaction: work => h.database.withAuthorityTransaction(repositories => work({ get: repositories.commands.getBulk, insert: repositories.commands.acceptBulk })) } });
    let calls = 0;
    const request = { ...world.envelope(h), type: "stop-worker", target: { workerId: "person-lookup-worker-1", expectedVersion: 1 } };
    const result = await ingress.submit(request, async () => { calls += 1; throw new Error("unsupported request reached execution"); });
    expect(result).toMatchObject({ state: "rejected", message: "worker-reset-authority-unavailable" });
    expect(calls).toBe(0);
  });
});

for (const fault of ["missing-owner-seam", "external", "dead", "member", "generation", "control"] as const) {
  it(`refuses public Stop ${fault} before journal or reservation mutation`, async () => {
    const h = await world.openControlHarness(fault === "missing-owner-seam" ? { interceptPool: pool => ({ ...pool, assertResetOwner: undefined }) } : undefined);
    const workerId = fault === "external" ? world.occupyMember(h, 1, "run") : world.WORKER_1;
    if (fault !== "external") await world.spawnPoolWorker(h);
    if (fault === "dead") h.children[0]?.emitExit(1, null);
    const lease = h.database.authority.workerLeases.get(workerId), slot = h.database.authority.workerSlots.get(workerId);
    if (lease === undefined || slot === undefined) throw new Error("missing owner");
    const request = { ...world.envelope(h), type: "stop-worker", target: { workerId,
      membershipRevision: slot.membershipRevision + (fault === "member" ? 1 : 0),
      controlBasis: { leaseGeneration: lease.leaseGeneration + (fault === "generation" ? 1 : 0), controlRevision: lease.controlRevision + (fault === "control" ? 1 : 0) } } };
    const generation = h.database.getMeta().authorityGeneration;
    const result = await h.kernel.executeWorkerPool(request);
    expect(result.state).toBe("rejected");
    expect(h.database.getMeta().authorityGeneration).toBe(generation);
    expect(h.database.authority.workerControls.get(request.commandId)).toBeUndefined();
    expect(h.database.authority.commands.get(request.commandId)).toBeUndefined();
    expect(h.database.authority.commandAudits.findByCommand(request.commandId)).toBeUndefined();
    expect(h.database.authority.workerLeases.get(workerId)).toEqual(lease);
    expect(h.children.flatMap(child => child.signalsSent)).toEqual([]);
  });
}
