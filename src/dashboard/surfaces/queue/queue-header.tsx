import { useState, type ReactNode } from "react";
import { parseDate } from "@internationalized/date";
import { CalendarDays, ListFilter, Plus, SlidersHorizontal } from "lucide-react";
import { Button, Calendar, IconButton, Tooltip } from "../../ds/ui.js";
import {
  DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "../../ds/primitives/dropdown-menu.js";
import { QUEUE_SORTS, type QueueSortKey } from "./queue-model.js";
import { needsYouCount, statusCount, totalCount, type StatusBucket, type StatusCountWire } from "../shell/shell-model.js";
import { PROPOSED_STATUS, dsStatusOf } from "../shared/status/status-model.js";
import { nonDefaultOptionCount, toggleQueueFilter } from "./queue-filter-model.js";

const GROUPS: readonly { label: string; statuses: readonly StatusBucket[] }[] = [
  { label: "Quick filters", statuses: ["all", "needsYou"] },
  { label: "In progress", statuses: ["queued", "running", "awaiting-approval"] },
  { label: "Finished", statuses: ["done", "failed", "cancelled"] },
];
const CHRONOLOGICAL = QUEUE_SORTS.filter(entry => entry.key !== "attention");

/** The day comes from the URL, so it can be unreadable; the calendar then opens on today. */
function calendarDay(day: string, today: string) {
  try { return parseDate(day); } catch { return parseDate(today); }
}

/** The card above the queue: the workflow's title, then Ask, Options and Start run as plain icon buttons. */
export function QueueHeader({ title, ask, startId, onStartRun, day, today, onDay, sort, onSort, active, counts, onFilter, dayMark }: {
  title: string; ask: ReactNode; startId: string; onStartRun: () => void;
  day: string; today: string; onDay: (day: string) => void; dayMark?: ReactNode;
  sort: QueueSortKey; onSort: (next: QueueSortKey) => void;
  active: readonly StatusBucket[]; counts: readonly StatusCountWire[]; onFilter: (next: readonly StatusBucket[]) => void;
}) {
  // Attention first sits over the chronological order, which is remembered while it is on.
  const [chronological, setChronological] = useState<Exclude<QueueSortKey, "attention">>("newest");
  const order = sort === "attention" ? chronological : sort;
  const label = (status: StatusBucket) => status === "all" ? "All" : status === "needsYou" ? "Needs you" : PROPOSED_STATUS[dsStatusOf(status)].accessibleLabel;
  const count = (status: StatusBucket) => status === "all" ? totalCount(counts) : status === "needsYou" ? needsYouCount(counts) : statusCount(counts, status);
  const changed = nonDefaultOptionCount({ day, today, sort, active });
  return <header aria-label="Queue header" className="queue-header">
    <h2 className="queue-header-title">{title}</h2>
    {dayMark}
    <div className="queue-header-actions">
      {ask}
      <DropdownMenu>
        <Tooltip side="bottom" content="Options">
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" size="sm" className="queue-options-trigger" label={changed > 0 ? `Options, ${String(changed)} changed` : "Options"} title="" icon={<span className="relative inline-flex"><SlidersHorizontal aria-hidden className="size-4" />{changed > 0 && <span aria-hidden className="queue-options-badge">{changed}</span>}</span>} />
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent aria-label="Queue options" align="end" className="queue-options-menu">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><CalendarDays aria-hidden />Date<span className="queue-options-value">{day === today ? "Today" : day}</span></DropdownMenuSubTrigger>
            <DropdownMenuSubContent aria-label="Pick a date" className="queue-date-menu">
              <Calendar label="Dashboard date" value={calendarDay(day, today)} maxValue={parseDate(today)} onChange={date => onDay(date.toString())} />
              <div className="queue-date-footer"><Button size="sm" variant="ghost" onClick={() => onDay(today)}>Today</Button><span>Runs from this day</span></div>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Sort by</DropdownMenuSubTrigger>
            <DropdownMenuSubContent aria-label="Sort by" className="w-64">
              <DropdownMenuRadioGroup value={order} onValueChange={value => { const next = value as Exclude<QueueSortKey, "attention">; setChronological(next); onSort(sort === "attention" ? "attention" : next); }}>
                {CHRONOLOGICAL.map(entry => <DropdownMenuRadioItem key={entry.key} value={entry.key}>{entry.label}</DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <p className="queue-options-note">With Attention first on, runs that need you and failures stay on top; this order applies within each group.</p>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger><ListFilter aria-hidden />Status</DropdownMenuSubTrigger>
            <DropdownMenuSubContent aria-label="Filter by status" className="w-64">
              {GROUPS.map((group, index) => <DropdownMenuGroup key={group.label}>
                {index > 0 && <DropdownMenuSeparator />}<DropdownMenuLabel>{group.label}</DropdownMenuLabel>
                {group.statuses.map(status => <DropdownMenuCheckboxItem key={status} closeOnClick={false} checked={active.includes(status)} onCheckedChange={() => onFilter(toggleQueueFilter(active, status))}>
                  <span className="flex-1">{label(status)}</span><span className="tabular-nums text-muted-foreground">{count(status)}</span>
                </DropdownMenuCheckboxItem>)}
              </DropdownMenuGroup>)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem closeOnClick={false} checked={sort === "attention"} onCheckedChange={on => onSort(on ? "attention" : chronological)}>Attention first</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Tooltip side="bottom" content="Start run">
        <IconButton id={startId} variant="ghost" size="sm" label="Start run" title="" onClick={onStartRun} icon={<Plus aria-hidden className="size-4" />} />
      </Tooltip>
    </div>
  </header>;
}
