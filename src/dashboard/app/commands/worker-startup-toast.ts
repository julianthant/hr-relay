import type { RunWorkerStartupFailure } from "../../../rules/commands/commands.js";
import type { DashboardDayWire } from "../../../models/dashboard/projection.js";
import { WORKER_STOP_REASON_LABEL } from "../../surfaces/sessions/worker-stop-reason-label.js";

const QUEUEING_RUN = new Set(["resume", "retry", "recover-run"]);
const QUEUEING_BULK = new Set(["resume", "retry"]);

export interface WorkerStartupToast {
  readonly tone: "warning";
  readonly title: string;
  readonly description?: string;
}

type StartupRequest = {
  readonly family: string;
  readonly type: string;
  readonly targets?: readonly unknown[];
};

type StartupReply = {
  readonly state?: string;
  // Bulk child results carry outcome and none of the other fields, so an all-optional shape rejects them.
  readonly outcome?: string;
  readonly workerStartup?: RunWorkerStartupFailure;
  readonly results?: readonly {
    readonly outcome: string;
    readonly workerStartup?: RunWorkerStartupFailure;
  }[];
};

function queuedWorkerTitle(state: "refused" | "unknown", count?: number): string {
  const subject = count === undefined ? "Run" : `${String(count)} ${count === 1 ? "run" : "runs"}`;
  return `${subject} queued; ${state === "refused" ? "worker unavailable" : "worker status unknown"}`;
}

function workerStartupToast(startup: RunWorkerStartupFailure): WorkerStartupToast {
  return { tone: "warning", title: queuedWorkerTitle(startup.state), description: startup.message };
}

function bulkWorkerStartupToast(results: NonNullable<StartupReply["results"]>): WorkerStartupToast | undefined {
  const missing = results.flatMap(result => result.outcome === "applied" && result.workerStartup !== undefined ? [result.workerStartup] : []);
  if (missing.length === 0) return undefined;
  const state = missing.some(startup => startup.state === "unknown") ? "unknown" : "refused";
  const message = new Set(missing.map(startup => startup.message)).size === 1 ? missing[0]?.message : undefined;
  return {
    tone: "warning",
    title: queuedWorkerTitle(state, missing.length),
    ...(message === undefined ? {} : { description: message }),
  };
}

export function appliedWorkerStartupToast(request: StartupRequest, reply: StartupReply | undefined): WorkerStartupToast | undefined {
  if (reply === undefined) return undefined;
  if (request.targets !== undefined) {
    if (!QUEUEING_BULK.has(request.type) || reply.results === undefined) return undefined;
    return bulkWorkerStartupToast(reply.results);
  }
  if (request.family !== "run" || !QUEUEING_RUN.has(request.type)) return undefined;
  if ((reply.state !== "applied" && reply.state !== "already-applied") || reply.workerStartup === undefined) return undefined;
  return workerStartupToast(reply.workerStartup);
}

/** Best-effort Resume all still names applied runs with no worker when a sibling keeps the parent unconfirmed. A confirmed parent is already warned. */
export function unconfirmedBulkWorkerToast(request: StartupRequest, reply: StartupReply | undefined, parentConfirmed: boolean): WorkerStartupToast | undefined {
  if (parentConfirmed || request.targets === undefined) return undefined;
  return appliedWorkerStartupToast(request, reply);
}

/** Queued runs no worker can take: every worker of their workflow has stopped, or it has none. Sticky while that holds. */
export function stoppedWorkerToasts(day: DashboardDayWire, workflowLabel: (workflowId: string) => string): WorkerStartupToast[] {
  const waiting = day.queueSurfaces.filter(row => row.status === "queued" && row.pause === undefined);
  return [...new Set(waiting.map(row => row.workflowId))].flatMap(workflowId => {
    const workers = day.workerCards.filter(card => card.workflowId === workflowId);
    const stopped = workers.some(card => card.state !== "failed") ? undefined : workers[0]?.stopReason;
    // Only served membership proves a workflow has no worker; a preview plan asks for none.
    const none = workers.length === 0 && day.workerAuthority.state === "present" && !day.workerAuthority.members.some(member => member.workflow === workflowId);
    const runs = waiting.filter(row => row.workflowId === workflowId && (!none || row.surfaceKind !== "preview")).length;
    if (runs === 0 || (stopped === undefined && !none)) return [];
    return [{ tone: "warning" as const, title: queuedWorkerTitle("refused", runs === 1 ? undefined : runs),
      description: stopped === undefined ? `${workflowLabel(workflowId)} has no worker. Add one in Sessions.`
        : `${workflowLabel(workflowId)} worker ${WORKER_STOP_REASON_LABEL[stopped]}. Retry it in Sessions.` }];
  });
}
