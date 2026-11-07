import type { InboxWiring } from "../../state/inbox-wiring-adapter.js";
import { useMemo, useState } from "react";
import { applyNotificationReads, notificationView, type NotificationControl, type NotificationDestination, type NotificationFilter, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";

type NotificationRailInput = Readonly<{
  notifications: NotificationsState;
  served?: InboxWiring;
  filter: NotificationFilter;
  setOpen: (open: boolean) => void;
  setNotice: (notice: string) => void;
  onOpenNotification: (destination: NotificationDestination, opened: () => void, refused: (message: string) => void) => void;
}>;

export type NotificationRailModel = Readonly<{
  state: NotificationsState;
  unread: number | undefined;
  ping: boolean;
  pingItem: NotificationItem | undefined;
  changeOpen: (next: boolean) => void;
  onControl: (id: string, control: NotificationControl) => void;
  onReadAll: () => void;
  onOpenItem: (item: NotificationItem) => void;
  onClosePing: () => void;
  onOpenPing: () => void;
}>;

export function useNotificationRailModel({ notifications, filter, setOpen, setNotice, onOpenNotification, served }: NotificationRailInput): NotificationRailModel {
  const [reads, setReads] = useState<Readonly<Record<string, boolean>>>({});
  const state = useMemo(() => applyNotificationReads(notifications, reads), [notifications, reads]);
  const [ping, setPing] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("notificationsPreview") === "ping");
  const view = notificationView(state, filter);
  const pingItem = state.state === "ready" ? state.items.find(item => item.destination.kind === "run" && item.title === "Run completed") : undefined;
  const changeOpen = (next: boolean) => { setOpen(next); if (next) setPing(false); };
  if (served !== undefined) return {
    state: served.state, unread: notificationView(served.state, filter).unread,
    ping: false, pingItem: undefined,
    changeOpen,
    onControl: (id, action) => { setNotice(""); void served.control(id, action); },
    onReadAll: () => { setNotice(""); void served.readAll(); },
    onOpenItem: item => { setNotice(""); served.open(item, onOpenNotification, () => setOpen(false), setNotice); },
    onClosePing: () => setPing(false),
    onOpenPing: () => changeOpen(true),
  };
  return {
    state,
    unread: view.unread,
    ping,
    pingItem,
    changeOpen,
    onControl: (id, control) => setReads(current => ({ ...current, [id]: control === "read" })),
    onReadAll: () => { if (state.state === "ready") setReads(current => ({ ...current, ...Object.fromEntries(state.items.map(item => [item.id, true])) })); },
    onOpenItem: item => {
      setNotice("");
      onOpenNotification(item.destination, () => {
        setReads(current => ({ ...current, [item.id]: true }));
        changeOpen(false);
      }, setNotice);
    },
    onClosePing: () => setPing(false),
    onOpenPing: () => changeOpen(true),
  };
}
