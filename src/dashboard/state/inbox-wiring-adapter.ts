import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { attemptUnresolved } from "../app/commands/command-outcome.js";
import type { DashboardCommandBinding } from "../app/dashboard-app-model.js";
import type { DashboardClient } from "../client/index.js";
import { listedAhead, upsertListedRow, NotificationWireSchema, type NotificationWire } from "../../models/dashboard/projection.js";
import type { NotificationArrival } from "../../models/dashboard/subscription.js";
import type { HeldNotificationStatus } from "../client/subscriptions/row-store.js";
import type { NotificationCollectionTarget } from "../../models/notifications/notifications.js";
import type { NotificationTarget } from "../../models/notifications/notification-target.js";
import type { NotificationTriggerEvent } from "../../rules/notifications/notification-triggers.js";
import { NotificationCommandReceiptSchema, NotificationCommandRequestSchema } from "../../rules/commands/commands.js";
import { ERROR_CATALOG, createErrorCatalogFailure, formatErrorCatalogFailure, shortFailureText } from "../../models/failures/error-catalog.js";
import { verifyShellCommandEffect } from "../app/commands/command-dispatch.js";
import { notificationAge, type NotificationControl, type NotificationDestination, type NotificationItem, type NotificationsState } from "../surfaces/notifications/notifications-view-model.js";

const policies = {
  "run-failed": { trigger: "failed", tone: "danger", detail: "Review the failed run before continuing." },
  "subject-mismatch": { trigger: "failed", tone: "danger", detail: "The subject identity did not match." },
  "gate-opened": { trigger: "gate-waiting", tone: "warning", detail: "This run is waiting for your review." },
  "write-parked": { trigger: "write-parked", tone: "warning", detail: "A write is parked." },
  "repeating-failure": { trigger: "repeating", tone: "danger", detail: "This failure keeps repeating." },
  "storage-degraded": { trigger: "storage", tone: "warning", detail: "Relay could not save everything." },
  "verified-done": { trigger: "verified-done", tone: "positive", detail: "Completed with the required verification evidence." },
  "command-refused": { trigger: "command", tone: "warning", detail: "Relay did not do this, so nothing changed." },
  "command-unknown": { trigger: "command", tone: "danger", detail: "Relay could not confirm whether this finished. Open it to check before trying again." },
  "bulk-incomplete": { trigger: "command", tone: "warning", detail: "Some items in this batch were not done. Open it to see each one." },
} as const satisfies Readonly<Record<Exclude<NotificationTriggerEvent["kind"], "backfill-gap">, { trigger: string; tone: NotificationItem["tone"]; detail: string }>>;

export const inboxMessage = (code: "DASHBOARD_READ_FAILED" | "NOTIFICATION_SOURCE_UNAVAILABLE" | "NOTIFICATION_OBSERVATION_FAILED" | "NOTIFICATION_COMMAND_PENDING" | "NOTIFICATION_TARGET_UNAVAILABLE" | "NOTIFICATION_REFRESH_PENDING") => formatErrorCatalogFailure(createErrorCatalogFailure(code, {})).text;

export function notificationPolicy(row: NotificationWire) {
  if (row.kind === "backfill-gap") return undefined;
  const source = row.sourceEvent;
  const policy = source?.state === "available" ? Object.entries(policies).find(([kind]) => kind === source.kind)?.[1] : undefined;
  const trigger = row.kind === "command" ? "command" : row.trigger;
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
      ...(row.readOnlyHistory === true ? { readOnlyHistory: true } : {}),
      ...(repeatingNotice(row) ? { quiet: true as const } : {}),
      read: row.readState === "read", action: command ? "Open" : row.link?.kind === "storage" ? "" : "Open log",
      destination: { kind: "refused", reason: "target-unavailable" },
    };
}

/** Whether a row was cleared at or after the revision it is listed at; a newer revision is a repeat and lists again. */
const clearedRow = (row: NotificationWire, cleared: ReadonlyMap<string, number>) => {
  const at = cleared.get(row.notificationId);
  return at !== undefined && row.kind !== "backfill-gap" && row.revision <= at;
};
/** The rows the panel shows: the listed rows the person has not cleared. */
const shownRows = (rows: readonly NotificationWire[], cleared: ReadonlyMap<string, number> = new Map()) => rows.filter(row => !clearedRow(row, cleared));

export function inboxProjection(rows: readonly NotificationWire[], nowIso: string, gone: ReadonlySet<string> = new Set(), cleared: ReadonlyMap<string, number> = new Map()): { state: NotificationsState; needsYou: number } {
  const items = foldRows(shownRows(rows, cleared)).map((group): NotificationItem => {
    const shown = notificationItem(group[0], nowIso);
    // A repeating notice says the failure repeats; it is not one more failure.
    const counted = group.filter(row => row === group[0] || !repeatingNotice(row)).reduce((sum, row) => sum + (row.kind === "notification" ? row.count : 1), 0);
    return { ...shown, read: group.every(row => row.readState === "read"), ...(counted > 1 ? { count: counted } : {}), ...(group.some(row => gone.has(row.notificationId)) ? { gone: true } : {}),
      ...(group.some(row => row.standing === true) ? { standing: true as const } : {}) };
  });
  const needsYou = items.filter(item => !item.read && (item.tone === "danger" || item.tone === "warning")).length;
  return { state: { state: "ready", items, pinned: [] }, needsYou };
}

export type InboxArrival = Readonly<{ sourceId: string; item: NotificationItem }>;

export interface InboxWiring {
  readonly state: NotificationsState;
  readonly notice: string;
  control(id: string, action: NotificationControl | "snooze" | "unsnooze"): Promise<boolean>;
  /** Whether the item's controls may act now: a served row is display-only until its rows and status are current. */
  canAct(id: string): boolean;
  /** Whether the item may be cleared now: only while its rows and status are current on a live stream. */
  canClear(id: string): boolean;
  readAll(): Promise<void>;
  /** Clears the item and every row it stands for; the item leaves at once and comes back if Relay refuses. */
  clear(id: string): Promise<boolean>;
  /** Clears every clearable item the tab lists; standing and history items stay. */
  clearAll(show: "all" | "unread"): Promise<void>;
  /** Delivers each distinct publication once, as the item it adds; snapshots never deliver. */
  onPublication(listener: (arrival: InboxArrival) => void): () => void;
  open(item: NotificationItem, navigate: (target: NotificationDestination, opened: () => void, refused: (message: string) => void) => void, opened: () => void, refused: (message: string) => void): void;
}

const NO_UPSERTS: readonly NotificationWire[] = Object.freeze([]);
const noStatus = (): HeldNotificationStatus | undefined => undefined;
const noList = () => undefined;

/** The inbox follows the stream's notification list and overlays confirmed command readbacks. */
export function useInboxWiring({ client, enabled, binding }: { client: DashboardClient; enabled: boolean; binding: DashboardCommandBinding }): InboxWiring {
  const dayState = binding.authority.dayState;
  // Commands run in the app's active scope; the inbox's own rows are keyed by the day stream it reads, which may be another day's.
  const request = useMemo(() => ({ client, enabled, scope: binding.scope, stream: dayState.stream ?? dayState.request }), [client, enabled, binding.scope, dayState.stream, dayState.request]);
  const store = dayState.rows;
  const status = useSyncExternalStore(listener => store.subscribe(listener), () => store.notificationStatus(), noStatus);
  const day = dayState.day;
  const list = useSyncExternalStore(listener => store.subscribe(listener), () => store.notificationList(request.scope.actorId), noList);
  const baseRows = list?.rows;
  const [upserts, setUpserts] = useState<{ request: typeof request; rows: readonly NotificationWire[] }>();
  const [commandNotice, setCommandNotice] = useState<{ request: typeof request; text: string }>();
  const [publicationNotice, setPublicationNotice] = useState<{ request: typeof request; text: string }>();
  /** Items whose run the server answered as deleted when the operator opened them. */
  const [gone, setGone] = useState<{ request: typeof request; ids: ReadonlySet<string> }>();
  /** Clear hides listed revisions while pending and committed revisions after confirmation. */
  const [cleared, setCleared] = useState<{ request: typeof request; ids: ReadonlyMap<string, number> }>();
  const clearedIds = cleared?.request === request ? cleared.ids : undefined;
  const clearedRef = useRef(clearedIds); clearedRef.current = clearedIds;
  const held = upserts?.request === request ? upserts.rows : NO_UPSERTS;
  const overlays = useMemo(() => baseRows === undefined ? NO_UPSERTS : held.filter(row => listedAhead(baseRows, row, true)), [baseRows, held]);
  const rows = useMemo(() => baseRows === undefined ? undefined
    : overlays.reduce(upsertListedRow, baseRows), [baseRows, overlays]);
  const consistent = rows !== undefined;
  const usable = enabled && consistent && list?.unavailable === false && status !== undefined && !status.unavailable;
  // A reconnect may report itself live before delivering its own list and status.
  const clearsNow = usable && list?.stale !== true && status?.stale !== true && day.state === "loaded" && dayState.connection.state === "live";
  const current = useRef({ request, binding, usable, clearsNow }); current.current = { request, binding, usable, clearsNow };
  const rowsRef = useRef(rows); rowsRef.current = rows;
  const baseRowsRef = useRef(baseRows); baseRowsRef.current = baseRows;
  const overlay = useCallback((rows: readonly NotificationWire[]): void => {
    rowsRef.current = rows.reduce(upsertListedRow, rowsRef.current ?? NO_UPSERTS);
    const base = baseRowsRef.current;
    setUpserts(previous => ({ request, rows: rows.reduce(upsertListedRow,
      previous?.request === request ? previous.rows.filter(held => base !== undefined && listedAhead(base, held, true)) : NO_UPSERTS) }));
  }, [request]);
  const overlayReceipt = (evidence: unknown, action: NotificationControl | "snooze" | "unsnooze") => {
    const receipt = NotificationCommandReceiptSchema.parse(evidence);
    const revisions = new Map(receipt.changes.map(change => [change.notificationId, change.revision]));
    const changed = (rowsRef.current ?? NO_UPSERTS).flatMap(row => {
      // The stream supplies aggregate state when a row represents several storage notices.
      if (row.kind === "backfill-gap" || row.readOnlyHistory === true || row.actorId !== receipt.actorId
        || row.kind === "notification" && row.group !== undefined) return [];
      const revision = revisions.get(row.notificationId);
      if (revision === undefined || revision !== row.revision + 1) return [];
      const readState = action === "read" || action === "unread" ? action : row.readState;
      const snoozedUntil = action === "snooze" ? receipt.snoozedUntil : action === "unsnooze" ? undefined : row.snoozedUntil;
      return [NotificationWireSchema.parse({ ...row, revision, readState, snoozedUntil,
        state: snoozedUntil === undefined ? readState : "snoozed",
        ...(row.kind === "command" ? { priority: readState === "unread" && snoozedUntil === undefined } : {}),
      })];
    });
    if (changed.length > 0) overlay(changed);
  };
  const subscribePublications = dayState.subscribePublications;
  const arrivalListeners = useRef(new Set<(arrival: InboxArrival) => void>());
  useEffect(() => {
    if (!enabled) return;
    const delivered = new Set<string>();
    return subscribePublications(({ publication, target }: NotificationArrival) => {
      if (current.current.request !== request || publication.actorId !== request.scope.actorId || delivered.has(publication.sourceId)) return;
      delivered.add(publication.sourceId);
      const row = publication.notification;
      // Replay gaps record a stream resnapshot; the inbox still has its durable rows.
      if (row.kind === "backfill-gap" || row.state === "snoozed") return;
      const arrival = { sourceId: publication.sourceId, item: notificationItem(row, current.current.binding.authority.now()) };
      for (const listener of arrivalListeners.current) listener(arrival);
      if (!notificationTargetMatches(row, target)) setPublicationNotice({ request, text: inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE") });
    });
  }, [enabled, request, subscribePublications]);
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
  const clearable = (row: NotificationWire) => row.kind !== "backfill-gap" && row.readOnlyHistory !== true && row.standing !== true;
  /** The items this render shows. A clear names only these rows at these revisions; a row published since is not on screen yet. */
  const shownGroups = foldRows(shownRows(rows ?? [], clearedIds));
  /** What clearing these items sends, without rows a clear from this same render already took. */
  const clearEntries = (groups: readonly (readonly NotificationWire[])[]) => groups.flatMap(group => group.flatMap(durableRows)).filter(([id, revision]) => (clearedRef.current?.get(id) ?? -1) < revision);
  /** One command clears exactly these rows at their listed revisions, or none of them. */
  const sendClear = async (entries: readonly (readonly [string, number])[]): Promise<boolean> => {
    const owner = current.current.binding;
    hide(entries);
    const members = [...new Map(entries)].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([notificationId, expectedVersion]) => ({ notificationId, expectedVersion }));
    const command = NotificationCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: owner.authority.now(), requestedBy: request.scope.actorId,
      source: "dashboard", family: "notification", type: "notification-clear", target: { actorId: request.scope.actorId, members, matchingCount: members.length } });
    const outcome = await owner.executor.execute(command, { scope: owner.scope, readback: (request, reply) => verifyShellCommandEffect(client, owner.authority.day, request, reply),
      publish: outcome => {
        if (current.current.request !== request) return;
        if (outcome.kind === "confirmed") {
          hide(NotificationCommandReceiptSchema.parse(outcome.readback).changes.map(change => [change.notificationId, change.revision]));
          return;
        }
        owner.feedback(outcome);
        if (outcome.kind === "conflict") dayState.refresh();
      } });
    if (outcome.kind !== "confirmed") { if (current.current.request === request) unhide(entries); return false; }
    return current.current.request === request;
  };
  const control = async (id: string, action: NotificationControl | "snooze" | "unsnooze"): Promise<boolean> => {
    if (!enabled || current.current.request !== request || !current.current.usable) return false;
    const row = rowsRef.current?.find(row => row.notificationId === id);
    if (row?.kind !== "notification" || row.actorId !== request.scope.actorId) { setCommandNotice({ request, text: inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE") }); return false; }
    if (row.readOnlyHistory === true) return false;
    const owner = current.current.binding;
    // Marking an item read marks every unread row it stands for.
    const group = action === "read" ? foldRows(shownRows(rowsRef.current ?? [], clearedRef.current)).find(members => members.includes(row)) ?? [] : [];
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
    // A group acts on every durable member it holds.
    for (const member of members) {
      const command = NotificationCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: owner.authority.now(), requestedBy: request.scope.actorId,
        source: "dashboard", family: "notification", type: `notification-${action}`, target: { notificationId: member.notificationId, actorId: request.scope.actorId, expectedVersion: member.revision } });
      outcome = await owner.executor.execute(command, { scope: owner.scope, readback: (request, reply) => verifyShellCommandEffect(client, owner.authority.day, request, reply),
        publish: outcome => {
          if (current.current.request !== request) return;
          if (outcome.kind === "confirmed") {
            overlayReceipt(outcome.readback, action);
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
  const observation = status?.status;
  const statusNotice = list?.unavailable === true || status?.unavailable === true ? inboxMessage("DASHBOARD_READ_FAILED")
    : observation === undefined || observation.state === "ready" ? ""
    : observation.code === "NOTIFICATION_RECEIPT_MISSING"
      ? "Notification history is incomplete. Missing completion receipts."
      : inboxMessage(observation.code ?? "NOTIFICATION_OBSERVATION_FAILED");
  const state: NotificationsState = rows !== undefined
    ? inboxProjection(rows, binding.authority.now(), gone?.request === request ? gone.ids : undefined, clearedIds).state
    : day.state === "failed" || list?.unavailable === true ? { state: "unavailable", reason: inboxMessage("DASHBOARD_READ_FAILED") } : { state: "loading" };
  const pending = enabled && consistent && status === undefined ? inboxMessage("NOTIFICATION_REFRESH_PENDING") : "";
  return { state, notice: [pending, enabled ? statusNotice : "", commandNotice?.request === request ? commandNotice.text : "", publicationNotice?.request === request ? publicationNotice.text : ""].filter(Boolean).join(" "),
    control,
    canAct: () => usable,
    canClear: () => clearsNow,
    clear: async id => {
      if (current.current.request !== request || !current.current.clearsNow) return false;
      // Clearing an item clears every row it stands for: its repeats and a storage group's members.
      const group = shownGroups.find(members => members.some(row => row.notificationId === id));
      if (group === undefined) { setCommandNotice({ request, text: inboxMessage("NOTIFICATION_TARGET_UNAVAILABLE") }); return false; }
      if (!group.every(clearable)) return false;
      if (heldAttempt(new Set(group.flatMap(durableRows).map(([memberId]) => memberId))) !== undefined) { setCommandNotice({ request, text: inboxMessage("NOTIFICATION_COMMAND_PENDING") }); return false; }
      const entries = clearEntries([group]);
      return entries.length > 0 && sendClear(entries);
    },
    clearAll: async show => {
      if (current.current.request !== request || !current.current.clearsNow) return;
      if (heldAttempt() !== undefined) { setCommandNotice({ request, text: inboxMessage("NOTIFICATION_COMMAND_PENDING") }); return; }
      // Whole displayed items only: a standing item stays whole, and Unread clears every row of an item with any unread row.
      const entries = clearEntries(shownGroups.filter(group => group.every(clearable)
        && (show === "all" || group.some(row => row.readState === "unread"))));
      if (entries.length > 0) await sendClear(entries);
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
            overlayReceipt(outcome.readback, "read");
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
