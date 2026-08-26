/**
 * The shell's served-count folds, the Workflow Panel mode and its persistence,
 * the status-bucket vocabulary and the worker/connection tones.
 *
 * It lives beside `shell.tsx` rather than inside it because a module that exports
 * a component may export nothing else if React Fast Refresh is to treat it as a
 * refresh boundary: one non-component export makes every edit to the shell
 * invalidate upward into `dashboard-app.tsx` and remount the app instead of
 * hot-swapping the component. Same values, same call sites, one import hop.
 */
import { useCallback, useState } from "react";


import { z } from "zod";
import { readEnumPreference, writePreference } from "../lib/preference-storage.js";
import { cn } from "../lib/utils.js";
import {
  dsClip,
  dsFocus,
  dsMotion,
  dsRadius,
  dsText,
} from "../ds/ui.js";
import { WorkflowBootstrapPrimitiveSchema } from "../../domain/dashboard/bootstrap.js";
import type {
  QueueSurfaceWireSchema,
  StatusCountWireSchema,
  WorkerCardWireSchema,
  WorkerPoolWireSchema,
  WorkflowCountWireSchema,
} from "../../domain/dashboard/projection.js";
import type { SubscriptionState } from "../client/index.js";
import { elapsedSecondsBetween } from "./format.js";
import { type QueueStatus } from "./status-model.js";
import {
  groupWorkflowsByCategory,
  type WorkflowCategoryGroup,
} from "./workflow-category.js";

export type WorkflowCountWire = z.infer<typeof WorkflowCountWireSchema>;

export type StatusCountWire = z.infer<typeof StatusCountWireSchema>;

export type WorkerCardWire = z.infer<typeof WorkerCardWireSchema>;

export type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;

export type WorkerPoolWire = z.infer<typeof WorkerPoolWireSchema>;

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
 * ACTIVE — queued PLUS running, the union of "accepted, not finished".
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
  return statusCount(counts, "queued") + statusCount(counts, "running");
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
 * `all`, the composite `needsYou`, and each of the eight served statuses. Every
 * status is reachable; none is folded away, and none is counted twice — each
 * row lands in exactly one status bucket, and `needsYou` is the only deliberate
 * overlap (it is a composite of two of them, labelled as such).
 */
export type StatusBucket = "all" | "needsYou" | QueueStatus;

/**
 * The demo's visual order, in the wire's vocabulary:
 * queued · running · waiting · parked · verified Done · Done-with-warnings ·
 * failed · cancelled.
 */
export const STATUS_PILL_ORDER: QueueStatus[] = [
  "queued",
  "running",
  "awaiting-approval",
  "blocked",
  "done",
  "partial",
  "failed",
  "cancelled",
];

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

/* ── Session Panel ───────────────────────────────────────────────────────── */

/** One membership row, with only authority worker cards that claim this exact run. */
export interface SessionMemberView {
  readonly row: QueueSurfaceWire;
  readonly workers: readonly WorkerCardWire[];
}

/** A session is the ordered set of queue rows that serve one exact session id. */
export interface SessionGroupView {
  readonly sessionId: Extract<QueueSurfaceWire["session"], { readonly state: "present" }>["sessionId"];
  readonly members: readonly SessionMemberView[];
  /** A session's rows may name one workflow; retain the keyed proof rather than assuming it in JSX. */
  readonly pools: readonly SessionPoolView[];
}

export interface SessionPoolView {
  readonly workflowId: string;
  readonly facts: WorkerPoolFacts;
}

/** A row whose authority record deliberately names no session. */
export interface AbsentSessionMemberView {
  readonly row: QueueSurfaceWire;
  readonly reason: string;
}

export interface SessionView {
  readonly sessions: readonly SessionGroupView[];
  readonly absentMembers: readonly AbsentSessionMemberView[];
}

/**
 * The membership panel has a one-second parent tick, while the performance
 * fixture has 1,240 rows. Fixed-height rows make the viewport math exact and
 * keep the DOM bounded without dropping an authority record. Long opaque
 * values remain available through each row's detail trigger in the renderer.
 */
export const SESSION_LIST_DEFAULT_VIEWPORT_HEIGHT = 512;
const SESSION_LIST_OVERSCAN_PX = 72;
const SESSION_LIST_HEADER_HEIGHT = 48;
const SESSION_LIST_MEMBER_HEIGHT = 72;

export type SessionListItem =
  | Readonly<{ kind: "session-header"; session: SessionGroupView }>
  | Readonly<{
    kind: "session-member";
    sessionId: SessionGroupView["sessionId"];
    member: SessionMemberView;
  }>
  | Readonly<{ kind: "absent-header" }>
  | Readonly<{ kind: "absent-member"; member: AbsentSessionMemberView }>;

export interface SessionListLayoutRow {
  readonly index: number;
  readonly key: string;
  readonly top: number;
  readonly height: number;
  readonly item: SessionListItem;
}

export interface SessionListLayout {
  readonly rows: readonly SessionListLayoutRow[];
  readonly totalHeight: number;
}

export interface SessionListWindow {
  readonly rows: readonly SessionListLayoutRow[];
  readonly totalHeight: number;
}

export interface SessionPoolDisplay {
  readonly summary?: string;
  readonly facts: readonly Readonly<{ label: string; value: string }>[];
}

/** Dense resting copy plus the complete authority values opened from it. */
export function sessionPoolDisplay(session: SessionGroupView): SessionPoolDisplay {
  const summaries = session.pools.map(({ facts }) => facts.state === "declared"
    ? `${String(facts.desiredWorkers)} declared · ${String(facts.activeWorkers)} active`
    : `No pool declaration · ${String(facts.activeWorkers)} active`);
  const first = summaries[0];
  return {
    summary: first === undefined
      ? undefined
      : summaries.length === 1
        ? first
        : `${first} · +${String(summaries.length - 1)} workflows`,
    facts: session.pools.map(({ workflowId, facts }) => ({
      label: `Workflow ${workflowId}`,
      value: facts.state === "declared"
        ? `${String(facts.desiredWorkers)} declared at pool version ${String(facts.version)} · ${String(facts.activeWorkers)} active authority worker cards`
        : `No worker-pool declaration · ${String(facts.activeWorkers)} active authority worker cards`,
    })),
  };
}

/** Flatten grouped authority data into one addressable layout, without filtering. */
export function buildSessionListLayout(sessionView: SessionView): SessionListLayout {
  const rows: SessionListLayoutRow[] = [];
  let top = 0;
  const push = (key: string, height: number, item: SessionListItem): void => {
    rows.push({ index: rows.length, key, top, height, item });
    top += height;
  };

  for (const session of sessionView.sessions) {
    const sessionId = String(session.sessionId);
    push(`session:${sessionId}`, SESSION_LIST_HEADER_HEIGHT, { kind: "session-header", session });
    for (const member of session.members) {
      push(`session:${sessionId}:run:${String(member.row.runId)}`, SESSION_LIST_MEMBER_HEIGHT, {
        kind: "session-member",
        sessionId: session.sessionId,
        member,
      });
    }
  }
  if (sessionView.absentMembers.length > 0) {
    push("absent:header", SESSION_LIST_HEADER_HEIGHT, { kind: "absent-header" });
    for (const member of sessionView.absentMembers) {
      push(`absent:run:${String(member.row.runId)}`, SESSION_LIST_MEMBER_HEIGHT, {
        kind: "absent-member",
        member,
      });
    }
  }

  return { rows, totalHeight: top };
}

/** Binary-search the first layout row whose bottom crosses the requested top. */
function firstSessionListRowAfter(layout: SessionListLayout, top: number): number {
  let low = 0;
  let high = layout.rows.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const row = layout.rows[middle];
    if (row === undefined || row.top + row.height > top) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** The retained row intersecting the viewport's leading edge. */
export function sessionListVisibleIndex(layout: SessionListLayout, scrollTop: number): number {
  if (layout.rows.length === 0) return 0;
  return Math.min(firstSessionListRowAfter(layout, Math.max(0, scrollTop)), layout.rows.length - 1);
}

/** The only rows the renderer mounts for one scroll position. */
export function sessionListWindow(
  layout: SessionListLayout,
  scrollTop: number,
  viewportHeight: number,
): SessionListWindow {
  const safeViewportHeight = Math.max(1, viewportHeight);
  const overscanTop = Math.max(0, scrollTop - SESSION_LIST_OVERSCAN_PX);
  const overscanBottom = Math.min(
    layout.totalHeight,
    Math.max(0, scrollTop) + safeViewportHeight + SESSION_LIST_OVERSCAN_PX,
  );
  const first = firstSessionListRowAfter(layout, overscanTop);
  let last = first;
  while (last < layout.rows.length && (layout.rows[last]?.top ?? layout.totalHeight) < overscanBottom) last += 1;
  return { rows: layout.rows.slice(first, last), totalHeight: layout.totalHeight };
}

/** A keyboard/scroll target that makes any retained row visible. */
export function sessionListScrollTopForIndex(
  layout: SessionListLayout,
  index: number,
  viewportHeight: number,
): number {
  const row = layout.rows[index];
  if (row === undefined) throw new Error(`Session membership row ${String(index)} is outside the served layout`);
  return Math.max(0, Math.min(row.top, layout.totalHeight - Math.max(1, viewportHeight)));
}

/** Resolve one list-row keyboard move without changing the retained authority layout. */
export function sessionListNavigationTarget(
  activeIndex: number,
  key: string,
  totalRows: number,
  viewportHeight: number,
): number | undefined {
  if (totalRows === 0) return undefined;
  const pageRows = Math.max(1, Math.floor(Math.max(1, viewportHeight) / SESSION_LIST_MEMBER_HEIGHT));
  const target = key === "ArrowDown" ? activeIndex + 1
    : key === "ArrowUp" ? activeIndex - 1
      : key === "PageDown" ? activeIndex + pageRows
        : key === "PageUp" ? activeIndex - pageRows
          : key === "Home" ? 0
            : key === "End" ? totalRows - 1
              : undefined;
  return target === undefined ? undefined : Math.max(0, Math.min(target, totalRows - 1));
}

/**
 * How a particular worker relates to the selected day's session rows.
 *
 * This is deliberately not a worker state: an idle worker has no claimed run,
 * and a run outside this day's projection has no session row for this view to
 * describe. Neither absence is permission to call it an absent session.
 */
export type WorkerSessionMembership =
  | Readonly<{ state: "unassigned"; reason: string }>
  | Readonly<{
    state: "present";
    sessionId: Extract<QueueSurfaceWire["session"], { readonly state: "present" }>["sessionId"];
    row: QueueSurfaceWire;
  }>
  | Readonly<{ state: "absent"; reason: string }>
  | Readonly<{ state: "not-served"; runId: Extract<WorkerCardWire["currentRun"], { readonly state: "present" }>["runId"] }>;

/**
 * A pool's desired count is an operator declaration; worker cards are the
 * authority facts about workers this snapshot actually serves. `activeWorkers`
 * is deliberately non-terminal: a stopped/failed card remains on the panel as
 * a retained record, but is not a live worker and must not inflate a declared
 * pool-size comparison. Keeping the two union arms distinct makes a missing
 * pool row visibly different from a fictional declaration of one worker at
 * version zero.
 */
export type WorkerPoolFacts =
  | Readonly<{ state: "declared"; desiredWorkers: number; version: number; activeWorkers: number }>
  | Readonly<{ state: "absent"; activeWorkers: number }>;

/** The exact current-run-to-queue-row join the worker card may render. */
export function sessionMembershipForWorker(
  worker: WorkerCardWire,
  queueSurfaces: readonly QueueSurfaceWire[],
): WorkerSessionMembership {
  const currentRun = worker.currentRun;
  if (currentRun.state === "absent") {
    return { state: "unassigned", reason: currentRun.reason };
  }
  const row = queueSurfaces.find((surface) => String(surface.runId) === String(currentRun.runId));
  if (row === undefined) return { state: "not-served", runId: currentRun.runId };
  return row.session.state === "present"
    ? { state: "present", sessionId: row.session.sessionId, row }
    : { state: "absent", reason: row.session.reason };
}

/** Session membership is every queue row that names the same authority session id. */
export function buildSessionView(
  queueSurfaces: readonly QueueSurfaceWire[],
  workerCards: readonly WorkerCardWire[],
  workerPools: readonly WorkerPoolWire[],
): SessionView {
  const workersByRunId = new Map<string, WorkerCardWire[]>();
  for (const worker of workerCards) {
    if (worker.currentRun.state !== "present") continue;
    const runId = String(worker.currentRun.runId);
    const workers = workersByRunId.get(runId);
    if (workers === undefined) workersByRunId.set(runId, [worker]);
    else workers.push(worker);
  }

  const sessionsById = new Map<string, SessionMemberView[]>();
  const sessionIds: SessionGroupView["sessionId"][] = [];
  const absentMembers: AbsentSessionMemberView[] = [];
  for (const row of queueSurfaces) {
    if (row.session.state === "absent") {
      absentMembers.push({ row, reason: row.session.reason });
      continue;
    }
    const sessionId = String(row.session.sessionId);
    const members = sessionsById.get(sessionId);
    const member = { row, workers: workersByRunId.get(String(row.runId)) ?? [] };
    if (members === undefined) {
      sessionsById.set(sessionId, [member]);
      sessionIds.push(row.session.sessionId);
    } else {
      members.push(member);
    }
  }

  return {
    sessions: sessionIds.map((sessionId) => ({
      sessionId,
      members: sessionsById.get(String(sessionId)) ?? [],
      pools: [...new Set((sessionsById.get(String(sessionId)) ?? []).map((member) => String(member.row.workflowId)))].map(
        (workflowId) => ({ workflowId, facts: poolFactsForWorkflow(workflowId, workerCards, workerPools) }),
      ),
    })),
    absentMembers,
  };
}

/** The complete presentation fold for the Session Panel, all from the day wire. */
export function buildSessionPanelView(
  queueSurfaces: readonly QueueSurfaceWire[],
  workerCards: readonly WorkerCardWire[],
  workerPools: readonly WorkerPoolWire[],
): Readonly<{
  sessionView: SessionView;
  workers: readonly Readonly<{ card: WorkerCardWire; membership: WorkerSessionMembership }>[];
  poolGroups: readonly SessionPoolGroup[];
}> {
  return {
    sessionView: buildSessionView(queueSurfaces, workerCards, workerPools),
    workers: workerCards.map((card) => ({ card, membership: sessionMembershipForWorker(card, queueSurfaces) })),
    poolGroups: buildSessionPoolGroups(workerCards, workerPools),
  };
}

/** Read a pool row whole; its omission is no declaration, never an implicit one. */
export function poolFactsForWorkflow(
  workflowId: string,
  workerCards: readonly WorkerCardWire[],
  workerPools: readonly WorkerPoolWire[],
): WorkerPoolFacts {
  const activeWorkers = workerCards.filter(
    (card) => String(card.workflowId) === workflowId && card.state !== "stopped" && card.state !== "failed",
  ).length;
  const pool = workerPools.find((entry) => String(entry.workflowId) === workflowId);
  return pool === undefined
    ? { state: "absent", activeWorkers }
    : {
      state: "declared",
      desiredWorkers: pool.desiredWorkers,
      version: pool.version,
      activeWorkers,
    };
}

/**
 * D271's ratified cap on an initial workflow pool. The browser bundle may not
 * import `src/core` (`dashboard-wire-boundary`), so the number is restated here
 * and PINNED to the kernel's `MAX_WORKERS_PER_POOL` by
 * `tests/unit/dashboard/worker-pool-controls.test.ts` — a cap raised on one side
 * alone fails that test rather than letting this panel offer a size the
 * supervisor refuses. Raising it requires a named concurrency proof at the
 * proposed size (D271), which is a decision, not a constant edit.
 */
export const SESSION_POOL_MAX_WORKERS = 3;

/**
 * THE 44px TOUCH FLOOR for D271's pool controls, the same coarse-gated pattern
 * `surfaces/queue-model.ts` established for the member line (`MEMBER_NAME_TOUCH_TARGET`).
 *
 * `Button size="sm"` paints `--ds-h-sm`, 24px — the WCAG 2.2 AA minimum (2.5.8)
 * and the right density for a mouse on an operator band, and well under the
 * 44px a finger needs. Every one of these controls POSTS a pool command
 * (`plan-worker-count`, `spawn-worker`, `stop-worker`), so a near-miss on a
 * coarse pointer is a worker process started or stopped by accident.
 *
 * `min-h`, not `h`, and no `::after` overlay: unlike the member line's toggle,
 * none of these controls sits at a fixed pitch beside a neighbour it could
 * reach into. They sit in flex rows with their own gaps, so the ROW grows with
 * them and containment is free — there is no clip to lift and no neighbour to
 * overlap. `min-height` also survives the `h-[var(--ds-h-sm)]` the button
 * variant already carries, whichever order `tailwind-merge` leaves them in.
 *
 * Gated on `pointer: coarse` for the reason the queue's targets are: on a fine
 * pointer the density IS the design, and the parity corpus renders at
 * `pointer: fine`, so no reference moves.
 */
export const POOL_CONTROL_TOUCH_TARGET = "pointer-coarse:min-h-11";

/**
 * The same floor in BOTH axes, for the count buttons — `1` / `2` / `3` are one
 * glyph inside `--ds-space-snug` of padding, so height alone still leaves a
 * ~24px-wide target. Three of them sit in a row `--ds-space-tight` apart, and
 * the act a mis-tap performs is planning the WRONG worker count.
 */
export const POOL_COUNT_TOUCH_TARGET = "pointer-coarse:min-h-11 pointer-coarse:min-w-11";

/**
 * The canonical pool identity, `poolWorkerId` restated for the bundle and
 * pinned to the kernel's derivation by the same test. It is a DERIVATION, not a
 * guess: `spawn-worker` names a worker id and the supervisor refuses any id
 * that is not the canonical identity of the index it claims, so composing one
 * here from a served workflow id and an index in range is the same string the
 * kernel would build — and anything out of range throws instead of minting an
 * identity the pool contract has no member for.
 */
export function poolMemberWorkerId(workflowId: string, poolIndex: number): string {
  if (!Number.isInteger(poolIndex) || poolIndex < 1 || poolIndex > SESSION_POOL_MAX_WORKERS) {
    throw new Error(
      `pool index ${String(poolIndex)} for ${workflowId} is outside 1..${String(SESSION_POOL_MAX_WORKERS)}`,
    );
  }
  return `${workflowId}-worker-${String(poolIndex)}`;
}

/** The canonical index a served worker id carries, or `undefined` when it carries none. */
export function poolIndexOfWorkerId(workflowId: string, workerId: string): number | undefined {
  const prefix = `${workflowId}-worker-`;
  if (!workerId.startsWith(prefix)) return undefined;
  const suffix = workerId.slice(prefix.length);
  // The kernel's own identity shape: a POSITIVE index with no padding, so
  // `-worker-01` and `-worker-0` are not this workflow's canonical member 1.
  if (!/^[1-9][0-9]*$/u.test(suffix)) return undefined;
  const index = Number(suffix);
  return index > SESSION_POOL_MAX_WORKERS ? undefined : index;
}

/**
 * One canonical pool index, and what the day wire serves about it.
 *
 * `not-served` is the honest arm and it is deliberately not called "crashed" or
 * "never started": this wire carries worker LEASES, and the absence of a lease
 * for an index says only that authority has no card for it. A retained terminal
 * card DOES name why it ended (`stopReason`), and that is the only crash reason
 * this panel may show.
 */
export type SessionPoolMemberSlot = Readonly<{
  poolIndex: number;
  workerId: string;
  /** Inside the pool row's `desiredWorkers` — an index the operator declared. */
  declared: boolean;
  membership:
    | Readonly<{ state: "live"; card: WorkerCardWire }>
    | Readonly<{ state: "retained"; card: WorkerCardWire }>
    | Readonly<{ state: "not-served" }>;
}>;

/**
 * A declared index with no LIVE worker is D271's visibly unmet declaration: the
 * card (if one is retained) keeps its stop reason on screen, the declaration is
 * not silently erased, and only an explicit `spawn-worker` replaces the member.
 */
export function poolSlotIsUnmet(slot: SessionPoolMemberSlot): boolean {
  return slot.declared && slot.membership.state !== "live";
}

/** Every worker card and pool row of ONE workflow, folded into the panel's roster. */
export type SessionPoolGroup = Readonly<{
  workflowId: string;
  facts: WorkerPoolFacts;
  /** The served pool row itself, so the panel can show WHO planned it and when. */
  declaration: WorkerPoolWire | undefined;
  /**
   * The CAS basis for `plan-worker-count` / `spawn-worker`, read from the SAME
   * snapshot that produced this view: the pool row's version, or 0 for a
   * workflow nobody has planned (D269 — 0 is the honest first basis, never a
   * guess, and the kernel answers a stale one with a `conflict`).
   */
  expectedVersion: number;
  /** Canonical indices, ascending: every declared index plus every index a card is served for. */
  slots: readonly SessionPoolMemberSlot[];
  /**
   * Served cards of this workflow whose id is NOT a canonical pool identity —
   * a pre-pool lease, or an index above the cap. They are shown, because they
   * are real workers; they take no pool control, because the pool contract has
   * no member for them.
   */
  unindexedCards: readonly WorkerCardWire[];
}>;

/** The roster the Session Panel draws its pool controls from — one group per workflow, wire order. */
export function buildSessionPoolGroups(
  workerCards: readonly WorkerCardWire[],
  workerPools: readonly WorkerPoolWire[],
): readonly SessionPoolGroup[] {
  const workflowIds: string[] = [];
  for (const card of workerCards) {
    const workflowId = String(card.workflowId);
    if (!workflowIds.includes(workflowId)) workflowIds.push(workflowId);
  }
  for (const pool of workerPools) {
    const workflowId = String(pool.workflowId);
    if (!workflowIds.includes(workflowId)) workflowIds.push(workflowId);
  }

  return workflowIds.map((workflowId) => {
    const facts = poolFactsForWorkflow(workflowId, workerCards, workerPools);
    const cards = workerCards.filter((card) => String(card.workflowId) === workflowId);
    const cardsByIndex = new Map<number, WorkerCardWire>();
    const unindexedCards: WorkerCardWire[] = [];
    for (const card of cards) {
      const index = poolIndexOfWorkerId(workflowId, String(card.workerId));
      // A duplicate canonical id cannot reach here — the day wire refuses a
      // repeated `workerId` — so the first writer wins is not a policy, it is
      // an impossibility. An id the pool contract cannot address stays visible
      // as itself rather than being folded onto an index it does not name.
      if (index === undefined) unindexedCards.push(card);
      else cardsByIndex.set(index, card);
    }

    const declaredCount = facts.state === "declared" ? facts.desiredWorkers : 0;
    const indices: number[] = [];
    for (let index = 1; index <= SESSION_POOL_MAX_WORKERS; index += 1) {
      if (index <= declaredCount || cardsByIndex.has(index)) indices.push(index);
    }

    return {
      workflowId,
      facts,
      declaration: workerPools.find((entry) => String(entry.workflowId) === workflowId),
      expectedVersion: facts.state === "declared" ? facts.version : 0,
      slots: indices.map((poolIndex) => {
        const card = cardsByIndex.get(poolIndex);
        return {
          poolIndex,
          workerId: poolMemberWorkerId(workflowId, poolIndex),
          declared: poolIndex <= declaredCount,
          membership: card === undefined
            ? { state: "not-served" as const }
            : card.state === "stopped" || card.state === "failed"
              ? { state: "retained" as const, card }
              : { state: "live" as const, card },
        };
      }),
      unindexedCards,
    };
  });
}

/**
 * What planning N workers for this pool WILL do, derived before anything is
 * posted.
 *
 * The excess set is not this surface's invention and not a choice it makes:
 * `plan-worker-count` reconciles the canonical indices `N+1..MAX` (the kernel's
 * `excessMembers`), and the acknowledgement must cover each RUNNING one with a
 * bounded graceful stop. So the panel names exactly those members, says which
 * of them are running, and makes the operator confirm THAT list — D271's
 * explicit-index scale-down, expressed against the arm the wire actually
 * carries. Nothing here selects members by idleness or by any other client-side
 * judgement.
 */
export type PoolPlanIntent =
  | Readonly<{ kind: "refused"; reason: string }>
  | Readonly<{
    kind: "ready";
    workflowId: string;
    desiredWorkers: number;
    expectedVersion: number;
    /**
     * The indices this plan covers above `desiredWorkers`, each carrying
     * whether a RUNNING lease is served for it. The surface derives everything
     * it says from this one list — how many members are stopped, and whether
     * anything is stopped at all — rather than from a second summary flag that
     * could disagree with the list under it.
     */
    excess: readonly Readonly<{ poolIndex: number; workerId: string; running: boolean }>[];
  }>;

export function planPoolIntent(group: SessionPoolGroup, desiredWorkers: number): PoolPlanIntent {
  if (!Number.isInteger(desiredWorkers) || desiredWorkers < 1 || desiredWorkers > SESSION_POOL_MAX_WORKERS) {
    return {
      kind: "refused",
      reason: `a worker pool is planned at 1 to ${String(SESSION_POOL_MAX_WORKERS)} workers (D271); `
        + `${String(desiredWorkers)} is outside that range`,
    };
  }
  if (group.facts.state === "declared" && group.facts.desiredWorkers === desiredWorkers) {
    return {
      kind: "refused",
      reason: `${group.workflowId} already declares ${String(desiredWorkers)} workers at pool version `
        + `${String(group.facts.version)}; there is nothing to plan`,
    };
  }

  const excess: { poolIndex: number; workerId: string; running: boolean }[] = [];
  for (let poolIndex = desiredWorkers + 1; poolIndex <= SESSION_POOL_MAX_WORKERS; poolIndex += 1) {
    const slot = group.slots.find((entry) => entry.poolIndex === poolIndex);
    excess.push({
      poolIndex,
      workerId: poolMemberWorkerId(group.workflowId, poolIndex),
      running: slot !== undefined && slot.membership.state === "live",
    });
  }

  return {
    kind: "ready",
    workflowId: group.workflowId,
    desiredWorkers,
    expectedVersion: group.expectedVersion,
    excess,
  };
}

export type WorkerState = WorkerCardWire["state"];

/**
 * A worker's state, on the same hue ramp as everything else, so "this daemon is
 * alive" and "this row is running" are not two unrelated blues.
 *
 * EVERY ARM HAS A PRODUCER since D248, and that is what changed: the projector
 * used to derive the state from two observations (`endedAt` ⇒ stopped, a
 * claimed row ⇒ working, otherwise idle), so `waiting`, `paused` and `failed`
 * could never arrive and the bar's attention chip could never fire. The card is
 * now the authority worker lease, so `starting` is a daemon that has taken its
 * lease and not yet reported a phase — the demo's own point that calling such a
 * worker `idle` misreads capacity — and the terminal lifecycle splits by its
 * recorded reason: asked to stop is `Stopped`, died is `Failed`.
 *
 * Two arms LEFT this table rather than staying unreachable. `waiting` was the
 * demo's "blocked on a lease another worker holds", and this platform gives
 * every worker its own browser session per system (ref execution-and-sessions §1), so there is no
 * cross-worker lease to wait on and nothing that could record a holder.
 * `paused` left because a pause is a DIRECTIVE, not a phase — see
 * `workerDirectiveNote` below, and the durable record's own header for why the
 * two must not be folded into one word.
 */
export const WORKER_TONE: Record<WorkerState, { dot: string; label: string; text: string }> = {
  // `Running`, not `Working` — the demo's word and the ratified status
  // vocabulary (R7-9). A worker that is on a run and a row that is running are
  // the same event seen from two places; two words for it made them read as
  // two facts.
  working: { dot: "bg-[var(--ds-success-fg)]", label: "Running", text: "text-[color:var(--ds-success-fg)]" },
  starting: {
    dot: "bg-[var(--ds-status-waiting-fg)] animate-pulse motion-reduce:animate-none",
    label: "Starting",
    text: "text-[color:var(--ds-status-waiting-fg)]",
  },
  idle: { dot: "bg-[var(--ds-fg-faint)]", label: "Idle", text: "text-[color:var(--ds-fg-muted)]" },
  stopped: { dot: "bg-[var(--ds-fg-faint)] opacity-60", label: "Stopped", text: "text-[color:var(--ds-fg-muted)]" },
  failed: { dot: "bg-[var(--ds-danger)]", label: "Failed", text: "text-[color:var(--ds-danger)]" },
};

export const WORKER_STATE_ORDER: WorkerState[] = ["working", "starting", "idle", "failed", "stopped"];

/** How a settled lease ended, in the operator's words rather than the enum's. */
export const WORKER_STOP_REASON_LABEL: Record<NonNullable<WorkerCardWire["stopReason"]>, string> = {
  operator: "stopped by you",
  shutdown: "shut down",
  crashed: "crashed",
  "lease-expired": "lease expired — its process stopped reporting",
};

/**
 * The operator's standing directive, when it is not `run`.
 *
 * It renders BESIDE the state word and never as it. `src/domain/run/worker.ts`
 * is explicit about why: a command writes what was asked and the worker writes
 * what is true, so a card that read `Paused` while its worker was mid-write on
 * a real HR system would be reporting an intent as a fact. A worker asked to
 * pause finishes its item first — that is the whole meaning of the pair.
 */
export function workerDirectiveNote(card: WorkerCardWire): string | undefined {
  if (card.state === "stopped" || card.state === "failed") return undefined;
  if (card.directive === "pause") return "Pausing after this item";
  if (card.directive === "stop") return "Stopping after this item";
  return undefined;
}

/**
 * Whether a `stop-worker` command has anything to act on.
 *
 * A settled lease takes no directives (the kernel refuses it by name — a
 * stopped worker starts a new lease generation instead), and a worker already
 * asked to stop is not asked twice. The button is DISABLED rather than hidden,
 * because a control that vanishes reads as a control that was never there.
 */
export function canStopWorker(card: WorkerCardWire): boolean {
  return card.state !== "stopped" && card.state !== "failed" && card.directive !== "stop";
}

/**
 * How long this worker has been up — live against the served instant, and
 * `endedAt − startedAt` once it has settled (D124's rule, one surface over).
 * Never `now − startedAt` for a dead worker: that number grows forever and
 * answers a question nobody asks of a process that is gone.
 */
export function workerElapsedSeconds(card: WorkerCardWire, nowIso: string): number {
  return elapsedSecondsBetween(card.startedAt, card.endedAt ?? nowIso);
}

/**
 * Ported verbatim from legacy
 * hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * `src/dashboard/components/dev/rebuild-demo/DemoShell.tsx:1531-1541`.
 *
 * ONE compact chip shape for every summary chip on the collapsed Session bar.
 * The demo's own comment is the reason it lives at module scope: the identical
 * nine lines had been declared a second time ~230 lines below the first,
 * differing only in the name of their boolean, and two declarations of one
 * shape is how the two drift. At module scope the second copy could not have
 * been written without noticing the first — which is exactly what happened
 * here, where the shape had been inlined into its one call site and the demo's
 * anti-drift argument was lost with it (R7-10).
 *
 * `full` is the loud arm (something needs attention); the quiet arm is the
 * recessed capacity summary. Both ship even though only the loud one has a
 * caller today: an arm deleted for lack of a caller is the drift the helper
 * exists to prevent, and the quiet arm's caller is the browser-health summary
 * riding the `WorkerCardWireSchema` batch (R7-3).
 */
export const capacityChip = (full: boolean): string =>
  cn(
    "inline-flex shrink-0 items-center border text-ellipsis",
    dsClip.token,
    "h-[var(--ds-h-xs)] gap-[var(--ds-space-tight)] px-[var(--ds-space-snug)]",
    dsRadius.sm,
    dsText.micro,
    full
      ? "border-[color:var(--ds-status-waiting-border)] bg-[var(--ds-status-waiting-bg)] text-[color:var(--ds-status-waiting-fg)]"
      : "border-[color:var(--ds-recess-border)] bg-[var(--ds-recess-bg)] text-[color:var(--ds-recess-fg-quiet)]",
  );

/**
 * The tallies the collapsed bar always shows, even at zero.
 *
 * `starting` joins them for the demo's own stated reason (`DemoShell.tsx:1860`):
 * *a daemon that is alive but has not reported a phase is still starting, never
 * idle — calling it idle misreads capacity.* A three-way split at zero is also
 * what stops the bar's width jumping the moment a worker boots.
 */
export const ALWAYS_TALLIED: WorkerState[] = ["working", "starting", "idle"];

/**
 * The connection, as the operator sees it — the whole point of the bar's right
 * edge. `live` is the only quiet state; everything else says what is wrong,
 * because a dashboard that has stopped receiving patches while still painting
 * the last snapshot is the exact failure ref frontend-backend-integration §3.5 forbids.
 */
export function connectionTone(state: SubscriptionState): {
  label: string;
  text: string;
  dot: string;
  detail?: string;
} {
  if (state.state === "live") {
    return {
      label: "Live",
      text: "text-[color:var(--ds-success-fg)]",
      dot: "bg-[var(--ds-success-fg)] animate-pulse motion-reduce:animate-none",
    };
  }
  if (state.state === "connecting" || state.state === "reconnecting") {
    return {
      label: state.state === "connecting" ? "Connecting" : "Reconnecting",
      text: "text-[color:var(--ds-status-waiting-fg)]",
      dot: "bg-[var(--ds-status-waiting-fg)] animate-pulse motion-reduce:animate-none",
    };
  }
  if (state.state === "degraded") {
    return {
      label: "Degraded",
      text: "text-[color:var(--ds-status-waiting-fg)]",
      dot: "bg-[var(--ds-status-waiting-fg)]",
    };
  }
  return {
    label: "Stopped",
    text: "text-[color:var(--ds-danger)]",
    dot: "bg-[var(--ds-danger)]",
    ...(state.error === undefined ? {} : { detail: state.error.message }),
  };
}
