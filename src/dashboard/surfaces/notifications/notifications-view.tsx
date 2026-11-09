import { ArrowLeft, Bell, CircleAlert, CircleCheck, Clock, HardDrive, Info, Unplug, type LucideIcon } from "lucide-react";
import { forwardRef, useEffect, useRef } from "react";
import { IconButton, Skeleton, dsFocus, dsIcon, useToasts } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import { LoadingRegion } from "../shared/loading/loading.js";
import { shortAge, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";
import "./notifications-panel.css";

const TONE_COLOR = { danger: "text-ui-danger", warning: "text-ui-warning", positive: "text-ui-positive", info: "text-ui-muted" } as const;

function itemIcon(item: NotificationItem): LucideIcon {
  if (item.kind === "storage") return HardDrive;
  if (item.kind === "chatgpt") return Unplug;
  return item.tone === "danger" ? CircleAlert : item.tone === "warning" ? Clock : item.tone === "positive" ? CircleCheck : Info;
}

/** Runs name the subject and workflow on the grey line; the other notices carry their own sentence. */
const itemLine = (item: NotificationItem) => item.kind === "run" ? `${item.subject} · ${item.workflow}` : item.detail;

function NotificationRow({ item, onOpen }: { item: NotificationItem; onOpen: (item: NotificationItem) => void }) {
  const Icon = itemIcon(item);
  return <li><button type="button" className={cn("notification-item", dsFocus)} onClick={() => onOpen(item)}>
    <Icon aria-hidden className={TONE_COLOR[item.tone]} />
    <span className="notification-item-copy"><span className="notification-item-title">{item.title}</span><span className="notification-item-line">{itemLine(item)}</span></span>
    <span className="notification-item-meta"><span className="notification-item-time">{shortAge(item.age)}</span><span aria-hidden className="notification-unread-dot" data-read={item.read} />{!item.read && <span className="sr-only">Unread</span>}</span>
  </button></li>;
}

function NotificationGroup({ label, items, onOpen }: { label: string; items: readonly NotificationItem[]; onOpen: (item: NotificationItem) => void }) {
  if (items.length === 0) return null;
  return <section aria-label={label}><h3 className="notification-group-label">{label}</h3><ul className="notification-list">{items.map(item => <NotificationRow key={item.id} item={item} onOpen={onOpen} />)}</ul></section>;
}

/** The sidebar body while the bell is pressed: header, Today and Earlier groups, or one grey line when there is nothing. */
export function NotificationsPanel({ state, onReadAll, onOpen, onBack, notice }: {
  state: NotificationsState; onReadAll: () => void; onOpen: (item: NotificationItem) => void; onBack: () => void; notice: string;
}) {
  const items = state.state === "ready" ? state.items : [];
  const empty = state.state === "ready" && items.length === 0;
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) return;
      event.preventDefault(); onBack();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [onBack]);
  return <section aria-label="Notifications" className="notification-panel font-ui">
    <header className="settings-nav-header notification-panel-head"><h2>Notifications</h2>
      <IconButton label="Back to workflows" size="sm" icon={<ArrowLeft className={dsIcon.md} />} onClick={onBack} />
    </header>
    <div className="notification-panel-toolbar"><button type="button" disabled={!items.some(item => !item.read)} className={cn("notification-mark-read", dsFocus)} onClick={onReadAll}>Mark all read</button></div>
    <div className="notification-panel-scroll rail-scroll">
      {state.state === "loading" ? <LoadingRegion label="Loading notifications"><div aria-hidden>{[0, 1, 2].map(index => <div key={index} className="flex items-center gap-2.5 px-2 py-2"><Skeleton className="size-4 rounded-full" /><Skeleton className="h-8 flex-1" /></div>)}</div></LoadingRegion>
        : state.state === "unavailable" ? <p role="alert" className="notification-empty">Notifications unavailable. {state.reason}</p>
        : empty ? <p className="notification-empty">You're all caught up.</p>
        : <><NotificationGroup label="Today" items={items.filter(item => !item.earlier)} onOpen={onOpen} /><NotificationGroup label="Earlier" items={items.filter(item => item.earlier)} onOpen={onOpen} /></>}
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
