import type { InboxWiring } from "../../state/inbox-wiring-adapter.js";
import { useCallback, useEffect, useRef } from "react";
import { useToasts } from "../../ds/ui.js";
import { usePersonPreferences } from "../../lib/person-preferences.js";
import { type NotificationControl, type NotificationDestination, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";
import type { PersonPreferences } from "../../../models/config/person-preferences.js";

type NotificationRailInput = Readonly<{
  served: InboxWiring;
  /** Whether the list is open: publications that arrive meanwhile are in front of the operator and raise no alert. */
  open?: boolean;
  setOpen: (open: boolean) => void;
  /** Delivers one gated alert per served publication; `sound` is false when Notification sound is off. */
  onAlert?: (item: NotificationItem, sound: boolean) => void;
  setNotice: (notice: string) => void;
  /** The item whose destination just opened. */
  onActive?: (id: string) => void;
  onOpenNotification: (destination: NotificationDestination, opened: () => void, refused: (message: string) => void) => void;
}>;

export type NotificationRailModel = Readonly<{
  state: NotificationsState;
  unread: number | undefined;
  changeOpen: (next: boolean) => void;
  /** Whether the control was accepted. */
  onControl: (id: string, control: NotificationControl) => Promise<boolean>;
  canAct: (id: string) => boolean;
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

export function useNotificationRailModel({ open = false, setOpen, onAlert, setNotice, onOpenNotification, onActive, served }: NotificationRailInput): NotificationRailModel {
  const { notifications: switches } = usePersonPreferences().value;
  const alert = useRef(onAlert); alert.current = onAlert;
  const live = useRef({ open, switches }); live.current = { open, switches };
  useEffect(() => served.onPublication(({ item }) => {
    if (live.current.open || !alertSwitch(item, live.current.switches)) return;
    alert.current?.(item, live.current.switches.sound !== "none");
  }), [served]);
  return {
    state: served.state, unread: unreadCount(served.state),
    changeOpen: setOpen,
    onControl: (id, action) => { setNotice(""); return served.control(id, action); },
    canAct: id => served.canAct(id),
    onReadAll: () => { setNotice(""); void served.readAll(); },
    onOpenItem: item => { setNotice(""); served.open(item, onOpenNotification, () => onActive?.(item.id), setNotice); },
  };
}

/** A short two-note chime from the browser's own audio; a runtime without audio plays nothing. */
export function playNotificationSound(): void {
  const Context = typeof AudioContext === "undefined" ? undefined : AudioContext;
  if (Context === undefined) return;
  const audio = new Context();
  const oscillator = audio.createOscillator(), gain = audio.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(880, audio.currentTime);
  oscillator.frequency.setValueAtTime(660, audio.currentTime + 0.12);
  gain.gain.setValueAtTime(0.08, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 0.3);
  oscillator.connect(gain).connect(audio.destination);
  oscillator.onended = () => { void audio.close(); };
  oscillator.start();
  oscillator.stop(audio.currentTime + 0.3);
}

/** Delivers a gated alert as a short toast (never a panel): success for a finished run, the item's own tone otherwise. */
export function useNotificationAlert(play: () => void = playNotificationSound) {
  const { toast } = useToasts();
  return useCallback((item: NotificationItem, sound: boolean) => {
    const finished = item.tone === "positive";
    toast({ tone: finished ? "success" : item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : "info", title: item.title,
      description: finished ? `${item.subject} · ${item.workflow}` : item.tone === "info" ? undefined : item.detail, ...(item.tone === "danger" ? { duration: 6000 } : {}) });
    if (sound) play();
  }, [toast, play]);
}
