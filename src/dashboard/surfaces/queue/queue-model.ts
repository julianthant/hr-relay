/** The queue's pure half: the band vocabulary and its sort, the row title folds
 * the member ordering, and the visible/attention run-id lists the keyboard */
import { useEffect, useRef, useState } from "react";
import { isQueueMember, isQueueTopLevel } from "../../../models/dashboard/queue-parent.js";
import type { z } from "zod";
import type { QueueSurfaceWireSchema, QueueRecordMember, QueueMemberSelection } from "../../../models/dashboard/projection.js";
import {
  dsStatusOf,
  statusAccessibleName,
  statusText,
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


export type OperationSurfaceWire = Extract<QueueSurfaceWire, { surfaceKind: "operation" }>;

export type PipelineStep = QueueSurfaceWire["pipeline"][number];

export type QueueStatusFilter = QueueSurfaceWire["status"] | "needsYou" | "all";

export interface QueueItemGroup {
  readonly key: string;
  readonly attempts: readonly QueueSurfaceWire[];
  readonly representative: QueueSurfaceWire;
  readonly dayNumberByRunId: ReadonlyMap<string, number>;
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
    const backendAttempts = new Set<number>();
    for (const surface of unsorted) {
      if (!Number.isFinite(Date.parse(surface.startedAt))) throw new Error(`queue run has no valid start time: ${surface.runId}`);
      if (backendAttempts.has(surface.attempt)) throw new Error(`queue item has duplicate attempt: ${key}`);
      backendAttempts.add(surface.attempt);
    }
    const chronological = [...unsorted].sort((left, right) =>
      Date.parse(left.startedAt) - Date.parse(right.startedAt) || (left.runId < right.runId ? -1 : left.runId > right.runId ? 1 : 0));
    const dayNumberByRunId = new Map(chronological.map((surface, index) => [String(surface.runId), index + 1]));
    const attempts = chronological.toReversed();
    const representative = attempts[0];
    if (representative === undefined) throw new Error(`queue item has no attempts: ${key}`);
    return { key, attempts, representative, dayNumberByRunId };
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
      if (surface.parent === null || !includedParents.has(String(surface.parent.runId))) continue;
      const key = queueItemKey(surface);
      if (includedItems.has(key)) continue;
      includedItems.add(key);
      changed = true;
    }
    for (const surface of surfaces) {
      if (!includedItems.has(queueItemKey(surface)) || !isQueueMember(surface)) continue;
      const parent = surfaces.find(candidate => candidate.runId === surface.parent?.runId);
      if (parent === undefined || includedItems.has(queueItemKey(parent))) continue;
      includedItems.add(queueItemKey(parent));
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
export function checkedByYouCount(members: readonly QueueSurfaceWire[], checkedIds: ReadonlySet<string>): number {
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

export function queuePauseLabel(surface: QueueSurfaceWire): "Paused" | "Pausing" | undefined {
  return surface.pauseControl?.state === "paused" ? "Paused" : surface.pauseControl?.state === "pause-pending" ? "Pausing" : undefined;
}

export function queueRowAccessibleName(surface: QueueSurfaceWire, nowIso: string): string {
  return `${queueRowTitle(surface)} — ${(queuePauseLabel(surface) ?? statusAccessibleName(
    dsStatusOf(surface.status),
    queueGateAge(surface, nowIso),
  )).toLowerCase()}`;
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

export function orderMembers(members: readonly QueueSurfaceWire[]): QueueSurfaceWire[] {
  return [...members]
    .map((surface, index) => ({ surface, index }))
    .sort((a, b) => {
      const tier = MEMBER_TIER[dsStatusOf(a.surface.status)] - MEMBER_TIER[dsStatusOf(b.surface.status)];
      return tier !== 0 ? tier : a.index - b.index;
    })
    .map(({ surface }) => surface);
}

export function queueMemberSelection(member: QueueRecordMember): QueueMemberSelection {
  if (member.kind === "record") return { kind: member.kind, record: member.record };
  if (member.kind === "reading") return { kind: member.kind, ownerRunId: member.ownerRunId };
  return { kind: member.kind, ownerRunId: member.ownerRunId, sourcePage: member.sourcePage };
}

export function queueMemberKey(selection: QueueMemberSelection): string {
  if (selection.kind === "record") return JSON.stringify([selection.kind, selection.record.runId, selection.record.recordId]);
  if (selection.kind === "reading") return JSON.stringify([selection.kind, selection.ownerRunId]);
  return JSON.stringify([selection.kind, selection.ownerRunId, selection.sourcePage]);
}

export type QueueMemberLine = Readonly<{ kind: "run"; key: string; item: QueueItemGroup }>
  | Readonly<{ kind: "record"; key: string; member: QueueRecordMember }>;

export function queueMemberLines(surface: OperationSurfaceWire, members: readonly QueueSurfaceWire[]): readonly QueueMemberLine[] {
  const covered = new Set(surface.recordMembers?.runIds ?? []);
  const runs: QueueMemberLine[] = groupQueueAttempts(members.filter(member => !covered.has(member.runId)))
    .map(item => ({ kind: "run", key: item.key, item }));
  const records: QueueMemberLine[] = (surface.recordMembers?.members ?? [])
    .map(member => ({ kind: "record", key: queueMemberKey(queueMemberSelection(member)), member }));
  const status = (line: QueueMemberLine) => line.kind === "run" ? line.item.representative.status : line.member.status;
  return [...runs, ...records].sort((a, b) => MEMBER_TIER[dsStatusOf(status(a))] - MEMBER_TIER[dsStatusOf(status(b))]);
}

export function queueMemberPresentation(line: QueueMemberLine, selectedRunId?: string) {
  if (line.kind === "record") return { key: line.key, title: line.member.title, status: line.member.status,
    statusLabel: line.member.statusLabel, statusAccessibleLabel: line.member.statusLabel, paused: false, buttonTitle: line.member.title,
    accessibleName: `${line.member.title} ${line.member.statusLabel.toLowerCase()}`, native: undefined };
  const item = line.item;
  const surface = item.attempts.find(attempt => attempt.runId === selectedRunId) ?? item.representative;
  const pause = queuePauseLabel(surface), status = dsStatusOf(surface.status), title = queueRowTitle(surface);
  return { key: String(surface.runId), title, status: surface.status, paused: pause === "Paused",
    statusLabel: pause ?? surface.outcome?.label ?? statusText(status), statusAccessibleLabel: pause ?? surface.outcome?.label ?? statusAccessibleName(status), buttonTitle: surface.subtitle.state === "present" ? surface.subtitle.value : surface.subtitle.reason,
    accessibleName: `${title} ${surface.subtitle.state === "present" ? surface.subtitle.value : (pause ?? statusAccessibleName(status)).toLowerCase()}`,
    native: { surface, item } };
}

export function queueMemberRollup(surface: OperationSurfaceWire, members: readonly QueueSurfaceWire[]) {
  if (surface.recordMembers === undefined) return surface.memberRollup;
  const statuses = queueMemberLines(surface, members).map(line => line.kind === "run" ? line.item.representative.status : line.member.status);
  return { total: statuses.length, terminal: statuses.filter(status => ["done", "failed", "cancelled", "partial"].includes(status)).length,
    failed: statuses.filter(status => status === "failed").length };
}

export type QueueKeyboardEntry = Readonly<{ key: string; status: QueueSurfaceWire["status"] } & (
  { kind: "run"; runId: string } | { kind: "record"; member: QueueRecordMember })>;

/* ── the panel ───────────────────────────────────────────────────────────── */

/** Inline and hidden children remain within their parent even when that parent is unloaded. */
export function partition(surfaces: readonly QueueSurfaceWire[]): {
  top: QueueSurfaceWire[];
  membersOf: Map<string, QueueSurfaceWire[]>;
} {
  const byRunId = new Map<string, QueueSurfaceWire>();
  for (const surface of surfaces) {
    if (isQueueMember(surface)) byRunId.set(surface.runId, surface);
  }
  const membersOf = new Map<string, QueueSurfaceWire[]>();
  for (const surface of surfaces) {
    if (surface.surfaceKind !== "operation") continue;
    const members: QueueSurfaceWire[] = [];
    for (const runId of surface.memberRunIds) {
      const member = byRunId.get(runId);
      if (member === undefined) continue;
      if (member.parent?.runId !== surface.runId) throw new Error("queue-member-parent-mismatch");
      members.push(member);
    }
    membersOf.set(surface.runId, members);
  }
  const top = surfaces.filter(isQueueTopLevel);
  return { top, membersOf };
}

export function queueScopeWorkflow(selected: QueueSurfaceWire, surfaces: readonly QueueSurfaceWire[]): string {
  const rows = new Map(surfaces.map(row => [row.runId, row]));
  const visited = new Set<string>();
  let current = selected;
  while (current.parent !== null && current.parent.visibility !== "linked") {
    if (visited.has(current.runId)) throw new Error("queue-parent-cycle");
    visited.add(current.runId);
    const parent = rows.get(current.parent.runId);
    if (parent === undefined) return current.parent.workflowId;
    current = parent;
  }
  return current.workflowId;
}

/** Keyboard traversal follows drawn rows, including expanded members. */
export function queueKeyboardEntries(
  surfaces: readonly QueueSurfaceWire[], sort: QueueSortKey = "attention", nowIso: string = new Date(0).toISOString(),
): readonly QueueKeyboardEntry[] {
  const { top, membersOf } = partition(surfaces);
  const { displayTop, itemByRunId } = queueItemLayout(top);
  const entries: QueueKeyboardEntry[] = [];
  const append = (surface: QueueSurfaceWire, item: QueueItemGroup): void => {
    entries.push(...item.attempts.toReversed().map(attempt => ({ kind: "run" as const, key: String(attempt.runId),
      runId: String(attempt.runId), status: item.representative.status })));
    if (surface.surfaceKind !== "operation") return;
    for (const line of queueMemberLines(surface, membersOf.get(surface.runId) ?? [])) {
      if (line.kind === "run") append(line.item.representative, line.item);
      else entries.push({ kind: "record", key: line.key, member: line.member, status: line.member.status });
    }
  };
  for (const group of queueDisplayGroups(displayTop, sort, nowIso)) for (const surface of group.rows) {
    const item = itemByRunId.get(String(surface.runId));
    if (item === undefined) throw new Error(`queue keyboard order lost item ${String(surface.itemId)}`);
    append(surface, item);
  }
  return entries;
}

export function visibleQueueKeys(surfaces: readonly QueueSurfaceWire[], sort: QueueSortKey = "attention", nowIso: string = new Date(0).toISOString()): readonly string[] {
  return queueKeyboardEntries(surfaces, sort, nowIso).map(entry => entry.key);
}

/** Attention shortcuts use the same visible order and bands as the queue. */
export function attentionQueueKeys(surfaces: readonly QueueSurfaceWire[], sort: QueueSortKey = "attention", nowIso: string = new Date(0).toISOString()): readonly string[] {
  return queueKeyboardEntries(surfaces, sort, nowIso).filter(entry => bandOf(dsStatusOf(entry.status)) === "attention").map(entry => entry.key);
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
    if (row.parent !== null || row.surfaceKind === "operation" || row.session.state !== "present" || row.session.presentation === undefined) continue;
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
