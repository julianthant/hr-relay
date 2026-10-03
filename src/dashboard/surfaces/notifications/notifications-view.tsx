import { Bell, Check, CheckCheck, ChevronDown, CircleAlert, Clock3, Info, Mail, ShieldAlert, X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger, Skeleton, dsFocus, dsLayer } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { NOTIFICATION_VIEW_FILTERS, notificationView, type NotificationControl, type NotificationFilter, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";

const iconButton = cn("inline-flex size-7.5 shrink-0 items-center justify-center rounded-md text-ui-secondary hover:bg-ui-hover hover:text-ui-primary", dsFocus);

function NotificationRow({ item, onControl, onOpen }: { item: NotificationItem; onControl: (id: string, control: NotificationControl) => void; onOpen: (item: NotificationItem) => void }) {
  const tone = item.tone === "danger" ? "text-ui-danger" : item.tone === "warning" ? "text-ui-warning" : item.tone === "positive" ? "text-ui-positive" : "text-ui-info";
  return <li className="px-4 py-3">
    <details className="group">
      <summary className={cn("flex cursor-pointer list-none items-start gap-2 rounded text-body [&::-webkit-details-marker]:hidden", dsFocus)}>
        <span className={cn("mt-0.5 shrink-0", tone)}>{item.tone === "danger" ? <CircleAlert aria-hidden className="size-3.5" /> : item.tone === "warning" ? <Clock3 aria-hidden className="size-3.5" /> : item.tone === "positive" ? <Check aria-hidden className="size-3.5" /> : <Info aria-hidden className="size-3.5" />}</span>
        <span className={cn("min-w-0 flex-1 text-ui-primary", !item.read && "font-semibold")}>{item.title}{!item.read && <span aria-label="Unread" className="ml-1.5 inline-block size-1.5 rounded-full bg-ui-info align-middle" />}</span><span className="shrink-0 pt-px text-caption text-ui-muted">{item.age}</span><ChevronDown aria-hidden className="mt-0.5 size-3.5 shrink-0 text-ui-muted group-open:rotate-180" />
      </summary>
      <p className="mb-1 ml-5.5 mt-2 text-body text-ui-secondary">{item.detail}</p>
    </details>
    <p className="mb-0 ml-5.5 mt-1 text-body text-ui-secondary">{item.workflow} · {item.subject}</p>
    <div className="ml-5.5 mt-1.5 flex items-center gap-1">
      <button type="button" className={cn("mr-auto rounded py-1 text-body font-medium text-ui-info hover:underline", dsFocus)} onClick={() => onOpen(item)}>{item.action}</button>
      <button type="button" aria-label={`${item.read ? "Mark unread" : "Mark read"}: ${item.title}`} title={item.read ? "Mark unread" : "Mark read"} className={iconButton} onClick={() => onControl(item.id, "read")}>{item.read ? <Mail aria-hidden className="size-3.5" /> : <CheckCheck aria-hidden className="size-3.5" />}</button>
      <button type="button" aria-label={`${item.snoozed ? "Unsnooze" : "Snooze"}: ${item.title}`} title={item.snoozed ? "Unsnooze" : "Snooze"} aria-pressed={item.snoozed} className={cn(iconButton, item.snoozed && "bg-ui-table text-ui-info")} onClick={() => onControl(item.id, "snooze")}><Clock3 aria-hidden className="size-3.5" /></button>
    </div>
  </li>;
}

export function NotificationsView({ state, filter, onFilter, open, onOpenChange, onControl, onOpen, notice, desktopStatus, onEnable }: {
  state: NotificationsState; filter: NotificationFilter; onFilter: (filter: NotificationFilter) => void;
  open: boolean; onOpenChange: (open: boolean) => void; onControl: (id: string, control: NotificationControl) => void;
  onOpen: (item: NotificationItem) => void; notice: string; desktopStatus: string; onEnable: () => void;
}) {
  const view = notificationView(state, filter);
  const surface = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const focused = pendingFocus.current;
    if (focused !== null && !focused.isConnected) {
      surface.current?.querySelector<HTMLButtonElement>(`[data-notification-filter="${filter}"]`)?.focus();
      pendingFocus.current = null;
    }
  }, [state, filter]);
  const control = (id: string, action: NotificationControl) => {
    const focused = document.activeElement;
    pendingFocus.current = focused instanceof HTMLElement ? focused : null;
    onControl(id, action);
  };
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild><button type="button" aria-label={view.unread === undefined ? state.state === "loading" ? "Notifications loading" : "Notifications unavailable" : `Notifications, ${view.unread} unread`} title="Notifications" className={cn(iconButton, "relative", open && "bg-ui-table text-ui-primary")}><Bell aria-hidden className="size-4" />{view.unread !== undefined && view.unread > 0 && <span aria-hidden className="absolute right-1.5 top-1 size-1.5 rounded-full border border-ui-panel bg-ui-info" />}{state.state === "unavailable" && <span aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-ui-warning" />}</button></PopoverTrigger>
    <PopoverContent title="Notifications" hideTitle align="end" surfaceRef={surface} className="ui-theme-scope flex max-h-[min(36rem,calc(100dvh-7rem))] w-92.5 flex-col overflow-hidden border-ui-stroke-control bg-ui-panel font-ui text-ui-primary [&>div:last-child]:flex [&>div:last-child]:min-h-0 [&>div:last-child]:flex-col [&>div:last-child]:p-0">
      <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-3"><h2 className="m-0 text-heading text-ui-primary">Notifications</h2><span className="text-caption text-ui-muted">{view.unread === undefined ? state.state === "loading" ? "Loading" : "Unavailable" : `${view.unread} unread`}</span><PopoverClose asChild><button type="button" aria-label="Close notifications" className={cn(iconButton, "ml-auto")}><X aria-hidden className="size-4" /></button></PopoverClose></div>
      <div role="group" aria-label="Notification filters" className="flex shrink-0 gap-0.5 border-b border-ui-stroke px-3 pb-2">{NOTIFICATION_VIEW_FILTERS.map(item => <button type="button" key={item.id} data-notification-filter={item.id} aria-pressed={filter === item.id} onClick={() => onFilter(item.id)} className={cn("rounded px-2 py-1.5 text-body hover:bg-ui-hover", dsFocus, filter === item.id ? "bg-ui-table font-medium text-ui-primary" : "text-ui-secondary")}>{item.label}</button>)}</div>
      <div className="min-h-0 overflow-y-auto overscroll-contain">
        {view.pinned.map(item => <details key={item.id} className="mx-3 my-2.5 rounded-md border border-ui-stroke bg-ui-table px-3 py-2 text-body text-ui-primary"><summary className={cn("flex cursor-pointer list-none items-center gap-2 rounded font-medium [&::-webkit-details-marker]:hidden", dsFocus)}><ShieldAlert aria-hidden className="size-3.5 text-ui-warning" /><span>{item.title}</span><span className="ml-auto text-caption font-normal text-ui-muted">Pinned</span></summary><p className="mb-0 mt-2 text-body font-normal text-ui-secondary">{item.detail}</p></details>)}
        {state.state === "loading" ? <div role="status" aria-label="Loading notifications" className="space-y-4 p-4">{[0, 1, 2].map(index => <div key={index} className="space-y-2"><Skeleton className="h-3 w-3/4" /><Skeleton className="h-3 w-1/2" /></div>)}</div> : state.state === "unavailable" ? <div role="alert" className="px-4 py-8 text-center"><CircleAlert aria-hidden className="mx-auto mb-2 size-5 text-ui-warning" /><p className="m-0 text-heading text-ui-primary">Notifications unavailable</p><p className="mb-0 mt-2 text-body text-ui-secondary">{state.reason}</p></div> : <>
          <ul aria-label="Notifications" className="m-0 list-none divide-y divide-ui-stroke p-0">{view.shown.map(item => <NotificationRow key={item.id} item={item} onControl={control} onOpen={onOpen} />)}</ul>
          {view.shown.length === 0 && <div className="px-4 py-8 text-center"><Bell aria-hidden className="mx-auto mb-2 size-5 text-ui-muted" /><p className="m-0 text-heading text-ui-primary">{filter === "all" ? "No notifications" : filter === "unread" ? "All caught up" : filter === "attention" ? "Nothing needs attention" : "Nothing snoozed"}</p><p className="mb-0 mt-2 text-body text-ui-secondary">{view.pinned.length > 0 ? "Pinned notices remain above." : "New updates will appear here."}</p></div>}
        </>}
      </div>
      {notice && <p role="status" className="m-0 shrink-0 border-t border-ui-stroke px-4 py-2 text-body text-ui-secondary">{notice}</p>}
      <footer className="flex shrink-0 items-center justify-between border-t border-ui-stroke bg-ui-table px-4 py-2.5"><span className="text-body text-ui-secondary">{desktopStatus}</span><button type="button" className={cn("rounded-md border border-ui-stroke-control bg-ui-panel px-2.5 py-1 text-body font-medium text-ui-primary hover:bg-ui-hover", dsFocus)} onClick={onEnable}>Enable</button></footer>
    </PopoverContent>
  </Popover>;
}

export function NotificationPing({ item, onClose, onOpen }: { item: NotificationItem; onClose: () => void; onOpen: () => void }) {
  return <aside role="status" aria-label="Notification ping" className={cn("ui-theme-scope fixed bottom-14 right-4 w-80 rounded-lg border border-ui-stroke-control bg-ui-panel p-3 font-ui shadow-lg", dsLayer.toast)}>
    <div className="flex items-start gap-2"><Check aria-hidden className="mt-0.5 size-4 text-ui-positive" /><div className="min-w-0 flex-1"><p className="m-0 text-body font-semibold text-ui-primary">{item.title}</p><p className="mb-0 mt-1 text-body text-ui-secondary">{item.subject} · {item.workflow}</p></div><button type="button" aria-label="Dismiss notification ping" className={cn(iconButton, "size-6")} onClick={onClose}><X aria-hidden className="size-3.5" /></button></div><button type="button" className={cn("ml-6 mt-2 rounded text-body font-medium text-ui-info hover:underline", dsFocus)} onClick={onOpen}>Open notifications</button>
  </aside>;
}
