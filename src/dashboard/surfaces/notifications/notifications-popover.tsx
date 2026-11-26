import { Bell, CheckCheck, ChevronRight, Info, Mail, MailOpen, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Drawer, DrawerContent, DrawerTrigger, EmptyState, IconButton, Popover, PopoverContent, PopoverTrigger, SegmentedChoice, Skeleton, StatusIcon, Tooltip, dsFocus, dsIcon } from "../../ds/ui.js";
import { mockParam } from "../../app/mock-surfaces.js";
import { cn } from "../../lib/utils.js";
import { useServedView } from "../../state/served-clock.js";
import { LoadingRegion } from "../shared/loading/loading.js";
import { itemClearable, itemContext, itemDay, itemSource, notificationAge, type NotificationControl, type NotificationItem, type NotificationsState } from "./notifications-view-model.js";
import "./notifications-popover.css";

/** Design options for #944, reachable only from the mock harness (`?notifications=rows|workflows|panel`) and the gallery. */
export type NoticeVariant = "rows" | "workflows" | "panel";
const VARIANTS: readonly string[] = ["rows", "workflows", "panel"];

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
function ToneIcon({ item }: { item: NotificationItem }) {
  return item.tone === "info" ? <Info aria-hidden className={cn(dsIcon.md, "shrink-0 text-[color:var(--ds-fg-muted)]")} />
    : <StatusIcon status={item.tone === "danger" ? "failed" : item.tone === "positive" ? "verifiedDone" : item.kind === "run" ? "waiting" : "doneWarnings"} />;
}

/** The option rows. `rows`: the person or run leads, the workflow and reason sit under it. `workflows`: one line, the section names the workflow.
 * `panel`: the three lines of today's row under a status icon, with the next step named on a waiting or failed notice. */
function variantText(item: NotificationItem, variant: NoticeVariant) {
  const lead = (item.kind === "run" || item.kind === "command") && item.subject !== "" ? item.subject : item.title;
  const detail = item.gone ? "This run was deleted." : item.detail;
  const count = item.count !== undefined && <span className="notice-count"><span className="sr-only">{item.count} times</span><span aria-hidden>{item.count > 999 ? "999+" : item.count}</span></span>;
  const context = item.kind === "storage" ? "" : itemContext(item);
  return <>
    <span className="notice-head">
      <ToneIcon item={item} />
      <span className="notice-title">{variant === "panel" ? item.title : <>{lead !== item.title && <span className="sr-only">{item.title}: </span>}{lead}</>}</span>
      {variant === "workflows" && <span className="notice-inline">{detail}</span>}
      {count}
      {!item.read && <><span aria-hidden className="notice-unread" /><span className="sr-only">Unread</span></>}
      <Age item={item} />
    </span>
    {variant === "rows" && <span className="notice-detail">{[item.workflow, detail].filter(part => part !== "").join(" · ")}</span>}
    {variant === "panel" && <>
      {context !== "" && <span className="notice-context">{context}</span>}
      <span className="notice-detail">{detail}</span>
      {item.priority && !item.read && !item.gone && item.action !== "" && <span className="notice-cta">{item.action}<ChevronRight aria-hidden className="size-3" /></span>}
    </>}
  </>;
}

function NoticeRow({ item, handlers, variant }: { item: NotificationItem; handlers: RowHandlers; variant?: NoticeVariant | undefined }) {
  const enabled = handlers.canAct(item.id), context = item.kind === "storage" ? "" : itemContext(item);
  const text = variant !== undefined ? variantText(item, variant) : <>
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

function NoticeGroup({ label, meta = "", items, handlers, variant }: { label: string; meta?: string; items: readonly NotificationItem[]; handlers: RowHandlers; variant?: NoticeVariant | undefined }) {
  return <section aria-label={label} className="notice-group"><h3 className="notice-group-label">{label}{meta !== "" && <span className="notice-group-meta">{meta}</span>}</h3>
    <ul className="notice-list">{items.map(item => <NoticeRow key={item.id} item={item} handlers={handlers} variant={variant} />)}</ul></section>;
}

export type NotificationsShow = "all" | "unread";
const SHOW_OPTIONS = [{ value: "all", label: "All" }, { value: "unread", label: "Unread" }] as const;

/** The bell and the surface it opens: a popover anchored to the bell, over the page, with its own scroll. Unread failures and waits
 * sit under Needs you; everything else falls into its day. It is modal, so Tab stays inside it until it closes. */
export function NotificationsPopover({ state, open, onOpenChange, show, onShow, onReadAll, onClearAll, notice = "", onClear, variant: chosen, ...handlers }: RowHandlers & {
  variant?: NoticeVariant;
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
  const asked = chosen ?? mockParam("notifications"), variant = asked !== null && VARIANTS.includes(asked) ? asked as NoticeVariant : undefined;
  const sourceOf = (item: NotificationItem) => item.kind === "storage" || item.kind === "chatgpt" ? "Relay" : itemSource(item);
  const sources = [...new Set(items.map(sourceOf))];
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
  const [Root, Trigger] = variant === "panel" ? [Drawer, DrawerTrigger] : [Popover, PopoverTrigger];
  return <Root modal open={open} onOpenChange={onOpenChange}>
    <Tooltip side="bottom" content="Notifications" {...(open ? { open: false as const } : {})}><Trigger asChild>
      <IconButton variant="ghost" size="sm" className="notice-bell" label={label} title=""
        icon={<><Bell aria-hidden className="size-4" />
          {unread > 0 && <span aria-hidden className="notice-bell-status"><span className="notice-bell-dot" /><span className="notice-bell-count">{unread > 99 ? "99+" : unread}</span></span>}</>} />
    </Trigger></Tooltip>
    {(body => variant === "panel" ? <DrawerContent title="Notifications" size="420px" className="notice-panel font-ui">{body}</DrawerContent>
      /* Opening focuses the panel itself; the filter would draw its focus ring before anyone has reached it. */
      : <PopoverContent title="Notifications" hideTitle side="bottom" align="start" sideOffset={8} className={cn("notice-popover font-ui outline-none", variant !== undefined && `notice-popover-${variant}`)}
        onOpenAutoFocus={event => { event.preventDefault(); (event.currentTarget as HTMLElement).focus(); }}>{body}</PopoverContent>)(<>
      <header ref={headRef} tabIndex={-1} className={cn("notice-popover-head", dsFocus)}>
        <p className="notice-popover-title">{variant === "panel" ? `${unread} unread` : "Notifications"}</p>
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
          : variant === "workflows" ? sources.map(source => { const own = items.filter(item => sourceOf(item) === source), fresh = own.filter(item => !item.read).length;
            return <NoticeGroup key={source} label={source} meta={fresh > 0 ? `${fresh} unread` : ""} items={own} handlers={rowHandlers} variant={variant} />; })
          : variant === "rows" ? <>
            {needsYou.length > 0 && <NoticeGroup label="Needs you" items={needsYou} handlers={rowHandlers} variant={variant} />}
            {rest.length > 0 && <NoticeGroup label="Earlier" items={rest} handlers={rowHandlers} variant={variant} />}
          </>
          : <>
            {needsYou.length > 0 && <NoticeGroup label="Needs you" items={needsYou} handlers={rowHandlers} variant={variant} />}
            {days.map(day => <NoticeGroup key={day} label={day} items={rest.filter(item => itemDay(item) === day)} handlers={rowHandlers} variant={variant} />)}
          </>}
      </div>
      {notice !== "" && <p role="status" className="notice-status">{notice}</p>}
    </>)}
  </Root>;
}
