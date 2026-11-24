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
import { ERROR_CATALOG, createErrorCatalogFailure, formatErrorCatalogFailure } from "../../models/failures/error-catalog.js";
import { verifyShellCommandEffect } from "../app/commands/command-dispatch.js";
import { notificationAge, type NotificationControl, type NotificationDestination, type NotificationItem, type NotificationsState } from "../surfaces/notifications/notifications-view-model.js";
import { formatLocalDay, formatMonthDay, formatWeekday } from "../lib/date-format.js";

const policies = {
  "run-failed": { trigger: "failed", tone: "danger", detail: "Review the failed run before continuing." },
  "subject-mismatch": { trigger: "failed", tone: "danger", detail: "The subject identity did not match. Review the failure before continuing." },
  "gate-opened": { trigger: "gate-waiting", tone: "warning", detail: "This run is waiting for your review." },
  "write-parked": { trigger: "write-parked", tone: "warning", detail: "A write is parked. Review its evidence before continuing." },
  "repeating-failure": { trigger: "repeating", tone: "danger", detail: "A failure crossed its repetition threshold. Review the failure." },
  "storage-degraded": { trigger: "storage", tone: "warning", detail: "Relay could not save everything. Reopen Relay before starting more work." },
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
  if (target.kind === "run") return link?.kind === "run" && link.runId === target.runId;
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
    : row.trigger === "failed" && Object.values(ERROR_CATALOG).some(entry => entry.text === row.summary))) return row.summary;
  return notificationPolicy(row)?.detail;
}

/** Repeats of one event for one run (or for storage) fold into one item: its latest time, unread while any repeat is unread, the sum of its counts. */
function foldKey(row: Exclude<NotificationWire, { kind: "backfill-gap" }>): string | undefined {
  if (row.kind !== "notification" || row.link === undefined) return undefined;
  const subject = row.link.kind === "storage" ? "storage" : "runId" in row.link ? row.link.runId : undefined;
  return subject === undefined ? undefined : `${row.trigger}\u0000${row.title}\u0000${subject}`;
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
      read: row.readState === "read", action: command ? "Open" : row.link?.kind === "storage" ? "" : "Open log",
      destination: { kind: "refused", reason: "target-unavailable" },
    };
}

export function inboxProjection(rows: readonly NotificationWire[], nowIso: string): { state: NotificationsState; notice: string; needsYou: number } {
  const notices = new Set<string>();
  const items: NotificationItem[] = [];
  const folded = new Map<string, number>();
  const newestFirst = [...rows].sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));
  for (const row of newestFirst) {
    if (row.kind === "backfill-gap") { notices.add(inboxMessage("NOTIFICATION_HISTORY_INCOMPLETE")); continue; }
    const item = notificationItem(row, nowIso), key = foldKey(row);
    const at = key === undefined ? undefined : folded.get(key);
    if (at === undefined) { if (key !== undefined) folded.set(key, items.length); items.push(item); continue; }
    const kept = items[at];
    items[at] = { ...kept, read: kept.read && item.read, count: (kept.count ?? 1) + (item.count ?? 1) };
  }
  const needsYou = items.filter(item => !item.read && (item.tone === "danger" || item.tone === "warning")).length;
  return { state: { state: "ready", items, pinned: [] }, notice: [...notices].join(" "), needsYou };
}

export type InboxArrival = Readonly<{ sourceId: string; item: NotificationItem }>;

export interface InboxWiring {
  readonly state: NotificationsState;
  readonly notice: string;
  control(id: string, action: NotificationControl | "snooze" | "unsnooze"): Promise<boolean>;
  /** Whether the item's controls may act now: a served row is display-only until its rows and status are current. */
  canAct(id: string): boolean;
  readAll(): Promise<void>;
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
  const control = async (id: string, action: NotificationControl | "snooze" | "unsnooze"): Promise<boolean> => {
    if (!enabled || current.current.request !== request || !current.current.usable) return false;
    const row = rowsRef.current?.find(row => row.notificationId === id);
    if (row?.kind !== "notification" || row.actorId !== request.scope.actorId) { setCommandNotice({ request, text: inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE") }); return false; }
    const owner = current.current.binding;
    const key = foldKey(row);
    const repeats = action === "read" && key !== undefined ? (rowsRef.current ?? []).flatMap(other => other.kind === "notification" && other.notificationId !== id && other.readState !== "read" && foldKey(other) === key
      ? [{ notificationId: other.notificationId, revision: other.revision }] : []) : [];
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
    : inboxProjection(rows, binding.authority.now());
  const pending = enabled && consistent && status === undefined ? inboxMessage("NOTIFICATION_REFRESH_PENDING") : "";
  return { state: projection.state, notice: [pending, projection.notice, enabled ? statusNotice : "", commandNotice?.request === request ? commandNotice.text : "", publicationNotice?.request === request ? publicationNotice.text : ""].filter(Boolean).join(" "),
    control,
    canAct: () => usable,
    onPublication: listener => { arrivalListeners.current.add(listener); return () => { arrivalListeners.current.delete(listener); }; },
    readAll: async () => {
      if (!enabled || current.current.request !== request || !current.current.usable || client.notificationCollection === undefined) return;
      const owner = current.current.binding;
      const held = () => owner.executor.retainedAttempts().find(attempt => !("targets" in attempt.request) && attempt.request.family === "notification"
        && attempt.request.target.actorId === request.scope.actorId && attemptUnresolved(attempt));
      if (held() !== undefined) { setCommandNotice({ request, text: inboxMessage("NOTIFICATION_COMMAND_PENDING") }); return; }
      let target: NotificationCollectionTarget;
      try { target = await client.notificationCollection("read"); }
      catch { if (current.current.request === request) setCommandNotice({ request, text: inboxMessage("NOTIFICATION_SOURCE_UNAVAILABLE") }); return; }
      if (current.current.request !== request || !current.current.usable || held() !== undefined || target.actorId !== request.scope.actorId) return;
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
        if (row === undefined || (target.kind !== "refused" && target.kind !== "archive" && !notificationTargetMatches(row, target))) { refused(inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE")); return; }
        navigate(target, () => { if (current.current.request !== request) return; opened(); if (row.kind === "notification" && row.readState !== "read") void control(item.id, "read"); }, refused);
      }).catch(() => { if (current.current.request === request) refused(inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE")); });
    },
  };
}
