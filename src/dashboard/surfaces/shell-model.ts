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
  StatusCountWireSchema,
  WorkerCardWireSchema,
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
