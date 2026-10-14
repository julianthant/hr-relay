import { useCallback,useEffect,useState } from "react";
import { z } from "zod";
import { WorkflowBootstrapPrimitiveSchema } from "../../../models/dashboard/bootstrap.js";
import type {
QueueSurfaceWireSchema,
StatusCountWireSchema,
WorkflowCountWireSchema
} from "../../../models/dashboard/projection.js";
import { dsFocus,dsMotion,dsRadius,dsText } from "../../ds/ui.js";
import { readEnumPreference,writePreference } from "../../lib/preference-storage.js";
import { cn } from "../../lib/utils.js";
import { type QueueStatus } from "../shared/status/status-model.js";
import {
groupWorkflowsByCategory,
type WorkflowCategoryGroup,
} from "../workflows/workflow-category.js";


export type WorkflowCountWire = z.infer<typeof WorkflowCountWireSchema>;


export type StatusCountWire = z.infer<typeof StatusCountWireSchema>;


export type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;


export type WorkflowBootstrapPrimitive = z.infer<typeof WorkflowBootstrapPrimitiveSchema>;


// Parse owner-provided projection arrays into this consumer’s closed shape.
export function parseWorkflows(workflows: readonly unknown[]): WorkflowBootstrapPrimitive[] {
  return z.array(WorkflowBootstrapPrimitiveSchema).parse(workflows);
}

const SELECTED_WORKFLOW_STORAGE_KEY = "hr-dashboard.selected-workflow";

export function useSelectedWorkflow(workflows: readonly { readonly id: string }[]): {
  selectedWorkflowId: string;
  setSelectedWorkflowId: (workflowId: string) => boolean;
  canSelectWorkflowId: (workflowId: string) => boolean;
} {
  const [selectedWorkflowId, setSelectedWorkflowIdState] = useState(() =>
    readEnumPreference(
      SELECTED_WORKFLOW_STORAGE_KEY,
      workflows.map((workflow) => String(workflow.id)),
      String(workflows[0]?.id ?? ""),
    ),
  );
  const valid = workflows.some(workflow => workflow.id === selectedWorkflowId);
  if (!valid && selectedWorkflowId !== "") setSelectedWorkflowIdState("");
  useEffect(() => {
    if (!valid) void writePreference(SELECTED_WORKFLOW_STORAGE_KEY, "");
  }, [valid]);
  const canSelectWorkflowId = useCallback((workflowId: string) => workflows.some(workflow => workflow.id === workflowId), [workflows]);
  const setSelectedWorkflowId = useCallback((workflowId: string) => {
    if (!canSelectWorkflowId(workflowId)) return false;
    setSelectedWorkflowIdState(workflowId);
    void writePreference(SELECTED_WORKFLOW_STORAGE_KEY, workflowId);
    return true;
  }, [canSelectWorkflowId]);
  return { selectedWorkflowId: valid ? selectedWorkflowId : "", setSelectedWorkflowId, canSelectWorkflowId };
}


// Empty projection buckets have no entry; absence means zero.
function servedCount<Entry>(entries: readonly Entry[], match: (entry: Entry) => boolean): number {
  const entry = entries.find(match);
  return entry === undefined ? 0 : (entry as { count: number }).count;
}


export function workflowCount(counts: readonly WorkflowCountWire[], workflowId: string): number {
  return servedCount(counts, (entry) => String(entry.workflowId) === workflowId);
}


export function statusCount(counts: readonly StatusCountWire[], status: QueueStatus): number {
  return servedCount(counts, (entry) => entry.status === status);
}


/** the served per-status dimension of ONE workflow's day, or nothing served yet */
export function workflowStatusCounts(
  counts: readonly WorkflowCountWire[],
  workflowId: string,
): readonly StatusCountWire[] {
  return counts.find((entry) => String(entry.workflowId) === workflowId)?.statusCounts ?? [];
}


/** ACTIVE — queued, running and cancelling, the union of "accepted, not finished". */
export function activeCount(counts: readonly StatusCountWire[]): number {
  return statusCount(counts, "queued") + statusCount(counts, "running") + statusCount(counts, "cancelling");
}


/** Name every active state contributing to the served count, preserving the established zero-state copy. */
export function activeStatusWords(counts: readonly StatusCountWire[]): string {
  return statusCount(counts, "cancelling") > 0 ? "queued, running or cancelling" : "queued or running";
}


/** ALL — every row a served per-status array accounts for. */
export function totalCount(counts: readonly StatusCountWire[]): number {
  return counts.reduce((total, entry) => total + entry.count, 0);
}


/** ── the toolbar control shape ───────────────────────────────────────────── */

export const toolbarControl = (): string =>
  cn(
    "inline-flex shrink-0 cursor-pointer items-center border",
    "h-[var(--ds-h-toolbar)] gap-[var(--ds-space-snug)] px-[var(--ds-space-base)]",
    dsRadius.md,
    dsText.meta,
    dsFocus,
    dsMotion.fast,
    "active:translate-y-px",
  );


/** ── Workflow Panel ──────────────────────────────────────────────────────── */

/** Where the Workflow Panel is, and how much of the window it costs.
 * `floating` — a window over the panels. */
export type WorkflowPanelMode = "floating" | "icon" | "sidebar";


const PANEL_MODE_CYCLE: WorkflowPanelMode[] = ["floating", "icon", "sidebar"];


export const WORKFLOW_PANEL_MODE_LABEL: Record<WorkflowPanelMode, string> = {
  floating: "floating window",
  icon: "icon",
  sidebar: "sidebar",
};


/** Rebuild-scoped so it can never collide with the stored demo mode. */
const PANEL_MODE_STORAGE_KEY = "hr-dashboard.workflow-panel";


/** The documented mode for an operator who has expressed no preference. */
const PANEL_MODE_DEFAULT: WorkflowPanelMode = "floating";


function readStoredPanelMode(): WorkflowPanelMode {
  // Nothing stored, storage refused, and a stored value outside the cycle are three
  // different things; `readEnumPreference` keeps them apart and lands on the named default.
  return readEnumPreference(PANEL_MODE_STORAGE_KEY, PANEL_MODE_CYCLE, PANEL_MODE_DEFAULT);
}


/** Owns the mode, its persistence, and one thing more: whether the OPERATOR has
 * moved it this session (`opened`). */
export function useWorkflowPanelMode(): {
  mode: WorkflowPanelMode;
  setMode: (mode: WorkflowPanelMode) => void;
  cycleMode: () => void;
  opened: boolean;
} {
  const [mode, setModeState] = useState<WorkflowPanelMode>(readStoredPanelMode);
  const [opened, setOpened] = useState(false);

  const setMode = useCallback((next: WorkflowPanelMode) => {
    setOpened(true);
    setModeState(next);
    // Same as the read: an unwritable store loses the preference for next time
// which is not a reason to refuse the operator this one — but the outcome
    void writePreference(PANEL_MODE_STORAGE_KEY, next);
  }, []);

  const cycleMode = useCallback(() => {
    setMode(PANEL_MODE_CYCLE[(PANEL_MODE_CYCLE.indexOf(mode) + 1) % PANEL_MODE_CYCLE.length]);
  }, [mode, setMode]);

  return { mode, setMode, cycleMode, opened };
}


export type WorkflowRailGroup = WorkflowCategoryGroup<WorkflowBootstrapPrimitive>;


/** The rail's groups, in the frontend's display order.
 * Membership is each workflow's OWN `categoryId` */
export function buildWorkflowRailGroups(
  workflows: readonly WorkflowBootstrapPrimitive[],
): WorkflowRailGroup[] {
  return groupWorkflowsByCategory(workflows)
    .map((group) => ({
      ...group,
      entries: group.entries.filter(
        (node) => node.entry.role.kind === "standalone" || node.entry.role.kind === "composition",
      ),
    }))
    .filter((group) => group.entries.length > 0);
}


/** ── Status Bar ──────────────────────────────────────────────────────────── */

/** `all`, the composite `needsYou`, and the served status buckets. Every status is reachable */
export type StatusBucket = "all" | "needsYou" | QueueStatus;


/** The status pills' visual order, in the wire's vocabulary
 * queued · running · cancelling · waiting · parked · verified Done · Done-with-warnings · */
const STATUS_PILL_ORDER: QueueStatus[] = [
  "queued",
  "running",
  "cancelling",
  "awaiting-approval",
  "blocked",
  "done",
  "partial",
  "failed",
  "cancelled",
];


/** Retain the established empty-state bar; expose Cancelling whenever served or selected. */
export function statusPillOrder(counts: readonly StatusCountWire[], active: StatusBucket): QueueStatus[] {
  return STATUS_PILL_ORDER.filter((status) =>
    status !== "cancelling" || active === status || statusCount(counts, status) > 0);
}


/** The two statuses that are stuck on a decision from the operator. */
const NEEDS_YOU_STATUSES: QueueStatus[] = ["awaiting-approval", "blocked"];


/** The `Needs you` composite, over the SERVED counts.
 * This adds two numbers the projection served; it does not count rows. The risk */
export function needsYouCount(counts: readonly StatusCountWire[]): number {
  return NEEDS_YOU_STATUSES.reduce((total, status) => total + statusCount(counts, status), 0);
}
export { ALWAYS_TALLIED,buildSessionPanelView,buildSessionPoolGroups,canStopWorker,capacityChip,connectionTone,planPoolIntent,poolFactsForWorkflow,poolIndexOfWorkerId,poolMemberWorkerId,poolSlotIsUnmet,sessionMembershipForWorker,sessionPoolGroupFor,WORKER_STATE_ORDER,WORKER_STOP_REASON_LABEL,WORKER_TONE,workerBrowserView,workerDirectiveNote,workerElapsedSeconds } from "../sessions/session-panel-model.js";
export type { PoolPlanIntent,SessionPoolGroup,SessionPoolMemberSlot,WorkerBrowserSlot,WorkerCardWire,WorkerPoolFacts,WorkerPoolWire,WorkerSessionMembership,WorkerState } from "../sessions/session-panel-model.js";
