import type { SessionControl, SessionWorker, SessionsViewState } from "./sessions-view-model.js";

export const SESSION_SAMPLE_OPTIONS = [
  { id: "active", label: "Active workers" }, { id: "attention", label: "Needs attention" },
  { id: "idle", label: "Idle workers" }, { id: "empty", label: "No workers" },
  { id: "loading", label: "Loading" }, { id: "unavailable", label: "Unavailable" },
] as const;
export const SESSION_SAMPLE_WORKFLOWS = [{ id: "separations", label: "Separations" }, { id: "person-lookup", label: "Person lookup" }] as const;
const workers: readonly [SessionWorker, SessionWorker, SessionWorker, SessionWorker] = [
  { id: "sample-worker-1", label: "Worker 1", workflow: "Separations", subject: "Alex Morgan", action: "Read the timecard", state: "running", elapsed: "2m 14s", progress: { completed: 2, total: 5 }, browsers: [{ id: "kuali", label: "Kuali", state: "ready" }, { id: "ucpath", label: "UCPath", state: "ready" }, { id: "kronos", label: "Kronos", state: "active" }] },
  { id: "sample-worker-2", label: "Worker 2", workflow: "Person lookup", subject: "Jordan Lee", action: "Check the job summary", state: "running", elapsed: "41s", progress: { completed: 1, total: 3 }, browsers: [{ id: "ucpath", label: "UCPath", state: "active" }] },
  { id: "sample-worker-3", label: "Worker 3", workflow: "Separations", subject: "Casey Rivera", action: "Open browser sessions", state: "starting", elapsed: "12s", browsers: [{ id: "kuali", label: "Kuali", state: "ready" }, { id: "ucpath", label: "UCPath", state: "starting" }] },
  { id: "sample-worker-4", label: "Worker 4", workflow: "Person lookup", action: "Ready for the next run", state: "idle", browsers: [{ id: "ucpath", label: "UCPath", state: "ready" }] },
];
export function sessionsSample(scenario: string): SessionsViewState {
  switch (scenario) {
    case "active": return { state: "ready", workers };
    case "attention": return { state: "ready", workers: [
      { ...workers[0], state: "waiting", action: "Confirm the matching employee" },
      { ...workers[1], state: "failed", action: "Read the document", problem: "The document session expired.", browsers: [{ id: "kuali", label: "Kuali", state: "unavailable" }] },
      { ...workers[2], state: "paused", action: "Read the timecard", progress: { completed: 2, total: 5 } },
    ] };
    case "idle": return { state: "ready", workers: workers.slice(0, 2).map(worker => ({ id: worker.id, label: worker.label, workflow: worker.workflow, action: "Ready for the next run", state: "idle", browsers: worker.browsers.map(browser => ({ ...browser, state: "ready" })) })) };
    case "empty": return { state: "ready", workers: [] };
    case "loading": return { state: "loading" };
    case "unavailable": return { state: "unavailable", reason: "Session information is unavailable." };
    default: throw new Error("sessions-sample-missing");
  }
}
export function previewSessionControl(data: SessionsViewState, id: string, control: SessionControl): SessionsViewState {
  if (data.state !== "ready") throw new Error("sessions-preview-not-ready");
  if (!data.workers.some(worker => worker.id === id)) throw new Error("sessions-preview-worker-missing");
  return { state: "ready", workers: data.workers.map(worker => {
    if (worker.id !== id) return worker;
    if (control === "stop") return { id: worker.id, label: worker.label, workflow: worker.workflow, action: "Ready for the next run", state: "idle", browsers: [] };
    if (control === "pause" && worker.state !== "running") throw new Error("sessions-preview-pause-invalid");
    if (control === "resume" && worker.state !== "paused") throw new Error("sessions-preview-resume-invalid");
    if (control === "retry" && worker.state !== "failed") throw new Error("sessions-preview-retry-invalid");
    const { problem: _problem, ...rest } = worker;
    return { ...rest, state: control === "pause" ? "paused" : control === "retry" ? "starting" : "running", ...(control === "retry" ? { action: "Reopen browser sessions", browsers: worker.browsers.map(browser => ({ ...browser, state: "starting" as const })) } : {}) };
  }) };
}
export function previewSessionAdd(data: SessionsViewState, workflowId: string, count: number, firstOrdinal: number): SessionsViewState {
  if (data.state !== "ready") throw new Error("sessions-preview-not-ready");
  const workflow = SESSION_SAMPLE_WORKFLOWS.find(item => item.id === workflowId);
  if (!workflow || !Number.isSafeInteger(count) || count < 1 || count > 6) throw new Error("sessions-preview-add-invalid");
  return { state: "ready", workers: [...data.workers, ...Array.from({ length: count }, (_, index): SessionWorker => ({ id: `sample-added-${firstOrdinal + index}`, label: `Worker ${firstOrdinal + index}`, workflow: workflow.label, state: "starting", action: "Open browser sessions", browsers: [{ id: "ucpath", label: "UCPath", state: "starting" }] }))] };
}
