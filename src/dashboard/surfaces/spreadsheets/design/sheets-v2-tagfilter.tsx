import { useState } from 'react';
import { Tag as TagIcon } from 'lucide-react';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuTrigger } from '../../../ds/primitives/dropdown-menu.js';
import { SearchInput } from '../../../ds/ui.js';
import { Picker, WorkflowIcon } from './sheets-v2-ui.js';
import { MENU } from './sheets-v2-menu.js';

/** Tag filter: search at the top, workflow tags (with their icons) first, a divider, then the user's tags A-Z. */
export function TagFilter({ groups, value, onChange }: { groups: { workflows: readonly string[]; tags: readonly string[] }; value: readonly string[]; onChange: (tags: readonly string[]) => void }) {
  const [query, setQuery] = useState('');
  const match = (tag: string) => tag.toLowerCase().includes(query.trim().toLowerCase());
  const workflows = groups.workflows.filter(match), tags = groups.tags.filter(match);
  const toggle = (tag: string) => (checked: boolean) => onChange(checked ? [...value, tag] : value.filter(item => item !== tag));
  return <DropdownMenu onOpenChange={open => { if (!open) setQuery(''); }}>
    <DropdownMenuTrigger render={<Picker aria-label="Filter by tag" icon={<TagIcon size={14} aria-hidden className="text-ui-muted" />}>{value.length ? value.join(', ') : 'All tags'}</Picker>} />
    <DropdownMenuContent align="start" className="flex w-[240px] flex-col overflow-hidden">
      <div className="mb-1 shrink-0" onKeyDown={event => { if (event.key !== 'Escape') event.stopPropagation(); }}><SearchInput variant="menu" aria-label="Find a tag" placeholder="Find a tag" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} /></div>
      <div className={`min-h-0 ${MENU}`}>
        <DropdownMenuCheckboxItem checked={!value.length} onCheckedChange={() => onChange([])} onSelect={event => event.preventDefault()}>All tags</DropdownMenuCheckboxItem>
        {workflows.map(tag => <DropdownMenuCheckboxItem key={tag} checked={value.includes(tag)} onCheckedChange={toggle(tag)} onSelect={event => event.preventDefault()}><WorkflowIcon name={tag} />{tag}</DropdownMenuCheckboxItem>)}
        {workflows.length > 0 && tags.length > 0 && <DropdownMenuSeparator />}
        {tags.map(tag => <DropdownMenuCheckboxItem key={tag} checked={value.includes(tag)} onCheckedChange={toggle(tag)} onSelect={event => event.preventDefault()}>{tag}</DropdownMenuCheckboxItem>)}
        {!workflows.length && !tags.length && <div className="px-2 py-1.5 text-[12px] text-ui-muted">No tags match.</div>}
      </div>
    </DropdownMenuContent>
  </DropdownMenu>;
}
