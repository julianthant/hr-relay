import { createErrorCatalogFailure, formatErrorCatalogFailure } from "../../../models/failures/error-catalog.js";
import { z } from "zod";
import type {
WorkerCardWireSchema,
WorkerPoolWireSchema
} from "../../../models/dashboard/projection.js";
import { type SubscriptionState } from "../../client/subscriptions/subscription.js";
import { dsClip,dsRadius,dsText } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { elapsedSecondsBetween } from "../shared/status/format.js";
import type { QueueSurfaceWire } from "../shell/shell-model.js";


export type WorkerCardWire = z.infer<typeof WorkerCardWireSchema>;


export type WorkerPoolWire = z.infer<typeof WorkerPoolWireSchema>;


/** ── Session Panel ───────────────────────────────────────────────────────── */

/** How a particular worker relates to the selected day's session rows.
 * This is deliberately not a worker state: an idle worker has no claimed run */
export type WorkerSessionMembership =
  | Readonly<{ state: "unassigned"; reason: string }>
  | Readonly<{
    state: "present";
    sessionId: Extract<QueueSurfaceWire["session"], { readonly state: "present" }>["sessionId"];
    row: QueueSurfaceWire;
  }>
  | Readonly<{ state: "absent"; reason: string }>
  | Readonly<{ state: "not-served"; runId: Extract<WorkerCardWire["currentRun"], { readonly state: "present" }>["runId"] }>;


export type WorkerBrowserSlot =
  | Readonly<{ state: "open"; browser: WorkerCardWire["browsers"][number] }>
  | Readonly<{ state: "required"; system: WorkerCardWire["browsers"][number]["system"] }>;


/** Stable browser slots for one live worker. Descriptor requirements establish
 * the order before acquisition; observed sessions replace their matching slot */
export function workerBrowserView(card: WorkerCardWire): Readonly<{
  slots: readonly WorkerBrowserSlot[];
  unavailableReason?: string;
}> {
  if (card.state === "failed") return { slots: [] };
  const open = [...card.browsers];
  const requirements = card.browserRequirements;
  if (requirements === undefined) {
    return {
      slots: open.map((browser) => ({ state: "open" as const, browser })),
      unavailableReason: "Browser requirements were not served by this dashboard snapshot",
    };
  }
  if (requirements.state === "unavailable") {
    return {
      slots: open.map((browser) => ({ state: "open" as const, browser })),
      unavailableReason: requirements.reason,
    };
  }

  const consumed = new Set<number>();
  const slots: WorkerBrowserSlot[] = requirements.systems.map((system) => {
    const index = open.findIndex((browser, candidate) => !consumed.has(candidate) && browser.system === system);
    if (index === -1) return { state: "required", system };
    consumed.add(index);
    const browser = open[index];
    if (browser === undefined) throw new Error(`browser requirement ${system} resolved to a missing observed session`);
    return { state: "open", browser };
  });
  open.forEach((browser, index) => {
    if (!consumed.has(index)) slots.push({ state: "open", browser });
  });
  return { slots };
}


/** The claimed run's already-served queue pipeline is the worker's step authority. */
export function workerTimelineView(
  card: WorkerCardWire,
  queueSurfaces: readonly QueueSurfaceWire[],
): Readonly<{ state: "present"; steps: QueueSurfaceWire["pipeline"] }>
  | Readonly<{ state: "absent"; reason: string }> {
  const currentRun = card.currentRun;
  if (currentRun.state === "absent") return { state: "absent", reason: currentRun.reason };
  const row = queueSurfaces.find((surface) => String(surface.runId) === String(currentRun.runId));
  if (row === undefined) return { state: "absent", reason: "Run timeline is not served on this day" };
  if (row.pipeline.length === 0) return { state: "absent", reason: "No steps are served for this run" };
  return { state: "present", steps: row.pipeline };
}

export const WORKER_TIMELINE_TONE: Record<QueueSurfaceWire["pipeline"][number]["state"], string> = {
  done: "border-[color:var(--ds-success-mark)] bg-[var(--ds-success-mark)]",
  active: "border-[color:var(--ds-status-running-mark)] bg-[var(--ds-status-running-mark)]",
  pending: "border-[color:var(--ds-border-strong)] bg-[var(--ds-surface-1)]",
  failed: "border-[color:var(--ds-danger)] bg-[var(--ds-danger)]",
  blocked: "border-[color:var(--ds-status-waiting-mark)] bg-[var(--ds-status-waiting-mark)]",
  skipped: "border-[color:var(--ds-border-subtle)] bg-[var(--ds-surface-1)]",
  cancelled: "border-[color:var(--ds-status-cancelled-mark)] bg-[var(--ds-status-cancelled-mark)]",
};


/** Separate desired pool declarations from served live leases; terminal records do not count as capacity. */
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


/** The complete presentation fold for the Session Panel, all from the day wire. */
export function buildSessionPanelView(
  queueSurfaces: readonly QueueSurfaceWire[],
  workerCards: readonly WorkerCardWire[],
  workerPools: readonly WorkerPoolWire[],
): Readonly<{
  workers: readonly Readonly<{ card: WorkerCardWire; membership: WorkerSessionMembership }>[];
  poolGroups: readonly SessionPoolGroup[];
}> {
  return {
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
    (card) => String(card.workflowId) === workflowId && card.state !== "failed",
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




/** Pin canonical worker IDs to kernel derivation; out-of-range indices cannot mint pool identities. */
export function poolMemberWorkerId(workflowId: string, poolIndex: number): string {
  if (!Number.isSafeInteger(poolIndex) || poolIndex < 1) {
    throw new Error(
      `pool index ${String(poolIndex)} for ${workflowId} must be a positive integer`,
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
  return Number.isSafeInteger(index) ? index : undefined;
}


/** A missing lease proves only not-served; crash claims require the retained stop reason. */
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


/** Keep unmet pool declarations visible; only explicit spawn replaces a stopped member. */
export function poolSlotIsUnmet(slot: SessionPoolMemberSlot): boolean {
  return slot.declared && slot.membership.state !== "live";
}


/** Every worker card and pool row of ONE workflow, folded into the panel's roster. */
export type SessionPoolGroup = Readonly<{
  workflowId: string;
  facts: WorkerPoolFacts;
  /** The served pool row itself, so the panel can show WHO planned it and when. */
  declaration: WorkerPoolWire | undefined;
  /** Read pool CAS basis from this snapshot; absent pool rows legitimately use version zero. */
  expectedVersion: number;
  /** Canonical indices, ascending: every declared index plus every index a card is served for. */
  slots: readonly SessionPoolMemberSlot[];
  /** Show noncanonical workers as real records, but offer no pool control for unaddressable identities. */
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

  return workflowIds.map((workflowId) => sessionPoolGroupFor(workflowId, workerCards, workerPools));
}


/** Unplanned workflows use basis zero and an empty roster, never a fabricated pool declaration. */
export function sessionPoolGroupFor(
  workflowId: string,
  workerCards: readonly WorkerCardWire[],
  workerPools: readonly WorkerPoolWire[],
): SessionPoolGroup {
  const facts = poolFactsForWorkflow(workflowId, workerCards, workerPools);
  const cards = workerCards.filter((card) => String(card.workflowId) === workflowId);
  const cardsByIndex = new Map<number, WorkerCardWire>();
  const unindexedCards: WorkerCardWire[] = [];
  for (const card of cards) {
    const index = poolIndexOfWorkerId(workflowId, String(card.workerId));
    // Preserve unaddressable served identities; duplicate canonical IDs are already refused by the wire.
    if (index === undefined) unindexedCards.push(card);
    else cardsByIndex.set(index, card);
  }

  const declaredCount = facts.state === "declared" ? facts.desiredWorkers : 0;
  const indices = new Set(cardsByIndex.keys());
  for (let index = 1; index <= declaredCount; index += 1) indices.add(index);

  return {
    workflowId,
    facts,
    declaration: workerPools.find((entry) => String(entry.workflowId) === workflowId),
    expectedVersion: facts.state === "declared" ? facts.version : 0,
    slots: [...indices].sort((a, b) => a - b).map((poolIndex) => {
      const card = cardsByIndex.get(poolIndex);
      return {
        poolIndex,
        workerId: poolMemberWorkerId(workflowId, poolIndex),
        declared: poolIndex <= declaredCount,
        membership: card === undefined
          ? { state: "not-served" as const }
          : card.state === "failed"
            ? { state: "retained" as const, card }
            : { state: "live" as const, card },
      };
    }),
    unindexedCards,
  };
}


/** Scale-down confirms exact excess indices and their running leases; never choose members by client idleness. */
export type PoolPlanIntent =
  | Readonly<{ kind: "refused"; reason: string }>
  | Readonly<{
    kind: "ready";
    workflowId: string;
    desiredWorkers: number;
    expectedVersion: number;
    /** Derive stop counts from the exact excess-member list, never a separate summary flag. */
    excess: readonly Readonly<{ poolIndex: number; workerId: string; running: boolean }>[];
  }>;


export function planPoolIntent(group: SessionPoolGroup, desiredWorkers: number): PoolPlanIntent {
  if (!Number.isSafeInteger(desiredWorkers) || desiredWorkers < 0) {
    return {
      kind: "refused",
      reason: `a worker pool requires a nonnegative integer count; received ${String(desiredWorkers)}`,
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
  for (const slot of group.slots.filter(slot => slot.poolIndex > desiredWorkers)) {
    const { poolIndex } = slot;
    excess.push({
      poolIndex,
      workerId: slot.workerId,
      running: slot.membership.state === "live",
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


/** Render served worker state, not inferred activity; pending pause intent cannot claim a mid-write worker is paused. */
export const WORKER_TONE: Record<WorkerState, { dot: string; label: string; text: string }> = {
  // Use the shared Running word so worker and run activity do not appear to be different facts.
  running: { dot: "bg-[var(--ds-success-fg)]", label: "Running", text: "text-[color:var(--ds-success-fg)]" },
  starting: {
    dot: "bg-[var(--ds-status-waiting-fg)] animate-pulse motion-reduce:animate-none",
    label: "Starting",
    text: "text-[color:var(--ds-status-waiting-fg)]",
  },
  paused: { dot: "bg-[var(--ds-fg-faint)]", label: "Paused", text: "text-[color:var(--ds-fg-muted)]" },
  idle: { dot: "bg-[var(--ds-fg-faint)]", label: "Idle", text: "text-[color:var(--ds-fg-muted)]" },
  waiting: { dot: "bg-[var(--ds-status-waiting-fg)]", label: "Waiting", text: "text-[color:var(--ds-status-waiting-fg)]" },
  failed: { dot: "bg-[var(--ds-danger)]", label: "Failed", text: "text-[color:var(--ds-danger)]" },
};


export const WORKER_STATE_ORDER: WorkerState[] = ["running", "starting", "idle", "waiting", "paused", "failed"];


/** How a settled lease ended, in the operator's words rather than the enum's. */
export const WORKER_STOP_REASON_LABEL: Record<NonNullable<WorkerCardWire["stopReason"]>, string> = {
  operator: "stopped by you",
  shutdown: "shut down",
  crashed: formatErrorCatalogFailure(createErrorCatalogFailure("WORKER_CRASHED", {})).text,
};


/** Directives describe intent, not state; pause waits for the current item to finish. */
export function workerDirectiveNote(card: WorkerCardWire): string | undefined {
  if (card.state === "failed") return undefined;
  if (card.directive === "pause" && card.state !== "paused") return "Pausing after this item";
  if (card.directive === "run" && card.state === "paused") return "Resume requested";
  if (card.directive === "stop") return "Stopping after this item";
  return undefined;
}


/** Settled leases take no directives; stopping twice must not offer another command. */
export function canStopWorker(card: WorkerCardWire): boolean {
  return card.state !== "failed" && card.directive !== "stop";
}


/** Settled worker duration uses its recorded end; elapsed-to-now would grow after death. */
export function workerElapsedSeconds(card: WorkerCardWire, nowIso: string): number {
  return elapsedSecondsBetween(card.startedAt, card.endedAt ?? nowIso);
}



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


/** Keep zero tallies visible; starting daemons are capacity awaiting a phase, never idle workers. */
export const ALWAYS_TALLIED: WorkerState[] = ["running", "starting", "idle"];


/** Expose interrupted patch delivery; stale snapshots must not keep a quiet Live connection state. */
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
