import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "vitest";
import { WorkerLifecycleBindingSchema } from "../../../../src/models/run/worker-control.js";
import { WorkerRetirementProofSchema } from "../../../../src/models/run/worker-slot.js";
import { authenticateWorkerSupervisorEffect, consumeWorkerSupervisorEffect } from "../../../../src/backend/storage/sqlite/worker-control.js";
import { createWorkerSupervisionTestWorld } from "../../../support/helpers/backend/worker-supervision-world.js";

async function removal(invalidateDuringProof = false) {
  const world = createWorkerSupervisionTestWorld(), member = world.member(1), failure = new Error("retirement-source-changed");
  let current = true, checks = 0;
  const harness = world.openHarness({
    browserControl: { request: async () => "unused", closeForRemoval: async () => undefined },
    proveRetirement: async target => {
      await Promise.resolve();
      if (invalidateDuringProof) current = false;
      return { proof: WorkerRetirementProofSchema.parse({ workerId: target.workerId,
      membershipRevision: target.membershipRevision, checkedAt: world.NOW, processStopped: true, browsersClosed: true, exclusive: true }),
      assertCurrent() { checks++; if (!current) throw failure; } };
    },
  });
  await harness.supervisor.execute({ command: "spawn-worker", commandId: randomUUID(), member });
  const child = harness.children[0]; assert.ok(child?.pid);
  const binding = WorkerLifecycleBindingSchema.parse({ commandId: randomUUID(), member,
    lifetime: { leaseGeneration: 1, processId: child.pid, startedAt: world.NOW }, basis: { leaseGeneration: 1, controlRevision: 1 },
    reservedControlRevision: 2, poolVersion: 1, desiredWorkers: 1, operation: { kind: "remove" } });
  harness.nextGracefulStop = (_target, directive) => {
    harness.leases.delete(member.workerId); child.emitExit(0, null);
    return world.stopReceipt(directive.requestedAt);
  };
  const removeWorker = harness.supervisor.removeWorker?.bind(harness.supervisor); assert.ok(removeWorker);
  const effect = await removeWorker(binding, { ...world.stopDirective(world.NOW), commandId: binding.commandId });
  return { effect, binding, failure, checks: () => checks, invalidate: () => { current = false; } };
}

it("refuses to mint a removal effect if authority changes while retirement proof is awaited", async () => {
  await assert.rejects(() => removal(true), /retirement-source-changed/u);
});

it("rechecks the retained retirement guard when a minted removal effect is authenticated", async () => {
  const f = await removal();
  assert.equal(authenticateWorkerSupervisorEffect(f.effect, f.binding).kind, "remove");
  const before = f.checks(); f.invalidate();
  assert.throws(() => authenticateWorkerSupervisorEffect(f.effect, f.binding), error => error === f.failure);
  assert.equal(f.checks(), before + 1);
});

it("consumes a recorded removal effect without rechecking its obsolete pre-effect capture", async () => {
  const f = await removal();
  authenticateWorkerSupervisorEffect(f.effect, f.binding);
  const before = f.checks(); f.invalidate();
  consumeWorkerSupervisorEffect(f.effect);
  assert.equal(f.checks(), before);
  assert.throws(() => authenticateWorkerSupervisorEffect(f.effect, f.binding), /worker-lifecycle-effect-authority-unavailable/u);
});
