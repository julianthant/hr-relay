import { ToggleButton } from '@heroui/react/toggle-button';
import { useState, type ReactNode } from 'react';
import { ArrowUpDown, ChevronDown, ListFilter, ListOrdered } from 'lucide-react';
import { Button, Select, dsIcon } from '../ds/ui.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem, DropdownMenuTrigger } from '../ds/dropdown-menu.js';
import { OperationsToolbar } from './operations-toolbar.js';
import { QUEUE_SORTS, type QueueSortKey } from './queue-model.js';
import { needsYouCount, statusCount, totalCount, type StatusBucket, type StatusCountWire } from './shell-model.js';
import { PROPOSED_STATUS, dsStatusOf } from './status-model.js';
import { toggleQueueFilter } from './queue-filter-model.js';

export function FocusQueueToolbar({ leading, runStart, active, counts, onFilter, sort, onSort }: {
  leading: ReactNode; runStart: ReactNode; active: readonly StatusBucket[]; counts: readonly StatusCountWire[];
  onFilter: (next: readonly StatusBucket[]) => void; sort: QueueSortKey; onSort: (next: QueueSortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const [chronological, setChronological] = useState<Exclude<QueueSortKey, "attention">>("newest");
  const groups: readonly { label: string; statuses: readonly StatusBucket[] }[] = [
    { label: 'Quick filters', statuses: ['all', 'needsYou'] },
    { label: 'In progress', statuses: ['queued', 'running', 'cancelling', 'awaiting-approval', 'blocked'] },
    { label: 'Finished', statuses: ['done', 'partial', 'failed', 'cancelled'] },
  ];
  const label = (status: StatusBucket) => status === 'all' ? 'All' : status === 'needsYou' ? 'Needs you' : PROPOSED_STATUS[dsStatusOf(status)].accessibleLabel;
  const count = (status: StatusBucket) => status === 'all' ? totalCount(counts) : status === 'needsYou' ? needsYouCount(counts) : statusCount(counts, status);
  const filtered = !active.includes('all') && active.length > 0;
  const selected = filtered ? active.map(label).join(', ') : 'All';
  return <OperationsToolbar label="Action panel controls" className="[--ds-h-toolbar:32px] [--ds-h-sm:32px] [--ds-brand-solid-bg:var(--ui-info)] [--ds-brand-solid-fg:var(--ui-canvas)] [--ds-brand-solid-hover:var(--ui-info)]">
    {leading}{runStart}
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild><Button variant="secondary" size="sm" className="queue-status-trigger" data-filtered={filtered} aria-label="Filter queue by status" aria-description={`Selected: ${selected}`} title={`Status: ${selected}`} icon={<ListFilter data-icon="inline-start" />}><span className="queue-status-label">{filtered ? active.length === 1 ? selected : `${active.length} statuses` : 'Status'}</span><ChevronDown data-icon="inline-end" /></Button></DropdownMenuTrigger>
      <DropdownMenuContent aria-label="Filter by status" align="start" className="w-64">
        {groups.map((group, index) => <DropdownMenuGroup key={group.label}>
          {index > 0 && <DropdownMenuSeparator />}<DropdownMenuLabel>{group.label}</DropdownMenuLabel>
          {group.statuses.map(status => {
            const spec = status === 'all' ? undefined : PROPOSED_STATUS[dsStatusOf(status === 'needsYou' ? 'awaiting-approval' : status)];
            const Icon = spec?.icon ?? ListFilter;
            return <DropdownMenuCheckboxItem key={status} closeOnClick={false} checked={active.includes(status)} onCheckedChange={() => onFilter(toggleQueueFilter(active, status))}>
              <Icon aria-hidden className={spec?.soloTone} /><span className="flex-1">{label(status)}</span><span className="tabular-nums text-muted-foreground">{count(status)}</span>
            </DropdownMenuCheckboxItem>;
          })}
        </DropdownMenuGroup>)}
      </DropdownMenuContent>
    </DropdownMenu>
    <Select variant="toolbar" className="queue-sort" aria-label="Sort the queue" title={`Sort queue: ${QUEUE_SORTS.find(entry => entry.key === sort)?.label}`} value={sort === "attention" ? chronological : sort} onChange={event => { const next = event.target.value as Exclude<QueueSortKey, "attention">; setChronological(next); onSort(next); }} icon={<ArrowUpDown className={dsIcon.sm} />}>
      {QUEUE_SORTS.filter(entry => entry.key !== "attention").map(entry => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
    </Select>
    <ToggleButton isIconOnly size="sm" variant="default" isSelected={sort === "attention"} onChange={selected => { if (selected && sort !== "attention") setChronological(sort); onSort(selected ? "attention" : chronological); }} className="queue-attention-toggle" aria-label="Attention first"><ListOrdered aria-hidden className="size-4" /></ToggleButton>
  </OperationsToolbar>;
}

export function FocusQueueHeader({ active, counts, onFilter, children }: {
  active: readonly StatusBucket[]; counts: readonly StatusCountWire[]; onFilter: (next: readonly StatusBucket[]) => void; children?: ReactNode;
}) {
  const options = [{ value: 'all', label: 'All', count: totalCount(counts) }, { value: 'needsYou', label: 'Needs you', count: needsYouCount(counts) }, { value: 'running', label: 'Running', count: statusCount(counts, 'running') }] as const;
  return <div className="queue-filter-tabs"><div role="group" aria-label="Frequent queue filters" className="queue-filter-list-container"><div className="queue-filter-list">
    {options.map(option => <ToggleButton key={option.value} size="sm" variant="ghost" isSelected={active.includes(option.value)} onChange={() => onFilter(toggleQueueFilter(active, option.value))} aria-label={`${option.label} ${option.count}`} className="queue-filter-tab">
      <span>{option.label}</span><span className="queue-filter-count">{option.count}</span>
    </ToggleButton>)}
  </div></div><div className="queue-filter-content">{children}</div></div>;
}
