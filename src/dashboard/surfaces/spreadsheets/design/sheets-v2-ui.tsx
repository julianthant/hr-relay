import { forwardRef, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Check, ChevronDown, Loader2, LogOut, MoreHorizontal, Pin, Plus, Search, UserPlus, Users, type LucideIcon } from 'lucide-react';
import { Button, Chip, IconButton, SearchInput, Tooltip, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, dsFocus, dsIcon, dsRadius, dsText } from '../../../ds/ui.js';
import { DropdownMenuCheckboxItem } from '../../../ds/primitives/dropdown-menu.js';
import { type Sheet, addTag, stamp, syncFailureWhy, tagsOf, MAX_TAG_LENGTH } from './sheets-v2-model.js';
import { MENU } from './sheets-v2-menu.js';

// soft = secondary (grey fill), line = outline (faint border), plain = ghost; primary is only a dialog's confirming action.
const VARIANT = { soft: 'secondary', line: 'outline', plain: 'ghost', primary: 'primary', danger: 'danger' } as const;
export type Look = keyof typeof VARIANT;
export const V2Button = forwardRef<HTMLButtonElement, Omit<ComponentProps<typeof Button>, 'variant'> & { look?: Look }>(function V2Button({ look = 'soft', ...props }, ref) {
  return <Button ref={ref} variant={VARIANT[look]} {...props} />;
});
export const V2Icon = forwardRef<HTMLButtonElement, { label: string; children: ReactNode } & Omit<ComponentProps<typeof IconButton>, 'icon' | 'label' | 'children'>>(function V2Icon({ label, children, ...props }, ref) {
  return <IconButton ref={ref} label={label} icon={children} {...props} />;
});
export const Picker = forwardRef<HTMLButtonElement, Omit<ComponentProps<typeof Button>, 'variant' | 'iconAfter'> & { children: ReactNode }>(function Picker({ children, className = '', ...props }, ref) {
  return <Button ref={ref} variant="outline" className={`ds-menu-trigger min-w-0 justify-between ${className}`} iconAfter={<ChevronDown aria-hidden className={`${dsIcon.md} shrink-0 text-ui-muted`} />} {...props}><span className="min-w-0 truncate">{children}</span></Button>;
});

export const Grey = ({ children, className = '' }: { children: ReactNode; className?: string }) => <span className={`${dsText.body} text-ui-muted ${className}`}>{children}</span>;
// The workflow chip carries the workflow's sidebar icon (category icons where the rail has one, the workflow's own icon otherwise).
const WORKFLOW_ICONS: Readonly<Record<string, LucideIcon>> = { 'Person Lookup': Search, Separations: LogOut, Onboarding: UserPlus, 'Emergency Contact': Users };
export const WorkflowIcon = ({ name }: { name: string }) => { const Icon = WORKFLOW_ICONS[name]; return Icon ? <Icon aria-hidden className={`${dsIcon.md} shrink-0`} /> : null; };
export const Tag = ({ children, onRemove, workflow }: { children: string; onRemove?: () => void; workflow?: boolean }) => {
  const Icon = workflow ? WORKFLOW_ICONS[children] : undefined;
  return <Chip className="sv2-tag" icon={Icon && <Icon aria-hidden className={dsIcon.sm} />} onRemove={onRemove} removeLabel="Remove tag">{children}</Chip>;
};
/** Chips for a spreadsheet: the automatic workflow chip first, then its own tags. */
export const SheetChips = ({ sheet }: { sheet: Sheet }) => <>{tagsOf(sheet).map(tag => <Tag key={tag} workflow={tag === sheet.workflow}>{tag}</Tag>)}</>;

const GAP = 4;
/** Shows the chips that fit the available width, then a +N chip whose tooltip lists every tag, then `after`. */
export function TagsFit({ sheet, after }: { sheet: Sheet; after?: ReactNode }) {
  const tags = tagsOf(sheet), key = tags.join('\u0000');
  const box = useRef<HTMLDivElement>(null), probe = useRef<HTMLDivElement>(null), tail = useRef<HTMLSpanElement>(null);
  const [count, setCount] = useState(tags.length);
  useLayoutEffect(() => {
    const element = box.current, ruler = probe.current; if (!element || !ruler) return;
    const fit = () => {
      const sizes = [...ruler.children].map(child => (child as HTMLElement).offsetWidth), plus = sizes.pop() ?? 0, room = element.clientWidth - (tail.current ? tail.current.offsetWidth + GAP : 0);
      let next = tags.length;
      while (next > 0 && sizes.slice(0, next).reduce((sum, size) => sum + size + GAP, -GAP) + (next < tags.length ? GAP + plus : 0) > room) next -= 1;
      setCount(next);
    };
    fit(); const observer = new ResizeObserver(fit); observer.observe(element); return () => observer.disconnect();
  }, [key, tags.length]);
  const hidden = tags.length - count;
  return <div ref={box} className="relative flex min-h-6 min-w-0 flex-1 items-center gap-1 overflow-hidden">
    <div ref={probe} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex gap-1 whitespace-nowrap"><SheetChips sheet={sheet} /><Tag>{`+${tags.length}`}</Tag></div>
    {tags.slice(0, count).map(tag => <Tag key={tag} workflow={tag === sheet.workflow}>{tag}</Tag>)}
    {hidden > 0 && <Tooltip content={<span className="grid gap-0.5">{tags.map(tag => <span key={tag}>{tag}</span>)}</span>}><span tabIndex={0} role="img" aria-label={`${hidden} more tags: ${tags.join(', ')}`} className={`shrink-0 rounded-[var(--ds-radius-sm)] ${dsFocus}`}><Chip>{`+${hidden}`}</Chip></span></Tooltip>}
    {after && <span ref={tail} className="flex shrink-0">{after}</span>}
  </div>;
}

/** The + beside a spreadsheet's tags: the library's tags to check or uncheck, and a new one typed into the search to create it. */
export function TagMenu({ name, tags, bank, disabled, onChange }: { name: string; tags: readonly string[]; bank: readonly string[]; disabled?: boolean; onChange: (tags: readonly string[]) => void }) {
  const [query, setQuery] = useState('');
  const text = query.trim(), all = [...new Set([...bank, ...tags])].toSorted((a, b) => a.localeCompare(b));
  const shown = all.filter(tag => tag.toLowerCase().includes(text.toLowerCase()));
  const creatable = !all.some(tag => tag.toLowerCase() === text.toLowerCase()) && addTag(tags, text) !== undefined;
  const create = () => { const next = addTag(tags, text); if (next) { onChange(next); setQuery(''); } };
  const toggle = (tag: string) => (checked: boolean) => { const next = checked ? addTag(tags, tag) : tags.filter(item => item !== tag); if (next) onChange(next); };
  return <DropdownMenu onOpenChange={open => { if (!open) setQuery(''); }}>
    <DropdownMenuTrigger render={<IconButton variant="outline" size="xs" disabled={disabled} label={`Add a tag to ${name}`} icon={<Plus aria-hidden className={dsIcon.sm} />} onClick={event => event.stopPropagation()} />} />
    <DropdownMenuContent align="start" className="flex w-[232px] flex-col overflow-hidden" onClick={event => event.stopPropagation()}>
      <div className="mb-1 shrink-0" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); create(); } if (!['Escape', 'ArrowDown', 'ArrowUp'].includes(event.key)) event.stopPropagation(); }}>
        <SearchInput variant="menu" aria-label="Find or create a tag" placeholder="Find or create a tag" maxLength={MAX_TAG_LENGTH} value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} /></div>
      <div className={`min-h-0 ${MENU}`}>
        {shown.map(tag => { const on = tags.includes(tag); return <DropdownMenuCheckboxItem key={tag} className="sv2-tag-item" checked={on} onCheckedChange={toggle(tag)} onSelect={event => event.preventDefault()}>
          {/* The checkbox look, not the ds Checkbox: a button inside a menu item would nest two controls. */}
          <span aria-hidden className={`ds-checkbox-control inline-flex size-4 shrink-0 items-center justify-center border ${dsRadius.xs} ${on ? 'border-transparent bg-[var(--ds-accent)]' : 'border-[color:var(--ds-control-border)] bg-[var(--ds-surface-2)]'}`}>
            {on && <Check className="size-3 text-[color:var(--ds-accent-fg)]" />}</span>{tag}</DropdownMenuCheckboxItem>; })}
        {creatable && <DropdownMenuItem closeOnClick={false} onSelect={create}>Create “{text}”</DropdownMenuItem>}
        {!shown.length && !creatable && <div className={`px-2 py-1.5 ${dsText.body} text-ui-muted`}>No tags match.</div>}
      </div>
    </DropdownMenuContent>
  </DropdownMenu>;
}

/** Filled while the spreadsheet is pinned. */
export const PinButton = ({ sheet, onClick }: { sheet: Sheet; onClick: () => void }) =>
  <IconButton label={`${sheet.pinned ? 'Unpin' : 'Pin'} ${sheet.name}`} aria-pressed={sheet.pinned} onClick={onClick}
    icon={<Pin aria-hidden className={dsIcon.lg} fill={sheet.pinned ? 'currentColor' : 'none'} />} className={sheet.pinned ? 'text-[color:var(--ds-fg)]' : ''} />;

/** One line under the SharePoint link: syncing, last synced, last sync failed, or not synced yet. */
export function SyncStatus({ sheet }: { sheet: Sheet }) {
  const sync = sheet.sync;
  if (!sync) return null;
  if (sync.state === 'running') return <span data-sync="running" className="inline-flex items-center gap-1 text-ui-info"><Loader2 aria-hidden className={`${dsIcon.sm} shrink-0 animate-spin motion-reduce:animate-none`} /><span className="truncate">Syncing…</span></span>;
  const failed = sync.lastResult === 'failed', never = sync.lastFinishedAt === undefined;
  const text = never ? 'Not synced yet' : failed ? 'Sync failed' : `Synced ${stamp(sync.lastFinishedAt!)}`;
  const line = <span data-sync={never ? 'never' : failed ? 'failed' : 'ok'} title={failed || never ? undefined : `Synced ${stamp(sync.lastFinishedAt!)}`} tabIndex={failed ? 0 : undefined} className={`inline-flex min-w-0 items-center gap-1.5 ${failed ? `text-ui-danger ${dsFocus}` : ''}`}>
    <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${failed ? 'bg-ui-danger' : never ? 'bg-ui-stroke' : 'bg-ui-positive'}`} /><span className="truncate">{text}</span></span>;
  return failed ? <Tooltip content={`${syncFailureWhy(sheet)} (${stamp(sync.lastFinishedAt!)})`}>{line}</Tooltip> : line;
}

export type MenuAction = 'pin' | 'sync' | 'link' | 'clone' | 'rename' | 'delete' | 'download';
/** Same menu on every row and on the detail page. */
export function SheetMenu({ sheet, onAction, label }: { sheet: Sheet; onAction: (action: MenuAction) => void; label: string }) {
  const item = (action: MenuAction, text: string) => <DropdownMenuItem onSelect={() => onAction(action)}>{text}</DropdownMenuItem>;
  return <DropdownMenu><DropdownMenuTrigger render={<V2Icon label={`Actions for ${label}`}><MoreHorizontal aria-hidden className={dsIcon.lg} /></V2Icon>} /><DropdownMenuContent align="end" className={`min-w-[210px] ${MENU}`}>
    {item('download', 'Download')}
    {sheet.sharePoint && (sheet.sync?.state === 'running' ? <DropdownMenuItem disabled>Syncing…</DropdownMenuItem> : item('sync', sheet.sync?.lastResult === 'failed' ? 'Retry sync' : 'Sync now'))}
    {item('link', sheet.sharePoint ? 'Change SharePoint link…' : 'Link to SharePoint…')}
    {item('clone', 'Clone')}
    {item('rename', 'Rename')}
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive" onSelect={() => onAction('delete')}>Delete</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>;
}
