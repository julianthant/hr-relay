import { Tabs } from '@heroui/react/tabs';
import { useState, type ReactNode } from 'react';
import { Archive, ArrowUpDown, ChevronDown, ListFilter, RotateCcw, Trash2, X } from 'lucide-react';
import { Button, Checkbox, IconButton, Select, Tooltip, dsIcon } from '../ds/ui.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../ds/dropdown-menu.js';
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
  const groups: readonly { label: string; statuses: readonly StatusBucket[] }[] = [
    { label: 'Quick filters', statuses: ['all', 'needsYou'] },
    { label: 'In progress', statuses: ['queued', 'running', 'cancelling', 'awaiting-approval', 'blocked'] },
    { label: 'Finished', statuses: ['done', 'partial', 'failed', 'cancelled'] },
  ];
  const label = (status: StatusBucket) => status === 'all' ? 'All' : status === 'needsYou' ? 'Needs you' : PROPOSED_STATUS[dsStatusOf(status)].accessibleLabel;
  const count = (status: StatusBucket) => status === 'all' ? totalCount(counts) : status === 'needsYou' ? needsYouCount(counts) : statusCount(counts, status);
  return <OperationsToolbar label="Action panel controls" className="[--ds-h-toolbar:32px] [--ds-h-sm:32px] [--ds-brand-solid-bg:var(--ui-info)] [--ds-brand-solid-fg:var(--ui-canvas)] [--ds-brand-solid-hover:var(--ui-info)]">
      {leading}{runStart}
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="queue-status-trigger" data-filtered={active !== 'all'} aria-label="Filter queue by status" aria-description={`Selected: ${label(active)}`} title={`Status: ${label(active)}`} icon={<ListFilter data-icon="inline-start" />}><span className="queue-status-label">{active === 'all' ? 'Status' : label(active)}</span><ChevronDown data-icon="inline-end" /></Button></DropdownMenuTrigger>
        <DropdownMenuContent aria-label="Filter by status" align="start" className="w-64">
          <DropdownMenuRadioGroup value={active} onValueChange={next => { onFilter(next as StatusBucket); setOpen(false); }}>
            {groups.map((group, index) => <DropdownMenuGroup key={group.label}>
              {index > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
              {group.statuses.map(status => {
                const spec = status === 'all' ? undefined : PROPOSED_STATUS[dsStatusOf(status === 'needsYou' ? 'awaiting-approval' : status)];
                const Icon = spec?.icon ?? ListFilter;
                return <DropdownMenuRadioItem key={status} value={status}>
                  <Icon aria-hidden className={spec?.soloTone} /><span className="flex-1">{label(status)}</span><span className="tabular-nums text-muted-foreground">{count(status)}</span>
                </DropdownMenuRadioItem>;
              })}
            </DropdownMenuGroup>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Select variant="toolbar" className="queue-sort" aria-label="Sort the queue" title={`Sort queue: ${QUEUE_SORTS.find(entry => entry.key === sort)?.label}`} value={sort} onChange={event => onSort(event.target.value as QueueSortKey)} icon={<ArrowUpDown className={dsIcon.sm} />}>
        {QUEUE_SORTS.map(entry => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
      </Select>
  </OperationsToolbar>;
}

export function FocusQueueHeader({ active, counts, onFilter, selecting, selectedCount, allSelected, someSelected, onSelectAll, onExit, onAction, children }: {
  active: StatusBucket; counts: readonly StatusCountWire[]; onFilter: (next: StatusBucket) => void;
  selecting: boolean; selectedCount: number; allSelected: boolean; someSelected: boolean;
  onSelectAll: (checked: boolean) => void; onExit: () => void; onAction: (action: QueueMockAction) => void; children?: ReactNode;
}) {
  const options = [{ value: 'all', label: 'All', count: totalCount(counts) }, { value: 'needsYou', label: 'Needs you', count: needsYouCount(counts) }, { value: 'running', label: 'Running', count: statusCount(counts, 'running') }] as const;
  const extra = active === "all" || active === "needsYou" || active === "running" ? null : { value: active, label: PROPOSED_STATUS[dsStatusOf(active)].accessibleLabel, count: statusCount(counts, active) };
  return selecting ? <div className="flex min-h-0 flex-1 flex-col"><div className="flex h-[58px] shrink-0 items-center gap-2 border-b border-ui-stroke px-3" onKeyDown={event => { if (event.key === 'Escape' && selecting) { event.preventDefault(); event.stopPropagation(); onExit(); } }}>
    <>
      <Checkbox label={<span className="sr-only">Select all visible runs</span>} checked={allSelected ? true : someSelected ? 'indeterminate' : false} onCheckedChange={checked => onSelectAll(checked === true)} />
      <span aria-live="polite" className="min-w-0 flex-1 text-body font-semibold tabular-nums">{selectedCount} selected</span>
      <div role="group" aria-label="Selected run actions" className="flex shrink-0 items-center gap-0.5">
        {([{ action: 'delete', label: 'Delete selected runs', Icon: Trash2 }, { action: 'archive', label: 'Archive selected runs', Icon: Archive }, { action: 'retry', label: 'Retry selected runs with original settings', Icon: RotateCcw }] as const).map(({ action, label, Icon }) => <Tooltip key={action} content={label}><IconButton label={label} icon={<Icon className={dsIcon.sm} />} disabled={selectedCount === 0} onClick={() => onAction(action)} /></Tooltip>)}
        <span aria-hidden className="mx-1 h-5 border-l border-ui-stroke" />
        <Tooltip content="Exit selection"><IconButton label="Exit selection" icon={<X className={dsIcon.sm} />} onClick={onExit} /></Tooltip>
      </div>
    </>
  </div>{children}</div> : <Tabs className="queue-filter-tabs" selectedKey={active} onSelectionChange={key => onFilter(String(key) as StatusBucket)} variant="secondary">
    <Tabs.ListContainer className="queue-filter-list-container"><Tabs.List aria-label="Frequent queue filters" className="queue-filter-list">
      {[...options, ...(extra ? [extra] : [])].map(option => <Tabs.Tab key={option.value} id={option.value} aria-label={`${option.label} ${option.count}`} className={extra?.value === option.value ? "queue-filter-tab queue-filter-extra" : "queue-filter-tab"}>
        <span className="min-w-0 truncate">{option.label}</span><span className="queue-filter-count">{option.count}</span><Tabs.Indicator className="queue-filter-indicator" />
      </Tabs.Tab>)}
    </Tabs.List></Tabs.ListContainer>
    <Tabs.Panel id={active} className="queue-filter-content">{children}</Tabs.Panel>
  </Tabs>;
}
