/** Served queue rows for the state gallery: one row per status, plus a group and its members. Browser-safe. */
import { TERMINAL_QUEUE_STATUSES, type QueueStatusSchema, type QueueSurfaceWireSchema } from "../../../../src/models/dashboard/projection.js";
import type { z } from "zod";
import { createAwaitingQueueFixtures } from "../../helpers/dashboard/awaiting-queue-fixtures.js";

type QueueStatus = z.infer<typeof QueueStatusSchema>;
type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;
type PipelineState = QueueSurfaceWire["pipeline"][number]["state"];

export const QUEUE_STORY_DAY = "2026-08-14";
export const QUEUE_STORY_NOW = "2026-08-14T17:00:00.000Z";
export const QUEUE_STORY_WORKFLOW_LABEL = "Person Lookup";
const STARTED = "2026-08-14T16:42:00.000Z";
const ENDED = "2026-08-14T16:45:30.000Z";

const uuid = (seed: number): string => `00000000-0000-4000-8000-${String(seed).padStart(12, "0")}`;
const { surface } = createAwaitingQueueFixtures(uuid(1), "a".repeat(64), "b".repeat(64), STARTED);

const PIPELINE: Record<QueueStatus, readonly [PipelineState, PipelineState, PipelineState, PipelineState]> = {
  queued: ["pending", "pending", "pending", "pending"],
  running: ["done", "active", "pending", "pending"],
  cancelling: ["done", "active", "pending", "pending"],
  blocked: ["done", "done", "blocked", "pending"],
  "awaiting-approval": ["done", "blocked", "pending", "pending"],
  done: ["done", "done", "done", "done"],
  failed: ["done", "failed", "pending", "pending"],
  cancelled: ["done", "cancelled", "skipped", "skipped"],
  partial: ["done", "done", "done", "skipped"],
};
const PIPELINE_STEPS = [["search", "Search"], ["cross-verify", "Cross Verification"], ["active-status", "Active Status"], ["crm-dates", "CRM Dates"]] as const;

const LIVE_MESSAGE: Partial<Record<QueueStatus, string>> = {
  running: "Cross-verifying against CRM",
  cancelling: "Stopping after this step",
  blocked: "Did the save reach UCPath?",
  "awaiting-approval": "Waiting on identity review",
  failed: "UCPath did not find this employee",
};

function actionsFor(status: QueueStatus, rowRevision: number): unknown[] {
  const command = { kind: "command", expectedVersion: rowRevision, placement: ["footer", "menu"] } as const;
  const rerun = { key: "rerun", label: "Rerun", kind: "navigation", navigate: { kind: "rerun", expectedVersion: rowRevision },
    intent: "primary", icon: "retry", placement: ["footer", "menu", "data"] };
  const remove = { ...command, key: "delete", label: "Delete run", command: "delete", intent: "destructive", icon: "delete",
    confirm: { title: "Delete this run", confirmLabel: "Delete", tone: "destructive" } };
  const cancel = { ...command, key: "cancel", label: "Cancel run", command: "cancel", intent: "destructive", icon: "cancel",
    confirm: { title: "Cancel this run", body: "Final: a cancelled run is never resumed.", confirmLabel: "Cancel the run", tone: "destructive" } };
  if (status === "cancelled") return [remove];
  if (TERMINAL_QUEUE_STATUSES.has(status)) return [rerun, remove];
  if (status === "cancelling" || status === "blocked") return [];
  return [cancel];
}

/** A served row in one status; `overrides` replaces any wire field. */
export function queueStoryRow(status: QueueStatus, seed: number, overrides: Record<string, unknown> = {}): QueueSurfaceWire {
  const terminal = TERMINAL_QUEUE_STATUSES.has(status);
  const message = LIVE_MESSAGE[status];
  return surface({
    runId: uuid(seed),
    itemId: uuid(seed + 5000),
    traceId: `pl-164200-${String(seed).padStart(4, "0")}`,
    runNumber: { state: "present", value: seed },
    status,
    title: "Jordan Reyes",
    subtitle: { state: "present", value: "EID 10873698" },
    updatedAt: terminal ? ENDED : STARTED,
    endedAt: terminal ? { state: "present", value: ENDED } : { state: "absent", reason: `run is ${status} and has not ended` },
    gateOpenedAt: status === "awaiting-approval" ? { state: "present", value: STARTED } : { state: "absent", reason: "no gate has opened on this run" },
    liveMessage: message === undefined ? { state: "absent", reason: "no live message is being emitted" } : { state: "present", value: message },
    warnings: status === "partial" ? { state: "present", count: 2, first: "CRM dates were not checked" } : { state: "absent", reason: "no warning set has been derived" },
    facts: terminal ? { state: "absent", reason: "this run's receipt records no output fact" } : { state: "absent", reason: `run is ${status} and has not produced a terminal result` },
    pipeline: PIPELINE_STEPS.map(([id, label], index) => ({ id, label, state: PIPELINE[status][index] })),
    availableSections: status === "failed" ? ["logs", "receipt", "failure"] : ["logs", "receipt"],
    rowRevision: seed,
    actions: actionsFor(status, seed),
    ...overrides,
  });
}

const GROUP_SEED = 40;
const MEMBERS: readonly { seed: number; status: QueueStatus; title: string }[] = [
  { seed: 41, status: "done", title: "Alvarez, Maria" },
  { seed: 42, status: "running", title: "Okafor, Chinedu" },
  { seed: 43, status: "failed", title: "Tran, Bao" },
  { seed: 44, status: "queued", title: "Morrow, Bea" },
];

/** A group row that has fanned out to four people. */
export const QUEUE_STORY_GROUP: QueueSurfaceWire = queueStoryRow("running", GROUP_SEED, {
  surfaceKind: "operation",
  panelKind: "group",
  title: "New-hire lookups",
  subtitle: { state: "absent", reason: "a group has no second identifier" },
  liveMessage: { state: "present", value: "2 of 4 people remaining" },
  memberRunIds: MEMBERS.map(member => uuid(member.seed)),
  memberRollup: { total: MEMBERS.length, terminal: 2, failed: 1 },
  memberPreview: { state: "present", value: "Alvarez, Maria +3 more" },
  actions: [],
});

/** The group's own people, each a served row that names its parent. */
export const QUEUE_STORY_MEMBERS: readonly QueueSurfaceWire[] = MEMBERS.map(member => queueStoryRow(member.status, member.seed, {
  title: member.title,
  panelKind: "member",
  actions: [],
  parent: { runId: uuid(GROUP_SEED), visibility: "inline", partitionDay: QUEUE_STORY_DAY, workflowId: "person-lookup",
    label: QUEUE_STORY_WORKFLOW_LABEL, title: "New-hire lookups", panelKind: "group", status: "running" },
}));
