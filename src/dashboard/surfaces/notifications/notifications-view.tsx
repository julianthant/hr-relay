import { CheckCheck, CircleAlert, Mail } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button, Skeleton, dsFocus, useToasts } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { notificationView, type NotificationControl, type NotificationFilter, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";

const iconButton = cn("inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-ui-secondary hover:bg-ui-hover hover:text-ui-primary", dsFocus);

function NotificationRow({ item, onControl, onOpen }: { item: NotificationItem; onControl: (id: string, control: NotificationControl) => void; onOpen: (item: NotificationItem) => void }) {
  const urgent = item.tone === "danger" || item.tone === "warning";
  return <li className="notification-row group border-b border-ui-stroke px-3 py-3 last:border-b-0 hover:bg-ui-hover">
    <div className="flex items-start gap-2"><span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", item.tone === "danger" ? "bg-ui-danger" : item.tone === "warning" ? "bg-ui-warning" : !item.read ? "bg-ui-info" : "bg-ui-stroke")} />
      <div className="min-w-0 flex-1"><button type="button" className={cn("block w-full truncate text-left text-body text-ui-primary", dsFocus)} onClick={() => onOpen(item)}>{item.subject}</button>
        <p className={cn("mb-0 mt-1 text-caption", urgent ? item.tone === "danger" ? "text-ui-danger" : "text-ui-warning" : "text-ui-secondary")}>{item.title}</p>
        <p className="mb-0 mt-1 line-clamp-2 text-caption text-ui-muted">{item.detail}</p>
        <div className="mt-2 flex items-center gap-2 text-caption text-ui-muted"><span className="truncate">{item.workflow}</span><span aria-hidden>·</span><span className="shrink-0">{item.age}</span></div>
      </div><button type="button" aria-label={`${item.read ? "Mark unread" : "Mark read"}: ${item.title}`} title={item.read ? "Mark unread" : "Mark read"} className={iconButton} onClick={() => onControl(item.id, "read")}>{item.read ? <Mail aria-hidden className="size-3.5" /> : <CheckCheck aria-hidden className="size-3.5" />}</button>
    </div>
    {urgent && <Button variant="ghost" size="sm" className="ml-3.5 mt-1 h-6 px-1 text-ui-info" onClick={() => onOpen(item)}>{item.action}</Button>}
  </li>;
}

export function NotificationsView({ state, filter, onFilter, onControl, onOpen, notice }: {
  state: NotificationsState; filter: NotificationFilter; onFilter: (filter: NotificationFilter) => void;
  onControl: (id: string, control: NotificationControl) => void;
  onOpen: (item: NotificationItem) => void; notice: string; onEnable?: () => void;
}) {
  const view = notificationView(state, filter);
  const surface = useRef<HTMLDivElement>(null);
  const control = (id: string, action: NotificationControl) => {
    const focused = document.activeElement;
    onControl(id, action);
    window.requestAnimationFrame(() => { if (focused instanceof HTMLElement && !focused.isConnected) surface.current?.querySelector<HTMLButtonElement>(`[data-notification-filter="${filter}"]`)?.focus(); });
  };
  const unread = state.state === "ready" ? state.items.filter(item => !item.read) : [];
  return <section ref={surface} role="region" aria-label="Notifications" className="notification-rail ui-theme-scope flex min-h-0 flex-1 flex-col overflow-hidden font-ui text-ui-primary">
    <div className="flex items-center justify-between gap-2 px-7 pb-3"><span className="text-caption text-ui-muted">Notifications{view.unread !== undefined && ` · ${view.unread} unread`}</span>
      <button type="button" disabled={!unread.length} className={cn("text-caption text-ui-secondary hover:text-ui-primary disabled:opacity-40", dsFocus)} onClick={() => unread.forEach(item => control(item.id, "read"))}>Read all</button>
    </div>
    <div role="group" aria-label="Notification filters" className="mx-4 mb-1 flex gap-1 border-b border-ui-stroke">
      {([{ id: "all", label: "All" }, { id: "unread", label: "Unread" }, { id: "attention", label: "Needs you" }, { id: "failed", label: "Failed" }] as const).map(item => <button type="button" key={item.id} data-notification-filter={item.id} aria-pressed={filter === item.id} onClick={() => onFilter(item.id)} className={cn("min-w-0 flex-1 border-b-2 px-0 py-2 text-[11px]", dsFocus, filter === item.id ? "border-ui-info text-ui-primary" : "border-transparent text-ui-muted hover:text-ui-primary")}>{item.label}</button>)}
    </div>
      <div className="rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {state.state === "loading" ? <div role="status" aria-label="Loading notifications" className="space-y-3">{[0,1,2].map(index => <Skeleton key={index} className="h-24 rounded-xl" />)}</div> : state.state === "unavailable" ? <div role="alert" className="py-8 text-center"><CircleAlert aria-hidden className="mx-auto mb-2 size-5 text-ui-warning" /><p className="m-0 text-body">Notifications unavailable</p><p className="mb-0 mt-2 text-caption text-ui-secondary">{state.reason}</p></div> : <>
          <ul aria-label="Notification updates" className="m-0 list-none p-0">{view.shown.map(item => <NotificationRow key={item.id} item={item} onControl={control} onOpen={onOpen} />)}</ul>
          {view.shown.length === 0 && <p className="py-6 text-center text-body text-ui-secondary">{filter === "all" || state.state === "ready" && state.items.length === 0 ? "No notifications" : filter === "unread" ? "All caught up" : filter === "failed" ? "No failures" : "Nothing needs attention"}</p>}
        </>}
      </div>
      {notice && <p role="status" className="m-0 border-t border-ui-stroke px-3 py-3 text-caption text-ui-secondary">{notice}</p>}

  </section>;
}

export function NotificationPing({ item, onOpen }: { item: NotificationItem; onClose: () => void; onOpen: () => void }) {
  const { toast } = useToasts();
  const sent = useRef(false);
  useEffect(() => { if (sent.current) return; sent.current = true; toast({ tone: "success", title: item.title, description: `${item.subject} · ${item.workflow}`, action: { label: "Open notifications", onAction: onOpen } }); }, [item, onOpen, toast]);
  return null;
}
