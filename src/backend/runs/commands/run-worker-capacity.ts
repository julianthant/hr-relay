import type { CommandKernel } from "./command-kernel.js";
import { type CapacityRequest, type CommandResult, type RunWorkerStartupFailure } from "../../../rules/commands/commands.js";
import { ERROR_CATALOG } from "../../../models/failures/error-catalog.js";
import { lifecycleCommandId } from "../../../rules/commands/lifecycle-command-id.js";
import type { AuthorityRepositories } from "../../storage/sqlite/authority-database.js";

export interface RunWorkerCapacity {
  workflowOf(request: CapacityRequest): string | undefined;
  ensure(request: CapacityRequest, result: CommandResult): Promise<void>;
  /** Runs capacity work its command did not wait for: the worker pool owns it until it settles, and its failure is reported as a fault. */
  detach(work: Promise<void>): void;
  /** True while a capacity step for the workflow is unsettled; its members that are not live are starting, not failed. */
  readonly startupPending: (workflowId: string) => boolean;
}

export class RunWorkerStartupError extends Error {
  constructor(readonly failure: RunWorkerStartupFailure, options?: ErrorOptions) { super(failure.message, options); this.name = "RunWorkerStartupError"; }
}

export function runCapacityCommandId(parentId: string, type: "plan-worker-count", index: number) {
  return lifecycleCommandId(`run-start-${type}`, [parentId, index]);
}

function fail(detail: string, state: RunWorkerStartupFailure["state"], cause?: unknown): never {
  throw new RunWorkerStartupError({ state, code: "RUN_QUEUED_WORKER_UNAVAILABLE", message: ERROR_CATALOG.RUN_QUEUED_WORKER_UNAVAILABLE.text, detail },
    cause === undefined ? undefined : { cause });
}

/** A start, or a run command that queues work, needs one live member of its workflow; a replayed command asks again, which is idempotent by pool state. */
export function createRunWorkerCapacity(deps: {
  kernel: CommandKernel;
  authority: Pick<AuthorityRepositories, "runs" | "startPlans" | "workerPools" | "workerSlots">;
  running(workflowId: string): boolean;
  ensureRunning(workflowId: string): Promise<void>;
  /** The worker pool's owner of startup work no caller waits for. */
  own: (work: Promise<void>) => void;
  reportDetachedFailure: (error: Error) => void;
  /** The served worker cards read `startupPending`; this republishes them when it changes. */
  startupPendingChanged: () => void;
}): RunWorkerCapacity {
  const workflowOf = (request: CapacityRequest) => request.family === "start" ? request.target.workflowId : deps.authority.runs.get(request.target.runId)?.envelope.workflow;
  const pending = new Map<string, number>();
  const countPending = (workflowId: string, delta: 1 | -1): void => {
    const count = (pending.get(workflowId) ?? 0) + delta;
    if (count === 0) pending.delete(workflowId); else pending.set(workflowId, count);
    deps.startupPendingChanged();
  };
  const start = async (workflowId: string, request: CapacityRequest): Promise<void> => {
    if (deps.authority.workerSlots.active(workflowId).length === 0) {
      const outcome = await deps.kernel.executeWorkerPool({ commandId: runCapacityCommandId(request.commandId, "plan-worker-count", 1),
        requestedAt: request.requestedAt, requestedBy: request.requestedBy, source: request.source, family: "worker-browser", type: "plan-worker-count",
        target: { workflowId, expectedVersion: deps.authority.workerPools.get(workflowId)?.version ?? 0 }, payload: { desiredWorkers: 1 } });
      if (outcome.state !== "applied" && outcome.state !== "already-applied") fail(`worker plan did not apply: ${JSON.stringify(outcome)}`, "refused");
      // The plan already preflighted and started its member; a refused or failed start leaves the workflow without a live member.
      if (!deps.running(workflowId)) fail("the planned worker did not start", "refused");
      return;
    }
    try { await deps.ensureRunning(workflowId); }
    catch (error) { fail(error instanceof Error ? error.message : String(error), "refused", error); }
  };
  return Object.freeze({
    workflowOf,
    startupPending: (workflowId: string) => pending.has(workflowId),
    detach(work: Promise<void>): void {
      deps.own(work.catch((error: unknown) => {
        deps.reportDetachedFailure(error instanceof Error ? error : new Error("worker capacity failed", { cause: error }));
      }));
    },
    async ensure(request: CapacityRequest, result: CommandResult): Promise<void> {
      if (result.state !== "applied" && result.state !== "already-applied") return;
      const workflowId = workflowOf(request);
      if (workflowId === undefined) fail("run is missing", "unknown");
      if (request.family === "start") {
        const startPlan = deps.authority.startPlans.get(request.target.startPlanId);
        if (startPlan === undefined || startPlan.workflowId !== workflowId) fail("start plan is missing or mismatched", "unknown");
        if (startPlan.shape === "preview" || startPlan.planned.length === 0) return;
      }
      countPending(workflowId, 1);
      try { await start(workflowId, request); }
      finally { countPending(workflowId, -1); }
    },
  });
}
