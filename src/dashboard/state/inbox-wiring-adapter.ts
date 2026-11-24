import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { attemptUnresolved } from "../app/commands/command-outcome.js";
import type { DashboardCommandBinding } from "../app/dashboard-app-model.js";
import type { DashboardClient } from "../client/index.js";
import { NotificationWireSchema, type NotificationWire } from "../../models/dashboard/projection.js";
import type { NotificationArrival } from "../../models/dashboard/subscription.js";
import type { HeldNotificationStatus } from "../client/subscriptions/row-store.js";
import type { NotificationCollectionTarget } from "../../models/notifications/notifications.js";
import type { NotificationTarget } from "../../models/notifications/notification-target.js";
import type { NotificationTriggerEvent } from "../../rules/notifications/notification-triggers.js";
import { NotificationCommandRequestSchema } from "../../rules/commands/commands.js";
import { ERROR_CATALOG, createErrorCatalogFailure, formatErrorCatalogFailure, shortFailureText } from "../../models/failures/error-catalog.js";
import { verifyShellCommandEffect } from "../app/commands/command-dispatch.js";
import { notificationAge, type NotificationControl, type NotificationDestination, type NotificationItem, type NotificationsState } from "../surfaces/notifications/notifications-view-model.js";
import { formatLocalDay, formatMonthDay, formatWeekday } from "../lib/date-format.js";

const policies = {
  "run-failed": { trigger: "failed", tone: "danger", detail: "Review the failed run before continuing." },
  "subject-mismatch": { trigger: "failed", tone: "danger", detail: "The subject identity did not match." },
  "gate-opened": { trigger: "gate-waiting", tone: "warning", detail: "This run is waiting for your review." },
  "write-parked": { trigger: "write-parked", tone: "warning", detail: "A write is parked." },
  "repeating-failure": { trigger: "repeating", tone: "danger", detail: "This failure keeps repeating." },
  "storage-degraded": { trigger: "storage", tone: "warning", detail: "Relay could not save everything." },
  "verified-done": { trigger: "verified-done", tone: "positive", detail: "Completed with the required verification evidence." },
  "backfill-gap": { trigger: "backfill-gap", tone: "warning", detail: "Notification history is incomplete. Reconcile the affected work." },
  "command-refused": { trigger: "command", tone: "warning", detail: "Relay did not do this, so nothing changed." },
  "command-unknown": { trigger: "command", tone: "danger", detail: "Relay could not confirm whether this finished. Open it to check before trying again." },
  "bulk-incomplete": { trigger: "command", tone: "warning", detail: "Some items in this batch were not done. Open it to see each one." },
} as const satisfies Readonly<Record<NotificationTriggerEvent["kind"], { trigger: string; tone: NotificationItem["tone"]; detail: string }>>;

export const inboxMessage = (code: "DASHBOARD_READ_FAILED" | "NOTIFICATION_SOURCE_UNAVAILABLE" | "NOTIFICATION_HISTORY_INCOMPLETE" | "NOTIFICATION_OBSERVATION_FAILED" | "NOTIFICATION_RECEIPT_MISSING" | "NOTIFICATION_COMMAND_PENDING" | "NOTIFICATION_TARGET_UNAVAILABLE" | "NOTIFICATION_REFRESH_PENDING") => formatErrorCatalogFailure(createErrorCatalogFailure(code, {})).text;

export function notificationPolicy(row: NotificationWire) {
  const source = row.sourceEvent;
  const policy = source?.state === "available" ? Object.entries(policies).find(([kind]) => kind === source.kind)?.[1] : undefined;
  const trigger = row.kind === "backfill-gap" ? "backfill-gap" : row.kind === "command" ? "command" : row.trigger;
  return policy?.trigger === trigger ? policy : undefined;
}

export function notificationTargetMatches(row: NotificationWire, target: NotificationTarget): boolean {
  if (row.kind === "command") {
    const link = row.link;
    if (target.kind === "recovery" && link.kind === "recovery") return link.commandId === target.commandId;
    if (target.kind === "command-result" && (link.kind === "command-result" || link.kind === "recovery")) return link.commandId === target.commandId;
    if (target.kind === "bulk-result" && link.kind === "bulk-result") return link.bulkCommandId === target.bulkCommandId;
    return false;
  }
  if (row.kind !== "notification") return false;
  const link = row.link;
  if (target.kind === "storage") return link?.kind === "storage";
  // The server sends a delegated run to its host run and names the linked run beside it.
  if (target.kind === "run") return target.linkedRunId === undefined ? link?.kind === "run" && link.runId === target.runId
    : (link?.kind === "run" || link?.kind === "failure") && link.runId === target.linkedRunId;
  if (target.kind === "failure") return link?.kind === "failure" && link.runId === target.runId && link.failureId === target.failureId;
  return false;
}

const PACIFIC = "America/Los_Angeles";
const pacificDay = (value: Date) => Date.parse(`${formatLocalDay(value, PACIFIC)}T00:00:00Z`);
/** Day group once out of Priority, by the Pacific day whatever the host zone: Today, Yesterday, the weekday within a week, else the date. */
export function notificationDay(occurredAt: string, nowIso: string): string {
  const when = new Date(occurredAt), ago = Math.round((pacificDay(new Date(nowIso)) - pacificDay(when)) / 86_400_000);
  return ago <= 0 ? "Today" : ago === 1 ? "Yesterday" : ago < 7 ? formatWeekday(when, PACIFIC, "long") : formatMonthDay(when, PACIFIC, "long");
}

function notificationDetail(row: Exclude<NotificationWire, { kind: "backfill-gap" }>): string | undefined {
  if (row.kind === "command") return row.summary;
  const source = row.sourceEvent;
  if (row.summary !== undefined && (source?.state === "available" ? source.kind === "run-failed"
    : row.trigger === "failed" && Object.values(ERROR_CATALOG).some(entry => shortFailureText(entry.text) === row.summary))) return row.summary;
  return notificationPolicy(row)?.detail;
}

type ListedRow = Exclude<NotificationWire, { kind: "backfill-gap" }>;
const linkedRun = (row: ListedRow) => row.kind === "notification" && row.link !== undefined && "runId" in row.link ? row.link.runId : undefined;
const repeatingNotice = (row: ListedRow) => row.kind === "notification" && row.trigger === "repeating";
const historyKey = (row: ListedRow, key: string) => row.readOnlyHistory === true ? `history\u0000${key}` : key;

/** Repeats fold into one item. A failure repeats across runs: the same workflow, person and failure text. Every other event repeats
 * for one run, or for storage. */
function foldKey(row: ListedRow): string | undefined {
  if (row.kind !== "notification" || row.link === undefined) return undefined;
  if (row.link.kind === "storage") return `${row.trigger}\u0000${row.title}\u0000storage`;
  if (row.trigger === "failed" && row.context.state === "available") return `failed\u0000${row.title}\u0000${row.context.workflow}\u0000${row.context.subject}\u0000${notificationDetail(row) ?? ""}`;
  return `${row.trigger}\u0000${row.title}\u0000${row.link.runId}`;
}

/** The rows each item stands for, newest item first; an item shows its first row. A "Repeating failure" notice joins the failure of
 * the run it names instead of standing beside it. */
export function foldRows(served: readonly NotificationWire[]): readonly (readonly ListedRow[])[] {
  const rows = served.flatMap(row => row.kind === "backfill-gap" ? [] : [row]);
  const failures = new Map<string, string>();
  for (const row of rows) {
    const run = linkedRun(row), key = foldKey(row);
    if (run !== undefined && key !== undefined && row.kind === "notification" && row.trigger === "failed") failures.set(historyKey(row, run), key);
  }
  const byKey = new Map<string, ListedRow[]>(), groups: ListedRow[][] = [];
  for (const row of rows.sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))) {
    const run = linkedRun(row);
    const fold = (repeatingNotice(row) && run !== undefined ? failures.get(historyKey(row, run)) : undefined) ?? foldKey(row);
    const key = fold === undefined ? undefined : historyKey(row, fold);
    const group = key === undefined ? undefined : byKey.get(key);
    if (group === undefined) { const made = [row]; if (key !== undefined) byKey.set(key, made); groups.push(made); }
    else if (repeatingNotice(group[0]) && !repeatingNotice(row)) group.unshift(row);
    else group.push(row);
  }
  return groups;
}

function notificationItem(row: Exclude<NotificationWire, { kind: "backfill-gap" }>, nowIso: string): NotificationItem {
  const policy = notificationPolicy(row);
  const context = row.context;
  const command = row.kind === "command";
  const tone = policy?.tone ?? (row.severity === "error" ? "danger" : row.severity === "warning" ? "warning" : "info");
  return { id: row.notificationId, title: row.title, tone,
      kind: command ? "command" as const : row.link?.kind === "storage" ? "storage" as const : "run" as const,
      // Notices the server marks as commands carry their own priority; error and warning notices still need the operator.
      priority: command ? row.priority : tone === "danger" || tone === "warning",
      subject: context.state === "available" ? context.subject : "",
      workflow: context.state === "available" || context.state === "workflow-only" ? context.workflow : "",
      detail: notificationDetail(row) ?? "",
      ...(row.kind === "notification" && row.count > 1 ? { count: row.count } : {}),
      age: notificationAge(row.occurredAt, nowIso), at: row.occurredAt,
      day: notificationDay(row.occurredAt, nowIso),
      ...(row.readOnlyHistory === true ? { readOnlyHistory: true } : {}),
      read: row.readState === "read", action: command ? "Open" : row.link?.kind === "storage" ? "" : "Open log",
      destination: { kind: "refused", reason: "target-unavailable" },
    };
}

/** Whether a row was cleared at or after the revision it is listed at; a newer revision is a repeat and lists again. */
const clearedRow = (row: NotificationWire, cleared: ReadonlyMap<string, number>) => {
  const at = cleared.get(row.notificationId);
  return at !== undefined && row.kind !== "backfill-gap" && row.revision <= at;
};

export function inboxProjection(rows: readonly NotificationWire[], nowIso: string, gone: ReadonlySet<string> = new Set(), cleared: ReadonlyMap<string, number> = new Map()): { state: NotificationsState; notice: string; needsYou: number } {
  const notice = rows.some(row => row.kind === "backfill-gap") ? inboxMessage("NOTIFICATION_HISTORY_INCOMPLETE") : "";
  const items = foldRows(rows.filter(row => !clearedRow(row, cleared))).map((group): NotificationItem => {
    const shown = notificationItem(group[0], nowIso);
    // A repeating notice says the failure repeats; it is not one more failure.
    const counted = group.filter(row => row === group[0] || !repeatingNotice(row)).reduce((sum, row) => sum + (row.kind === "notification" ? row.count : 1), 0);
    return { ...shown, read: group.every(row => row.readState === "read"), ...(counted > 1 ? { count: counted } : {}), ...(group.some(row => gone.has(row.notificationId)) ? { gone: true } : {}),
      ...(group.some(row => row.kind === "notification" && row.standing === true) ? { standing: true as const } : {}) };
  });
  const needsYou = items.filter(item => !item.read && (item.tone === "danger" || item.tone === "warning")).length;
  return { state: { state: "ready", items, pinned: [] }, notice, needsYou };
}

export type InboxArrival = Readonly<{ sourceId: string; item: NotificationItem }>;

export interface InboxWiring {
  readonly state: NotificationsState;
  readonly notice: string;
  control(id: string, action: NotificationControl | "snooze" | "unsnooze"): Promise<boolean>;
  /** Whether the item's controls may act now: a served row is display-only until its rows and status are current. */
  canAct(id: string): boolean;
  readAll(): Promise<void>;
  /** Clears the item and every row it stands for; the item leaves at once and comes back if Relay refuses. */
  clear(id: string): Promise<boolean>;
  /** Clears every clearable item the tab lists; standing and history items stay. */
  clearAll(show: "all" | "unread"): Promise<boolean>;
  /** Delivers each distinct publication once, as the item it adds; snapshots never deliver. */
  onPublication(listener: (arrival: InboxArrival) => void): () => void;
  open(item: NotificationItem, navigate: (target: NotificationDestination, opened: () => void, refused: (message: string) => void) => void, opened: () => void, refused: (message: string) => void): void;
}

/** Each durable notification a listed row stands for, with its revision: a storage group stands for its members. */
function memberRevisions(row: NotificationWire): ReadonlyMap<string, number> {
  if (row.kind === "notification" && row.group !== undefined) return new Map(row.group.members.map(member => [member.notificationId, member.revision]));
  return new Map([[row.notificationId, row.kind === "backfill-gap" ? 0 : row.revision]]);
}

/** Whether a listed row is ahead of the held rows: newer for one of its notifications, or holding one they lack, and older for none. */
function listedAhead(rows: readonly NotificationWire[], listed: NotificationWire): boolean {
  const held = new Map(rows.flatMap(row => [...memberRevisions(row)]));
  const entries = [...memberRevisions(listed)];
  return entries.some(([id, revision]) => (held.get(id) ?? -1) < revision) && entries.every(([id, revision]) => (held.get(id) ?? -1) <= revision);
}

/** Puts a listed row in place of every held row it stands for, when it is ahead of them; otherwise the held rows stand. */
export function upsertListedRow(rows: readonly NotificationWire[], listed: NotificationWire): readonly NotificationWire[] {
  const incoming = memberRevisions(listed);
  const covered = rows.filter(row => [...memberRevisions(row).keys()].some(id => incoming.has(id)));
  if (!listedAhead(covered, listed)) return rows;
  return [...rows.filter(row => !covered.includes(row)), listed];
}

/** A row the inbox holds over its day. A publication's row stands while the day is the snapshot the stream held when it arrived,
 * since the stream's next snapshot carries it; a command readback stands while it is ahead of the day's rows, since the stream may
 * deliver a snapshot frozen before the command. */
type Overlay = Readonly<{ row: NotificationWire } & ({ source: "publication"; snapshotCursor: string } | { source: "readback" })>;

/** The overlays that still stand over this day's rows. */
export function standingOverlays(overlays: readonly Overlay[], day: Readonly<{ rows: readonly NotificationWire[]; snapshotCursor: string }> | undefined): readonly Overlay[] {
  return overlays.filter(overlay => overlay.source === "publication" ? overlay.snapshotCursor === day?.snapshotCursor
    : day === undefined || listedAhead(day.rows, overlay.row));
}

const NO_UPSERTS: readonly Overlay[] = Object.freeze([]);
const noStatus = (): HeldNotificationStatus | undefined => undefined;

/** The inbox's rows come from the day it holds and the publications and command readbacks since; its status comes from the stream's row. */
export function useInboxWiring({ client, enabled, binding }: { client: DashboardClient; enabled: boolean; binding: DashboardCommandBinding }): InboxWiring {
  const dayState = binding.authority.dayState;
  // Commands run in the app's active scope; the inbox's own rows are keyed by the day stream it reads, which may be another day's.
  const request = useMemo(() => ({ client, enabled, scope: binding.scope, dayRequest: dayState.request }), [client, enabled, binding.scope, dayState.request]);
  const store = dayState.rows;
  const status = useSyncExternalStore(listener => store.subscribe(listener), () => store.notificationStatus(), noStatus);
  const day = dayState.day;
  const frame = day.state === "loaded" ? day.value : day.state === "loading" ? day.kept?.value : undefined;
  const dayRows = frame?.notifications;
  const dayView = useMemo(() => frame === undefined ? undefined : { rows: frame.notifications, snapshotCursor: frame.snapshotCursor }, [frame]);
  const [upserts, setUpserts] = useState<{ request: typeof request; overlays: readonly Overlay[] }>();
  const [commandNotice, setCommandNotice] = useState<{ request: typeof request; text: string }>();
  const [publicationNotice, setPublicationNotice] = useState<{ request: typeof request; text: string }>();
  /** Items whose run the server answered as deleted when the operator opened them. */
  const [gone, setGone] = useState<{ request: typeof request; ids: ReadonlySet<string> }>();
  /** Rows the person cleared, at the revision they were listed at; a refused clear takes its rows back out. */
  const [cleared, setCleared] = useState<{ request: typeof request; ids: ReadonlyMap<string, number> }>();
  const clearedIds = cleared?.request === request ? cleared.ids : undefined;
  const clearedRef = useRef(clearedIds); clearedRef.current = clearedIds;
  const held = upserts?.request === request ? upserts.overlays : NO_UPSERTS;
  const rows = useMemo(() => dayRows === undefined ? undefined
    : standingOverlays(held, dayView).reduce<readonly NotificationWire[]>((next, overlay) => upsertListedRow(next, overlay.row), dayRows), [dayRows, dayView, held]);
  const consistent = rows !== undefined && rows.every(row => row.actorId === request.scope.actorId) && new Set(rows.map(row => row.notificationId)).size === rows.length;
  // Controls act only on rows read with a status the stream has delivered as available.
  const usable = enabled && consistent && status !== undefined && !status.unavailable;
  const current = useRef({ request, binding, usable }); current.current = { request, binding, usable };
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const dayRowsRef = useRef(dayRows); dayRowsRef.current = dayRows;
  /** Adds rows over the day. A publication drops those of older snapshots, and a readback drops those the last rendered rows caught up
   * with; the render filters the rest, since a snapshot delivered with this row may not have rendered yet. */
  const overlay = useCallback((listed: readonly NotificationWire[], arrived: Readonly<{ source: "publication"; snapshotCursor: string }> | Readonly<{ source: "readback" }>): void => {
    const rendered = dayRowsRef.current;
    rowsRef.current = listed.reduce<readonly NotificationWire[]>(upsertListedRow, rowsRef.current ?? []);
    setUpserts(previous => ({ request, overlays: [...(previous?.request === request ? previous.overlays : NO_UPSERTS).filter(held => held.source === "publication"
      ? arrived.source === "readback" || held.snapshotCursor === arrived.snapshotCursor
      : rendered === undefined || listedAhead(rendered, held.row)),
    ...listed.map(row => ({ row, ...arrived }))] }));
  }, [request]);
  const subscribePublications = dayState.subscribePublications;
  const arrivalListeners = useRef(new Set<(arrival: InboxArrival) => void>());
  useEffect(() => {
    if (!enabled) return;
    const delivered = new Set<string>();
    return subscribePublications(({ publication, listed, target, snapshotCursor }: NotificationArrival) => {
      if (current.current.request !== request || publication.actorId !== request.scope.actorId || delivered.has(publication.sourceId)) return;
      delivered.add(publication.sourceId);
      overlay([listed], { source: "publication", snapshotCursor });
      const row = publication.notification;
      if (row.kind === "backfill-gap") { setPublicationNotice({ request, text: inboxMessage("NOTIFICATION_HISTORY_INCOMPLETE") }); return; }
      if (row.state === "snoozed") return;
      const arrival = { sourceId: publication.sourceId, item: notificationItem(row, current.current.binding.authority.now()) };
      for (const listener of arrivalListeners.current) listener(arrival);
      if (!notificationTargetMatches(row, target)) setPublicationNotice({ request, text: inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE") });
    });
  }, [enabled, request, subscribePublications, overlay]);
  const hide = (entries: readonly (readonly [string, number])[]) => {
    clearedRef.current = new Map([...(clearedRef.current ?? []), ...entries]);
    setCleared({ request, ids: clearedRef.current });
  };
  const unhide = (entries: readonly (readonly [string, number])[]) => {
    const ids = new Set(entries.map(([id]) => id));
    clearedRef.current = new Map([...(clearedRef.current ?? [])].filter(([id]) => !ids.has(id)));
    setCleared({ request, ids: clearedRef.current });
  };
  /** An unresolved notification command of this actor, for any of these rows or for any row when none are named. */
  const heldAttempt = (ids?: ReadonlySet<string>) => current.current.binding.executor.retainedAttempts().find(attempt => !("targets" in attempt.request) && attempt.request.family === "notification"
    && attempt.request.target.actorId === request.scope.actorId && attemptUnresolved(attempt)
    && (ids === undefined || ("members" in attempt.request.target ? attempt.request.target.members.some(entry => ids.has(entry.notificationId)) : ids.has(attempt.request.target.notificationId))));
  /** Each durable row a listed row stands for, at its listed revision. */
  const durableRows = (row: NotificationWire): readonly (readonly [string, number])[] => row.kind === "backfill-gap" ? []
    : row.kind === "notification" && row.group !== undefined ? row.group.members.map(member => [member.notificationId, member.revision] as const) : [[row.notificationId, row.revision] as const];
  const clearable = (row: NotificationWire) => row.kind !== "backfill-gap" && row.readOnlyHistory !== true && !(row.kind === "notification" && row.standing === true);
  const control = async (id: string, action: NotificationControl | "snooze" | "unsnooze"): Promise<boolean> => {
    if (!enabled || current.current.request !== request || !current.current.usable) return false;
    const row = rowsRef.current?.find(row => row.notificationId === id);
    if (row?.kind !== "notification" || row.actorId !== request.scope.actorId) { setCommandNotice({ request, text: inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE") }); return false; }
    if (row.readOnlyHistory === true) return false;
    const owner = current.current.binding;
    // Marking an item read marks every unread row it stands for.
    const group = action === "read" ? foldRows(rowsRef.current ?? []).find(members => members.includes(row)) ?? [] : [];
    const repeats = group.flatMap(other => other.kind === "notification" && other !== row && other.readState !== "read" ? [{ notificationId: other.notificationId, revision: other.revision }] : []);
    const members = [...(row.group?.members ?? [{ notificationId: id, revision: row.revision }]), ...repeats];
    for (const member of members) {
      const retained = owner.executor.retainedAttempts().find(attempt => !("targets" in attempt.request) && attempt.request.family === "notification"
        && ("members" in attempt.request.target ? attempt.request.target.members.some(entry => entry.notificationId === member.notificationId) : attempt.request.target.notificationId === member.notificationId) && attempt.request.target.actorId === request.scope.actorId
        && attemptUnresolved(attempt));
      if (retained !== undefined) { setCommandNotice({ request, text: retained.outcome !== undefined && "feedback" in retained.outcome ? retained.outcome.feedback.text : inboxMessage("NOTIFICATION_COMMAND_PENDING") }); return false; }
    }
    setCommandNotice({ request, text: inboxMessage("NOTIFICATION_COMMAND_PENDING") });
    let outcome: Awaited<ReturnType<typeof owner.executor.execute>> | undefined;
    // A group acts on every durable member it holds; each confirmed readback replaces the rows it stands for.
    for (const member of members) {
      const command = NotificationCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: owner.authority.now(), requestedBy: request.scope.actorId,
        source: "dashboard", family: "notification", type: `notification-${action}`, target: { notificationId: member.notificationId, actorId: request.scope.actorId, expectedVersion: member.revision } });
      outcome = await owner.executor.execute(command, { scope: owner.scope, readback: (request, reply) => verifyShellCommandEffect(client, owner.authority.day, request, reply),
        publish: outcome => {
          if (current.current.request !== request) return;
          if (outcome.kind === "confirmed") {
            overlay([NotificationWireSchema.parse(outcome.readback)], { source: "readback" });
            setCommandNotice({ request, text: "" });
          }
          else {
            setCommandNotice({ request, text: outcome.feedback.text }); owner.feedback(outcome);
            // The held row is older than the server's; only a new day snapshot carries the current one.
            if (outcome.kind === "conflict") dayState.refresh();
          }
        } });
      if (outcome.kind !== "confirmed") break;
    }
    if (outcome === undefined) return false;
    // A command that settles after the inbox moved to another day of the same authority leaves that day's rows behind it.
    const replacement = current.current;
    if (replacement.request !== request && replacement.request.enabled && replacement.request.client === client
      && replacement.binding.scope.client === owner.scope.client && replacement.binding.scope.actorId === owner.scope.actorId
      && replacement.binding.scope.authority === owner.scope.authority) replacement.binding.authority.dayState.refresh();
    return current.current.request === request && outcome.kind === "confirmed";
  };
  const statusNotice = !consistent ? inboxMessage("DASHBOARD_READ_FAILED") : status === undefined ? ""
    : status.unavailable ? inboxMessage("DASHBOARD_READ_FAILED")
    : status.status !== undefined && status.status.state !== "ready" ? inboxMessage(status.status.code ?? "NOTIFICATION_OBSERVATION_FAILED") : "";
  const projection = rows === undefined
    ? { state: day.state === "failed" ? { state: "unavailable" as const, reason: inboxMessage("DASHBOARD_READ_FAILED") } : { state: "loading" as const }, notice: "" }
    : !consistent ? { state: { state: "unavailable" as const, reason: statusNotice }, notice: "" }
    : inboxProjection(rows, binding.authority.now(), gone?.request === request ? gone.ids : undefined, clearedIds);
  const pending = enabled && consistent && status === undefined ? inboxMessage("NOTIFICATION_REFRESH_PENDING") : "";
  return { state: projection.state, notice: [pending, projection.notice, enabled ? statusNotice : "", commandNotice?.request === request ? commandNotice.text : "", publicationNotice?.request === request ? publicationNotice.text : ""].filter(Boolean).join(" "),
    control,
    canAct: () => usable,
    clear: async id => {
      if (!enabled || current.current.request !== request || !current.current.usable) return false;
      const listed = rowsRef.current ?? [];
      const row = listed.find(row => row.notificationId === id);
      if (row === undefined || row.kind === "backfill-gap" || row.actorId !== request.scope.actorId) { setCommandNotice({ request, text: inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE") }); return false; }
      // Clearing an item clears every row it stands for: its repeats and a storage group's members.
      const group = foldRows(listed).find(members => members.includes(row)) ?? [row];
      if (!group.every(clearable)) return false;
      const members = group.flatMap(durableRows);
      if (heldAttempt(new Set(members.map(([memberId]) => memberId))) !== undefined) { setCommandNotice({ request, text: inboxMessage("NOTIFICATION_COMMAND_PENDING") }); return false; }
      const owner = current.current.binding;
      hide(members);
      for (const [index, [notificationId, revision]] of members.entries()) {
        const command = NotificationCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: owner.authority.now(), requestedBy: request.scope.actorId,
          source: "dashboard", family: "notification", type: "notification-clear", target: { notificationId, actorId: request.scope.actorId, expectedVersion: revision } });
        const outcome = await owner.executor.execute(command, { scope: owner.scope, readback: (request, reply) => verifyShellCommandEffect(client, owner.authority.day, request, reply),
          publish: outcome => {
            if (current.current.request !== request || outcome.kind === "confirmed") return;
            owner.feedback(outcome);
            if (outcome.kind === "conflict") dayState.refresh();
          } });
        if (outcome.kind !== "confirmed") { if (current.current.request === request) unhide(members.slice(index)); return false; }
      }
      return current.current.request === request;
    },
    clearAll: async show => {
      if (!enabled || current.current.request !== request || !current.current.usable || client.notificationCollection === undefined) return false;
      if (heldAttempt() !== undefined) { setCommandNotice({ request, text: inboxMessage("NOTIFICATION_COMMAND_PENDING") }); return false; }
      const listed = (rowsRef.current ?? []).filter(row => clearable(row) && (show === "all" || (row.kind !== "backfill-gap" && row.readState === "unread")));
      const entries = listed.flatMap(durableRows).filter(([id, revision]) => (clearedRef.current?.get(id) ?? -1) < revision);
      const owner = current.current.binding;
      hide(entries);
      let target: NotificationCollectionTarget;
      try { target = await client.notificationCollection(show === "all" ? "clear" : "clear-unread"); }
      catch { if (current.current.request === request) { unhide(entries); setCommandNotice({ request, text: inboxMessage("NOTIFICATION_SOURCE_UNAVAILABLE") }); } return false; }
      if (current.current.request !== request) return false;
      if (!current.current.usable || heldAttempt() !== undefined || target.actorId !== request.scope.actorId) { unhide(entries); return false; }
      const command = NotificationCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: owner.authority.now(), requestedBy: request.scope.actorId,
        source: "dashboard", family: "notification", type: show === "all" ? "notification-clear-all" : "notification-clear-unread-all", target });
      const outcome = await owner.executor.execute(command, { scope: owner.scope, readback: (request, reply) => verifyShellCommandEffect(client, owner.authority.day, request, reply),
        publish: outcome => { if (current.current.request === request && outcome.kind !== "confirmed") owner.feedback(outcome); } });
      if (outcome.kind !== "confirmed") { if (current.current.request === request) unhide(entries); return false; }
      return current.current.request === request;
    },
    onPublication: listener => { arrivalListeners.current.add(listener); return () => { arrivalListeners.current.delete(listener); }; },
    readAll: async () => {
      if (!enabled || current.current.request !== request || !current.current.usable || client.notificationCollection === undefined) return;
      const owner = current.current.binding;
      if (heldAttempt() !== undefined) { setCommandNotice({ request, text: inboxMessage("NOTIFICATION_COMMAND_PENDING") }); return; }
      let target: NotificationCollectionTarget;
      try { target = await client.notificationCollection("read"); }
      catch { if (current.current.request === request) setCommandNotice({ request, text: inboxMessage("NOTIFICATION_SOURCE_UNAVAILABLE") }); return; }
      if (current.current.request !== request || !current.current.usable || heldAttempt() !== undefined || target.actorId !== request.scope.actorId) return;
      const command = NotificationCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: owner.authority.now(),
        requestedBy: request.scope.actorId, source: "dashboard", family: "notification", type: "notification-read-all", target });
      setCommandNotice({ request, text: inboxMessage("NOTIFICATION_COMMAND_PENDING") });
      await owner.executor.execute(command, { scope: owner.scope,
        readback: (request, reply) => verifyShellCommandEffect(client, owner.authority.day, request, reply),
        publish: outcome => {
          if (current.current.request !== request) return;
          if (outcome.kind === "confirmed") {
            overlay(NotificationWireSchema.array().parse(outcome.readback), { source: "readback" });
            setCommandNotice({ request, text: "" });
          } else { setCommandNotice({ request, text: outcome.feedback.text }); owner.feedback(outcome); }
        } });
    },
    open: (item, navigate, opened, refused) => {
      if (!enabled || current.current.request !== request || !current.current.usable) return;
      void client.notificationTarget(item.id).then(target => {
        if (current.current.request !== request || !current.current.usable) return;
        const row = rowsRef.current?.find(row => row.notificationId === item.id);
        if (row !== undefined && target.kind === "refused" && (target.reason === "run-unavailable" || target.reason === "failure-unavailable")) {
          setGone(previous => ({ request, ids: new Set([...(previous?.request === request ? previous.ids : []), item.id]) }));
          return;
        }
        if (row === undefined || (target.kind !== "refused" && target.kind !== "archive" && !notificationTargetMatches(row, target))) { refused(inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE")); return; }
        navigate(target, () => { if (current.current.request !== request) return; opened(); if (row.kind === "notification" && !item.read) void control(item.id, "read"); }, refused);
      }).catch(() => { if (current.current.request === request) refused(inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE")); });
    },
  };
}
