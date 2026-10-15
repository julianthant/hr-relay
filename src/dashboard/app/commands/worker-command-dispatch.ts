import { systemClock } from "../../../rules/time/clock.js";
import type { WorkerControlBasis } from "../../../models/run/worker.js";

type Context = Readonly<{ actorId: string; source: string }>;
function envelope(context: Context) {
  return { commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: context.actorId, source: context.source, family: "worker-browser" };
}
export function composeStopWorkerCommand(worker: Readonly<{ workerId: string; membershipRevision: number; leaseVersion: number; controlBasis: WorkerControlBasis }>, context: Context): unknown {
  return { ...envelope(context), type: "stop-worker", target: { workerId: worker.workerId, membershipRevision: worker.membershipRevision, expectedVersion: worker.leaseVersion, controlBasis: worker.controlBasis } };
}
export function composePlanWorkerCountCommand(pool: Readonly<{ workflowId: string; desiredWorkers: number; expectedVersion: number }>, context: Context): unknown {
  return { ...envelope(context), type: "plan-worker-count", target: { workflowId: pool.workflowId, expectedVersion: pool.expectedVersion }, payload: { desiredWorkers: pool.desiredWorkers } };
}
export function composeSpawnWorkerCommand(member: Readonly<{ workflowId: string; workerId: string; expectedVersion: number }>, context: Context): unknown {
  return { ...envelope(context), type: "spawn-worker", target: { workflowId: member.workflowId, expectedVersion: member.expectedVersion }, payload: { workerId: member.workerId } };
}
