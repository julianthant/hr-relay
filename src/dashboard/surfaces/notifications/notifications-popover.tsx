import { Bell, CheckCheck, Mail, MailOpen, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EmptyState, IconButton, Popover, PopoverContent, PopoverTrigger, SegmentedChoice, Skeleton, Tooltip, dsFocus, dsIcon } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { useServedView } from "../../state/served-clock.js";
import { LoadingRegion } from "../shared/loading/loading.js";
import { itemClearable, itemContext, itemDay, notificationAge, type NotificationControl, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";
import "./notifications-popover.css";

type RowHandlers = Readonly<{ onOpen: (item: NotificationItem) => void; onControl: (id: string, control: NotificationControl) => void; onClear: (id: string) => void; canAct: (id: string) => boolean; canClear: (id: string) => boolean }>;

function Age({ item }: { item: NotificationItem }) {
  const at = item.at;
  const age = useServedView("", now => at === undefined || now === "" ? item.age : notificationAge(at, now));
  return <span className="notice-age">{age}</span>;
}

function HeadAction({ label, icon, onClick, disabled }: { label: string; icon: ReactNode; onClick: () => void; disabled: boolean }) {
  return <Tooltip side="bottom" content={label}><IconButton variant="ghost" label={label} title="" size="sm" icon={icon} onClick={onClick} disabled={disabled} /></Tooltip>;
}

function RowAction({ label, icon, onClick, disabled }: { label: string; icon: ReactNode; onClick: () => void; disabled: boolean }) {
  return <Tooltip side="bottom" content={label}><IconButton label={label} title="" size="xs" icon={icon} onClick={onClick} disabled={disabled} /></Tooltip>;
}

/** One row: the title line ends in a fixed slot that shows the time, or the read toggle and Clear while the row is hovered or focused,
 * so nothing moves. The lines below run the full width, one line each. A notice that still waits on the operator has no Clear. */
function NoticeRow({ item, handlers }: { item: NotificationItem; handlers: RowHandlers }) {
  const enabled = handlers.canAct(item.id), context = item.kind === "storage" ? "" : itemContext(item);
  const text = <>
    <span className="notice-head">
      <span aria-hidden className="notice-dot" />
      <span className="notice-title">{item.title}</span>
      {item.count !== undefined && <span className="notice-count"><span className="sr-only">{item.count} times</span><span aria-hidden>{item.count > 999 ? "999+" : item.count}</span></span>}
      {!item.read && <span className="sr-only">Unread</span>}
      <Age item={item} />
    </span>
    {context !== "" && <span className="notice-context">{context}</span>}
    <span className="notice-detail">{item.gone ? "This run was deleted." : item.detail}</span>
  </>;
  return <li className="notice-row" data-id={item.id} data-unread={!item.read || undefined} data-gone={item.gone || undefined} data-read-only-history={item.readOnlyHistory}>
    {item.gone ? <div className="notice-main">{text}</div>
      : <button type="button" className={cn("notice-main", dsFocus)} onClick={() => handlers.onOpen(item)} disabled={!enabled}>{text}</button>}
    {item.readOnlyHistory !== true && <span className="notice-action">
      <RowAction label={item.read ? "Mark as unread" : "Mark as read"} icon={item.read ? <Mail aria-hidden className={dsIcon.md} /> : <MailOpen aria-hidden className={dsIcon.md} />}
        onClick={() => handlers.onControl(item.id, item.read ? "unread" : "read")} disabled={!enabled} />
      {itemClearable(item) && <RowAction label="Clear notification" icon={<X aria-hidden className={dsIcon.md} />} onClick={() => handlers.onClear(item.id)} disabled={!handlers.canClear(item.id)} />}
    </span>}
  </li>;
}

function NoticeGroup({ label, items, handlers }: { label: string; items: readonly NotificationItem[]; handlers: RowHandlers }) {
  return <section aria-label={label} className="notice-group"><h3 className="notice-group-label">{label}</h3>
    <ul className="notice-list">{items.map(item => <NoticeRow key={item.id} item={item} handlers={handlers} />)}</ul></section>;
}

export type NotificationsShow = "all" | "unread";
const SHOW_OPTIONS = [{ value: "all", label: "All" }, { value: "unread", label: "Unread" }] as const;

/** The bell and the surface it opens: a popover anchored to the bell, over the page, with its own scroll. Unread failures and waits
 * sit under Needs you; everything else falls into its day. It is modal, so Tab stays inside it until it closes. */
export function NotificationsPopover({ state, open, onOpenChange, show, onShow, onReadAll, onClearAll, notice = "", onClear, ...handlers }: RowHandlers & {
  state: NotificationsState; open: boolean; onOpenChange: (open: boolean) => void; show: NotificationsShow; onShow: (show: NotificationsShow) => void; onReadAll: () => void;
  /** Clears what the current tab lists, except notices that still wait on the operator. */
  onClearAll: () => void;
  /** What the inbox says about its own state, such as rows that may be missing. */
  notice?: string;
}) {
  const all = state.state === "ready" ? state.items : [];
  const unread = all.filter(item => !item.read).length;
  const items = show === "unread" ? all.filter(item => !item.read) : all;
  const needsYou = items.filter(item => item.priority && !item.read);
  const rest = items.filter(item => !needsYou.includes(item));
  const days = [...new Set(rest.map(itemDay))];
  const clearable = items.filter(item => itemClearable(item) && handlers.canClear(item.id));
  // After a clear, focus moves to the next row that can take it, or to the header once none can; after Clear all, to the first such row left.
  const [moveFocus, setMoveFocus] = useState<{ cleared: readonly string[]; after?: readonly (string | undefined)[] }>();
  const headRef = useRef<HTMLElement>(null), scrollRef = useRef<HTMLDivElement>(null);
  const focusableRows = () => [...(scrollRef.current?.querySelectorAll<HTMLElement>("li.notice-row") ?? [])].filter(row => row.querySelector("button.notice-main:not(:disabled)") !== null);
  useEffect(() => {
    if (moveFocus === undefined || items.some(item => moveFocus.cleared.includes(item.id))) return;
    const rows = focusableRows();
    const next = moveFocus.after === undefined ? rows[0] : moveFocus.after.map(id => rows.find(row => row.dataset.id === id)).find(row => row !== undefined);
    (next?.querySelector<HTMLElement>("button.notice-main") ?? headRef.current)?.focus();
    setMoveFocus(undefined);
  }, [moveFocus, items]);
  const clearRow = (id: string) => {
    const rows = [...(scrollRef.current?.querySelectorAll<HTMLElement>("li.notice-row") ?? [])], index = rows.findIndex(row => row.dataset.id === id);
    setMoveFocus({ cleared: [id], after: [...rows.slice(index + 1), ...rows.slice(0, Math.max(index, 0)).reverse()].map(row => row.dataset.id) });
    onClear(id);
  };
  const rowHandlers = { ...handlers, onClear: clearRow };
  const label = state.state === "loading" ? "Notifications loading" : state.state === "unavailable" ? "Notifications unavailable" : `Notifications, ${unread} unread`;
  return <Popover modal open={open} onOpenChange={onOpenChange}>
    <Tooltip side="bottom" content="Notifications" {...(open ? { open: false as const } : {})}><PopoverTrigger asChild>
      <IconButton variant="ghost" size="sm" className="notice-bell" label={label} title=""
        icon={<><Bell aria-hidden className="size-4" />
          {unread > 0 && <span aria-hidden className="notice-bell-status"><span className="notice-bell-dot" /><span className="notice-bell-count">{unread > 99 ? "99+" : unread}</span></span>}</>} />
    </PopoverTrigger></Tooltip>
    {/* Opening focuses the panel itself; the filter would draw its focus ring before anyone has reached it. */}
    <PopoverContent title="Notifications" hideTitle side="bottom" align="start" sideOffset={8} className="notice-popover font-ui outline-none"
      onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement).focus(); }}>
      <header ref={headRef} tabIndex={-1} className={cn("notice-popover-head", dsFocus)}>
        <p className="notice-popover-title">Notifications</p>
        <SegmentedChoice label="Show" hideLabel value={show} options={SHOW_OPTIONS} onChange={onShow} />
        <span className="notice-popover-actions">
          <HeadAction label="Mark all read" icon={<CheckCheck aria-hidden className={dsIcon.md} />} onClick={onReadAll} disabled={unread === 0} />
          <HeadAction label="Clear all" icon={<Trash2 aria-hidden className={dsIcon.md} />} onClick={() => { setMoveFocus({ cleared: clearable.map(item => item.id) }); onClearAll(); }} disabled={clearable.length === 0} />
        </span>
      </header>
      <div ref={scrollRef} className="notice-popover-scroll">
        {state.state === "loading" ? <LoadingRegion label="Loading notifications"><div aria-hidden className="notice-loading">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-14" />)}</div></LoadingRegion>
          : state.state === "unavailable" ? <p role="alert" className="notice-message">Notifications unavailable. {state.reason}</p>
          : items.length === 0 ? <EmptyState className="notice-empty" icon={<Bell aria-hidden className={dsIcon.lg} />} title={show === "unread" && all.length > 0 ? "No unread notifications" : "No notifications"}
            description={show === "unread" && all.length > 0 ? undefined : "Failed runs and runs waiting for you show up here."} />
          : <>
            {needsYou.length > 0 && <NoticeGroup label="Needs you" items={needsYou} handlers={rowHandlers} />}
            {days.map(day => <NoticeGroup key={day} label={day} items={rest.filter(item => itemDay(item) === day)} handlers={rowHandlers} />)}
          </>}
      </div>
      {notice !== "" && <p role="status" className="notice-status">{notice}</p>}
    </PopoverContent>
  </Popover>;
}
