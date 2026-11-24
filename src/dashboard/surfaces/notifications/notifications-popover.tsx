import { Bell, Mail, MailOpen, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button, EmptyState, IconButton, Popover, PopoverContent, PopoverTrigger, SegmentedChoice, Skeleton, Tooltip, dsFocus, dsIcon } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { useServedView } from "../../state/served-clock.js";
import { LoadingRegion } from "../shared/loading/loading.js";
import { itemContext, itemDay, notificationAge, type NotificationControl, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";
import "./notifications-popover.css";

type RowHandlers = Readonly<{ onOpen: (item: NotificationItem) => void; onControl: (id: string, control: NotificationControl) => void; onDismiss: (id: string) => void; canAct: (id: string) => boolean }>;

function Age({ item }: { item: NotificationItem }) {
  const at = item.at;
  const age = useServedView("", now => at === undefined || now === "" ? item.age : notificationAge(at, now));
  return <span className="notice-age">{age}</span>;
}

function RowAction({ label, icon, onClick, disabled }: { label: string; icon: ReactNode; onClick: () => void; disabled: boolean }) {
  return <Tooltip side="bottom" content={label}><IconButton label={label} title="" size="xs" icon={icon} onClick={onClick} disabled={disabled} /></Tooltip>;
}

/** One row on a fixed grid: text left, a fixed side column right. The side column holds the time on the title line and the
 * actions below it, always mounted and only faded in on hover or focus, so nothing in the row moves. */
function NoticeRow({ item, handlers }: { item: NotificationItem; handlers: RowHandlers }) {
  const enabled = handlers.canAct(item.id), context = itemContext(item);
  const text = <>
    <span className="notice-head">
      <span aria-hidden className="notice-dot" />
      <span className="notice-title">{item.title}</span>
      {item.count !== undefined && <span className="notice-count"><span className="sr-only">{item.count} times</span><span aria-hidden>{item.count > 999 ? "999+" : item.count}</span></span>}
      {!item.read && <span className="sr-only">Unread</span>}
    </span>
    {context !== "" && <span className="notice-context">{context}</span>}
    <span className="notice-detail">{item.gone ? "This run was deleted." : item.detail}</span>
  </>;
  return <li className="notice-row" data-unread={!item.read || undefined} data-gone={item.gone || undefined}>
    {item.gone ? <div className="notice-main">{text}</div>
      : <button type="button" className={cn("notice-main", dsFocus)} onClick={() => handlers.onOpen(item)} disabled={!enabled}>{text}</button>}
    <span className="notice-side">
      <Age item={item} />
      {item.gone ? <Button size="sm" variant="secondary" onClick={() => handlers.onDismiss(item.id)} disabled={!enabled}>Dismiss</Button>
        : <span className="notice-actions">
          <RowAction label={item.read ? "Mark as unread" : "Mark as read"} icon={item.read ? <Mail aria-hidden className={dsIcon.md} /> : <MailOpen aria-hidden className={dsIcon.md} />}
            onClick={() => handlers.onControl(item.id, item.read ? "unread" : "read")} disabled={!enabled} />
          <RowAction label="Dismiss" icon={<X aria-hidden className={dsIcon.md} />} onClick={() => handlers.onDismiss(item.id)} disabled={!enabled} />
        </span>}
    </span>
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
export function NotificationsPopover({ state, open, onOpenChange, show, onShow, onReadAll, ...handlers }: RowHandlers & {
  state: NotificationsState; open: boolean; onOpenChange: (open: boolean) => void; show: NotificationsShow; onShow: (show: NotificationsShow) => void; onReadAll: () => void;
}) {
  const all = state.state === "ready" ? state.items : [];
  const unread = all.filter(item => !item.read).length;
  const items = show === "unread" ? all.filter(item => !item.read) : all;
  const needsYou = items.filter(item => item.priority && !item.read);
  const rest = items.filter(item => !needsYou.includes(item));
  const days = [...new Set(rest.map(itemDay))];
  const label = state.state === "loading" ? "Notifications loading" : state.state === "unavailable" ? "Notifications unavailable" : `Notifications, ${unread} unread`;
  return <Popover modal open={open} onOpenChange={onOpenChange}>
    <Tooltip side="bottom" content="Notifications" {...(open ? { open: false as const } : {})}><PopoverTrigger asChild>
      <IconButton variant="ghost" size="sm" className="notice-bell" label={label} title=""
        icon={<><Bell aria-hidden className="size-4" />{unread > 0 && <span aria-hidden className="notice-bell-count">{unread > 99 ? "99+" : unread}</span>}</>} />
    </PopoverTrigger></Tooltip>
    <PopoverContent title="Notifications" hideTitle side="bottom" align="start" sideOffset={8} className="notice-popover font-ui">
      <header className="notice-popover-head">
        <p className="notice-popover-title">Notifications</p>
        <SegmentedChoice label="Show" hideLabel value={show} options={SHOW_OPTIONS} onChange={onShow} />
        <Button size="sm" variant="ghost" onClick={onReadAll} disabled={unread === 0}>Mark all read</Button>
      </header>
      <div className="notice-popover-scroll">
        {state.state === "loading" ? <LoadingRegion label="Loading notifications"><div aria-hidden className="notice-loading">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-14" />)}</div></LoadingRegion>
          : state.state === "unavailable" ? <p role="alert" className="notice-message">Notifications unavailable. {state.reason}</p>
          : items.length === 0 ? <EmptyState className="notice-empty" icon={<Bell aria-hidden className={dsIcon.lg} />} title={show === "unread" && all.length > 0 ? "No unread notifications" : "No notifications"}
            description={show === "unread" && all.length > 0 ? undefined : "Failed runs and runs waiting for you show up here."} />
          : <>
            {needsYou.length > 0 && <NoticeGroup label="Needs you" items={needsYou} handlers={handlers} />}
            {days.map(day => <NoticeGroup key={day} label={day} items={rest.filter(item => itemDay(item) === day)} handlers={handlers} />)}
          </>}
      </div>
    </PopoverContent>
  </Popover>;
}
