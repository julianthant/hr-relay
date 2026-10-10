import type { CommandKernel } from "./command-kernel.js";
import { MAX_WORKERS_PER_POOL } from "../../runtime/workers/worker-loop.js";
import { WorkerBrowserCommandRequestSchema, type CommandRequest, type CommandResult } from "../../../rules/commands/commands.js";
import { lifecycleCommandId } from "../../../rules/commands/lifecycle-command-id.js";
import { isLiveWorker } from "../../../models/run/worker.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";

type StartRequest = Extract<CommandRequest, { family: "start" }>;
type WorkerRequest = Extract<CommandRequest, { family: "worker-browser" }>;
type CapacityAuthority = Pick<AuthorityRepositories, "workerPools" | "workerSlots" | "workerLeases" | "workerControls" | "commands">;

export interface RunWorkerCapacity {
  ensure(request: StartRequest, result: CommandResult): Promise<void>;
}

export function runCapacityCommandId(parentId: string, type: "plan-worker-count" | "spawn-worker", index: number) {
  return lifecycleCommandId(`run-start-${type}`, [parentId, index]);
}

/** One explicit launch creates one missing member; retained effects govern replay. */
export function createRunWorkerCapacity(deps: { kernel: CommandKernel; authority: CapacityAuthority }): RunWorkerCapacity {
  return Object.freeze({
    async ensure(request: StartRequest, result: CommandResult): Promise<void> {
      if (result.state !== "applied" && result.state !== "already-applied") return;
      const runIds = result.affectedTargets.flatMap(target => target.family === "run" ? [target.runId] : []);
      if (runIds.length === 0) return;
      const fail = (message: string): never => {
        throw new Error(`Runs queued (${runIds.join(", ")}; start ${request.commandId}; plan ${request.target.startPlanId}); worker startup ${message}`);
      };
      const { workflowId } = request.target;
      const activeSlots = () => deps.authority.workerSlots.list(workflowId).filter(slot => slot.retiredAt === null);
      const memberId = (index: number) => {
        const slot = activeSlots().find(value => value.poolIndex === index);
        if (slot === undefined) return fail("has no admitted slot at the selected pool index");
        return slot.workerId;
      };
      const retained: { index: number; plan?: WorkerRequest; spawn?: WorkerRequest }[] = [];
      for (let index = 1; index <= MAX_WORKERS_PER_POOL; index++) {
        const read = (type: "plan-worker-count" | "spawn-worker") => {
          const id = runCapacityCommandId(request.commandId, type, index);
          const value = deps.authority.workerControls.get(id)?.request ?? deps.authority.commands.get(id);
          if (value === undefined) return undefined;
          if (value.family !== "worker-browser" || value.type !== type || !("workflowId" in value.target)
            || value.target.workflowId !== workflowId || value.requestedAt !== request.requestedAt
            || value.requestedBy !== request.requestedBy || value.source !== request.source
            || (value.type === "spawn-worker" && (deps.authority.workerSlots.get(value.payload.workerId)?.workflow !== workflowId
              || deps.authority.workerSlots.get(value.payload.workerId)?.poolIndex !== index))
            || (value.type === "plan-worker-count" && (value.payload.desiredWorkers > MAX_WORKERS_PER_POOL))) {
            fail("identity differs from its retained capacity command");
          }
          return WorkerBrowserCommandRequestSchema.parse(value);
        };
        const plan = read("plan-worker-count");
        const spawn = read("spawn-worker");
        if (plan !== undefined || spawn !== undefined) retained.push({ index, ...(plan === undefined ? {} : { plan }), ...(spawn === undefined ? {} : { spawn }) });
      }
      if (retained.length > 1) fail("has multiple retained member intents; reconciliation required");
      let intent = retained[0];
      const usable = deps.authority.workerLeases.listLive(workflowId).some(lease => lease.control.directive === "run"
        && ["starting", "idle", "busy"].includes(lease.lifecycle.state));
      if (intent === undefined) {
        if (usable) return;
        if (result.state === "already-applied") fail("status unknown: no retained startup command or usable worker; reconcile before a new launch");
        const pool = deps.authority.workerPools.get(workflowId);
        const count = pool?.desiredWorkers ?? 0;
        if (count > MAX_WORKERS_PER_POOL) fail("unavailable: pool declaration exceeds the three-worker limit");
        const slots = activeSlots();
        if (slots.length > MAX_WORKERS_PER_POOL) fail("unavailable: admitted roster exceeds the three-worker limit");
        const reusable = slots.find(slot => {
          const lease = deps.authority.workerLeases.get(slot.workerId);
          return lease === undefined || !isLiveWorker(lease);
        });
        let index = reusable?.poolIndex;
        if (index === undefined) {
          index = [1, 2, 3].find(candidate => !slots.some(slot => slot.poolIndex === candidate));
          if (index === undefined) return fail("unavailable: all three admitted members are paused or stopping");
        }
        const envelope = { requestedAt: request.requestedAt, requestedBy: request.requestedBy, source: request.source, family: "worker-browser" as const };
        const desiredWorkers = Math.max(count, slots.length + (reusable === undefined ? 1 : 0));
        const needsPlan = pool === undefined || reusable === undefined || desiredWorkers !== count;
        if (needsPlan && slots.some(slot => {
          const lease = deps.authority.workerLeases.get(slot.workerId);
          return lease !== undefined && isLiveWorker(lease) && (lease.lifecycle.state === "stopping" || lease.control.directive === "stop");
        })) fail("unavailable: the admitted roster contains a pending stop");
        const plan = needsPlan
          ? WorkerBrowserCommandRequestSchema.parse({ ...envelope, commandId: runCapacityCommandId(request.commandId, "plan-worker-count", index),
            type: "plan-worker-count", target: { workflowId, expectedVersion: pool?.version ?? 0 }, payload: { desiredWorkers } })
          : undefined;
        const spawn = needsPlan ? undefined : WorkerBrowserCommandRequestSchema.parse({ ...envelope,
          commandId: runCapacityCommandId(request.commandId, "spawn-worker", index), type: "spawn-worker",
          target: { workflowId, expectedVersion: pool.version }, payload: { workerId: memberId(index) } });
        intent = { index, ...(plan === undefined ? {} : { plan }), ...(spawn === undefined ? {} : { spawn }) };
      }
      const execute = async (child: WorkerRequest) => {
        const outcome = await deps.kernel.executeWorkerPool(child).catch((error: unknown) =>
          fail(`failed or uncertain at ${child.type} ${child.commandId}: ${error instanceof Error ? error.message : String(error)}`));
        if (outcome.state !== "applied" && outcome.state !== "already-applied") {
          fail(`did not complete at ${child.type} ${child.commandId}: ${JSON.stringify(outcome)}`);
        }
      };
      if (intent.plan !== undefined) await execute(intent.plan);
      let spawn = intent.spawn;
      if (spawn === undefined) {
        const plan = intent.plan;
        if (plan === undefined || plan.type !== "plan-worker-count") return fail("has no retained spawn basis; reconciliation required");
        spawn = WorkerBrowserCommandRequestSchema.parse({ commandId: runCapacityCommandId(request.commandId, "spawn-worker", intent.index),
          requestedAt: plan.requestedAt, requestedBy: plan.requestedBy, source: plan.source,
          family: "worker-browser", type: "spawn-worker", target: { workflowId, expectedVersion: plan.target.expectedVersion + 1 },
          payload: { workerId: memberId(intent.index) } });
      }
      await execute(spawn);
    },
  });
}
