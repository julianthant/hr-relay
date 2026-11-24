import { NotificationWireSchema, notificationSourceEventOf, notificationWireOf, type NotificationWire } from "../../../models/dashboard/projection.js";
import type { NotificationRecord } from "../../../models/notifications/notifications.js";
import { NotificationTriggerEventSchema } from "../../../rules/notifications/notification-triggers.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";
import { notificationDisplayContext } from "../queries/notification-display.js";

type NotificationProjectionDependencies = {
  display: Parameters<typeof notificationDisplayContext>[1];
  source(id: string): Parameters<typeof notificationSourceEventOf>[1];
};

export type ServedNotificationRecord = NotificationRecord & Readonly<{ readOnlyHistory?: true }>;

export function notificationProjection(record: ServedNotificationRecord, nowMs: number, deps: NotificationProjectionDependencies): NotificationWire {
  const source = deps.source(record.notificationId);
  const sourceEvent = notificationSourceEventOf(record, source);
  const event = source === undefined ? undefined : NotificationTriggerEventSchema.parse(source.event);
  const context = event?.kind === "storage-degraded" ? { state: "storage", concern: event.concern } as const
    : record.trigger === "storage" ? { state: "unavailable" } as const : notificationDisplayContext(record, deps.display);
  return notificationWireOf(record, nowMs, context, sourceEvent, record.readOnlyHistory);
}

/** Group only retained source evidence; durable rows and their mutation revisions remain distinct. */
export function notificationListProjection(records: readonly ServedNotificationRecord[], nowMs: number, deps: NotificationProjectionDependencies): NotificationWire[] {
  const rows = records.map(record => notificationProjection(record, nowMs, deps))
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.notificationId.localeCompare(b.notificationId));
  const groups = new Map<string, Extract<NotificationWire, { kind: "notification" }>[]>();
  const result: NotificationWire[] = [];
  for (const row of rows) {
    if (row.kind !== "notification" || row.trigger !== "storage" || row.context.state !== "storage") {
      result.push(row);
      continue;
    }
    const key = `${row.actorId}:${row.context.concern}:${row.readOnlyHistory === true}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [row]);
    else group.push(row);
  }
  for (const group of groups.values()) {
    const latest = group[0];
    if (group.length === 1) { result.push(latest); continue; }
    if (latest.context.state !== "storage") throw new Error("notification-list: storage group has no concern");
    const members = group.map(row => ({ notificationId: row.notificationId, revision: row.revision }))
      .sort((a, b) => a.notificationId.localeCompare(b.notificationId));
    const readState = group.some(row => row.readState === "unread") ? "unread" : "read";
    const snoozedUntil = group.every(row => row.state === "snoozed")
      ? group.flatMap(row => row.snoozedUntil === undefined ? [] : [row.snoozedUntil]).sort()[0] : undefined;
    const { snoozedUntil: _latestSnooze, ...representative } = latest;
    result.push(NotificationWireSchema.parse({ ...representative,
      count: group.reduce((sum, row) => sum + row.count, 0),
      readState, state: snoozedUntil === undefined ? readState : "snoozed",
      ...(snoozedUntil === undefined ? {} : { snoozedUntil }),
      publicationId: sha256Hex(JSON.stringify(group.map(row => row.publicationId))),
      group: { concern: latest.context.concern, members },
    }));
  }
  return result.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.notificationId.localeCompare(b.notificationId));
}
