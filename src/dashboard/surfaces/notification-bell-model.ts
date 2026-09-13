import type { z } from "zod";
import type { NotificationWireSchema } from "../../domain/dashboard/projection.js";


export interface NotificationRowExtras {
  readonly body?: string;
  readonly triggerLabel?: string;
  readonly delivery?: "ping" | "inbox";
  readonly count?: number;
  readonly desktopDelivered?: boolean;
}


export type NotificationRowWire = z.infer<typeof NotificationWireSchema> & NotificationRowExtras;

export type PinnedNotificationRowWire = Extract<NotificationRowWire, { kind: "backfill-gap" }>;

export type OrdinaryNotificationRowWire = Extract<NotificationRowWire, { kind: "notification" }>;


export const NOTIFICATION_FILTERS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
  { key: "ping", label: "Pings" },
  { key: "inbox", label: "Inbox" },
  { key: "snoozed", label: "Snoozed" },
] as const;


export type NotificationFilterKey = (typeof NOTIFICATION_FILTERS)[number]["key"];


export interface NotificationInboxView {
  readonly pinned: readonly PinnedNotificationRowWire[];
  readonly shown: readonly OrdinaryNotificationRowWire[];
  readonly counts: Readonly<Record<NotificationFilterKey, number>>;
  readonly visibleCount: number;
  readonly empty: boolean;
  readonly unread: number;
  readonly critical: boolean;
}


/**
 * The pinned safety lane is partitioned before ordinary filtering. No filter
 * branch receives it, so adding a chip cannot accidentally make the gap
 * disappear. It still contributes to the bell and filter counts.
 */
export function notificationInboxView(
  notifications: readonly NotificationRowWire[],
  filter: NotificationFilterKey,
): NotificationInboxView {
  const pinned: PinnedNotificationRowWire[] = [];
  const listed: OrdinaryNotificationRowWire[] = [];
  for (const entry of notifications) {
    if (entry.kind === "backfill-gap") pinned.push(entry);
    else listed.push(entry);
  }
  const ordinaryUnread = listed.filter((entry) => entry.state === "unread").length;
  const counts: Record<NotificationFilterKey, number> = {
    all: notifications.length,
    unread: pinned.length + ordinaryUnread,
    ping: pinned.length + listed.filter((entry) => entry.delivery === "ping").length,
    inbox: listed.filter((entry) => entry.delivery === "inbox").length,
    snoozed: listed.filter((entry) => entry.state === "snoozed").length,
  };
  const shown = listed.filter((entry) => {
    if (filter === "all") return true;
    if (filter === "unread") return entry.state === "unread";
    if (filter === "snoozed") return entry.state === "snoozed";
    return entry.delivery === filter;
  });
  return Object.freeze({
    pinned: Object.freeze(pinned),
    shown: Object.freeze(shown),
    counts: Object.freeze(counts),
    visibleCount: pinned.length + shown.length,
    empty: pinned.length + shown.length === 0,
    unread: pinned.length + ordinaryUnread,
    critical: pinned.length > 0
      || listed.some((entry) => entry.state === "unread" && entry.severity === "error"),
  });
}
