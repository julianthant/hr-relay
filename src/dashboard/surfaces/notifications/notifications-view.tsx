import { Bell, MoreHorizontal } from "lucide-react";
import { forwardRef, useEffect, useRef, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, IconButton, Skeleton, dsFocus, dsIcon, useToasts } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { LoadingRegion } from "../shared/loading/loading.js";
import { itemDay, itemPreview, itemSource, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";
import "./notifications-panel.css";

type Open = (item: NotificationItem) => void;

/** Codex rows: title and source tag on one line, a two-line grey preview below; the dot marks unread. */
function NotificationRow({ item, active, onOpen }: { item: NotificationItem; active: boolean; onOpen: Open }) {
  return <li><button type="button" aria-current={active || undefined} className={cn("notification-item", dsFocus)} onClick={() => onOpen(item)}>
    <span className="notification-item-head">
      <span className="notification-item-title">{item.title}</span>
      <span className="notification-item-tag">{itemSource(item)}</span>
      {!item.read && <><span aria-hidden className="notification-unread-dot" /><span className="sr-only">Unread</span></>}
    </span>
    <span className="notification-item-line">{itemPreview(item)}</span>
  </button></li>;
}

function NotificationGroup({ label, items, activeId, onOpen, action, empty }: { label: string; items: readonly NotificationItem[]; activeId: string; onOpen: Open; action?: ReactNode; empty?: string }) {
  return <section aria-label={label} className="notification-group"><div className="notification-group-head"><h3 className="notification-group-label">{label}</h3>{action}</div>
    {items.length === 0 ? <p className="notification-empty">{empty}</p>
      : <ul className="notification-list">{items.map(item => <NotificationRow key={item.id} item={item} active={item.id === activeId} onOpen={onOpen} />)}</ul>}
  </section>;
}

/** Day groups in the order their first item appears. */
function dayGroups(items: readonly NotificationItem[]) {
  const days = [...new Set(items.map(itemDay))];
  return days.map(day => ({ day, items: items.filter(item => itemDay(item) === day) }));
}

/** The sidebar body while the bell is pressed: Priority, then day groups. The sidebar header stays the workflow view's. */
export function NotificationsPanel({ state, activeId, onReadAll, onOpen, onBack, notice }: {
  state: NotificationsState; activeId: string; onReadAll: () => void; onOpen: Open; onBack: () => void; notice: string;
}) {
  const items = state.state === "ready" ? state.items : [];
  const priority = items.filter(item => item.priority);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      event.preventDefault(); onBack();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onBack]);
  const menu = <DropdownMenu><DropdownMenuTrigger asChild><IconButton label="Notification actions" size="xs" icon={<MoreHorizontal aria-hidden className={dsIcon.md} />} /></DropdownMenuTrigger>
    <DropdownMenuContent align="end"><DropdownMenuItem disabled={!items.some(item => !item.read)} onClick={onReadAll}>Mark all read</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
  return <section aria-label="Notifications" className="notification-panel font-ui">
    <div className="notification-panel-scroll rail-scroll">
      {state.state === "loading" ? <LoadingRegion label="Loading notifications"><div aria-hidden>{[0, 1, 2].map(index => <div key={index} className="flex items-center gap-2.5 px-2 py-2"><Skeleton className="h-10 flex-1" /></div>)}</div></LoadingRegion>
        : state.state === "unavailable" ? <p role="alert" className="notification-empty">Notifications unavailable. {state.reason}</p>
        : <>
          <NotificationGroup label="Priority" items={priority} activeId={activeId} onOpen={onOpen} action={menu} empty="Nothing needs attention" />
          {dayGroups(items.filter(item => !item.priority)).map(group => <NotificationGroup key={group.day} label={group.day} items={group.items} activeId={activeId} onOpen={onOpen} />)}
        </>}
    </div>
    {notice && <p role="status" className="notification-notice">{notice}</p>}
  </section>;
}

/** The sidebar header's bell: pressed while the list is open, a small dot when anything is unread. */
export const NotificationBell = forwardRef<HTMLButtonElement, { label: string; open: boolean; unread: boolean; onToggle: () => void }>(function NotificationBell({ label, open, unread, onToggle }, ref) {
  return <IconButton ref={ref} variant="ghost" size="sm" className="rail-notification-toggle" aria-pressed={open} label={label} onClick={onToggle}
    icon={<><Bell aria-hidden className="size-4" />{unread && <span data-testid="notification-unread-dot" className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-ui-info" />}</>} />;
});

export function NotificationPing({ item }: { item: NotificationItem }) {
  const { toast } = useToasts();
  const sent = useRef(false);
  useEffect(() => { if (sent.current) return; sent.current = true; toast({ tone: "success", title: item.title, description: `${item.subject} · ${item.workflow}`}); }, [item, toast]);
  return null;
}
