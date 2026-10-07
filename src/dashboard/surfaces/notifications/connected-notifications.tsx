import { useEffect, useMemo, useRef, useState } from "react";
import type { NotificationWire } from "../../../models/dashboard/projection.js";
import { useToasts } from "../../ds/ui.js";
import { settleCommandResult } from "../../app/command-result.js";
import type { OpenNotification } from "../../state/notification-navigation.js";
import { useNotificationClient } from "../../state/notification-client.js";
import { NOTIFICATION_DELIVERY_LABELS, useNotificationDelivery } from "../../state/use-notification-delivery.js";
import { projectNotifications, type NotificationFilter } from "./notifications-view-model.js";
import { createNotificationToastFeed, notificationRowsForActor, notificationToastPresentation } from "./notification-feedback-model.js";
import { createNotificationControlFeedback, notificationControlFeedback } from "./notification-control-feedback-model.js";
import { NotificationsView } from "./notifications-view.js";

export function ConnectedNotifications({ rows, actorId, day, nowIso, connected, dayState, refresh, onOpenNotification }: {
  rows: readonly NotificationWire[]; actorId: string; day: string; nowIso: string; connected: boolean;
  dayState: "loaded" | "loading" | "failed" | undefined; refresh: () => void; onOpenNotification: OpenNotification;
}) {
  const client = useNotificationClient();
  const { toast, dismiss } = useToasts();
  const identity = useRef({ client, actorId, day, onOpenNotification, version: 0 });
  if (identity.current.client !== client || identity.current.actorId !== actorId || identity.current.day !== day || identity.current.onOpenNotification !== onOpenNotification) {
    identity.current = { client, actorId, day, onOpenNotification, version: identity.current.version + 1 };
  }
  const delivery = useNotificationDelivery(rows, connected);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>("all");
  const [notice, setNotice] = useState("");
  const [observation, setObservation] = useState("");
  const toastFeed = useRef(createNotificationToastFeed());
  const controlFeedback = useMemo(() => createNotificationControlFeedback(feedback =>
    toast({ tone: feedback.tone, title: feedback.title, description: feedback.description }), dismiss), [toast, dismiss]);
  const activePublicationToasts = useRef(new Map<string, string>());
  const toastContext = useRef(identity.current.version);
  const scopedRows = useMemo(() => notificationRowsForActor(rows, actorId), [rows, actorId]);
  const currentRows = useRef(scopedRows);
  currentRows.current = scopedRows;
  const state = useMemo(() => dayState === "failed" ? { state: "unavailable" as const, reason: "The day snapshot is unavailable." }
    : dayState === "loading" ? { state: "loading" as const } : projectNotifications(rows, nowIso), [dayState, rows, nowIso]);
  useEffect(() => {
    if (toastContext.current !== identity.current.version) {
      for (const toastId of activePublicationToasts.current.values()) dismiss(toastId);
      activePublicationToasts.current.clear();
      toastFeed.current.reset();
      controlFeedback.reset();
      toastContext.current = identity.current.version;
    }
    const current = new Set<string>(scopedRows.map(row => row.publicationId));
    for (const [publicationId, toastId] of activePublicationToasts.current) {
      if (!current.has(publicationId)) { dismiss(toastId); activePublicationToasts.current.delete(publicationId); }
    }
    const version = identity.current.version;
    const candidates = toastFeed.current.update(scopedRows, connected && dayState === "loaded");
    for (const row of candidates) {
      const publicationId = row.publicationId;
      const eventKind = row.sourceEvent?.state === "available" ? row.sourceEvent.kind : undefined;
      const presentation = notificationToastPresentation(row);
      const toastId = toast({ tone: presentation.tone, title: presentation.title, description: presentation.description,
        ...(presentation.action === undefined ? {} : { action: { label: presentation.action, onAction: () => {
          if (identity.current.version !== version || !currentRows.current.some(entry => entry.kind === "notification" && entry.publicationId === publicationId && entry.notificationId === row.notificationId && entry.actorId === actorId && entry.sourceEvent?.state === "available" && entry.sourceEvent.kind === eventKind)) return;
          onOpenNotification(row.notificationId, () => {}, message => { if (identity.current.version === version) setNotice(message); });
        } } }),
      });
      activePublicationToasts.current.set(publicationId, toastId);
    }
  }, [scopedRows, actorId, day, client, connected, dayState, toast, dismiss, onOpenNotification, controlFeedback]);

  useEffect(() => () => {
    identity.current.version += 1;
    for (const toastId of activePublicationToasts.current.values()) dismiss(toastId);
    activePublicationToasts.current.clear();
    controlFeedback.reset();
  }, [dismiss, controlFeedback]);

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
    const row = scopedRows.find((entry) => entry.notificationId === id);
    if (row === undefined || row.kind !== "notification") { setNotice("Notification is unavailable. Refresh the inbox."); return; }
    const type = action === "read" ? row.readState === "read" ? "notification-unread" : "notification-read"
      : row.state === "snoozed" ? "notification-unsnooze" : "notification-snooze";
    setNotice("");
    const command = {
      commandId: crypto.randomUUID(), requestedAt: nowIso, requestedBy: actorId,
      source: "notification-bell", family: "notification", type,
      target: { notificationId: row.notificationId, actorId, expectedVersion: row.revision },
    } as const;
    const publish = (feedback: ReturnType<typeof notificationControlFeedback>) => {
      if (identity.current.version !== version) return;
      controlFeedback.publish(`${version}:${actorId}:${day}:${row.notificationId}`, command.commandId, feedback);
    };
    void client.executeCommand(command).then(result => {
      if (identity.current.version !== version) return;
      const feedback = notificationControlFeedback(command, result);
      if (feedback.outcome === "unknown") setNotice("The notification result could not be confirmed. Refresh the inbox before acting again.");
      else {
        const settlement = settleCommandResult(result);
        if (settlement.kind === "refused") setNotice(settlement.problem);
      }
      publish(feedback);
      refresh();
    }, (error: unknown) => {
      if (identity.current.version !== version) return;
      setNotice(error instanceof Error ? error.message : String(error));
      publish(notificationControlFeedback(command, undefined));
      refresh();
    });
  };
  return <><NotificationsView state={state} filter={filter} onFilter={setFilter} open={open} onOpenChange={setOpen}
    onControl={control} onOpen={item => onOpenNotification(item.id, () => setOpen(false), setNotice)}
    notice={[notice, observation, delivery.state === "delivery-failed" ? NOTIFICATION_DELIVERY_LABELS[delivery.state] : ""].filter(Boolean).join(" ")}
    desktopStatus={NOTIFICATION_DELIVERY_LABELS[delivery.state]} onEnable={delivery.enable} /></>;
}
