import { QueueSurfaceWireSchema, type QueueSurfaceWire } from "../../domain/dashboard/projection.js";
import { sha256Hex } from "../../domain/sha256.js";
import { mockNeedsReview, mockQueueStatus, mockRunLog, type MockRun } from "./workflow-mock-model.js";
import { reviewCanApprove, reviewRecords } from "./workflow-review-model.js";

// Presentation identities are local only; no command descriptors target them.
export function mockQueueId(id: string): string {
  const hash = sha256Hex(id);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export function mockQueueSurface(run: MockRun, day: string): QueueSurfaceWire {
  const review = mockNeedsReview(run);
  const records = reviewRecords(run);
  const warnings = records.flatMap(record => record.warnings);
  const { timeline } = mockRunLog(run);
  const absent = (reason: string) => ({ state: "absent" as const, reason });
  return QueueSurfaceWireSchema.parse({
    surfaceKind: "single", runId: mockQueueId(run.id), itemId: mockQueueId(run.id), workflowId: run.workflowId,
    traceId: `mock-091000-${sha256Hex(run.id).slice(0, 4)}`, attempt: 1,
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
    startedAt: `${day}T16:10:00.000Z`, updatedAt: `${day}T16:30:00.000Z`,
    endedAt: review ? absent("Records await approval") : { state: "present", value: `${day}T16:30:00.000Z` },
    gateOpenedAt: review ? { state: "present", value: `${day}T16:30:00.000Z` } : absent("No open approval"),
    liveMessage: review ? { state: "present", value: `${records.filter(reviewCanApprove).length} of ${records.length} records ready for approval` } : absent("No active step"),
    warnings: warnings.length ? { state: "present", count: warnings.length, first: warnings[0] } : absent("No record warnings"),
    pipeline: timeline.filter(stage => stage.id !== `${run.id}:result`).map((stage, index) => ({
      id: `step-${index + 1}`, label: stage.label,
      state: stage.state === "completed" ? "done" : stage.state === "waiting" ? "blocked" : stage.state,
    })),
    panelKind: review ? "review" : "run", availableSections: ["logs", ...(run.draft.method === "pdf" ? ["review"] : [])],
    actions: [], rowRevision: 1,
  });
}

export function mockQueueSurfaces(runs: readonly MockRun[], day: string): readonly QueueSurfaceWire[] {
  const surfaces = runs.map(run => mockQueueSurface(run, day));
  if (new Set(surfaces.map(surface => surface.runId)).size !== runs.length) throw new Error("MOCK_QUEUE_ID_COLLISION");
  return surfaces;
}
