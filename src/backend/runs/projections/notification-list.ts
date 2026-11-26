import { NotificationWireSchema, notificationSourceEventOf, notificationWireOf, type NotificationDisplayContext, type NotificationWire } from "../../../models/dashboard/projection.js";
import { notificationStanding, type NotificationRecord, type NotificationStandingSources } from "../../../models/notifications/notifications.js";
import { NotificationTriggerEventSchema } from "../../../rules/notifications/notification-triggers.js";
import { sha256Hex } from "../../../rules/validation/sha256.js";

type NotificationProjectionDependencies = {
  display(record: NotificationRecord): NotificationDisplayContext;
  source(id: string): Parameters<typeof notificationSourceEventOf>[1];
  standing: NotificationStandingSources;
};

export type ServedNotificationRecord = NotificationRecord & Readonly<{ readOnlyHistory?: true }>;

export function notificationProjection(record: ServedNotificationRecord, nowMs: number, deps: NotificationProjectionDependencies): NotificationWire {
  const source = deps.source(record.notificationId);
  const sourceEvent = notificationSourceEventOf(record, source);
  const event = source === undefined ? undefined : NotificationTriggerEventSchema.parse(source.event);
  const context = event?.kind === "storage-degraded" ? { state: "storage", concern: event.concern } as const
    : record.trigger === "storage" ? { state: "unavailable" } as const : deps.display(record);
  const standing = record.readOnlyHistory !== true && notificationStanding(record, deps.standing) ? true : undefined;
  return notificationWireOf(record, nowMs, context, sourceEvent, record.readOnlyHistory, standing);
}

/** Group only retained source evidence; durable rows and their mutation revisions remain distinct. A cleared row is not listed. */
export function compareNotificationRows(a: NotificationWire, b: NotificationWire): number {
  return b.occurredAt.localeCompare(a.occurredAt) || a.notificationId.localeCompare(b.notificationId);
}

export function notificationListProjection(records: readonly ServedNotificationRecord[], nowMs: number, deps: NotificationProjectionDependencies,
  project: typeof notificationProjection = notificationProjection): NotificationWire[] {
  const rows = records.filter(record => record.clearedAt === undefined).map(record => project(record, nowMs, deps)).sort(compareNotificationRows);
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
  return result.sort(compareNotificationRows);
}
