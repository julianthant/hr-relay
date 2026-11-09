import type { InboxWiring } from "../../state/inbox-wiring-adapter.js";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { applyNotificationReads, type NotificationControl, type NotificationDestination, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";

/** Read marks live with the caller: Settings replaces the rail, and the marks must survive the visit. */
export type NotificationReads = Readonly<Record<string, boolean>>;

type NotificationRailInput = Readonly<{
  notifications: NotificationsState;
  reads: NotificationReads;
  setReads: Dispatch<SetStateAction<NotificationReads>>;
  served?: InboxWiring;
  setOpen: (open: boolean) => void;
  setNotice: (notice: string) => void;
  /** The item whose destination just opened. */
  onActive?: (id: string) => void;
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
}>;

const unreadCount = (state: NotificationsState) => state.state === "ready" ? state.items.filter(item => !item.read).length : undefined;

export function useNotificationRailModel({ notifications, reads, setReads, setOpen, setNotice, onOpenNotification, onActive, served }: NotificationRailInput): NotificationRailModel {
  const state = useMemo(() => applyNotificationReads(notifications, reads), [notifications, reads]);
  const [ping, setPing] = useState(() => typeof window !== "undefined" && new URLSearchParams(window.location.search).get("notificationsPreview") === "ping");
  const pingItem = state.state === "ready" ? state.items.find(item => item.destination.kind === "run" && item.title === "Run completed") : undefined;
  const changeOpen = (next: boolean) => { setOpen(next); if (next) setPing(false); };
  if (served !== undefined) return {
    state: served.state, unread: unreadCount(served.state),
    ping: false, pingItem: undefined,
    changeOpen,
    onControl: (id, action) => { setNotice(""); void served.control(id, action); },
    onReadAll: () => { setNotice(""); void served.readAll(); },
    onOpenItem: item => { setNotice(""); served.open(item, onOpenNotification, () => onActive?.(item.id), setNotice); },
  };
  return {
    state,
    unread: unreadCount(state),
    ping,
    pingItem,
    changeOpen,
    onControl: (id, control) => setReads(current => ({ ...current, [id]: control === "read" })),
    onReadAll: () => { if (state.state === "ready") setReads(current => ({ ...current, ...Object.fromEntries(state.items.map(item => [item.id, true])) })); },
    onOpenItem: item => {
      setNotice("");
      const markRead = () => setReads(current => ({ ...current, [item.id]: true }));
      if (item.destination.kind === "none") markRead();
      else onOpenNotification(item.destination, () => { markRead(); onActive?.(item.id); }, setNotice);
    },
  };
}
