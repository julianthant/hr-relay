import { useState, type ReactNode } from 'react';
import { Archive, ArrowUpDown, ChevronDown, ListFilter, RotateCcw, Trash2, X } from 'lucide-react';
import { Button, Checkbox, IconButton, Select, Tooltip, dsFocus, dsIcon } from '../ds/ui.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../ds/dropdown-menu.js';
import { OperationsToolbar } from './operations-toolbar.js';
import { QUEUE_SORTS, type QueueSortKey } from './queue-model.js';
import { needsYouCount, statusCount, totalCount, type StatusBucket, type StatusCountWire } from './shell-model.js';
import { PROPOSED_STATUS, dsStatusOf } from './status-model.js';
import type { QueueMockAction } from './queue-preview-model.js';

export function FocusQueueToolbar({ leading, runStart, active, counts, onFilter, sort, onSort }: {
  leading: ReactNode; runStart: ReactNode; active: StatusBucket; counts: readonly StatusCountWire[];
  onFilter: (next: StatusBucket) => void; sort: QueueSortKey; onSort: (next: QueueSortKey) => void; 
}) {
  const [open, setOpen] = useState(false);
  const statuses: readonly StatusBucket[] = ['all', 'needsYou', 'queued', 'running', 'cancelling', 'awaiting-approval', 'blocked', 'done', 'partial', 'failed', 'cancelled'];
  const label = (status: StatusBucket) => status === 'all' ? 'All' : status === 'needsYou' ? 'Needs you' : PROPOSED_STATUS[dsStatusOf(status)].accessibleLabel;
  const count = (status: StatusBucket) => status === 'all' ? totalCount(counts) : status === 'needsYou' ? needsYouCount(counts) : statusCount(counts, status);
  return <OperationsToolbar label="Queue actions" className="[--ds-h-toolbar:32px] [--ds-h-sm:32px] [--ds-brand-solid-bg:var(--ui-info)] [--ds-brand-solid-fg:var(--ui-canvas)] [--ds-brand-solid-hover:var(--ui-info)]">
      {leading}<span aria-hidden className="h-5 border-l border-ui-stroke" />{runStart}
      <span className="flex-1" />
      <span className="text-caption text-ui-muted">Mock actions</span>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild><Button variant="secondary" size="sm" aria-label="All statuses" icon={<ListFilter data-icon="inline-start" className={dsIcon.sm} />}>{['all', 'needsYou', 'running'].includes(active) ? 'All statuses' : label(active)}<ChevronDown data-icon="inline-end" className="size-3" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent aria-label="Filter by status" align="end" className="w-60">
          <DropdownMenuGroup><DropdownMenuRadioGroup value={active} onValueChange={next => { onFilter(next as StatusBucket); setOpen(false); }}>
            {statuses.map(status => <DropdownMenuRadioItem key={status} value={status}>
              <span className="flex-1">{label(status)}</span><span className="tabular-nums text-ui-muted">{count(status)}</span>
            </DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup></DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Select variant="toolbar" aria-label="Sort the queue" value={sort} onChange={event => onSort(event.target.value as QueueSortKey)} icon={<ArrowUpDown className={dsIcon.sm} />}>
        {QUEUE_SORTS.map(entry => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
      </Select>
  </OperationsToolbar>;
}

export function FocusQueueHeader({ active, counts, onFilter, selecting, selectedCount, allSelected, someSelected, onSelectAll, onExit, onAction }: {
  active: StatusBucket; counts: readonly StatusCountWire[]; onFilter: (next: StatusBucket) => void;
  selecting: boolean; selectedCount: number; allSelected: boolean; someSelected: boolean;
  onSelectAll: (checked: boolean) => void; onExit: () => void; onAction: (action: QueueMockAction) => void;
}) {
  const options = [{ value: 'all', label: 'All', count: totalCount(counts) }, { value: 'needsYou', label: 'Needs you', count: needsYouCount(counts) }, { value: 'running', label: 'Running', count: statusCount(counts, 'running') }] as const;
  return <div className="flex h-[58px] shrink-0 items-center gap-2 border-b border-ui-stroke px-3" onKeyDown={event => { if (event.key === 'Escape' && selecting) { event.preventDefault(); event.stopPropagation(); onExit(); } }}>
    {selecting ? <>
      <Checkbox label={<span className="sr-only">Select all visible runs</span>} checked={allSelected ? true : someSelected ? 'indeterminate' : false} onCheckedChange={checked => onSelectAll(checked === true)} />
      <span aria-live="polite" className="min-w-0 flex-1 text-body font-semibold tabular-nums">{selectedCount} selected</span>
      <div role="group" aria-label="Selected run actions" className="flex shrink-0 items-center gap-0.5">
        {([{ action: 'delete', label: 'Delete selected runs', Icon: Trash2 }, { action: 'archive', label: 'Archive selected runs', Icon: Archive }, { action: 'retry', label: 'Retry selected runs with original settings', Icon: RotateCcw }] as const).map(({ action, label, Icon }) => <Tooltip key={action} content={label}><IconButton label={label} icon={<Icon className={dsIcon.sm} />} disabled={selectedCount === 0} onClick={() => onAction(action)} /></Tooltip>)}
        <span aria-hidden className="mx-1 h-5 border-l border-ui-stroke" />
        <Tooltip content="Exit selection"><IconButton label="Exit selection" icon={<X className={dsIcon.sm} />} onClick={onExit} /></Tooltip>
      </div>
    </> : <div role="group" aria-label="Frequent queue filters" className="relative grid w-full grid-cols-3 rounded-md border border-ui-stroke bg-ui-canvas p-[3px]">
      {options.some(option => option.value === active) && <span aria-hidden className="pointer-events-none absolute inset-y-[3px] left-[3px] w-[calc((100%-6px)/3)] rounded-[4px] bg-ui-hover transition-transform duration-[var(--ds-dur-move)] motion-reduce:transition-none" style={{ transform: `translateX(${options.findIndex(option => option.value === active) * 100}%)` }} />}
      {options.map(option => <button key={option.value} type="button" aria-pressed={active === option.value} onClick={() => onFilter(option.value)} className={`relative min-w-0 rounded-[4px] px-1 py-2 text-body ${dsFocus} ${active === option.value ? 'font-semibold text-ui-primary' : 'text-ui-muted'}`}>
        {option.label} <span className="tabular-nums">{option.count}</span>
      </button>)}
    </div>}
  </div>;
}
