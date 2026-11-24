import { Bell, Check, Mail, MailOpen, MoreHorizontal, X } from "lucide-react";
import { forwardRef, useEffect, type ReactNode } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator, IconButton, Skeleton, Tooltip, dsFocus, dsIcon } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { LoadingRegion } from "../shared/loading/loading.js";
import { itemContext, itemDay, notificationAge, type NotificationControl, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";
import { useServedView } from "../../state/served-clock.js";
import "./notifications-panel.css";

type Open = (item: NotificationItem) => void;
type RowActions = Readonly<{ onControl: (id: string, control: NotificationControl) => void; onDismiss: (id: string) => void; canAct: (id: string) => boolean }>;

/** Hover and focus replace the time with icon actions: read/unread, plus Dismiss outside Priority. */
function RowActionButton({ label, icon, onClick, disabled }: { label: string; icon: ReactNode; onClick: () => void; disabled: boolean }) {
  return <Tooltip side="bottom" content={label}><IconButton label={label} title="" size="xs" icon={icon} onClick={onClick} disabled={disabled} /></Tooltip>;
}

/** The age ticks here, so a minute passing re-renders only this text. */
function NotificationAge({ item }: { item: NotificationItem }) {
  const at = item.at;
  const age = useServedView("", now => at === undefined || now === "" ? item.age : notificationAge(at, now));
  return <span className="notification-item-age">{age}</span>;
}

/** Codex rows: the unread dot left of the title, the time right of it, the workflow and run, then a two-line grey line below. */
function NotificationRow({ item, active, onOpen, actions }: { item: NotificationItem; active: boolean; onOpen: Open; actions: RowActions }) {
  return <li className="notification-row">
    <button type="button" aria-current={active || undefined} className={cn("notification-item", dsFocus)} onClick={() => onOpen(item)} disabled={!actions.canAct(item.id)}>
      <span className="notification-item-head">
        {!item.read && <span aria-hidden className="notification-unread-dot" />}
        <span className="notification-item-title">{item.title}</span>
        {item.count !== undefined && <span className="notification-item-count"><span className="sr-only">{item.count} times</span><span aria-hidden>×{item.count}</span></span>}
        <NotificationAge item={item} />
        {!item.read && <span className="sr-only">Unread</span>}
      </span>
      {itemContext(item) !== "" && <span className="notification-item-context">{itemContext(item)}</span>}
      {item.detail !== "" && <span className="notification-item-line">{item.detail}</span>}
    </button>
    <span className="notification-item-actions">
      <RowActionButton label={item.read ? "Mark as unread" : "Mark as read"} icon={item.read ? <Mail aria-hidden className={dsIcon.md} /> : <MailOpen aria-hidden className={dsIcon.md} />} onClick={() => actions.onControl(item.id, item.read ? "unread" : "read")} disabled={!actions.canAct(item.id)} />
      {!item.priority && <RowActionButton label="Dismiss" icon={<X aria-hidden className={dsIcon.md} />} onClick={() => actions.onDismiss(item.id)} disabled={!actions.canAct(item.id)} />}
    </span>
  </li>;
}

function NotificationGroup({ label, items, activeId, onOpen, actions, empty }: { label: string; items: readonly NotificationItem[]; activeId: string; onOpen: Open; actions: RowActions; empty?: string }) {
  return <section aria-label={label} className="notification-group"><div className="notification-group-head"><h3 className="notification-group-label">{label}</h3></div>
    {items.length === 0 ? <p className="notification-empty">{empty}</p>
      : <ul className="notification-list">{items.map(item => <NotificationRow key={item.id} item={item} active={item.id === activeId} onOpen={onOpen} actions={actions} />)}</ul>}
  </section>;
}

/** Day groups in the order their first item appears. */
function dayGroups(items: readonly NotificationItem[]) {
  const days = [...new Set(items.map(itemDay))];
  return days.map(day => ({ day, items: items.filter(item => itemDay(item) === day) }));
}

/** The sidebar body while the bell is pressed: Priority (when shown), then day groups. The sidebar header stays the workflow view's.
 * An item `canAct` refuses shows its controls disabled; Dismiss hides an item only once its mark-read is accepted. */
export function NotificationsPanel({ state, activeId, showPriority, onShowPriority, dismissed, onDismiss, onControl, canAct, onReadAll, onOpen, onBack, notice }: {
  state: NotificationsState; activeId: string; showPriority: boolean; onShowPriority: (show: boolean) => void; dismissed: readonly string[]; onDismiss: (id: string) => void;
  onControl: (id: string, control: NotificationControl) => void | Promise<boolean>; canAct: (id: string) => boolean; onReadAll: () => void; onOpen: Open; onBack: () => void; notice: string;
}) {
  const items = (state.state === "ready" ? state.items : []).filter(item => !dismissed.includes(item.id));
  const actions: RowActions = { onControl: (id, control) => { void onControl(id, control); }, canAct,
    onDismiss: id => { void Promise.resolve(onControl(id, "read")).then(accepted => { if (accepted !== false) onDismiss(id); }); } };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      event.preventDefault(); onBack();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onBack]);
  const menu = <DropdownMenu><DropdownMenuTrigger asChild><IconButton label="Notification actions" size="xs" icon={<MoreHorizontal aria-hidden className={dsIcon.md} />} /></DropdownMenuTrigger>
    <DropdownMenuContent align="end" alignOffset={3} aria-label="Notification actions" className="notification-menu">
      <DropdownMenuGroup><DropdownMenuLabel>Show</DropdownMenuLabel>
      <DropdownMenuItem role="menuitemcheckbox" aria-checked={showPriority} className="pr-[34px]" onClick={() => onShowPriority(!showPriority)}>Priority section<span className="ds-menu-indicator">{showPriority && <Check aria-hidden className="ds-menu-check" />}</span></DropdownMenuItem></DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled={!items.some(item => !item.read && canAct(item.id))} onClick={onReadAll}>Mark all as read</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>;
  const groups = [
    ...(showPriority ? [{ label: "Priority", items: items.filter(item => item.priority), empty: "Nothing needs attention" }] : []),
    ...dayGroups(items.filter(item => !showPriority || !item.priority)).map(group => ({ label: group.day, items: group.items, empty: undefined })),
  ];
  return <section aria-label="Notification list" className="notification-panel font-ui">
    <div className="notification-panel-scroll rail-scroll">
      {state.state === "loading" ? <LoadingRegion label="Loading notifications"><div aria-hidden>{[0, 1, 2].map(index => <div key={index} className="flex items-center gap-2.5 px-2 py-2"><Skeleton className="h-10 flex-1" /></div>)}</div></LoadingRegion>
        : state.state === "unavailable" ? <p role="alert" className="notification-empty">Notifications unavailable. {state.reason}</p>
        : <>
          <div className="notification-panel-head"><h2 className="notification-panel-title">Notifications</h2>{menu}</div>
          {groups.map(group => <NotificationGroup key={group.label} label={group.label} items={group.items} activeId={activeId} onOpen={onOpen} actions={actions} empty={group.empty} />)}
        </>}
    </div>
    {notice && <p role="status" className="notification-notice">{notice}</p>}
  </section>;
}

/** The sidebar header's bell: pressed while the list is open, a small dot when anything is unread. */
export const NotificationBell = forwardRef<HTMLButtonElement, { label: string; open: boolean; unread: boolean; onToggle: () => void }>(function NotificationBell({ label, open, unread, onToggle }, ref) {
  return <Tooltip side="bottom" content="Notifications"><IconButton ref={ref} variant="ghost" size="sm" className="rail-notification-toggle" aria-pressed={open} label={label} title="" onClick={onToggle}
    icon={<><Bell aria-hidden className="size-4" />{unread && <span data-testid="notification-unread-dot" className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-ui-info" />}</>} /></Tooltip>;
});
