import { Tabs } from "@heroui/react/tabs";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../../ds/dropdown-menu.js";
import { CheckCheck, CircleAlert, Mail, ListFilter } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button, Skeleton, dsFocus, useToasts } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { notificationView, type NotificationCategory, type NotificationControl, type NotificationFilter, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";

const iconButton = cn("inline-flex size-7 shrink-0 items-center justify-center rounded-lg text-ui-secondary hover:bg-ui-hover hover:text-ui-primary", dsFocus);

function NotificationRow({ item, onControl, onOpen }: { item: NotificationItem; onControl: (id: string, control: NotificationControl) => void; onOpen: (item: NotificationItem) => void }) {
  const urgent = item.tone === "danger" || item.tone === "warning";
  return <li className="notification-row group rounded-lg px-3 py-3 hover:bg-ui-hover focus-within:bg-ui-hover">
    <div className="flex items-start gap-2"><span aria-hidden className={cn("mt-1.5 size-1.5 shrink-0 rounded-full", item.tone === "danger" ? "bg-ui-danger" : item.tone === "warning" ? "bg-ui-warning" : !item.read ? "bg-ui-info" : "bg-ui-stroke")} />
      <div className="min-w-0 flex-1"><button type="button" className={cn("block min-h-6 w-full truncate text-left text-body text-ui-primary", dsFocus)} onClick={() => onOpen(item)}>{item.subject}</button>
        <p className={cn("mb-0 mt-1 text-caption", urgent ? item.tone === "danger" ? "text-ui-danger" : "text-ui-warning" : "text-ui-secondary")}>{item.title}</p>
        <p className="mb-0 mt-1 line-clamp-2 text-caption text-ui-muted">{item.detail}</p>
        <div className="mt-2 flex items-center gap-2 text-caption text-ui-muted"><span className="truncate">{item.workflow}</span>{item.age && <><span aria-hidden>·</span><span className="shrink-0">{item.age}</span></>}</div>
      </div><button type="button" aria-label={`${item.read ? "Mark unread" : "Mark read"}: ${item.title}`} title={item.read ? "Mark unread" : "Mark read"} className={iconButton} onClick={() => onControl(item.id, item.read ? "unread" : "read")}>{item.read ? <Mail aria-hidden className="size-3.5" /> : <CheckCheck aria-hidden className="size-3.5" />}</button>
    </div>
    <Button variant="ghost" size="sm" className="ml-3.5 mt-1 h-6 px-1 text-ui-info" onClick={() => onOpen(item)}>{item.action}</Button>
  </li>;
}

export function NotificationsView({ state, filter, onFilter, category, onCategory, onControl, onReadAll, onOpen, notice }: {
  state: NotificationsState; filter: NotificationFilter; onFilter: (filter: NotificationFilter) => void;
  category: NotificationCategory; onCategory: (category: NotificationCategory) => void;
  onControl: (id: string, control: NotificationControl) => void; onReadAll: () => void;
  onOpen: (item: NotificationItem) => void; notice: string; onEnable?: () => void;
}) {
  const view = notificationView(state, filter, category);
  const surface = useRef<HTMLDivElement>(null);
  const restoreFocus = (focused: Element | null) => window.requestAnimationFrame(() => {
    if (focused instanceof HTMLElement && (!focused.isConnected || focused.matches(":disabled"))) surface.current?.querySelector<HTMLButtonElement>(`[data-notification-filter="${filter}"]`)?.focus();
  });
  const control = (id: string, action: NotificationControl) => {
    const focused = document.activeElement;
    onControl(id, action);
    restoreFocus(focused);
  };
  const unread = state.state === "ready" ? state.items.filter(item => !item.read) : [];
  return <section ref={surface} role="region" aria-label="Notifications" className="notification-rail ui-theme-scope flex min-h-0 flex-1 flex-col overflow-hidden font-ui text-ui-primary">
    <div className="flex items-center justify-between gap-2 px-4 pb-3"><span className="text-caption text-ui-muted">Notifications{view.unread !== undefined && ` · ${view.unread} unread`}</span>
      <button type="button" disabled={!unread.length} className={cn("min-h-6 text-caption text-ui-secondary hover:text-ui-primary disabled:opacity-40", dsFocus)} onClick={() => { const focused = document.activeElement; onReadAll(); restoreFocus(focused); }}>Read all</button>
    </div>
    <Tabs selectedKey={filter === "unread" ? "unread" : "all"} onSelectionChange={key => onFilter(key as NotificationFilter)} variant="secondary" className="notification-tabs">
      <div className="notification-filter-bar">
        <Tabs.ListContainer><Tabs.List aria-label="Notification filters">
          <Tabs.Tab id="all" data-notification-filter="all">All<Tabs.Indicator /></Tabs.Tab>
          <Tabs.Tab id="unread" data-notification-filter="unread">Unread<Tabs.Indicator /></Tabs.Tab>
        </Tabs.List></Tabs.ListContainer>
        <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="ghost" className="notification-category-filter" data-filtered={category !== "all"} aria-label="Filter notifications by category" title={category === "all" ? "All updates" : category === "attention" ? "Needs you" : "Failed"} icon={<ListFilter className="size-3.5" data-icon="inline-start" />} /></DropdownMenuTrigger>
          <DropdownMenuContent aria-label="Notification categories" align="end"><DropdownMenuGroup><DropdownMenuRadioGroup value={category} onValueChange={value => onCategory(value as NotificationCategory)}>
            <DropdownMenuRadioItem value="all">All updates</DropdownMenuRadioItem><DropdownMenuRadioItem value="attention">Needs you</DropdownMenuRadioItem><DropdownMenuRadioItem value="failed">Failed</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup></DropdownMenuGroup></DropdownMenuContent>
        </DropdownMenu>
      </div>
      {(["all", "unread"] as const).map(tab => <Tabs.Panel key={tab} id={tab} className="notification-tab-panel">
      <div className="rail-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3">
        {state.state === "loading" ? <div role="status" aria-label="Loading notifications" className="flex flex-col gap-3">{[0,1,2].map(index => <Skeleton key={index} className="h-24 rounded-xl" />)}</div> : state.state === "unavailable" ? <div role="alert" className="py-8 text-center"><CircleAlert aria-hidden className="mx-auto mb-2 size-5 text-ui-warning" /><p className="m-0 text-body">Notifications unavailable</p><p className="mb-0 mt-2 text-caption text-ui-secondary">{state.reason}</p></div> : <>
          <ul aria-label="Notification updates" className="m-0 list-none p-0">{view.shown.map(item => <NotificationRow key={item.id} item={item} onControl={control} onOpen={onOpen} />)}</ul>
          {view.shown.length === 0 && <p className="py-6 text-center text-body text-ui-secondary">{state.state === "ready" && state.items.length === 0 ? "No notifications" : category === "failed" ? "No failures" : category === "attention" ? "Nothing needs attention" : filter === "unread" ? "All caught up" : "No notifications"}</p>}
        </>}
      </div>
      </Tabs.Panel>)}
    </Tabs>
      {notice && <p role="status" className="m-0 border-t border-ui-stroke px-3 py-3 text-caption text-ui-secondary">{notice}</p>}

  </section>;
}

export function NotificationPing({ item, onOpen }: { item: NotificationItem; onClose: () => void; onOpen: () => void }) {
  const { toast } = useToasts();
  const sent = useRef(false);
  useEffect(() => { if (sent.current) return; sent.current = true; toast({ tone: "success", title: item.title, description: `${item.subject} · ${item.workflow}`, action: { label: "Open notifications", onAction: onOpen } }); }, [item, onOpen, toast]);
  return null;
}
