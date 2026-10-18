/** The queue's pure half: the band vocabulary and its sort, the row title folds
 * the member ordering, and the visible/attention run-id lists the keyboard */
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import type { QueueSurfaceWireSchema } from "../../../models/dashboard/projection.js";
import {
  dsStatusOf,
  statusAccessibleName,
  type ProposedStatus,
} from "../shared/status/status-model.js";
import { MEMBER_WELL_LINES } from "./layout-metrics.js";
import { elapsedSecondsBetween, fmtElapsed } from "../shared/status/format.js";

/** ONE ROW'S ⓘ CONTENT, as a fold rather than as JSX.
 * WHAT THE ⓘ IS FOR, in the operator's own words */
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
  /** PRESENT — and the ⓘ is now its ONLY home. The subtitle left the row's footer entirely (`surfaces/queue.tsx`).
 * That */
  if (surface.subtitle.state === "present" && surface.subtitle.value !== queueRowTitle(surface)) {
    facts.push({ label: "Subtitle", state: "present", text: surface.subtitle.value });
  }
  if (surface.liveMessage.state === "absent") absent("Live message", surface.liveMessage.reason);
  if (surface.runNumber.state === "absent") absent("Run number", surface.runNumber.reason);
  /** PRESENT — the workflow ordinal left the footer too. The footer's `#N` chip is the ATTEMPT */
  if (surface.runNumber.state === "present") {
    facts.push({ label: "Run number", state: "present", text: `#${String(surface.runNumber.value)} of this workflow` });
  }
  if (surface.surfaceKind === "operation" && surface.memberPreview.state === "absent") {
    absent("Members", surface.memberPreview.reason);
  }
  return facts;
}

/** Attention groups by status; the other orders sort the entire queue. */
export type QueueSortKey = "attention" | "newest" | "oldest" | "longest";

export const QUEUE_SORTS: readonly { key: QueueSortKey; label: string; note: string }[] = [
  { key: "attention", label: "Attention first", note: "What needs you, then what broke, then everything else — the default." },
  { key: "newest", label: "Newest first", note: "Most recently started first." },
  { key: "oldest", label: "Oldest first", note: "Earliest started first." },
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

/** Keep served attempts under their served logical item identity. */
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
      right.attempt - left.attempt || String(left.runId).localeCompare(String(right.runId)));
    for (let index = 1; index < attempts.length; index += 1) {
      if (attempts[index - 1]?.attempt === attempts[index]?.attempt) {
        throw new Error(`queue item has duplicate attempt: ${key}`);
      }
    }
    const representative = attempts[0];
    if (representative === undefined) throw new Error(`queue item has no attempts: ${key}`);
    return { key, attempts, representative };
  });
}

/** Match a status at item scope, then retain every served attempt for that item. */
export function filterQueueSurfaces(
  surfaces: readonly QueueSurfaceWire[],
  filter: QueueStatusFilter | readonly QueueStatusFilter[],
): readonly QueueSurfaceWire[] {
  const filters = typeof filter === "string" ? [filter] : filter;
  if (filters.length === 0 || filters.includes("all")) return surfaces;
  const matches = (surface: QueueSurfaceWire): boolean => filters.some(value => value === "needsYou"
    ? surface.status === "awaiting-approval" || surface.status === "blocked"
    : surface.status === value);
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

/** Triage is browser-local; it must not be mistaken for an authority projection. */
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

/** Delegated children are waited on, never counted as this row’s members. */
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

/** Bands count drawn rows; only the served status projection reports day totals. */
export function bandOf(status: ProposedStatus): QueueBandKey {
  if (status === "waiting" || status === "parked") return "attention";
  if (status === "running" || status === "cancelling") return "active";
  if (status === "queued") return "queued";
  return "finished";
}

export const BAND_ORDER: QueueBandKey[] = ["attention", "active", "queued", "finished"];

/** Attention order differs from band order; failures must precede clean completion within their band. */
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

/** Unknown terminal duration sorts by elapsed-to-now; rendering still preserves its unknown end reason. */
function elapsedMs(surface: QueueSurfaceWire, nowIso: string): number {
  const started = Date.parse(surface.startedAt);
  const ended = surface.endedAt.state === "present" ? Date.parse(surface.endedAt.value) : Date.parse(nowIso);
  return Math.max(0, ended - started);
}

/** Keep operator displayName separate from system title so renamed subjects remain identifiable. */
export function queueRowTitle(surface: QueueSurfaceWire): string {
  return surface.displayName.state === "present" ? surface.displayName.value : surface.title;
}

/** Renamed rows disclose their original subject; unchanged titles need no explanatory tooltip. */
export function queueRowTitleTooltip(surface: QueueSurfaceWire): string | undefined {
  return surface.displayName.state === "present"
    ? `Named by you — subject is ${surface.title}`
    : undefined;
}

/** Share gate-age measurement with its accessible name; missing gate instants never become zero. */
export function queueGateAge(surface: QueueSurfaceWire, nowIso: string): string | undefined {
  return surface.gateOpenedAt.state === "present"
    ? fmtElapsed(elapsedSecondsBetween(surface.gateOpenedAt.value, nowIso))
    : undefined;
}

/** Visual and spoken gate age use one fold so they cannot disagree. */
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

/** The view and keyboard navigation share the same row order. */
export function queueDisplayGroups(rows: readonly QueueSurfaceWire[], sort: QueueSortKey, nowIso: string): readonly { key: QueueBandKey | null; label: string; rows: readonly QueueSurfaceWire[] }[] {
  if (sort !== "attention") return [{ key: null, label: "", rows: sortQueueBand(rows, sort, nowIso) }];
  return BAND_ORDER.map(key => ({ key, label: BAND_LABEL[key], rows: sortQueueBand(rows.filter(row => bandOf(dsStatusOf(row.status)) === key), sort, nowIso) }));
}

/* ── the attention transition ────────────────────────────────────────────── */

/** how long the settle lasts — one `move`, then still */
const ATTENTION_ANNOUNCE_MS = 900;

/** Animate only entry into attention states, never mount, timers or ordinary status churn. */
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
    if (!attention) {
      setAnnouncing(false);
      return;
    }
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

/** Attention-sort members while preserving served order within each tier. */
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

/** Read served containment; member rows cannot also appear as top-level work. */
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

/** Keyboard traversal follows drawn rows, including expanded members. */
export function visibleRunIds(
  surfaces: readonly QueueSurfaceWire[],
  sort: QueueSortKey = "attention",
  nowIso: string = new Date(0).toISOString(),
): string[] {
  const { top, membersOf } = partition(surfaces);
  const { displayTop, itemByRunId } = queueItemLayout(top);
  const ids: string[] = [];
  const addAttempts = (surface: QueueSurfaceWire): void => {
    const item = itemByRunId.get(String(surface.runId));
    if (item === undefined) throw new Error(`queue keyboard order lost item ${String(surface.itemId)}`);
    ids.push(...item.attempts.toReversed().map((attempt) => String(attempt.runId)));
  };
  for (const group of queueDisplayGroups(displayTop, sort, nowIso)) {
    const band = group.rows;
    for (const surface of band) {
      addAttempts(surface);
      const memberGroups = groupQueueAttempts(membersOf.get(surface.runId) ?? []);
      for (const member of orderMembers(memberGroups.map((group) => group.representative) as MemberSurfaceWire[])) {
        const item = memberGroups.find((group) => group.representative.runId === member.runId);
        if (item === undefined) throw new Error(`queue keyboard order lost member item ${String(member.itemId)}`);
        ids.push(...item.attempts.toReversed().map((attempt) => String(attempt.runId)));
      }
    }
  }
  return ids;
}

/** Attention shortcuts use the same visible order and bands as the queue. */
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

/** Logical items stay separate regardless of the served session's grouping preference. */
export function queueItemLayout(top: readonly QueueSurfaceWire[]) {
  const itemGroups = groupQueueAttempts(top);
  const itemByRunId = new Map(itemGroups.flatMap((group) =>
    group.attempts.map((attempt) => [String(attempt.runId), group] as const)));
  const displayTop = itemGroups.map((group) => group.representative);
  return { displayTop, itemGroups, itemByRunId };
}
