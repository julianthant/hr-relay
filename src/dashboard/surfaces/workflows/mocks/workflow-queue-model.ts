import { QueueSurfaceWireSchema } from "../../../../models/dashboard/projection.js";
import type { QueueBusinessOutcome } from "../../shared/status/status-model.js";
import type { QueueSurfaceWire } from "../../queue/queue-model.js";
import { sha256Hex } from "../../../../rules/validation/sha256.js";
import { mockNeedsReview, mockWaitsForOcr, mockQueueStatus, mockRunLog, type MockRun } from "./workflow-mock-model.js";
import { reviewCanApprove, reviewRecords } from "./workflow-review-model.js";
import { runDisplayId, workflowDisplayCode } from "../../shared/status/run-display-model.js";
import { mockWorkflow } from "./workflow-mock-catalog.js";

// Presentation identities are local only; no command descriptors target them.
export function mockQueueId(id: string): string {
  const hash = sha256Hex(id);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function mockRunDisplayId(run: Pick<MockRun, "id" | "workflowId">): string {
  return runDisplayId(mockQueueId(run.id), workflowDisplayCode(mockWorkflow(run.workflowId).label));
}

export function mockQueueSurface(run: MockRun, anchorIso: string): QueueSurfaceWire {
  const review = mockNeedsReview(run);
  const records = reviewRecords(run);
  const warnings = records.flatMap(record => record.warnings);
  const { timeline, durationSeconds } = mockRunLog(run);
  const currentStep = timeline.find(stage => stage.state === "active" || stage.state === "waiting");
  const anchor = Date.parse(anchorIso);
  const end = new Date(anchor).toISOString();
  const start = new Date(anchor - durationSeconds * 1000).toISOString();
  const absent = (reason: string) => ({ state: "absent" as const, reason });
  return QueueSurfaceWireSchema.parse({
    surfaceKind: "single", runId: mockQueueId(run.id), itemId: mockQueueId(run.id), workflowId: run.workflowId,
    traceId: `${workflowDisplayCode(mockWorkflow(run.workflowId).label)}-091000-${sha256Hex(run.id).slice(0, 4)}`, attempt: 1,
    lineage: run.parentId ? { state: "child", parentRunId: mockQueueId(run.parentId) } : { state: "root" },
    containment: run.parentId ? "linked" : "root", linkedRuns: [],
    appVersion: absent("Local workflow fixture"), descriptorVersion: 1,
    descriptorHash: sha256Hex(run.workflowId), configFingerprint: sha256Hex(JSON.stringify(run.draft)),
    resolvedInstances: [], dryRun: run.draft.dryRun,
    priority: run.draft.priority === "background" ? "bulk" : "interactive",
    runNumber: absent("No persisted run ordinal"), session: absent("Local workflow fixture"),
    facts: absent("Results appear in Logs"), title: run.subject,
    displayName: absent("Use the input subject"), subtitle: absent("The panel names the workflow"),
    status: mockQueueStatus(run),
    startedAt: start, updatedAt: end,
    endedAt: review || mockWaitsForOcr(run) ? absent("Records await approval") : { state: "present", value: end },
    gateOpenedAt: review ? { state: "present", value: end } : absent("No open approval"),
    liveMessage: review ? { state: "present", value: `${records.filter(reviewCanApprove).length} of ${records.length} records ready for approval` } : currentStep ? { state: "present", value: currentStep.label } : absent("No active step"),
    warnings: warnings.length ? { state: "present", count: warnings.length, first: warnings[0] } : absent("No record warnings"),
    pipeline: timeline.map((stage, index) => ({
      id: `step-${index + 1}`, label: stage.label,
      state: stage.state === "completed" ? "done" : stage.state === "waiting" ? "blocked" : stage.state,
    })),
    panelKind: review ? "review" : "run", availableSections: ["logs", ...(run.workflowId === "ocr" ? ["review"] : [])],
    actions: [], rowRevision: 1,
  });
}

export function mockQueueSurfaces(runs: readonly MockRun[], anchorIso: string): readonly QueueSurfaceWire[] {
  const surfaces = runs.map(run => mockQueueSurface(run, anchorIso));
  if (new Set(surfaces.map(surface => surface.runId)).size !== runs.length) throw new Error("MOCK_QUEUE_ID_COLLISION");
  return surfaces;
}

export function mockQueueOutcomes(runs: readonly MockRun[]): ReadonlyMap<string, QueueBusinessOutcome> {
  return new Map(runs.flatMap(run => run.businessOutcome ? [[mockQueueId(run.id), run.businessOutcome] as const] : []));
}
