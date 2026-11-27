/** Notification stories: the real bell, its popover and alert toasts on fixture notices, one story per popover state, tone, source, bell state and toast. */
import { useEffect, useState } from "react";
import { PanelLeft, Search } from "lucide-react";
import { EmptyState, IconButton, Panel, PanelBody } from "../../../../../../src/dashboard/ds/ui.js";
import { NotificationsPopover, type NotificationsShow } from "../../../../../../src/dashboard/surfaces/notifications/notifications-popover.js";
import { WorkflowRail } from "../../../../../../src/dashboard/surfaces/shell/workflow-rail.js";
import { useNotificationAlert } from "../../../../../../src/dashboard/surfaces/notifications/notification-rail-model.js";
import { itemClearable, type NotificationItem, type NotificationKind, type NotificationsState } from "../../../../../../src/dashboard/surfaces/notifications/notifications-view-model.js";
import {
  NOTICE_BY_KIND, NOTICE_BY_TONE, POPOVER_DONE, POPOVER_FAILED, POPOVER_FEW, POPOVER_GONE, POPOVER_LONG_NOTICES, POPOVER_MANY, notificationsReady,
} from "../../../../fixtures/dashboard/sessions-notifications-story-fixtures.js";
import { SHELL_STORY_COUNTS_IDLE, SHELL_STORY_WORKFLOWS } from "../../../../fixtures/dashboard/shell-story-fixtures.js";
import { defineSurface, type Story } from "../story-catalogue.js";
import { StoryFrame } from "./story-frame.js";

const noop = () => undefined;

/** Raises the alert the rail raises when a notice arrives while the list is closed. */
function AlertOnMount({ item }: { item: NotificationItem }) {
  const alert = useNotificationAlert(noop);
  const [mounted, setMounted] = useState(false);
  // The rail raises an alert after its data answers; the toast host only hears alerts raised once it has mounted.
  useEffect(() => setMounted(true), []);
  useEffect(() => { if (mounted) alert(item, false); }, [alert, item, mounted]);
  return null;
}
const toast = (item: NotificationItem, ready: string, extra: Partial<Story> = {}): Story => ({ title: `An alert toast for a ${item.tone} notice`, ready, ...extra, render: () => <StoryFrame><AlertOnMount item={item} /></StoryFrame> });
const TOAST = {
  danger: toast(NOTICE_BY_TONE.danger, 'text=/^Run failed/'),
  warning: toast(NOTICE_BY_TONE.warning, 'text=/^Run waiting for you/'),
  positive: toast(NOTICE_BY_TONE.positive, 'text=/^Run completed/'),
  info: toast(NOTICE_BY_TONE.info, 'text=/^Relay repaired a saved file/'),
} satisfies Record<NotificationItem["tone"], Story>;

/** The bell's popover over the dashboard: the rail, the bell in its header, and an idle queue and Logs behind it. Clearing removes rows as the served inbox does. */
function PopoverScene({ state: initialState, show: initial = "all", open = true, notice, collapsed = false }: { state: NotificationsState; show?: NotificationsShow; open?: boolean; notice?: string; collapsed?: boolean }) {
  const [show, setShow] = useState(initial);
  const [state, setState] = useState(initialState);
  const keep = (kept: (item: NotificationItem) => boolean) => setState(current => current.state === "ready" ? { ...current, items: current.items.filter(kept) } : current);
  const emptyPanel = (title: string, description?: string) => <Panel className="min-h-0 flex-1"><PanelBody className="grid place-items-center p-[var(--ds-space-page)]"><EmptyState title={title} description={description} /></PanelBody></Panel>;
  return <StoryFrame>
    <aside aria-label="Workspace" className="workspace-rail ui-theme-scope" data-collapsed={collapsed || undefined}><header className="workspace-rail-header"><h2>Relay</h2><div className="workspace-rail-actions">
      <IconButton variant="ghost" size="sm" label="Collapse sidebar" title="" icon={<PanelLeft aria-hidden className="size-4" />} />
      <NotificationsPopover state={state} open={open} onOpenChange={noop} {...(notice === undefined ? {} : { notice })} show={show} onShow={setShow} onReadAll={noop} onOpen={noop} onControl={noop} canAct={() => true} canClear={() => true}
        onClear={id => keep(item => item.id !== id)} onClearAll={() => keep(item => !itemClearable(item) || (show === "unread" && item.read))} />
      <IconButton variant="ghost" size="sm" label="Search" title="" icon={<Search aria-hidden className="size-4" />} />
    </div></header><div className="workspace-rail-body"><WorkflowRail workflows={SHELL_STORY_WORKFLOWS} counts={SHELL_STORY_COUNTS_IDLE} active="person-lookup" onSelect={noop} collapsed={collapsed} /></div></aside>
    <main className="flex min-h-0 flex-1 flex-col"><div className="dashboard-panel-columns"><div className="dashboard-queue-column"><h1 className="sr-only">Person Lookup queue</h1>{emptyPanel("No runs on this day")}</div>
      <div className="dashboard-log-column">{emptyPanel("No run open", "Select a run from the queue to open its logs.")}</div></div></main>
  </StoryFrame>;
}
const POPOVER_SURFACE = '[aria-label="Notifications"][role="dialog"]';
const popover = (title: string, state: NotificationsState, extra: Partial<Story> = {}, scene: { show?: NotificationsShow; notice?: string } = {}): Story => ({ title, ready: POPOVER_SURFACE, render: () => <PopoverScene state={state} {...scene} />, ...extra });
const POPOVER_STATE = {
  ready: popover("The popover with a few notifications", POPOVER_FEW),
  loading: popover("The popover while notifications load", { state: "loading" }, { slowFetch: { region: '[aria-label="Loading notifications"]' } }),
  unavailable: popover("The popover when notifications cannot be read", { state: "unavailable", reason: "Try again in a moment." }),
} satisfies Record<NotificationsState["state"], Story>;

const tone = (item: NotificationItem): Story => popover(`A ${item.tone} notice`, notificationsReady(item));
const TONE = {
  danger: tone(NOTICE_BY_TONE.danger), warning: tone(NOTICE_BY_TONE.warning), positive: tone(NOTICE_BY_TONE.positive), info: tone(NOTICE_BY_TONE.info),
} satisfies Record<NotificationItem["tone"], Story>;

const kind = (item: NotificationItem): Story => popover(`A ${item.kind ?? "plain"} notice`, notificationsReady(item));
const KIND = {
  storage: kind(NOTICE_BY_KIND.storage), chatgpt: kind(NOTICE_BY_KIND.chatgpt), run: kind(NOTICE_BY_KIND.run), command: kind(NOTICE_BY_KIND.command),
} satisfies Record<NotificationKind, Story>;

/** The All / Unread filter at rest: its selected option is a filled pill, the other has no fill, and neither is ringed. */
const filterAtRest: NonNullable<Story["play"]> = async page => {
  const drawn = await page.locator(".ds-segment label > span").evaluateAll(options => options.map(option => {
    const style = getComputedStyle(option);
    return { filled: style.backgroundColor !== "rgba(0, 0, 0, 0)", ringed: style.outlineStyle !== "none" };
  }));
  const expected = [{ filled: true, ringed: false }, { filled: false, ringed: false }];
  if (JSON.stringify(drawn) !== JSON.stringify(expected)) throw new Error(`the filter is not at rest: ${JSON.stringify(drawn)}`);
};

/** Hovering a row shows its actions in the time's slot; every text line box stays where it was. */
const hoverKeepsText: NonNullable<Story["play"]> = async page => {
  const row = page.locator(".notice-row").first();
  const boxes = () => row.locator(".notice-title, .notice-detail").evaluateAll(lines => lines.map(line => {
    const box = line.getBoundingClientRect();
    return [box.x, box.y, box.width, box.height];
  }));
  const before = await boxes();
  await row.hover();
  await row.getByRole("button", { name: "Clear notification" }).waitFor();
  const after = await boxes();
  if (before.length === 0 || JSON.stringify(before) !== JSON.stringify(after)) throw new Error(`hover moved the row's text: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
};
const COMBINATION = {
  empty: popover("The popover with no notifications", notificationsReady()),
  grouped: popover("The popover with many grouped notifications", POPOVER_MANY),
  long: popover("The popover with a long name, truncated on one line", POPOVER_LONG_NOTICES, { knownFailures: { "fits-viewport": "#751" } }),
  hover: popover("A row hovered: the read toggle and Clear take the time's place and nothing moves", POPOVER_MANY, { play: async page => { await filterAtRest(page); await hoverKeepsText(page); } }),
  standing: popover("A notice still waiting on you, hovered: no Clear until it is handled", POPOVER_FEW, { play: async page => { await filterAtRest(page); await page.locator('.notice-row[data-id="popover-waiting"]').hover(); } }),
  cleared: popover("Everything cleared: only the notice still waiting on you stays", POPOVER_FEW, { play: page => page.getByRole("button", { name: "Clear all" }).click() }),
  "cleared-empty": popover("Everything cleared: the empty panel", notificationsReady(POPOVER_FAILED, POPOVER_DONE), { play: async page => { await page.getByRole("button", { name: "Clear all" }).click(); await filterAtRest(page); } }),
  unread: popover("Only unread notifications", POPOVER_MANY, {}, { show: "unread" }),
  "all-read": popover("Unread chosen with everything read", notificationsReady(NOTICE_BY_TONE.positive), {}, { show: "unread" }),
  gone: popover("A notice whose run was deleted", notificationsReady(POPOVER_GONE)),
  "history-gap": popover("Notification history is incomplete", POPOVER_FEW, {}, { notice: "Notification history is incomplete. Missing completion receipts." }),
} satisfies Record<string, Story>;

type BellState = "read" | "unread" | "loading" | "unavailable";
const BELL_STATE: Readonly<Record<BellState, NotificationsState>> = { read: notificationsReady({ ...NOTICE_BY_TONE.positive, read: true }), unread: POPOVER_FEW, loading: { state: "loading" }, unavailable: { state: "unavailable", reason: "Try again in a moment." } };
const BELL_LABEL: Readonly<Record<BellState, string>> = { read: "Notifications, 0 unread", unread: "Notifications, 2 unread", loading: "Notifications loading", unavailable: "Notifications unavailable" };
const bell = (title: string, state: BellState): Story => ({ title, ready: `button[aria-label="${BELL_LABEL[state]}"]`, render: () => <PopoverScene state={BELL_STATE[state]} open={false} /> });
const BELL = {
  read: bell("The bell, everything read", "read"), unread: bell("The bell with its unread count", "unread"),
  loading: bell("The bell while notifications load", "loading"), unavailable: bell("The bell when notifications cannot be read", "unavailable"),
} satisfies Record<BellState, Story>;

/** The count must sit clear of the search button beside it (below it when the sidebar is minimized). */
const countClearOfSearch: NonNullable<Story["play"]> = async page => {
  const count = await page.locator(".notice-bell-count").boundingBox();
  const search = await page.getByRole("button", { name: "Search", exact: true }).boundingBox();
  if (count === null || search === null) throw new Error("the bell's count or the search button is not drawn");
  if (count.x < search.x + search.width && search.x < count.x + count.width && count.y < search.y + search.height && search.y < count.y + count.height) {
    throw new Error("the bell's count covers the search button");
  }
};
const counted = (unread: number, collapsed: boolean): Story => ({
  title: `The bell with ${String(unread)} unread, sidebar ${collapsed ? "minimized" : "open"}`, ready: `button[aria-label="Notifications, ${String(unread)} unread"]`, play: countClearOfSearch,
  render: () => <PopoverScene state={notificationsReady(...Array.from({ length: unread }, (_, index) => ({ ...NOTICE_BY_TONE.info, id: `unread-${String(index)}`, read: false })))} open={false} collapsed={collapsed} />,
});
type BellCount = 1 | 14 | 66 | 140;
const BELL_COUNT = { 1: counted(1, false), 14: counted(14, false), 66: counted(66, false), 140: counted(140, false) } satisfies Record<BellCount, Story>;
const BELL_COUNT_COLLAPSED = { 1: counted(1, true), 14: counted(14, true), 66: counted(66, true), 140: counted(140, true) } satisfies Record<BellCount, Story>;

export const NOTIFICATIONS_STORIES = defineSurface("notifications", { popover: POPOVER_STATE, tone: TONE, kind: KIND, combination: COMBINATION, bell: BELL, "bell-count": BELL_COUNT, "bell-count-collapsed": BELL_COUNT_COLLAPSED, toast: TOAST });
