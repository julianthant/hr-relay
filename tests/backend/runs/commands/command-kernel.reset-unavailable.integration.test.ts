import { afterEach, describe, expect, it } from "vitest";
import { createDashboardPoolTestWorld } from "../../../support/helpers/backend/dashboard-pool-world.js";
import { createOperatorCommandIngress } from "../../../../src/backend/runs/commands/operator-command-ingress.js";

const world = createDashboardPoolTestWorld();
afterEach(world.cleanup);

describe("public Stop waits for reset settlement support", () => {
  it("requires current membership/control evidence and refuses strict Stop before any journal reservation or shutdown effect", async () => {
    const h = world.openControlHarness();
    const workerId = world.occupyMember(h, 1, "run");
    const slot = h.database.authority.workerSlots.get(workerId), lease = h.database.authority.workerLeases.get(workerId);
    if (slot === undefined || lease === undefined) throw new Error("missing fixture authority");
    for (const strict of [false, true]) {
      const request = { ...world.envelope(h), type: "stop-worker", target: { workerId, expectedVersion: lease.version,
        ...(strict ? { membershipRevision: slot.membershipRevision, controlBasis: { leaseGeneration: lease.leaseGeneration,
          controlRevision: lease.controlRevision } } : {}) } };
      const before = h.database.getMeta().authorityGeneration;
      const result = await h.kernel.executeWorkerPool(request);
      expect(result).toMatchObject({ state: "rejected", message: strict ? "worker-reset-settlement-unavailable" : "worker-reset-authority-unavailable" });
      expect(h.database.getMeta().authorityGeneration).toBe(before);
      expect(h.database.authority.workerLeases.get(workerId)).toEqual(lease);
      expect(h.database.authority.workerControls.get(request.commandId)).toBeUndefined();
      expect(h.database.authority.commands.get(request.commandId)).toBeUndefined();
      expect(h.children.flatMap(child => child.signalsSent)).toEqual([]);
    }
  });

  it("rejects missing Stop authority at operator ingress before invoking the kernel", async () => {
    const h = world.openControlHarness();
    const ingress = createOperatorCommandIngress({ clock: h.clock, journal: h.database.authority.commands,
      protectedCommandAcceptedAt: () => undefined, bulkAcceptances: { withTransaction: work => h.database.withAuthorityTransaction(repositories => work({ get: repositories.commands.getBulk, insert: repositories.commands.acceptBulk })) } });
    let calls = 0;
    const request = { ...world.envelope(h), type: "stop-worker", target: { workerId: "person-lookup-worker-1", expectedVersion: 1 } };
    const result = await ingress.submit(request, async () => { calls += 1; throw new Error("unsupported request reached execution"); });
    expect(result).toMatchObject({ state: "rejected", message: "worker-reset-authority-unavailable" });
    expect(calls).toBe(0);
  });
});
