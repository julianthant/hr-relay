import type { WorkflowCatalogEntry } from "../workflow-catalog-model.js";
import type { SessionControl, SessionNode, SessionWorker, SessionsViewState } from "./sessions-view-model.js";
import { buildExplorerPreview } from "../explorer/explorer-fixture.js";

export const SESSION_SAMPLE_OPTIONS = [
  { id: "active", label: "Active workers" }, { id: "attention", label: "Needs attention" },
  { id: "idle", label: "Idle workers" }, { id: "empty", label: "No workers" },
  { id: "loading", label: "Loading" }, { id: "unavailable", label: "Unavailable" },
] as const;
const separationNodes = buildExplorerPreview({ identity: "verified", pending: "none", termination: "absent" }).map(step => ({ id: `separation-${step.number}`, label: step.title }));
const lookupNodes = ["Open UCPath", "Search the employee", "Verify the matching person", "Read the job summary"].map((label, index) => ({ id: `lookup-${index + 1}`, label }));
function sampleTimeline(workflow: "separations" | "person-lookup", completed: number, state: SessionNode["state"] = "active"): readonly SessionNode[] {
  return (workflow === "separations" ? separationNodes : lookupNodes).map((node, index) => ({ ...node, state: index < completed ? "completed" : index === completed ? state : "pending" }));
}
const workers: readonly [SessionWorker, SessionWorker, SessionWorker, SessionWorker] = [
  { id: "sample-worker-1", label: "Worker 1", workflowId: "separations", workflow: "Separations", subject: "Alex Morgan", action: "Read the timecard", state: "running", elapsed: "2m 14s", timeline: sampleTimeline("separations", 11), browsers: [{ id: "kuali", label: "Kuali", state: "ready" }, { id: "ucpath", label: "UCPath", state: "ready" }, { id: "kronos", label: "Kronos", state: "active" }] },
  { id: "sample-worker-2", label: "Worker 2", workflowId: "person-lookup", workflow: "Person Lookup", subject: "Jordan Lee", action: "Read the job summary", state: "running", elapsed: "41s", timeline: sampleTimeline("person-lookup", 3), browsers: [{ id: "ucpath", label: "UCPath", state: "active" }] },
  { id: "sample-worker-3", label: "Worker 3", workflowId: "separations", workflow: "Separations", subject: "Casey Rivera", action: "Open browser sessions", state: "starting", elapsed: "12s", timeline: sampleTimeline("separations", 0), browsers: [{ id: "kuali", label: "Kuali", state: "ready" }, { id: "ucpath", label: "UCPath", state: "starting" }] },
  { id: "sample-worker-4", label: "Worker 4", workflowId: "person-lookup", workflow: "Person Lookup", action: "Ready for the next run", state: "idle", browsers: [{ id: "ucpath", label: "UCPath", state: "ready" }] },
];
export function sessionsSample(scenario: string): SessionsViewState {
  switch (scenario) {
    case "active": return { state: "ready", workers };
    case "attention": return { state: "ready", workers: [
      { ...workers[0], state: "waiting", action: "Confirm the matching employee", timeline: sampleTimeline("separations", 14, "waiting") },
      { ...workers[1], state: "failed", action: "Read the job summary", problem: "The UCPath session expired.", timeline: sampleTimeline("person-lookup", 3, "failed"), browsers: [{ id: "ucpath", label: "UCPath", state: "unavailable" }] },
      { ...workers[2], state: "paused", action: "Read the timecard", timeline: sampleTimeline("separations", 11, "paused") },
    ] };
    case "idle": return { state: "ready", workers: workers.slice(0, 2).map(worker => ({ id: worker.id, label: worker.label, workflowId: worker.workflowId, workflow: worker.workflow, action: "Ready for the next run", state: "idle", browsers: worker.browsers.map(browser => ({ ...browser, state: "ready" })) })) };
    case "empty": return { state: "ready", workers: [] };
    case "loading": return { state: "loading" };
    case "unavailable": return { state: "unavailable", reason: "Session information is unavailable." };
    default: throw new Error("sessions-sample-missing");
  }
}
export function previewSessionControl(data: SessionsViewState, id: string, control: SessionControl): SessionsViewState {
  if (data.state !== "ready") throw new Error("sessions-preview-not-ready");
  const target = data.workers.find(worker => worker.id === id);
  if (!target) throw new Error("sessions-preview-worker-missing");
  if (control === "remove") {
    if (target.state !== "idle") throw new Error("sessions-preview-remove-invalid");
    return { state: "ready", workers: data.workers.filter(worker => worker.id !== id) };
  }
  return { state: "ready", workers: data.workers.map(worker => {
    if (worker.id !== id) return worker;
    if (control === "stop") return { id: worker.id, label: worker.label, workflowId: worker.workflowId, workflow: worker.workflow, action: "Ready for the next run", state: "idle", browsers: [] };
    if (control === "pause" && worker.state !== "running") throw new Error("sessions-preview-pause-invalid");
    if (control === "resume" && worker.state !== "paused") throw new Error("sessions-preview-resume-invalid");
    if (control === "retry" && worker.state !== "failed") throw new Error("sessions-preview-retry-invalid");
    const { problem: _problem, ...rest } = worker;
    const timeline = worker.timeline?.map((node, index): SessionNode => ({ ...node, state: control === "retry" ? index === 0 ? "active" : "pending" : control === "pause" && node.state === "active" ? "paused" : control === "resume" && node.state === "paused" ? "active" : node.state }));
    return { ...rest, timeline, state: control === "pause" ? "paused" : control === "retry" ? "starting" : "running", ...(control === "retry" ? { action: "Reopen browser sessions", browsers: worker.browsers.map(browser => ({ ...browser, state: "starting" as const })) } : {}) };
  }) };
}
export function previewSessionAdd(data: SessionsViewState, catalog: readonly WorkflowCatalogEntry[], workflowId: string, count: number, firstOrdinal: number): SessionsViewState {
  if (data.state !== "ready") throw new Error("sessions-preview-not-ready");
  const workflow = catalog.find(item => item.id === workflowId);
  if (!workflow || !Number.isSafeInteger(count) || count < 1) throw new Error("sessions-preview-add-invalid");
  const systems = [...new Set(workflow.preview?.steps.flatMap(step => step.system ? [step.system] : []) ?? [])];
  return { state: "ready", workers: [...data.workers, ...Array.from({ length: count }, (_, index): SessionWorker => ({
    id: `sample-added-${firstOrdinal + index}`, label: `Worker ${firstOrdinal + index}`, workflowId: workflow.id, workflow: workflow.label, state: "starting", action: "Preparing worker",
    browsers: systems.map(label => ({ id: label, label, state: "starting" })),
  }))] };
}
