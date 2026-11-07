import { QueueSurfaceWireSchema } from "../../../../models/dashboard/projection.js";
import { type MockGroup, type MockState } from "../../run-detail/decision-mock/decision-mock-model.js";
import { mockLogsScene } from "../../assistant/assistant-mock-frames.js";
import type { QueueBusinessOutcome } from "../../shared/status/status-model.js";
import type { QueueSurfaceWire } from "../../queue/queue-model.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { mockNeedsReview, mockWaitsForOcr, mockQueueStatus, mockRunLog, type MockRun } from "./workflow-mock-model.js";
import { reviewCanApprove, reviewRecords } from "./workflow-review-model.js";
import { runDisplayId, workflowDisplayCode } from "../../shared/status/run-display-model.js";
import { mockWorkflow } from "./workflow-mock-catalog.js";
import { localDatePart } from "../../../../rules/time/clock.js";

// Presentation identities are local only; no command descriptors target them.
export function mockQueueId(id: string): string {
  const hash = sha256Hex(id);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function mockRunDisplayId(run: Pick<MockRun, "id" | "workflowId">): string {
  return runDisplayId(mockQueueId(run.id), workflowDisplayCode(mockWorkflow(run.workflowId).label));
}

const MOCK_QUEUE_STATUS: Readonly<Record<MockState, "awaiting-approval" | "blocked" | "failed" | "queued" | "cancelling" | "running" | "done">> = {
  review: "awaiting-approval", parked: "blocked", failed: "failed", paused: "queued", stalled: "failed", cancelling: "cancelling", running: "running", done: "done",
};
export function mockQueueSurface(run: MockRun, anchorIso: string, parent?: MockRun): QueueSurfaceWire {
  const review = mockNeedsReview(run);
  const records = reviewRecords(run);
  const warnings = records.flatMap(record => record.warnings);
  const { timeline, durationSeconds } = mockRunLog(run);
  const currentStep = timeline.find(stage => stage.state === "active" || stage.state === "waiting");
  const anchor = Date.parse(anchorIso);
  const end = new Date(anchor).toISOString();
  const start = new Date(anchor - durationSeconds * 1000).toISOString();
  const absent = (reason: string) => ({ state: "absent" as const, reason });
  if (run.parentId !== undefined && parent?.id !== run.parentId) throw new Error("MOCK_QUEUE_PARENT_UNAVAILABLE");
  const scene = mockLogsScene();
  const decisionRun = scene && run.id === `mock:${scene.workflow}:sample` ? scene : undefined;
  if (decisionRun) run = { ...run, subject: decisionRun.subject };
  return QueueSurfaceWireSchema.parse({
    surfaceKind: "single", runId: mockQueueId(run.id), itemId: mockQueueId(run.id), workflowId: run.workflowId,
    traceId: `${workflowDisplayCode(mockWorkflow(run.workflowId).label)}-091000-${sha256Hex(run.id).slice(0, 4)}`, attempt: 1,
    parent: parent === undefined ? null : { runId: mockQueueId(parent.id), visibility: "linked",
      partitionDay: localDatePart(new Date(anchor - mockRunLog(parent).durationSeconds * 1000)), workflowId: parent.workflowId,
      label: mockWorkflow(parent.workflowId).label, title: parent.subject, panelKind: mockNeedsReview(parent) ? "review" : "run", status: mockQueueStatus(parent) },
    linkedRuns: [],
    appVersion: absent("Local workflow fixture"), descriptorVersion: 1,
    descriptorHash: sha256Hex(run.workflowId), configFingerprint: sha256Hex(JSON.stringify(run.draft)),
    resolvedInstances: [], dryRun: run.draft.dryRun,
    priority: run.draft.priority === "background" ? "bulk" : "interactive",
    runNumber: absent("No persisted run ordinal"), session: absent("Local workflow fixture"),
    facts: absent("Results appear in Logs"), title: run.subject,
    displayName: absent("Use the input subject"), subtitle: absent("The panel names the workflow"),
    status: decisionRun ? MOCK_QUEUE_STATUS[decisionRun.state] : mockQueueStatus(run),
    startedAt: start, updatedAt: end,
    endedAt: decisionRun?.state !== "done" && decisionRun || review || mockWaitsForOcr(run) ? absent("Records await approval") : { state: "present", value: end },
    gateOpenedAt: review ? { state: "present", value: end } : absent("No open approval"),
    liveMessage: review ? { state: "present", value: `${records.filter(reviewCanApprove).length} of ${records.length} records ready for approval` } : decisionRun ? { state: "present", value: decisionRun.queueMessage } : currentStep ? { state: "present", value: currentStep.label } : absent("No active step"),
    warnings: warnings.length ? { state: "present", count: warnings.length, first: warnings[0] } : absent("No record warnings"),
    pipeline: timeline.map((stage, index) => ({
      id: `step-${index + 1}`, label: stage.label,
      state: stage.state === "completed" ? "done" : stage.state === "waiting" ? "blocked" : stage.state,
    })),
    panelKind: review ? "review" : "run", availableSections: ["logs", ...(run.workflowId === "ocr" ? ["review"] : [])],
    actions: [], rowRevision: 1,
  });
}

export function mockQueueSurfaces(runs: readonly MockRun[], anchorIso: string, allRuns = runs): readonly QueueSurfaceWire[] {
  const surfaces = runs.map(run => mockQueueSurface(run, anchorIso, run.parentId === undefined ? undefined : allRuns.find(parent => parent.id === run.parentId)));
  if (new Set(surfaces.map(surface => surface.runId)).size !== runs.length) throw new Error("MOCK_QUEUE_ID_COLLISION");
  const scene = mockLogsScene();
  const group = scene?.group;
  if (!group) return surfaces;
  const sample = mockQueueId(`mock:${scene.workflow}:sample`);
  return surfaces.flatMap(surface => surface.runId === sample ? decisionGroupSurfaces(surface, group) : [surface]);
}

/** Design mock: one parent run for the PDF plus one inline member run per person. The selected run keeps the sample id. */
function decisionGroupSurfaces(sample: QueueSurfaceWire, group: MockGroup): readonly QueueSurfaceWire[] {
  const id = (key: string, selected: boolean) => selected ? sample.runId : mockQueueId(`${sample.runId}:${key}`);
  const parentId = id("pdf", group.selected === "parent");
  const selected = group.selected;
  const memberIds = group.members.map((member, index) => id(String(index), selected !== "parent" && member.name === selected.member));
  const ended = { state: "present", value: sample.updatedAt } as const;
  const parent = QueueSurfaceWireSchema.parse({ ...sample, surfaceKind: "operation", runId: parentId, itemId: parentId, title: group.title,
    subtitle: { state: "present", value: group.subtitle }, status: "failed", endedAt: ended, liveMessage: { state: "absent", reason: "Members carry their own status" }, panelKind: "group",
    memberRunIds: memberIds, memberRollup: { total: memberIds.length, terminal: memberIds.length, failed: group.members.filter(member => member.failed).length },
    memberPreview: { state: "present", value: `${group.members[0].name} +${group.members.length - 1} more` } });
  return [parent, ...group.members.map((member, index) => QueueSurfaceWireSchema.parse({ ...sample, runId: memberIds[index], itemId: memberIds[index], title: member.name,
    subtitle: { state: "absent", reason: "The member title names the person" }, status: member.failed ? "failed" : "done", endedAt: ended,
    liveMessage: { state: "absent", reason: "Run is terminal" }, parent: { runId: parentId, visibility: "inline", partitionDay: localDatePart(new Date(sample.startedAt)), workflowId: sample.workflowId, label: "Emergency Contact", title: group.title, panelKind: "group", status: "failed" }, panelKind: "member" }))];
}

export function mockQueueOutcomes(runs: readonly MockRun[]): ReadonlyMap<string, QueueBusinessOutcome> {
  return new Map(runs.flatMap(run => run.businessOutcome ? [[mockQueueId(run.id), run.businessOutcome] as const] : []));
}
