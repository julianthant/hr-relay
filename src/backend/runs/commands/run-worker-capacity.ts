import type { CommandKernel } from "./command-kernel.js";
import { WorkerBrowserCommandRequestSchema, type CommandRequest, type CommandResult, type RunWorkerStartupFailure } from "../../../rules/commands/commands.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { lifecycleCommandId } from "../../../rules/commands/lifecycle-command-id.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";

type StartRequest = Extract<CommandRequest, { family: "start" }>;
type WorkerRequest = Extract<CommandRequest, { family: "worker-browser" }>;
type CapacityAuthority = Pick<AuthorityRepositories, "startPlans" | "workerPools" | "workerSlots" | "workerControls" | "commands">;

export interface RunWorkerCapacity {
  ensure(request: StartRequest, result: CommandResult): Promise<void>;
}

export class RunWorkerStartupError extends Error {
  constructor(readonly failure: RunWorkerStartupFailure) { super(failure.message); this.name = "RunWorkerStartupError"; }
}

export function runCapacityCommandId(parentId: string, type: "plan-worker-count" | "spawn-worker", index: number) {
  return lifecycleCommandId(`run-start-${type}`, [parentId, index]);
}

export function createRunWorkerCapacity(deps: { kernel: CommandKernel; authority: CapacityAuthority; reconcileWorker(workerId: string): boolean }): RunWorkerCapacity {
  return Object.freeze({
    async ensure(request: StartRequest, result: CommandResult): Promise<void> {
      if (result.state !== "applied" && result.state !== "already-applied") return;
      const fail = (detail: string, state: RunWorkerStartupFailure["state"] = "unknown", commandId?: RunWorkerStartupFailure["commandId"]): never => {
        throw new RunWorkerStartupError({ state, code: "RUN_QUEUED_WORKER_UNAVAILABLE", message: ERROR_CATALOG.RUN_QUEUED_WORKER_UNAVAILABLE.text,
          detail, ...(commandId === undefined ? {} : { commandId }) });
      };
      const { workflowId } = request.target;
      const startPlan = deps.authority.startPlans.get(request.target.startPlanId);
      if (startPlan === undefined || startPlan.workflowId !== workflowId) return fail("start plan is missing or mismatched");
      if (startPlan.shape === "preview" || startPlan.planned.length === 0) return;
      const wanted = 1;
      const slots = deps.authority.workerSlots.list(workflowId);
      const read = (type: "plan-worker-count" | "spawn-worker", index: number) => {
        const id = runCapacityCommandId(request.commandId, type, index);
        const value = deps.authority.workerControls.get(id)?.request ?? deps.authority.commands.get(id);
        if (value === undefined) return undefined;
        if (value.family !== "worker-browser" || value.type !== type || !("workflowId" in value.target)
          || value.target.workflowId !== workflowId || value.requestedAt !== request.requestedAt
          || value.requestedBy !== request.requestedBy || value.source !== request.source
          || (value.type === "spawn-worker" && !slots.some(slot => slot.workerId === value.payload.workerId && slot.poolIndex === index))) {
          return fail("identity differs from its retained capacity command");
        }
        return WorkerBrowserCommandRequestSchema.parse(value);
      };
      const retained = [...new Set(slots.map(slot => slot.poolIndex))].flatMap(index => {
        const plan = read("plan-worker-count", index), spawn = read("spawn-worker", index);
        return plan === undefined && spawn === undefined ? [] : [{ index, plan, spawn }];
      });
      const plans = retained.flatMap(intent => intent.plan === undefined ? [] : [intent.plan]);
      if (plans.length > 1) return fail("has multiple retained pool plans; reconciliation required");
      let plan = plans[0];
      const failChild = (child: WorkerRequest, detail: string, rejected: boolean): never => {
        const phase = deps.authority.workerControls.get(child.commandId)?.phase;
        if (phase?.state === "refused" || phase?.state === "uncertain") {
          return fail(detail, phase.state === "refused" ? "refused" : "unknown", child.commandId);
        }
        if (phase?.state === "admitted" || phase?.state === "executing") {
          return fail(`${child.type} ${child.commandId}: worker-control-${phase.state}; no repeated effect is authorized`, "unknown", child.commandId);
        }
        return fail(detail, phase === undefined && rejected ? "refused" : "unknown", child.commandId);
      };
      const execute = async (child: WorkerRequest) => {
        const outcome = await deps.kernel.executeWorkerPool(child).catch((error: unknown) =>
          failChild(child, `failed or uncertain at ${child.type} ${child.commandId}: ${error instanceof Error ? error.message : String(error)}`, false));
        if (outcome.state !== "applied" && outcome.state !== "already-applied") {
          failChild(child, `did not complete at ${child.type} ${child.commandId}: ${JSON.stringify(outcome)}`, outcome.state === "rejected");
        }
      };
      if (plan === undefined && retained.length > 0) {
        for (const intent of retained) if (intent.spawn !== undefined) await execute(intent.spawn);
        return;
      }
      if (plan === undefined) {
        const active = slots.filter(slot => slot.retiredAt === null);
        const live = active.filter(slot => {
          try { return deps.reconcileWorker(slot.workerId); }
          catch (error) { return fail(`unavailable: ${error instanceof Error ? error.message : String(error)}`); }
        });
        if (live.length >= wanted) return;
        if (result.state === "already-applied") return fail("status unknown: no retained startup command; reconcile before a new launch");
        const pool = deps.authority.workerPools.get(workflowId);
        if ((pool?.desiredWorkers ?? 0) !== active.length) return fail("unavailable: worker pool roster authority is inconsistent");
        if (deps.authority.workerSlots.verifications(workflowId).length !== 0) return fail("unavailable: worker verification owns the pool reservation");
        const stopped = active.filter(slot => !live.some(member => member.workerId === slot.workerId));
        for (const member of stopped.slice(0, wanted - live.length)) {
          await execute(WorkerBrowserCommandRequestSchema.parse({ commandId: runCapacityCommandId(request.commandId, "spawn-worker", member.poolIndex),
            requestedAt: request.requestedAt, requestedBy: request.requestedBy, source: request.source,
            family: "worker-browser", type: "spawn-worker", target: { workflowId, expectedVersion: pool?.version ?? 0 },
            payload: { workerId: member.workerId } }));
        }
        const shortfall = wanted - live.length - Math.min(stopped.length, wanted - live.length);
        if (shortfall === 0) return;
        let index = 1;
        while (active.some(slot => slot.poolIndex === index)) index += 1;
        plan = WorkerBrowserCommandRequestSchema.parse({ commandId: runCapacityCommandId(request.commandId, "plan-worker-count", index),
          requestedAt: request.requestedAt, requestedBy: request.requestedBy, source: request.source,
          family: "worker-browser", type: "plan-worker-count", target: { workflowId, expectedVersion: pool?.version ?? 0 },
          payload: { desiredWorkers: active.length + shortfall } });
      }
      await execute(plan);
      const control = deps.authority.workerControls.get(plan.commandId);
      if (plan.type !== "plan-worker-count" || control?.roster === undefined || control.roster.excess.length !== 0) {
        return fail("has no retained additive roster; reconciliation required");
      }
      for (const member of control.roster.selected.filter(slot => slot.reservationCommandId === plan.commandId)) {
        let spawn = read("spawn-worker", member.poolIndex);
        if (spawn === undefined) {
          const current = deps.authority.workerSlots.get(member.workerId);
          if (current === undefined || current.retiredAt !== null || current.membershipRevision !== member.membershipRevision) {
            return fail("admitted member changed before Spawn; reconciliation required");
          }
          spawn = WorkerBrowserCommandRequestSchema.parse({ commandId: runCapacityCommandId(request.commandId, "spawn-worker", member.poolIndex),
            requestedAt: request.requestedAt, requestedBy: request.requestedBy, source: request.source,
            family: "worker-browser", type: "spawn-worker", target: { workflowId, expectedVersion: control.roster.afterVersion },
            payload: { workerId: member.workerId } });
        }
        await execute(spawn);
      }
    },
  });
}
