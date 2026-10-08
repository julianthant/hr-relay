import { useCallback,useState } from "react";
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


/**
 * The bootstrap wire types its projection arrays as `unknown[]` on purpose —
 * the schema is composed from owner-provided parts, so a consumer states which
 * closed shape it expects and PARSES. This is the same call the bootstrap
 * schema's own `superRefine` makes; it is schema-derived typing, never a
 * handwritten mirror.
 */
export function parseWorkflows(workflows: readonly unknown[]): WorkflowBootstrapPrimitive[] {
  return z.array(WorkflowBootstrapPrimitiveSchema).parse(workflows);
}

const SELECTED_WORKFLOW_STORAGE_KEY = "hr-dashboard.selected-workflow";

export function useSelectedWorkflow(workflows: readonly { readonly id: string }[]): {
  selectedWorkflowId: string;
  setSelectedWorkflowId: (workflowId: string) => void;
} {
  const [selectedWorkflowId, setSelectedWorkflowIdState] = useState(() =>
    readEnumPreference(
      SELECTED_WORKFLOW_STORAGE_KEY,
      workflows.map((workflow) => String(workflow.id)),
      String(workflows[0]?.id ?? ""),
    ),
  );
  const setSelectedWorkflowId = useCallback((workflowId: string) => {
    setSelectedWorkflowIdState(workflowId);
    void writePreference(SELECTED_WORKFLOW_STORAGE_KEY, workflowId);
  }, []);
  return { selectedWorkflowId, setSelectedWorkflowId };
}


/**
 * A count the projection did not serve is ZERO, not unknown.
 *
 * This is a documented, provably-correct default rather than a guess: the
 * projection builds each count array by folding the surfaces it is serving, so
 * a status or workflow with no row simply has no entry. Absence IS zero here,
 * and rendering it as zero is what keeps a slot from vanishing when a bucket
 * empties.
 */
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


/**
 * ACTIVE — queued, running and cancelling, the union of "accepted, not finished".
 *
 * Ported from the demo's `railEntryCounts` / `attentionAcrossWorkflows`
 * (hr-automation@1bffbd65, DemoShell.tsx:200-235) with the fold removed: the
 * demo derived this from a row array, this reads the served counts. `queued`
 * alone is not "what is happening in this panel" — the moment a run starts it
 * leaves `queued` and the column reads zero while the workflow is plainly
 * working. Attention is deliberately NOT folded in: that is a different
 * question with a different answer surface (the Status Bar's `Needs you`).
 */
export function activeCount(counts: readonly StatusCountWire[]): number {
  return statusCount(counts, "queued") + statusCount(counts, "running") + statusCount(counts, "cancelling");
}


/** Name every active state contributing to the served count, preserving the established zero-state copy. */
export function activeStatusWords(counts: readonly StatusCountWire[]): string {
  return statusCount(counts, "cancelling") > 0 ? "queued, running or cancelling" : "queued or running";
}


/**
 * ALL — every row a served per-status array accounts for.
 *
 * The demo's `All` segment reads `counts.all` off the SAME record its eight
 * pills read (`DemoShell.tsx:1348` over `countRows(scopedRows)`), so the
 * composite is closed under addition with the primitives beside it by
 * construction. This is the served-count equivalent: it folds the ONE array the
 * pills render rather than a second aggregation, which is what R4-2 found —
 * `All` used to come from `monthCounts` (a different scope with a different
 * member-exclusion predicate) and agreed with the pills only by coincidence.
 *
 * The projection already refines that a workflow entry's per-status counts sum
 * to its `count`, so this fold cannot disagree with the server's own total.
 */
export function totalCount(counts: readonly StatusCountWire[]): number {
  return counts.reduce((total, entry) => total + entry.count, 0);
}


/* ── the toolbar control shape ───────────────────────────────────────────── */

/**
 * Ported from DemoBulkBar's `toolbarControl`. It lives here because the
 * Workflow Panel toggle sits a hairline from the queue's own toolbar controls
 * and every control in a toolbar is `--ds-h-toolbar` tall (DESIGN.md) — a
 * repeated literal is exactly how one of thirteen came to be 30px in a row
 * of 24.
 */
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


/* ── Workflow Panel ──────────────────────────────────────────────────────── */

/**
 * Where the Workflow Panel is, and how much of the window it costs.
 *
 * `floating` — a window over the panels. It costs no column, so the queue and
 * the detail panel get the full width; it is dismissable, and dismissing it
 * lands on `icon`.
 * `icon` — nothing is drawn over the content at all. The toggle in the action
 * bar is the launcher, and it keeps carrying the day's count so a collapsed
 * panel can never hide one.
 * `sidebar` — docked, always visible. For the operator who wants it.
 */
export type WorkflowPanelMode = "floating" | "icon" | "sidebar";


const PANEL_MODE_CYCLE: WorkflowPanelMode[] = ["floating", "icon", "sidebar"];


export const WORKFLOW_PANEL_MODE_LABEL: Record<WorkflowPanelMode, string> = {
  floating: "floating window",
  icon: "icon",
  sidebar: "sidebar",
};


/** Rebuild-scoped so it can never collide with the legacy demo's stored mode. */
const PANEL_MODE_STORAGE_KEY = "hr-dashboard.workflow-panel";


/** The documented mode for an operator who has expressed no preference. */
const PANEL_MODE_DEFAULT: WorkflowPanelMode = "floating";


function readStoredPanelMode(): WorkflowPanelMode {
  // Nothing stored, storage refused, and a stored value outside the cycle are
  // three different things; `readEnumPreference` keeps them apart and lands
  // them all on the named default, rather than a catch block inventing one.
  return readEnumPreference(PANEL_MODE_STORAGE_KEY, PANEL_MODE_CYCLE, PANEL_MODE_DEFAULT);
}


/**
 * Owns the mode, its persistence, and one thing more: whether the OPERATOR has
 * moved it this session (`opened`).
 *
 * That flag is what keeps the window honest on first paint. A window that
 * animates in and grabs focus because it was the persisted default is animating
 * on page load and stealing the caret from the queue — both banned.
 */
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
    // Same as the read: an unwritable store loses the preference for next time,
    // which is not a reason to refuse the operator this one — but the outcome
    // is returned rather than swallowed.
    void writePreference(PANEL_MODE_STORAGE_KEY, next);
  }, []);

  const cycleMode = useCallback(() => {
    setMode(PANEL_MODE_CYCLE[(PANEL_MODE_CYCLE.indexOf(mode) + 1) % PANEL_MODE_CYCLE.length]);
  }, [mode, setMode]);

  return { mode, setMode, cycleMode, opened };
}


export type WorkflowRailGroup = WorkflowCategoryGroup<WorkflowBootstrapPrimitive>;


/**
 * The rail's groups, in the frontend's display order (R2 D17/D18).
 *
 * Membership is each workflow's OWN `categoryId`; the heading and the order are
 * `workflow-category.ts`'s, which the Run Modal's picker calls too — so a
 * workflow the backend serves can never be missing from the rail, can never sit
 * under a heading the product does not use, and the two surfaces cannot drift
 * into two orders. A category nothing is registered under is DROPPED rather
 * than rendered as an empty heading.
 *
 * The same function also decides MEMBERSHIP (D219): an entry whose served role
 * is `chunk-harness` comes back nested under its composition's entry rather
 * than beside it, which is why a group's entries are `WorkflowGroupEntry`
 * records and not bare primitives — the rail cannot flatten a step back into a
 * workflow without saying so.
 *
 * The panel lists MAIN workflows only — compositions and standalones — so a
 * chunk harness renders nowhere here, nested or top-level (the cross-category
 * `separations-kronos-timecard` included). Harnesses stay startable through the
 * Run Modal's nested picker and documented in the Explorer; their runs'
 * attention still reaches the operator through the Status Bar's global
 * `Needs you` and the notification inbox, neither of which is rail-scoped. A
 * category whose entries all dropped goes with them rather than rendering as
 * an empty heading.
 */
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


/* ── Status Bar ──────────────────────────────────────────────────────────── */

/**
 * `all`, the composite `needsYou`, and the served status buckets. Every
 * status is reachable; none is folded away, and none is counted twice — each
 * row lands in exactly one status bucket, and `needsYou` is the only deliberate
 * overlap (it is a composite of two of them, labelled as such).
 */
export type StatusBucket = "all" | "needsYou" | QueueStatus;


/**
 * The demo's visual order, in the wire's vocabulary:
 * queued · running · cancelling · waiting · parked · verified Done · Done-with-warnings ·
 * failed · cancelled.
 */
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


/**
 * The `Needs you` composite, over the SERVED counts.
 *
 * This adds two numbers the projection served; it does not count rows. That
 * distinction is the whole of D81 — the risk is a second CORPUS, and there is
 * none here: the sum is a pure function of the same `statusCounts` array the
 * two pills beside it render, so it cannot disagree with them.
 */
export function needsYouCount(counts: readonly StatusCountWire[]): number {
  return NEEDS_YOU_STATUSES.reduce((total, status) => total + statusCount(counts, status), 0);
}
export { ALWAYS_TALLIED,buildSessionPanelView,buildSessionPoolGroups,canStopWorker,capacityChip,connectionTone,planPoolIntent,poolFactsForWorkflow,poolIndexOfWorkerId,poolMemberWorkerId,poolSlotIsUnmet,SESSION_POOL_MAX_WORKERS,sessionMembershipForWorker,sessionPoolGroupFor,WORKER_STATE_ORDER,WORKER_STOP_REASON_LABEL,WORKER_TONE,workerBrowserView,workerDirectiveNote,workerElapsedSeconds } from "../sessions/session-panel-model.js";
export type { PoolPlanIntent,SessionPoolGroup,SessionPoolMemberSlot,WorkerBrowserSlot,WorkerCardWire,WorkerPoolFacts,WorkerPoolWire,WorkerSessionMembership,WorkerState } from "../sessions/session-panel-model.js";
