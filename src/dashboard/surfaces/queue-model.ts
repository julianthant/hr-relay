/**
 * The queue's pure half: the band vocabulary and its sort, the row title folds,
 * the member ordering, and the visible/attention run-id lists the keyboard
 * layer reads.
 *
 * It lives beside `queue.tsx` rather than inside it because a module that
 * exports a component may export nothing else if React Fast Refresh is to
 * treat it as a refresh boundary: one non-component export makes
 * every edit to the queue invalidate upward into `dashboard-app.tsx` and
 * remount the surface. Same values, same call sites, one import hop.
 */
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { QueueSurfaceWireSchema } from "../../domain/dashboard/projection.js";
import {
  dsStatusOf,
  statusAccessibleName,
  type ProposedStatus,
} from "./status-model.js";
import { MEMBER_WELL_LINES } from "./layout-metrics.js";
import { elapsedSecondsBetween, fmtElapsed } from "./format.js";

/**
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * `demo-data.ts` `DEMO_SORTS` / `sortDemoRows` / `SORT_STATUS_RANK`.
 *
 * All four are PRESENTATIONS the operator asked for by name, and the control on
 * the toolbar is what makes the reorder visible. They reorder WITHIN a band and
 * never across one: a band is what a run's status means, and no sort may move a
 * row out of the group that says a human is blocking.
 *
 * `attention` used to pass the array straight through with a note claiming it
 * ordered "what needs you, then what broke, then the rest" — a sentence about
 * an order the server does not produce, on the control that is the default
 * (R3 finding 1). It now ranks by status the way the demo does, newest first
 * inside a rank. That is presentation over a served enum, not a second opinion
 * about what a run IS: no row changes band, no count moves.
 */
export type QueueSortKey = "attention" | "newest" | "oldest" | "longest";

export const QUEUE_SORTS: readonly { key: QueueSortKey; label: string; note: string }[] = [
  { key: "attention", label: "Attention first", note: "What needs you, then what broke, then everything else — the default." },
  { key: "newest", label: "Newest first", note: "Most recently started at the top of each band." },
  { key: "oldest", label: "Oldest first", note: "The rows that have been sitting the longest, first in each band." },
  { key: "longest", label: "Longest running", note: "Biggest elapsed or recorded duration first — where the time is going." },
];

export type QueueSurfaceWire = z.infer<typeof QueueSurfaceWireSchema>;

export type MemberSurfaceWire = Extract<QueueSurfaceWire, { surfaceKind: "member" }>;

export type OperationSurfaceWire = Extract<QueueSurfaceWire, { surfaceKind: "operation" }>;

export type PipelineStep = QueueSurfaceWire["pipeline"][number];

/** One delegated child this row waits on and does NOT count (D231). */
export type LinkedRunWire = QueueSurfaceWire["linkedRuns"][number];

/* ── bands ───────────────────────────────────────────────────────────────── */

export type QueueBandKey = "attention" | "active" | "queued" | "finished";

export const BAND_LABEL: Record<QueueBandKey, string> = {
  attention: "Needs you",
  active: "Active",
  queued: "Queued",
  /** narrowed to `Finished` off today's partition — see `isToday` below */
  finished: "Finished today",
};

/**
 * A fixed map from the closed ds status vocabulary to a visual band — the same
 * class of pure presentation as mapping a status to an icon. It reorders what
 * the operator sees; it never reclassifies what a run is, and the band's own
 * number is the count of rows drawn in it, not a claim about the day's totals
 * (those are the Status Bar's, from the one projection — D81).
 */
export function bandOf(status: ProposedStatus): QueueBandKey {
  if (status === "waiting" || status === "parked") return "attention";
  if (status === "running") return "active";
  if (status === "queued") return "queued";
  return "finished";
}

export const BAND_ORDER: QueueBandKey[] = ["attention", "active", "queued", "finished"];

/**
 * The `attention` order, copied VALUE FOR VALUE from the demo's
 * `SORT_STATUS_RANK` (`demo-data.ts:4259-4268`).
 *
 * It is not the band order and must not be re-derived from it: `failed` sorts
 * second here while its band is `finished`, which is the whole point — inside
 * the finished band a failure comes before a clean done.
 */
const SORT_STATUS_RANK: Record<ProposedStatus, number> = {
  waiting: 0,
  failed: 1,
  parked: 2,
  running: 3,
  queued: 4,
  doneWarnings: 5,
  verifiedDone: 6,
  cancelled: 7,
};

/**
 * How long a row has been working: recorded when it ended, live while it runs.
 * `endedAt` is the served union (D124), so a terminal row whose end instant is
 * genuinely unknown counts as its elapsed-to-now rather than being ranked as
 * zero — and nothing here substitutes `now` for a missing END on a row the
 * server said is still in flight.
 */
function elapsedMs(surface: QueueSurfaceWire, nowIso: string): number {
  const started = Date.parse(surface.startedAt);
  const ended = surface.endedAt.state === "present" ? Date.parse(surface.endedAt.value) : Date.parse(nowIso);
  return Math.max(0, ended - started);
}

/**
 * What this row is CALLED — the operator's own name for the run when they have
 * given it one, and otherwise the server's (ref dashboard-surfaces §1.2).
 *
 * The server serves the two separately on purpose: `title` says what the system
 * thinks the run is about (the start-input title, replaced by the subject's
 * name once the run resolves one) and `displayName` is the operator's override.
 * Folding them on the server would make the tooltip below unwritable, because
 * no surface could then tell a renamed row from a system-titled one.
 */
export function queueRowTitle(surface: QueueSurfaceWire): string {
  return surface.displayName.state === "present" ? surface.displayName.value : surface.title;
}

/**
 * The renamed row's tooltip: it names the SUBJECT the operator renamed away
 * from, so the run's own identity is one hover away rather than gone. A row
 * that was never renamed carries no tooltip at all — a title explaining itself
 * is noise on every row in the queue.
 */
export function queueRowTitleTooltip(surface: QueueSurfaceWire): string | undefined {
  return surface.displayName.state === "present"
    ? `Named by you — subject is ${surface.title}`
    : undefined;
}

/**
 * How long the row's gate has been waiting, as the operator reads it.
 *
 * Ported from legacy hr-automation@793abe1f8265f3213ffe8a80d6cfd9860a32a1dc,
 * `demo-data.ts:4084` `gateAge` (`fmtElapsed(gateWaitSec(row, tick))`).
 *
 * D12 draws this age on the row's own pill and `DemoQueue.tsx:818` puts it in
 * the row's accessible NAME as well, which is the only place it reaches a
 * screen reader: the pill's age is a visual fact, and a queue you triage by
 * ear needs `waiting on you · 18m`, not `waiting on you`. It lives here, once,
 * so the pill and the name cannot disagree about how old one gate is — the
 * defect D256 named on this very panel, one clock lower down.
 *
 * `undefined` when the server dated no gate, which is every row that is not
 * waiting on a human: an absent age draws and speaks nothing rather than a
 * zero nobody measured.
 */
export function queueGateAge(surface: QueueSurfaceWire, nowIso: string): string | undefined {
  return surface.gateOpenedAt.state === "present"
    ? fmtElapsed(elapsedSecondsBetween(surface.gateOpenedAt.value, nowIso))
    : undefined;
}

/**
 * The queue row's accessible identity, including the served age of a gate.
 *
 * This is the same composition `QueueRow` puts on its one press target. It
 * lives beside the shared age fold so a visual pill and the sentence an
 * operator hears cannot become two different readings of the same gate.
 */
export function queueRowAccessibleName(surface: QueueSurfaceWire, nowIso: string): string {
  return `${queueRowTitle(surface)} — ${statusAccessibleName(
    dsStatusOf(surface.status),
    queueGateAge(surface, nowIso),
  ).toLowerCase()}`;
}

export function sortQueueBand(
  rows: readonly QueueSurfaceWire[],
  key: QueueSortKey,
  nowIso: string,
): readonly QueueSurfaceWire[] {
  const born = (surface: QueueSurfaceWire): number => Date.parse(surface.startedAt);
  const rank = (surface: QueueSurfaceWire): number => SORT_STATUS_RANK[dsStatusOf(surface.status)];
  return [...rows].sort((a, b) => {
    if (key === "newest") return born(b) - born(a);
    if (key === "oldest") return born(a) - born(b);
    if (key === "longest") return elapsedMs(b, nowIso) - elapsedMs(a, nowIso);
    // `attention` — rank, then newest first inside a rank, exactly as the demo
    // composes it (`rank(a) - rank(b) || born(b) - born(a)`).
    return rank(a) - rank(b) || born(b) - born(a);
  });
}

/* ── the attention transition ────────────────────────────────────────────── */

/** how long the settle lasts — one `move`, then still */
const ATTENTION_ANNOUNCE_MS = 900;

/**
 * THE ATTENTION TRANSITION — the one status change this product animates.
 *
 * DESIGN.md says never animate status churn, and it is right: this dashboard
 * updates constantly, and if everything that changes also moves it is
 * unreadable exactly when it is busiest. Elapsed timers, counts, background
 * settling and self-initiated re-sorts all stay perfectly still.
 *
 * A run CROSSING INTO `Waiting on you` or `Failed` is different in kind. Those
 * are the two states allowed to shout; a run entering one has stopped being
 * background and become work, and the moment it happens is the moment the
 * operator is looking somewhere else. It fires on the EDGE, never on the state
 * — a row already waiting when you scrolled to it does nothing — never on
 * mount, once, and only for those two statuses.
 *
 * Implemented once, here. Do not re-derive it at a second call site.
 */
export function useAttentionAnnounce(status: ProposedStatus): boolean {
  const attention = status === "waiting" || status === "failed";
  const previous = useRef<ProposedStatus | null>(null);
  const [announcing, setAnnouncing] = useState(false);

  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    // First sight of a row is not a transition. Mounting into an attention
    // status is how EVERY row on a busy panel would announce itself on paint.
    if (was === null || was === status) return;
    if (!attention) return;
    setAnnouncing(true);
    const timer = window.setTimeout(() => setAnnouncing(false), ATTENTION_ANNOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [attention, status]);

  return announcing;
}

/* ── the member well ─────────────────────────────────────────────────────── */

/* the two well shapes live in `layout-metrics.ts` — see the note there */

/** A dedicated roster view accompanies every member set that can expand. */
export function canViewAllMembers(memberCount: number): boolean {
  return memberCount > MEMBER_WELL_LINES;
}

/**
 * Members sort attention-first and keep the same one-line tracks (DESIGN.md:
 * "Member status changes order and ink, never row shape"). Within a tier the
 * SERVER's order is preserved — the client never re-sorts a projection.
 *
 * The VALUES are the demo's `MEMBER_ATTENTION_RANK`
 * (`demo-data.ts:4388-4397`), copied rather than re-derived: a member that
 * finished WITH WARNINGS ranks with `parked` at 2, because a warning is
 * something to look at, and `cancelled` sinks BELOW a clean done at 5/6 — a
 * member nobody ran is the least interesting line in the well, and the rebuild
 * had those two inverted (R3 finding 13).
 *
 * The TIEBREAK stays the rebuild's: the member's index in the served array, so
 * two members of the same status keep the projection's order. The demo falls
 * back to its fixture id, which is not an order any server produces.
 */
const MEMBER_TIER: Record<ProposedStatus, number> = {
  failed: 0,
  waiting: 1,
  doneWarnings: 2,
  parked: 2,
  running: 3,
  queued: 4,
  cancelled: 5,
  verifiedDone: 6,
};

export function orderMembers(members: readonly MemberSurfaceWire[]): MemberSurfaceWire[] {
  return [...members]
    .map((surface, index) => ({ surface, index }))
    .sort((a, b) => {
      const tier = MEMBER_TIER[dsStatusOf(a.surface.status)] - MEMBER_TIER[dsStatusOf(b.surface.status)];
      return tier !== 0 ? tier : a.index - b.index;
    })
    .map(({ surface }) => surface);
}

/* ── the panel ───────────────────────────────────────────────────────────── */

/**
 * Members are contained by their operation and are drawn INSIDE it, so a member
 * surface is never also a top-level row. Containment is read from the served
 * `memberRunIds` / `lineage`, never re-decided here.
 */
export function partition(surfaces: readonly QueueSurfaceWire[]): {
  top: QueueSurfaceWire[];
  membersOf: Map<string, MemberSurfaceWire[]>;
} {
  const byRunId = new Map<string, MemberSurfaceWire>();
  for (const surface of surfaces) {
    if (surface.surfaceKind === "member") byRunId.set(surface.runId, surface);
  }
  const claimed = new Set<string>();
  const membersOf = new Map<string, MemberSurfaceWire[]>();
  for (const surface of surfaces) {
    if (surface.surfaceKind !== "operation") continue;
    const members: MemberSurfaceWire[] = [];
    for (const runId of surface.memberRunIds) {
      const member = byRunId.get(runId);
      if (member === undefined) continue;
      members.push(member);
      claimed.add(runId);
    }
    membersOf.set(surface.runId, members);
  }
  const top = surfaces.filter((surface) => !claimed.has(surface.runId));
  return { top, membersOf };
}

/**
 * The j/k traversal order for the current view — the SAME order the eye sees,
 * members included, so a keyboard walk and a scroll agree.
 */
export function visibleRunIds(
  surfaces: readonly QueueSurfaceWire[],
  sort: QueueSortKey = "attention",
  nowIso: string = new Date(0).toISOString(),
): string[] {
  const { top, membersOf } = partition(surfaces);
  const ids: string[] = [];
  for (const key of BAND_ORDER) {
    const band = sortQueueBand(
      top.filter((surface) => bandOf(dsStatusOf(surface.status)) === key),
      sort,
      nowIso,
    );
    for (const surface of band) {
      ids.push(surface.runId);
      for (const member of orderMembers(membersOf.get(surface.runId) ?? [])) ids.push(member.runId);
    }
  }
  return ids;
}

/**
 * The rows that need the operator, in the order they are DRAWN — the `n`
 * binding's target (`app/global-keys.ts`).
 *
 * It filters `visibleRunIds` by the same `bandOf` the NEEDS YOU band header
 * draws from, so the key and the band physically cannot disagree about what
 * needs attention. A member of an attention band's group is in the list at its
 * own drawn position, which is where the eye finds it.
 */
export function attentionRunIds(
  surfaces: readonly QueueSurfaceWire[],
  sort: QueueSortKey = "attention",
  nowIso: string = new Date(0).toISOString(),
): string[] {
  const attention = new Set<string>(
    surfaces
      .filter((surface) => bandOf(dsStatusOf(surface.status)) === "attention")
      .map((surface) => String(surface.runId)),
  );
  return visibleRunIds(surfaces, sort, nowIso).filter((runId) => attention.has(runId));
}
