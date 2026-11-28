import { type ReactNode } from "react";
import { parseDate } from "@internationalized/date";
import { ArrowDownUp, CalendarDays, ListFilter, Plus, Settings2 } from "lucide-react";
import { BareButton, Calendar, IconButton, Tooltip, dsFocus } from "../../ds/ui.js";
import { cn } from "../../lib/utils.js";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuItemCopy, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "../../ds/primitives/dropdown-menu.js";
import { QUEUE_SORTS, type QueueOrder, type QueueSortKey } from "./queue-model.js";
import { needsYouCount, statusCount, totalCount, type StatusBucket, type StatusCountWire } from "../shell/shell-model.js";
import { PROPOSED_STATUS, dsStatusOf } from "../shared/status/status-model.js";
import { nonDefaultOptionCount, shownStatuses, statusFilterValue, toggleQueueFilter } from "./queue-filter-model.js";
import { formatMonthDay } from "../../lib/date-format.js";

const GROUPS: readonly { label: string; statuses: readonly StatusBucket[] }[] = [
  { label: "Quick filters", statuses: ["all", "needsYou"] },
  { label: "In progress", statuses: ["queued", "running", "cancelling", "blocked", "awaiting-approval"] },
  { label: "Finished", statuses: ["done", "failed", "cancelled", "partial"] },
];
const ORDERS = QUEUE_SORTS.filter(entry => entry.key !== "attention");

/** The day comes from the URL, so it can be unreadable; the calendar then opens on today. */
function calendarDay(day: string, today: string) {
  try { return parseDate(day); } catch { return parseDate(today); }
}

/** The card above the queue: the workflow's title, then Ask, Options and Start run as plain icon buttons. */
export function QueueHeader({ title, ask, startId, onStartRun, day, today, onDay, sort, order: grouped, onSort, active, counts, onFilter, dayMark }: {
  title: string; ask: ReactNode; startId: string; onStartRun: () => void;
  day: string; today: string; onDay: (day: string) => void; dayMark?: ReactNode;
  sort: QueueSortKey; order: QueueOrder; onSort: (next: QueueSortKey, order: QueueOrder) => void;
  active: readonly StatusBucket[]; counts: readonly StatusCountWire[]; onFilter: (next: readonly StatusBucket[]) => void;
}) {
  // Attention first groups the runs; the chosen order applies inside each group, or to the whole queue when it is off.
  const order = sort === "attention" ? grouped : sort;
  const label = (status: StatusBucket) => status === "all" ? "All" : status === "needsYou" ? "Needs you" : status === "awaiting-approval" ? "Needs approval" : PROPOSED_STATUS[dsStatusOf(status)].accessibleLabel;
  const count = (status: StatusBucket) => status === "all" ? totalCount(counts) : status === "needsYou" ? needsYouCount(counts) : statusCount(counts, status);
  const changed = nonDefaultOptionCount({ day, today, sort, order, active });
  const dayLabel = day === today ? "Today" : /^\d{4}-\d{2}-\d{2}$/u.test(day) ? formatMonthDay(`${day}T00:00:00Z`, "UTC", "short") : day;
  // Day first: it replaces the route, the other two build on the pending one.
  const reset = () => { if (day !== today) onDay(today); onFilter(["all"]); onSort("attention", "newest"); };
  return <header aria-label="Queue header" className="queue-header">
    <h2 className="queue-header-title">{title}</h2>
    <div className="queue-header-actions">
      {ask}
      {dayMark}
      <DropdownMenu>
        <Tooltip side="bottom" content="Options">
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" size="sm" className="queue-options-trigger" label={changed > 0 ? `Options, ${String(changed)} changed` : "Options"} title="" icon={<span className="relative inline-flex"><Settings2 aria-hidden strokeWidth={1.75} />{changed > 0 && <span aria-hidden className="queue-options-badge">{changed}</span>}</span>} />
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent aria-label="Queue options" align="end" className="queue-options-menu">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><CalendarDays aria-hidden />Date<span className="queue-options-value">{day !== today && <span aria-hidden className="queue-options-dot" />}{dayLabel}</span></DropdownMenuSubTrigger>
            <DropdownMenuSubContent aria-label="Pick a date" className="queue-date-menu">
              {/* A calendar is not menu items: its keys stay inside, so Tab and the arrows work it. Escape still closes. */}
              <div onKeyDown={event => { if (event.key !== "Escape") event.stopPropagation(); }}>
                <Calendar autoFocus label="Dashboard date" value={calendarDay(day, today)} maxValue={parseDate(today)} onChange={date => onDay(date.toString())} />
                <div className="queue-date-footer"><BareButton type="button" className={cn("queue-date-today", dsFocus)} onClick={() => onDay(today)}>Today</BareButton><span>Runs from this day</span></div>
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><ArrowDownUp aria-hidden />Sort by<span className="queue-options-value">{ORDERS.find(entry => entry.key === order)?.label}</span></DropdownMenuSubTrigger>
            <DropdownMenuSubContent aria-label="Sort by" className="queue-options-sub w-[260px]">
              <DropdownMenuRadioGroup value={order} onValueChange={value => { const next = value as QueueOrder; onSort(sort === "attention" ? "attention" : next, next); }}>
                {ORDERS.map(entry => <DropdownMenuRadioItem key={entry.key} value={entry.key}>{entry.label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <p className="queue-options-note">Attention first keeps runs that need you on top.</p>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><ListFilter aria-hidden />Status<span className="queue-options-value">{statusFilterValue(active, label)}</span></DropdownMenuSubTrigger>
            <DropdownMenuSubContent aria-label="Filter by status" className="queue-options-sub w-[280px]">
              {GROUPS.map((group, index) => <DropdownMenuGroup key={group.label}>
                {index > 0 && <DropdownMenuSeparator />}<DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                {shownStatuses(group.statuses, active, count).map(status => <DropdownMenuCheckboxItem key={status} closeOnClick={false} checked={active.includes(status)} onCheckedChange={() => onFilter(toggleQueueFilter(active, status))}>
                  <span className="flex-1">{label(status)}</span><span className="queue-options-count">{count(status)}</span>
                </DropdownMenuCheckboxItem>)}
              </DropdownMenuGroup>)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem closeOnClick={false} className="queue-options-toggle" checked={sort === "attention"} onCheckedChange={on => onSort(on ? "attention" : order, order)}>
            <DropdownMenuItemCopy title="Attention first" description="Needs you and failures on top" />
            {/* The house switch's look only: the menu item itself carries the checked state and the keyboard. */}
            <span aria-hidden className="ds-switch-row queue-options-switch"><span className={cn("ds-switch-control inline-flex items-center rounded-full", sort === "attention" && "ds-switch-control-checked")}><span className={cn("ds-switch-thumb rounded-full", sort === "attention" && "ds-switch-thumb-checked")} /></span></span>
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="queue-options-reset" onSelect={reset}>Reset to defaults</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip side="bottom" content="Start run">
        <IconButton id={startId} variant="ghost" size="sm" label="Start run" title="" onClick={onStartRun} icon={<Plus aria-hidden strokeWidth={1.75} />} />
      </Tooltip>
    </div>
  </header>;
}
