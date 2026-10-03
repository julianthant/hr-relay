import { useEffect, useMemo, useRef, useState } from "react";
import type { NotificationWire } from "../../../models/dashboard/projection.js";
import { settleCommandResult } from "../../app/command-result.js";
import type { OpenNotification } from "../../state/notification-navigation.js";
import { useNotificationClient } from "../../state/notification-client.js";
import { NOTIFICATION_DELIVERY_LABELS, useNotificationDelivery } from "../../state/use-notification-delivery.js";
import { createCompletionPingFeed, projectNotifications, type NotificationFilter } from "./notifications-view-model.js";
import { NotificationPing, NotificationsView } from "./notifications-view.js";

export function ConnectedNotifications({ rows, actorId, day, nowIso, connected, dayState, refresh, onOpenNotification }: {
  rows: readonly NotificationWire[]; actorId: string; day: string; nowIso: string; connected: boolean;
  dayState: "loaded" | "loading" | "failed" | undefined; refresh: () => void; onOpenNotification: OpenNotification;
}) {
  const client = useNotificationClient();
  const identity = useRef({ client, actorId, day, version: 0 });
  if (identity.current.client !== client || identity.current.actorId !== actorId || identity.current.day !== day) {
    identity.current = { client, actorId, day, version: identity.current.version + 1 };
  }
  const delivery = useNotificationDelivery(rows, connected);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [notice, setNotice] = useState("");
  const [observation, setObservation] = useState("");
  const [pingId, setPingId] = useState<string | undefined>();
  const pingFeed = useRef(createCompletionPingFeed());
  const state = useMemo(() => dayState === "failed" ? { state: "unavailable" as const, reason: "The day snapshot is unavailable." }
    : dayState === "loading" ? { state: "loading" as const } : projectNotifications(rows, nowIso), [dayState, rows, nowIso]);
  useEffect(() => {
    const next = pingFeed.current.update(rows, connected);
    if (next !== undefined) setPingId(next);
  }, [rows, connected]);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const read = () => { void client.notificationStatus().then(status => {
      if (active) setObservation(status.state === "failed" ? "Some notifications could not be published. Observation will retry." : status.state === "stopped" ? "Notification observation is stopped." : "");
    }, () => { if (active) setObservation("Notification observation status is unavailable."); }); };
    read(); const timer = setInterval(read, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [client, open]);

  const control = (id: string, action: "read" | "snooze") => {
    const version = identity.current.version;
    const row = rows.find((entry) => entry.notificationId === id);
    if (row === undefined || row.kind !== "notification") { setNotice("Notification is unavailable. Refresh the inbox."); return; }
    const type = action === "read" ? row.readState === "read" ? "notification-unread" : "notification-read"
      : row.state === "snoozed" ? "notification-unsnooze" : "notification-snooze";
    setNotice("");
    void client.executeCommand({
      commandId: crypto.randomUUID(), requestedAt: nowIso, requestedBy: actorId,
      source: "notification-bell", family: "notification", type,
      target: { notificationId: row.notificationId, actorId, expectedVersion: row.revision },
    }).then(result => {
      if (identity.current.version !== version) return;
      const settlement = settleCommandResult(result);
      if (settlement.kind === "refused") setNotice(settlement.problem);
      refresh();
    }, (error: unknown) => { if (identity.current.version !== version) return; setNotice(error instanceof Error ? error.message : String(error)); refresh(); });
  };
  const ping = state.state === "ready" ? state.items.find(item => item.id === pingId && item.tone === "positive") : undefined;
  return <><NotificationsView state={state} filter={filter} onFilter={setFilter} open={open} onOpenChange={setOpen}
    onControl={control} onOpen={item => onOpenNotification(item.id, () => setOpen(false), setNotice)}
    notice={[notice, observation, delivery.state === "delivery-failed" ? NOTIFICATION_DELIVERY_LABELS[delivery.state] : ""].filter(Boolean).join(" ")}
    desktopStatus={NOTIFICATION_DELIVERY_LABELS[delivery.state]} onEnable={delivery.enable} />
    {ping !== undefined && <NotificationPing item={ping} onClose={() => setPingId(undefined)} onOpen={() => { setPingId(undefined); setOpen(true); }} />}</>;
}
