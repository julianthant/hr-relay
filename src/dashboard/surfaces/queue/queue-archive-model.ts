import { isTerminalQueueStatus } from "../../../domain/dashboard/projection.js";
import type { MockArchiveRun } from "../archive/archive-mock-model.js";
import { runTiming } from "../shared/status/format.js";
import type { LogStep } from "../run-detail/logs/log-feed-model.js";
import type { LogTimelineStage } from "../run-detail/logs/log-timeline-model.js";
import type { QueueMockRecord } from "./queue-preview-model.js";
import { runDisplayId } from "../shared/status/run-display-model.js";
import { dsStatusOf } from "../shared/status/status-model.js";
import { mockWorkflow } from "../workflows/mocks/workflow-mock-catalog.js";
import { mockDeletionIds, mockRunLog, type MockRun } from "../workflows/mocks/workflow-mock-model.js";
import { mockQueueSurface } from "../workflows/mocks/workflow-queue-model.js";
import { reviewName, reviewRecords } from "../workflows/mocks/workflow-review-model.js";

function snapshotReport(record: QueueMockRecord, label: string, archived: string, logs: { steps: readonly LogStep[]; timeline: readonly LogTimelineStage[] }, source: MockArchiveRun["snapshot"], fields: MockArchiveRun["fields"]): MockArchiveRun {
  const { row, originalSettings } = record;
  const completed = isTerminalQueueStatus(row.status) && row.endedAt.state === "present" ? row.endedAt.value : undefined;
  const timing = isTerminalQueueStatus(row.status) && completed === undefined ? undefined : runTiming(row, archived, isTerminalQueueStatus);
  return structuredClone({
    id: `queue-archive:${row.runId}:${row.startedAt.slice(0, 10)}`, number: runDisplayId(row.runId, row.traceId),
    title: row.title, person: row.title, employeeId: "Not recorded", email: "Not recorded", location: "Not recorded",
    workflow: row.workflowId, workflowLabel: label, dashboard: "unrecorded", workflowVersion: String(row.descriptorVersion),
    outcome: dsStatusOf(row.status), ...(completed ? { completed } : {}), archived, elapsed: timing?.text ?? "Not measured", document: row.title,
    settings: [["Dry run", row.dryRun ? "On" : "Off"], ["Priority", row.priority], ["Step selection", originalSettings.stepSelection.join(", ")]],
    fields, steps: logs.timeline.map<MockArchiveRun["steps"][number]>(stage => ({ label: stage.label, status: stage.state === "completed" ? "verifiedDone" : stage.state === "failed" ? "failed" : stage.state === "waiting" ? "waiting" : stage.state === "active" ? "running" : stage.state === "cancelled" ? "cancelled" : "notStarted", duration: stage.durationLabel ?? "—" })),
    savedLogs: logs, snapshot: source,
    files: [{ name: "run-snapshot.json", content: JSON.stringify(source, null, 2) }, { name: "logs.json", content: JSON.stringify(logs, null, 2) }],
  });
}

export function archiveQueuePreview(record: QueueMockRecord, label: string, archived: string): MockArchiveRun {
  const timeline: readonly LogTimelineStage[] = record.row.pipeline.map(step => ({ id: step.id, label: step.label, state: step.state === "done" ? "completed" : step.state === "blocked" ? "waiting" : step.state, stepId: step.id, substeps: [] }));
  const steps: readonly LogStep[] = record.row.pipeline.map(step => ({ id: step.id, title: step.label, time: "", entries: [{ kind: "note", id: `${step.id}:state`, time: "", message: `Recorded step state: ${step.state}` }] }));
  return snapshotReport(record, label, archived, { steps, timeline }, { kind: "queue", record }, record.row.facts.state === "present" ? record.row.facts.value.map(field => [field.label, field.value]) : []);
}

export function archiveWorkflowTree(runs: readonly MockRun[], id: string, day: string, archived: string): { ids: readonly string[]; reports: readonly MockArchiveRun[] } {
  const ids = mockDeletionIds(runs, id);
  const reports = runs.filter(run => ids.includes(run.id)).map(run => {
    const row = mockQueueSurface(run, day);
    const record: QueueMockRecord = { row, originalSettings: { workflowId: run.workflowId, workflowVersion: row.descriptorVersion, input: run.draft.text, dryRun: run.draft.dryRun, priority: row.priority, browserMode: run.draft.browser, captureScreenshots: run.draft.captures, instances: [], stepSelection: run.draft.selectedSteps } };
    const logs = mockRunLog(run);
    const fields: MockArchiveRun["fields"] = reviewRecords(run).flatMap(record => record.fields.map(field => [`${reviewName(record)} · Page ${record.page} · ${field.label}`, field.value] as const));
    return { ...snapshotReport(record, mockWorkflow(run.workflowId).label, archived, logs, { kind: "workflow", run }, fields),
      settings: [["Dry run", run.draft.dryRun ? "On" : "Off"], ["Priority", run.draft.priority], ["Browser mode", run.draft.browser], ["Capture screenshots", run.draft.captures ? "On" : "Off"], ["Step selection", run.draft.selectedSteps.join(", ")]] as const };
  });
  return { ids, reports };
}
