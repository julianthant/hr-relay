import type { InboxWiring } from "../../state/inbox-wiring-adapter.js";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { usePersonPreferences } from "../../lib/person-preferences.js";
import { applyNotificationReads, type NotificationControl, type NotificationDestination, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";
import type { PersonPreferences } from "../../../models/config/person-preferences.js";
import { mockParam } from "../../app/mock-surfaces.js";

/** Read marks live with the caller: Settings replaces the rail, and the marks must survive the visit. */
export type NotificationReads = Readonly<Record<string, boolean>>;

type NotificationRailInput = Readonly<{
  notifications: NotificationsState;
  reads: NotificationReads;
  setReads: Dispatch<SetStateAction<NotificationReads>>;
  served?: InboxWiring;
  /** Whether the list is open: items that arrive meanwhile are in front of the operator and raise no alert. */
  open?: boolean;
  setOpen: (open: boolean) => void;
  /** Delivers one gated alert for a newly arrived served item; `sound` is false when Notification sound is off. */
  onAlert?: (item: NotificationItem, sound: boolean) => void;
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

/** Which Settings > General > Notifications switch governs an arriving item, by its tone. */
export function alertSwitch(item: NotificationItem, preferences: PersonPreferences["notifications"]): boolean {
  if (item.read) return false;
  if (item.tone === "positive") return preferences.runFinished !== "never";
  if (item.tone === "warning") return preferences.needsYou;
  if (item.tone === "danger") return preferences.failures;
  return false;
}

const unreadCount = (state: NotificationsState) => state.state === "ready" ? state.items.filter(item => !item.read).length : undefined;

export function useNotificationRailModel({ notifications, reads, setReads, open = false, setOpen, onAlert, setNotice, onOpenNotification, onActive, served }: NotificationRailInput): NotificationRailModel {
  const state = useMemo(() => applyNotificationReads(notifications, reads), [notifications, reads]);
  const [ping, setPing] = useState(() => mockParam("notificationsPreview") === "ping");
  const pingItem = state.state === "ready" ? state.items.find(item => item.destination.kind === "run" && item.title === "Run completed") : undefined;
  const { notifications: switches } = usePersonPreferences().value;
  const seen = useRef<Set<string> | undefined>(undefined);
  const alert = useRef(onAlert); alert.current = onAlert;
  const servedState = served?.state;
  useEffect(() => {
    if (servedState?.state !== "ready") return;
    if (seen.current === undefined) { seen.current = new Set(servedState.items.map(item => item.id)); return; }
    const arrived = servedState.items.filter(item => !seen.current?.has(item.id));
    for (const item of arrived) seen.current.add(item.id);
    if (open) return;
    for (const item of arrived) if (alertSwitch(item, switches)) alert.current?.(item, switches.sound !== "none");
  }, [servedState, open, switches]);
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
