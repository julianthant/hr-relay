export type SessionWorkerState = "running" | "starting" | "idle" | "waiting" | "paused" | "failed";
export type SessionControl = "pause" | "resume" | "retry" | "stop";
export type SessionWorker = Readonly<{
  id: string;
  label: string;
  workflow: string;
  subject?: string;
  action: string;
  state: SessionWorkerState;
  elapsed?: string;
  progress?: Readonly<{ completed: number; total: number }>;
  problem?: string;
  browsers: readonly Readonly<{ id: string; label: string; state: "ready" | "active" | "starting" | "unavailable" }>[];
}>;
export type SessionsViewState = Readonly<{ state: "ready"; workers: readonly SessionWorker[] }>
  | Readonly<{ state: "loading" }> | Readonly<{ state: "unavailable"; reason: string }>;
export const SESSION_STATE_LABELS: Readonly<Record<SessionWorkerState, string>> = {
  running: "Running", starting: "Starting", idle: "Idle", waiting: "Waiting", paused: "Paused", failed: "Failed",
};
export function sessionStateColor(state: SessionWorkerState): string {
  return state === "failed" ? "text-ui-danger" : state === "waiting" || state === "starting" ? "text-ui-warning"
    : state === "running" ? "text-ui-positive" : "text-ui-muted";
}
export function sessionTallies(workers: readonly SessionWorker[]): readonly { state: SessionWorkerState; count: number }[] {
  const order: readonly SessionWorkerState[] = ["running", "starting", "idle", "waiting", "paused", "failed"];
  return order.map(state => ({ state, count: workers.filter(worker => worker.state === state).length }))
    .filter(tally => tally.count > 0 || ["running", "starting", "idle"].includes(tally.state));
}
export function sessionProgressPercent(progress: NonNullable<SessionWorker["progress"]>): number {
  if (!Number.isSafeInteger(progress.completed) || !Number.isSafeInteger(progress.total) || progress.total < 1 || progress.completed < 0 || progress.completed > progress.total) throw new Error("session-progress-invalid");
  return progress.completed / progress.total * 100;
}
