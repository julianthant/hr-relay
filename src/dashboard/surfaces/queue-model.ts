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
 * ONE ROW'S ⓘ CONTENT, as a fold rather than as JSX.
 *
 * WHAT THE ⓘ IS FOR, in the operator's own words: *"the subtitle and other
 * important stuff related to the run that doesnt fit into the queue row —
 * something i dont need normally when i glance at the queue row but i could
 * maybe use sometimes to find out more info."* Two exclusions follow from that
 * sentence and both were applied:
 *
 *   NOT PRODUCT EXPLANATION. What a panel of this kind shows, and what this
 *     row's containment means, are facts about the PRODUCT — identical on
 *     every row sharing a `panelKind`, worth one read ever, and printed above
 *     the thing the ⓘ was opened for. They left `surfaces/queue.tsx`.
 *   NOT THE RUN'S EXTRACTED VALUES. `facts[]` — the evidence receipt's own
 *     output — is what the run PRODUCED, and it is already drawn on the row as
 *     chips. Repeating it here made the ⓘ a second copy of the row instead of
 *     the place you go for what the row could not hold.
 *
 * Two kinds of entry remain and they must stay distinguishable, which is why
 * `state` rides along instead of both arms being flattened into a sentence:
 *
 *   ABSENT — the server said it has no such fact, and said WHY. Letting those
 *     reasons collapse into a silent gap is the absence-versus-failure
 *     conflation this program bans (D230 / §9 D7).
 *   PRESENT — the fact's own value, WHOLE, on a click a touch user and a
 *     keyboard user can both make. DESIGN.md is explicit that load-bearing
 *     detail "goes in the UI or in a Popover (click-to-open, keyboard- and
 *     touch-reachable), never in a hover-only surface".
 *
 * KNOWN CONSEQUENCE, recorded rather than hidden: dropping the present
 * `facts[]` entries takes the row's fact CHIPS back to `title` as their only
 * route to an uncut value, which is the hover-only surface that rule names. The
 * chips are the row's own output and belong to it; if that clip starts costing
 * an operator a value, the answer is an affordance on the chips, not putting
 * the run's output back inside the ⓘ.
 */
export interface RowInfoFact {
  readonly label: string;
  readonly state: "absent" | "present";
  /** the server's reason for the absence, or the fact's own full value */
  readonly text: string;
}

export function rowInfoFacts(surface: QueueSurfaceWire): readonly RowInfoFact[] {
  const facts: RowInfoFact[] = [];
  const absent = (label: string, text: string): void => {
    facts.push({ label, state: "absent", text });
  };
  if (surface.subtitle.state === "absent") absent("Subtitle", surface.subtitle.reason);
  /*
    PRESENT — and the ⓘ is now its ONLY home.

    The subtitle left the row's footer entirely (`surfaces/queue.tsx`). That
    line is provenance — when, which run, which trace, how long — and a
    subtitle is not: across the product it is the workflow's own name, a start
    option, the filer, or a re-read ordinal with the operator's free-text
    reason. It is context about how the run came to BE, not something the run
    produced, so it belongs where explanation lives rather than on a surface
    read at a glance. Being here also means the value is never clipped: the
    popover prints it whole, on a click that a touch and a keyboard can both
    make.

    THE DEMO'S `showId` GUARD COMES WITH IT (`DemoQueue.tsx:674`, R3 finding
    18): a subtitle equal to the row's title printed the same string twice on
    one card, and it would print it twice in one popover for the same reason.
    The guard moved here because the footer that used to hold it no longer
    reads the field at all.

    It leads the list — the popover then reads top-down the way the row does.
  */
  if (surface.subtitle.state === "present" && surface.subtitle.value !== queueRowTitle(surface)) {
    facts.push({ label: "Subtitle", state: "present", text: surface.subtitle.value });
  }
  if (surface.liveMessage.state === "absent") absent("Live message", surface.liveMessage.reason);
  if (surface.runNumber.state === "absent") absent("Run number", surface.runNumber.reason);
  /*
    PRESENT — the workflow ordinal left the footer too. The footer's `#N` chip
    is the ATTEMPT (operator ruling, 2026-09-01); the ordinal is context about
    where this run sits in its workflow's history and reads here, whole.
  */
  if (surface.runNumber.state === "present") {
    facts.push({ label: "Run number", state: "present", text: `#${String(surface.runNumber.value)} of this workflow` });
  }
  if (surface.surfaceKind === "operation" && surface.memberPreview.state === "absent") {
    absent("Members", surface.memberPreview.reason);
  }
  return facts;
}

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

export type QueueStatusFilter = QueueSurfaceWire["status"] | "needsYou" | "all";

export interface QueueItemGroup {
  readonly key: string;
  readonly attempts: readonly QueueSurfaceWire[];
  readonly representative: QueueSurfaceWire;
}

function queueItemKey(surface: Pick<QueueSurfaceWire, "workflowId" | "itemId">): string {
  return JSON.stringify([surface.workflowId, surface.itemId]);
}

/** Keep the day's attempts under their served logical item identity. */
export function groupQueueAttempts(surfaces: readonly QueueSurfaceWire[]): readonly QueueItemGroup[] {
  const groups = new Map<string, QueueSurfaceWire[]>();
  for (const surface of surfaces) {
    const key = queueItemKey(surface);
    const attempts = groups.get(key);
    if (attempts === undefined) groups.set(key, [surface]);
    else attempts.push(surface);
  }

  return [...groups].map(([key, unsorted]) => {
    const attempts = [...unsorted].sort((left, right) =>
      left.attempt - right.attempt || String(left.runId).localeCompare(String(right.runId)));
    for (let index = 1; index < attempts.length; index += 1) {
      if (attempts[index - 1]?.attempt === attempts[index]?.attempt) {
        throw new Error(`queue item has duplicate attempt: ${key}`);
      }
    }
    const representative = attempts.at(-1);
    if (representative === undefined) throw new Error(`queue item has no attempts: ${key}`);
    return { key, attempts, representative };
  });
}

/** Match a status at item scope, then retain every served attempt for that item. */
export function filterQueueSurfaces(
  surfaces: readonly QueueSurfaceWire[],
  filter: QueueStatusFilter,
): readonly QueueSurfaceWire[] {
  if (filter === "all") return surfaces;
  const matches = (surface: QueueSurfaceWire): boolean => filter === "needsYou"
    ? surface.status === "awaiting-approval" || surface.status === "blocked"
    : surface.status === filter;
  const includedItems = new Set(
    groupQueueAttempts(surfaces.filter(matches)).map((group) => group.key),
  );

  // An included operation retains its served child set. A child that matches
  // on its own remains visible and keeps all of its attempts too.
  let changed = true;
  while (changed) {
    changed = false;
    const includedParents = new Set(surfaces
      .filter((surface) => includedItems.has(queueItemKey(surface)) && surface.surfaceKind === "operation")
      .map((surface) => String(surface.runId)));
    for (const surface of surfaces) {
      if (surface.lineage.state !== "child" || !includedParents.has(String(surface.lineage.parentRunId))) continue;
      const key = queueItemKey(surface);
      if (includedItems.has(key)) continue;
      includedItems.add(key);
      changed = true;
    }
  }

  return surfaces.filter((surface) => includedItems.has(queueItemKey(surface)));
}

/**
 * Browser-local triage, deliberately not an authority projection. The caller
 * owns the state lifetime (DashboardApp creates an empty set on every load),
 * while this fold keeps the immutable set update shared and testable.
 */
export function toggleCheckedByYou(previous: ReadonlySet<string>, runId: string): ReadonlySet<string> {
  const next = new Set(previous);
  if (next.has(runId)) next.delete(runId);
  else next.add(runId);
  return next;
}

/** Only members present in this view count toward its local tally. A saved id
 * from another operation cannot inflate a group it does not belong to. */
export function checkedByYouCount(members: readonly MemberSurfaceWire[], checkedIds: ReadonlySet<string>): number {
  return members.filter((member) => checkedIds.has(String(member.runId))).length;
}

export function checkedQueueItemCount(items: readonly QueueItemGroup[], checkedIds: ReadonlySet<string>): number {
  return items.filter((item) => item.attempts.some((attempt) => checkedIds.has(String(attempt.runId)))).length;
}

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
  if (status === "running" || status === "cancelling") return "active";
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
  cancelling: 3,
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
  cancelling: 3,
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
  const { batchByRun, displayTop, itemByRunId } = queueBatchLayout(top, sort, nowIso);
  const ids: string[] = [];
  const addAttempts = (surface: QueueSurfaceWire): void => {
    const item = itemByRunId.get(String(surface.runId));
    if (item === undefined) throw new Error(`queue keyboard order lost item ${String(surface.itemId)}`);
    ids.push(...item.attempts.map((attempt) => String(attempt.runId)));
  };
  for (const key of BAND_ORDER) {
    const band = sortQueueBand(
      displayTop.filter((surface) => (batchByRun.get(surface.runId)?.band ?? bandOf(dsStatusOf(surface.status))) === key),
      sort,
      nowIso,
    );
    for (const surface of band) {
      const batch = batchByRun.get(surface.runId);
      if (batch !== undefined) {
        for (const row of batch.members) addAttempts(row);
        continue;
      }
      addAttempts(surface);
      const memberGroups = groupQueueAttempts(membersOf.get(surface.runId) ?? []);
      for (const member of orderMembers(memberGroups.map((group) => group.representative) as MemberSurfaceWire[])) {
        const item = memberGroups.find((group) => group.representative.runId === member.runId);
        if (item === undefined) throw new Error(`queue keyboard order lost member item ${String(member.itemId)}`);
        ids.push(...item.attempts.map((attempt) => String(attempt.runId)));
      }
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
    groupQueueAttempts(surfaces)
      .map((group) => group.representative)
      .filter((surface) => bandOf(dsStatusOf(surface.status)) === "attention")
      .map((surface) => String(surface.runId)),
  );
  return visibleRunIds(surfaces, sort, nowIso).filter((runId) => attention.has(runId));
}

export interface QueueBatch {
  readonly id: string;
  readonly version: number;
  readonly groupInQueue: boolean;
  readonly startedAt: string;
  readonly representative: QueueSurfaceWire;
  readonly members: readonly QueueSurfaceWire[];
  readonly history: readonly QueueSurfaceWire[];
  readonly band: QueueBandKey;
}

/** Groups only the loaded scope. A batch is presentation, never a synthetic run. */
export function queueBatches(rows: readonly QueueSurfaceWire[]): readonly QueueBatch[] {
  const groups = new Map<string, QueueSurfaceWire[]>();
  for (const row of rows) {
    if (row.containment !== "root" || row.surfaceKind === "operation" || row.session.state !== "present" || row.session.presentation === undefined) continue;
    const members = groups.get(row.session.sessionId) ?? [];
    members.push(row);
    groups.set(row.session.sessionId, members);
  }
  return [...groups.entries()].map(([id, rows]) => {
    const first = rows[0];
    if (first === undefined || first.session.state !== "present" || first.session.presentation === undefined) throw new Error("batch has no presentation");
    const presentation = first.session.presentation;
    const latest = new Map<string, QueueSurfaceWire>();
    for (const row of rows) {
      const session = row.session;
      if (session.state !== "present" || session.presentation === undefined) throw new Error("batch member lacks item identity");
      if (row.workflowId !== first.workflowId || session.presentation.version !== presentation.version || session.presentation.groupInQueue !== presentation.groupInQueue || session.presentation.startedAt !== presentation.startedAt) throw new Error("batch members disagree about their presentation");
      const previous = latest.get(row.itemId);
      if (previous === undefined || previous.attempt < row.attempt) latest.set(row.itemId, row);
      else if (previous.attempt === row.attempt) throw new Error("batch has duplicate item attempt");
    }
    const members = [...latest.values()];
    const latestIds = new Set(members.map((row) => row.runId));
    const history = rows.filter((row) => !latestIds.has(row.runId));
    const band = BAND_ORDER.find((key) => members.some((row) => bandOf(dsStatusOf(row.status)) === key));
    if (band === undefined) throw new Error("batch has no queue band");
    return { id, ...presentation, representative: first, members, history, band };
  });
}

/** One layout shared by rendering and keyboard traversal. */
export function queueBatchLayout(top: readonly QueueSurfaceWire[], sort: QueueSortKey, nowIso: string) {
  const itemGroups = groupQueueAttempts(top);
  const itemByRunId = new Map(itemGroups.flatMap((group) =>
    group.attempts.map((attempt) => [String(attempt.runId), group] as const)));
  const representatives = itemGroups.map((group) => group.representative);
  const batches = queueBatches(representatives).map((batch) => ({ ...batch,
    members: sortQueueBand(batch.members, sort, nowIso), history: sortQueueBand(batch.history, sort, nowIso),
  }));
  const grouped = batches.filter((batch) => batch.groupInQueue && batch.members.length > 1);
  const batchByRun = new Map(grouped.flatMap((batch) => batch.members.map((row) => [row.runId, batch] as const)));
  const flatBatchByFirst = new Map(batches.filter((batch) => !batch.groupInQueue && batch.members.length > 1).map((batch) => [batch.representative.runId, batch]));
  const displayTop = representatives.filter((row) =>
    !batchByRun.has(row.runId) || batchByRun.get(row.runId)?.representative.runId === row.runId,
  );
  return { batchByRun, flatBatchByFirst, displayTop, itemGroups, itemByRunId };
}
