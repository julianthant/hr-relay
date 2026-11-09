import { CircleAlert, CircleCheck, Clock, HardDrive, Info, Unplug, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { DropdownMenuItemCopy, Skeleton, dsFocus, useToasts } from "../../ds/ui.js";
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
    <DropdownMenuItemCopy title={item.title} description={itemLine(item)} />
    <span className="notification-item-meta"><span>{shortAge(item.age)}</span><span aria-hidden className="notification-unread-dot" data-read={item.read} />{!item.read && <span className="sr-only">Unread</span>}</span>
  </button></li>;
}

function NotificationGroup({ label, items, onOpen }: { label: string; items: readonly NotificationItem[]; onOpen: (item: NotificationItem) => void }) {
  if (items.length === 0) return null;
  return <section aria-label={label}><div className="ds-menu-label">{label}</div><ul className="notification-list">{items.map(item => <NotificationRow key={item.id} item={item} onOpen={onOpen} />)}</ul></section>;
}

/** The bell's panel body: header, Today and Earlier groups, or one grey line when there is nothing. */
export function NotificationsPanel({ state, onReadAll, onOpen, notice }: {
  state: NotificationsState; onReadAll: () => void; onOpen: (item: NotificationItem) => void; notice: string;
}) {
  const items = state.state === "ready" ? state.items : [];
  const today = items.filter(item => !item.earlier);
  const earlier = items.filter(item => item.earlier);
  const empty = state.state === "ready" && items.length === 0;
  return <div role="region" aria-label="Notifications" className="notification-panel font-ui">
    <div className="notification-panel-head"><h2>Notifications</h2>
      <button type="button" disabled={!items.some(item => !item.read)} className={cn("notification-mark-read", dsFocus)} onClick={onReadAll}>Mark all read</button>
    </div>
    <div className="notification-panel-scroll">
      {state.state === "loading" ? <LoadingRegion label="Loading notifications"><div aria-hidden>{[0, 1, 2].map(index => <div key={index} className="flex items-center gap-2.5 px-3 py-2"><Skeleton className="size-4 rounded-full" /><Skeleton className="h-8 flex-1" /></div>)}</div></LoadingRegion>
        : state.state === "unavailable" ? <p role="alert" className="notification-empty">Notifications unavailable. {state.reason}</p>
        : empty ? <p className="notification-empty">You're all caught up.</p>
        : <><NotificationGroup label="Today" items={today} onOpen={onOpen} />{today.length > 0 && earlier.length > 0 && <div role="separator" className="ds-menu-separator" />}<NotificationGroup label="Earlier" items={earlier} onOpen={onOpen} /></>}
    </div>
    {notice && <p role="status" className="notification-notice">{notice}</p>}
  </div>;
}

export function NotificationPing({ item }: { item: NotificationItem }) {
  const { toast } = useToasts();
  const sent = useRef(false);
  useEffect(() => { if (sent.current) return; sent.current = true; toast({ tone: "success", title: item.title, description: `${item.subject} · ${item.workflow}`}); }, [item, toast]);
  return null;
}
