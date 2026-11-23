/** Notification stories: the real bell, panel and alert toasts on fixture notices, one story per panel state, tone, source, bell state and toast. */
import { useEffect, useState } from "react";
import { NotificationBell, NotificationsPanel } from "../../../../../../src/dashboard/surfaces/notifications/notifications-view.js";
import { useNotificationAlert } from "../../../../../../src/dashboard/surfaces/notifications/notification-rail-model.js";
import type { NotificationItem, NotificationKind, NotificationsState } from "../../../../../../src/dashboard/surfaces/notifications/notifications-view-model.js";
import {
  BACKFILL_GAP_NOTICE, MIXED_NOTICES, NOTICE_BY_KIND, NOTICE_BY_TONE, STORAGE_DEGRADED_NOTICE, notificationsReady,
} from "../../../../fixtures/dashboard/sessions-notifications-story-fixtures.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

const noop = () => undefined;
/** A notice title longer than the rail is cut off sideways instead of wrapping. */
const CLIPPED = { knownFailures: { "fits-viewport": "#532" } } as const;
const PANEL = '[aria-label="Notification list"]';

interface PanelOptions { readonly showPriority?: boolean; readonly dismissed?: readonly string[]; readonly notice?: string }
const panel = (title: string, state: NotificationsState, { showPriority = true, dismissed = [], notice = "" }: PanelOptions = {}, extra: Partial<Story> = {}): Story => ({ title, ready: PANEL,
  render: () => <StoryFrame><aside aria-label="Workspace" className="workspace-rail ui-theme-scope" data-notifications-open="true"><div className="workspace-rail-body">
    <NotificationsPanel state={state} activeId="" showPriority={showPriority} onShowPriority={noop} dismissed={dismissed} onDismiss={noop} onControl={noop} onReadAll={noop} onOpen={noop} onBack={noop} notice={notice} />
  </div></aside></StoryFrame>, ...extra });

const PANEL_STATE = {
  ready: panel("The panel with Priority and day groups", MIXED_NOTICES, {}, CLIPPED),
  loading: panel("The panel while notifications load", { state: "loading" }, {}, { slowFetch: { region: '[aria-label="Loading notifications"]' } }),
  unavailable: panel("The panel when notifications cannot be read", { state: "unavailable", reason: "Notification data could not be loaded." }, {}, { ready: '[role="alert"]' }),
} satisfies Record<NotificationsState["state"], Story>;

const tone = (item: NotificationItem): Story => panel(`A ${item.tone} notice`, notificationsReady(item));
const TONE = {
  danger: tone(NOTICE_BY_TONE.danger), warning: tone(NOTICE_BY_TONE.warning), positive: tone(NOTICE_BY_TONE.positive), info: tone(NOTICE_BY_TONE.info),
} satisfies Record<NotificationItem["tone"], Story>;

const kind = (item: NotificationItem, extra: Partial<Story> = {}): Story => panel(`A ${item.kind ?? "plain"} notice`, notificationsReady(item), {}, extra);
const KIND = {
  storage: kind(NOTICE_BY_KIND.storage), chatgpt: kind(NOTICE_BY_KIND.chatgpt, CLIPPED), run: kind(NOTICE_BY_KIND.run), command: kind(NOTICE_BY_KIND.command, CLIPPED),
} satisfies Record<NotificationKind, Story>;

const COMBINATION = {
  "storage-degraded": panel("Relay could not save everything", notificationsReady(STORAGE_DEGRADED_NOTICE), {}, CLIPPED),
  "backfill-gap": panel("Notification history is incomplete", notificationsReady(BACKFILL_GAP_NOTICE, NOTICE_BY_TONE.positive), { notice: "Notification history is incomplete. Check the affected work." }, CLIPPED),
  "priority-clear": panel("Nothing in Priority", notificationsReady({ ...NOTICE_BY_TONE.positive, day: "Today" })),
  "priority-hidden": panel("Priority section switched off", MIXED_NOTICES, { showPriority: false }, CLIPPED),
  empty: panel("No notifications at all", notificationsReady()),
  "all-read": panel("Every notice read", { state: "ready", pinned: [], items: MIXED_NOTICES.state === "ready" ? MIXED_NOTICES.items.map(item => ({ ...item, read: true })) : [] }),
  repeated: panel("A failure folded from three repeats", notificationsReady({ ...NOTICE_BY_TONE.danger, count: 3 })),
  dismissed: panel("The only notice dismissed", notificationsReady(NOTICE_BY_TONE.positive), { dismissed: [NOTICE_BY_TONE.positive.id] }),
  refused: panel("A destination that could not be opened", MIXED_NOTICES, { notice: "That run is no longer available." }, { ready: '[role="status"]', ...CLIPPED }),
} satisfies Record<string, Story>;

type BellState = "read" | "unread" | "open" | "loading" | "unavailable";
const BELL_LABEL: Readonly<Record<BellState, string>> = { read: "Notifications, 0 unread", unread: "Notifications, 2 unread", open: "Notifications, 2 unread", loading: "Notifications loading", unavailable: "Notifications unavailable" };
const bell = (title: string, state: BellState): Story => ({ title, ready: `button[aria-label="${BELL_LABEL[state]}"]`,
  render: () => <StoryFrame><aside aria-label="Workspace" className="workspace-rail ui-theme-scope"><header className="workspace-rail-header"><h2>Relay</h2><div className="workspace-rail-actions">
    <NotificationBell label={BELL_LABEL[state]} open={state === "open"} unread={state === "unread" || state === "open"} onToggle={noop} /></div></header></aside></StoryFrame> });
const BELL = {
  read: bell("The bell, everything read", "read"), unread: bell("The bell with a dot for unread notices", "unread"), open: bell("The bell pressed, the list open", "open"),
  loading: bell("The bell while notifications load", "loading"), unavailable: bell("The bell when notifications cannot be read", "unavailable"),
} satisfies Record<BellState, Story>;

/** Raises the alert the rail raises when a notice arrives while the list is closed. */
function AlertOnMount({ item }: { item: NotificationItem }) {
  const alert = useNotificationAlert(noop);
  const [mounted, setMounted] = useState(false);
  // The rail raises an alert after its data answers; the toast host only hears alerts raised once it has mounted.
  useEffect(() => setMounted(true), []);
  useEffect(() => { if (mounted) alert(item, false); }, [alert, item, mounted]);
  return null;
}
const toast = (item: NotificationItem, ready: string): Story => ({ title: `An alert toast for a ${item.tone} notice`, ready, render: () => <StoryFrame><AlertOnMount item={item} /></StoryFrame> });
const TOAST = {
  danger: toast(NOTICE_BY_TONE.danger, 'text="Run failed"'),
  warning: toast(NOTICE_BY_TONE.warning, 'text="Run waiting for you"'),
  positive: toast(NOTICE_BY_TONE.positive, 'text="Run completed"'),
  info: toast(NOTICE_BY_TONE.info, 'text="Relay repaired a saved file"'),
} satisfies Record<NotificationItem["tone"], Story>;

export const NOTIFICATIONS_STORIES = defineSurface("notifications", { panel: PANEL_STATE, tone: TONE, kind: KIND, combination: COMBINATION, bell: BELL, toast: TOAST });
