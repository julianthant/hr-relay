import { systemClock } from "../../../rules/time/clock.js";
import { WorkerBrowserCommandRequestSchema } from "../../../rules/commands/commands.js";
import type { WorkerControlBasis } from "../../../models/run/worker.js";
import type { WorkerCardWire } from "../../surfaces/sessions/session-panel-model.js";
import { settleCommandResult } from "./command-result.js";
import type { DashboardClient } from "../../client/index.js";

export type WorkerControlAction = "pause-worker" | "resume-worker" | "stop-worker" | "refresh-browser" | "reopen-browser";
type Context = Readonly<{ actorId: string; source: string }>;
function envelope(context: Context) {
  return { commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(), requestedBy: context.actorId, source: context.source, family: "worker-browser" };
}
export function composeStopWorkerCommand(worker: Readonly<{ workerId: string; leaseVersion: number; controlBasis?: WorkerControlBasis }>, context: Context): unknown {
  return { ...envelope(context), type: "stop-worker", target: { workerId: worker.workerId, expectedVersion: worker.leaseVersion, ...(worker.controlBasis === undefined ? {} : { controlBasis: worker.controlBasis }) } };
}
export function composePlanWorkerCountCommand(pool: Readonly<{ workflowId: string; desiredWorkers: number; expectedVersion: number }>, context: Context): unknown {
  return { ...envelope(context), type: "plan-worker-count", target: { workflowId: pool.workflowId, expectedVersion: pool.expectedVersion }, payload: { desiredWorkers: pool.desiredWorkers } };
}
export function composeSpawnWorkerCommand(member: Readonly<{ workflowId: string; workerId: string; expectedVersion: number }>, context: Context): unknown {
  return { ...envelope(context), type: "spawn-worker", target: { workflowId: member.workflowId, expectedVersion: member.expectedVersion }, payload: { workerId: member.workerId } };
}
export function composeWorkerControlCommand(card: WorkerCardWire, type: WorkerControlAction, context: Context, browserSessionId?: string) {
  if (card.controls?.basis.state !== "present") throw new Error("worker-control-basis-unavailable");
  if (card.controls.ownership.state !== "owned") throw new Error(card.controls.ownership.reason);
  return WorkerBrowserCommandRequestSchema.parse({ ...envelope(context), type,
    target: { workerId: card.workerId, expectedVersion: card.leaseVersion, controlBasis: card.controls.basis.value,
      ...(browserSessionId === undefined ? {} : { browserSessionId }) } });
}
/** Retain the exact envelope for replay; never mint an identity after response loss. */
export function createWorkerCommandDispatch(client: Pick<DashboardClient, "executeCommand">, context: Context) {
  const send = (request: unknown) => client.executeCommand(request).then(settleCommandResult);
  return Object.freeze({
    prepare: (card: WorkerCardWire, type: WorkerControlAction, browserSessionId?: string) => composeWorkerControlCommand(card, type, context, browserSessionId),
    send,
    plan: (pool: Parameters<typeof composePlanWorkerCountCommand>[0]) => send(composePlanWorkerCountCommand(pool, context)),
    spawn: (member: Parameters<typeof composeSpawnWorkerCommand>[0]) => send(composeSpawnWorkerCommand(member, context)),
  });
}
export type WorkerCommandDispatch = ReturnType<typeof createWorkerCommandDispatch>;
