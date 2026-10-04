import { Bell, CheckCheck, CircleAlert, Clock3, Mail, ShieldAlert, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button, Popover, PopoverClose, PopoverContent, PopoverTrigger, Skeleton, dsFocus, useToasts } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { NOTIFICATION_VIEW_FILTERS, notificationView, type NotificationControl, type NotificationFilter, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";

const iconButton = cn("inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-ui-secondary hover:bg-ui-hover hover:text-ui-primary", dsFocus);

function NotificationRow({ item, onControl, onOpen }: { item: NotificationItem; onControl: (id: string, control: NotificationControl) => void; onOpen: (item: NotificationItem) => void }) {
  const urgent = item.tone === "danger" || item.tone === "warning";
  return <li className={cn("rounded-xl border border-ui-stroke bg-ui-table p-3", urgent && "border-l-2", item.tone === "danger" ? "border-l-ui-danger" : item.tone === "warning" ? "border-l-ui-warning" : "")}>
    <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><p className="m-0 text-body font-medium text-ui-primary">{item.subject}{!item.read && <span aria-label="Unread" className="ml-2 inline-block size-1.5 rounded-full bg-ui-info" />}</p>
      <p className={cn("mb-0 mt-1 text-caption", item.tone === "danger" ? "text-ui-danger" : item.tone === "warning" ? "text-ui-warning" : "text-ui-secondary")}>{item.title}</p></div><span className="text-caption text-ui-muted">{item.age}</span></div>
    <p className="mb-2 mt-2 text-caption leading-relaxed text-ui-secondary">{item.detail}</p>
    <div className="flex items-center justify-between gap-2"><Button variant={urgent ? "secondary" : "ghost"} size="sm" onClick={() => onOpen(item)}>{item.action}</Button>
      <button type="button" aria-label={`${item.read ? "Mark unread" : "Mark read"}: ${item.title}`} title={item.read ? "Mark unread" : "Mark read"} className={iconButton} onClick={() => onControl(item.id, "read")}>{item.read ? <Mail aria-hidden className="size-3.5" /> : <CheckCheck aria-hidden className="size-3.5" />}</button>
    </div>
  </li>;
}

export function NotificationsView({ state, filter, onFilter, open, onOpenChange, onControl, onOpen, notice }: {
  state: NotificationsState; filter: NotificationFilter; onFilter: (filter: NotificationFilter) => void;
  open: boolean; onOpenChange: (open: boolean) => void; onControl: (id: string, control: NotificationControl) => void;
  onOpen: (item: NotificationItem) => void; notice: string; onEnable?: () => void;
}) {
  const view = notificationView(state, filter);
  const surface = useRef<HTMLDivElement>(null);
  const control = (id: string, action: NotificationControl) => {
    const focused = document.activeElement;
    onControl(id, action);
    window.requestAnimationFrame(() => { if (focused instanceof HTMLElement && !focused.isConnected) surface.current?.querySelector<HTMLButtonElement>(`[data-notification-filter="${filter}"]`)?.focus(); });
  };
  const groups = [...new Set(view.shown.map(item => item.workflow))];
  const failures = state.state === "ready" ? state.items.filter(item => item.tone === "danger").length : undefined;
  const waiting = state.state === "ready" ? state.items.filter(item => item.tone === "warning").length : undefined;
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild><button type="button" aria-label={state.state === "loading" ? "Notifications loading" : state.state === "unavailable" ? "Notifications unavailable" : `Notifications, ${view.unread} unread`} title="Notifications" className={cn(iconButton, "relative")}><Bell aria-hidden className="size-4" />{view.unread !== undefined && view.unread > 0 && <span aria-label={`${view.unread} unread notifications`} className="absolute right-1 top-1 size-1.5 rounded-full bg-ui-info" />}</button></PopoverTrigger>
    <PopoverContent surfaceRef={surface} title="Notifications" hideTitle hideClose align="end" className="ui-theme-scope flex max-h-[min(680px,calc(100vh-90px))] w-[420px] flex-col overflow-hidden rounded-2xl border border-ui-stroke bg-ui-panel p-0 font-ui text-ui-primary" width="md">
      <div className="flex items-center justify-between px-4 pb-3 pt-4"><h2 className="m-0 text-section font-medium">Workflow updates</h2><PopoverClose asChild><button aria-label="Close notifications" className={iconButton}><X aria-hidden className="size-4" /></button></PopoverClose></div>
      {state.state === "ready" && <div className="mx-4 mb-3 grid grid-cols-2 gap-2"><div className="flex items-center gap-2 rounded-xl bg-ui-table px-3 py-2"><Clock3 className="size-3.5 text-ui-warning" /><span className="flex-1 text-caption">Waiting for you</span><strong className="text-body font-medium">{waiting}</strong></div><div className="flex items-center gap-2 rounded-xl bg-ui-table px-3 py-2"><CircleAlert className="size-3.5 text-ui-danger" /><span className="flex-1 text-caption">Failed</span><strong className="text-body font-medium">{failures}</strong></div></div>}
      <div role="group" aria-label="Notification filters" className="mx-4 mb-3 flex gap-1 rounded-xl bg-ui-canvas p-1">{NOTIFICATION_VIEW_FILTERS.map(item => <button type="button" key={item.id} data-notification-filter={item.id} aria-pressed={filter === item.id} onClick={() => onFilter(item.id)} className={cn("flex-1 rounded-lg px-2 py-1.5 text-caption", dsFocus, filter === item.id ? "bg-ui-hover text-ui-primary" : "text-ui-secondary hover:text-ui-primary")}>{item.label}</button>)}</div>
      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
        {view.pinned.map(item => <details key={item.id} className="mb-3 rounded-xl border border-ui-stroke p-3"><summary className={cn("flex cursor-pointer list-none items-center gap-2 text-caption [&::-webkit-details-marker]:hidden", dsFocus)}><ShieldAlert aria-hidden className="size-3.5 text-ui-warning" />{item.title}</summary><p className="mb-0 mt-2 text-caption text-ui-secondary">{item.detail}</p></details>)}
        {state.state === "loading" ? <div role="status" aria-label="Loading notifications" className="space-y-3">{[0,1,2].map(index => <Skeleton key={index} className="h-24 rounded-xl" />)}</div> : state.state === "unavailable" ? <div role="alert" className="py-8 text-center"><CircleAlert aria-hidden className="mx-auto mb-2 size-5 text-ui-warning" /><p className="m-0 text-body">Notifications unavailable</p><p className="mb-0 mt-2 text-caption text-ui-secondary">{state.reason}</p></div> : <>
          {groups.map(workflow => <section key={workflow} aria-label={`${workflow} updates`} className="mb-4 last:mb-0"><h3 className="mb-2 mt-0 text-caption font-normal text-ui-muted">{workflow}</h3><ul aria-label={`${workflow} notifications`} className="m-0 flex list-none flex-col gap-2 p-0">{view.shown.filter(item => item.workflow === workflow).map(item => <NotificationRow key={item.id} item={item} onControl={control} onOpen={onOpen} />)}</ul></section>)}
          {view.shown.length === 0 && <p className="py-6 text-center text-body text-ui-secondary">{filter === "all" || state.state === "ready" && state.items.length === 0 ? "No notifications" : filter === "unread" ? "All caught up" : filter === "failed" ? "No failures" : "Nothing needs attention"}</p>}
        </>}
      </div>
      {notice && <p role="status" className="m-0 border-t border-ui-stroke px-4 py-3 text-caption text-ui-secondary">{notice}</p>}
      <p className="m-0 border-t border-ui-stroke px-4 py-2 text-caption text-ui-muted">Marking an update read keeps the run’s action pending.</p>
    </PopoverContent>
  </Popover>;
}

export function NotificationPing({ item, onOpen }: { item: NotificationItem; onClose: () => void; onOpen: () => void }) {
  const { toast } = useToasts();
  const sent = useRef(false);
  useEffect(() => { if (sent.current) return; sent.current = true; toast({ tone: "success", title: item.title, description: `${item.subject} · ${item.workflow}`, action: { label: "Open notifications", onAction: onOpen } }); }, [item, onOpen, toast]);
  return null;
}
