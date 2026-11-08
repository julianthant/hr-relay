import type { RunWorkerStartupFailure } from "../../../rules/commands/commands.js";

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

/** Shared with Start so Resume, Retry and Recover cannot drift from its wording. */
export function workerStartupToast(startup: RunWorkerStartupFailure): WorkerStartupToast {
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
