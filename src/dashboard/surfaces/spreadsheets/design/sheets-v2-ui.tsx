import { forwardRef, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ChevronDown, Download, LogOut, MoreHorizontal, Search, UserPlus, Users, X, type LucideIcon } from 'lucide-react';
import { Button, IconButton, Tooltip, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, dsFocus } from '../../../ds/ui.js';
import { type Sheet, tagsOf } from './sheets-v2-model.js';

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
  return <Button ref={ref} variant="outline" className={`ds-menu-trigger min-w-0 justify-between ${className}`} iconAfter={<ChevronDown size={14} aria-hidden className="shrink-0 text-ui-muted" />} {...props}><span className="min-w-0 truncate">{children}</span></Button>;
});

export const Grey = ({ children, className = '' }: { children: ReactNode; className?: string }) => <span className={`text-[12px] text-ui-muted ${className}`}>{children}</span>;
// The workflow chip carries the workflow's sidebar icon (category icons where the rail has one, the workflow's own icon otherwise).
const WORKFLOW_ICONS: Readonly<Record<string, LucideIcon>> = { 'Person Lookup': Search, Separations: LogOut, Onboarding: UserPlus, 'Emergency Contact': Users };
/** Every dropdown in the mock: 13px, 28px rows, capped at 280px tall and scrolling after that. */
export const MENU = 'max-h-[280px] overflow-y-auto';
export const ROW = '!min-h-7 !py-1';
export const WorkflowIcon = ({ name }: { name: string }) => { const Icon = WORKFLOW_ICONS[name]; return Icon ? <Icon size={14} aria-hidden className="shrink-0" /> : null; };
export const Tag = ({ children, onRemove, workflow }: { children: string; onRemove?: () => void; workflow?: boolean }) => {
  const Icon = workflow ? WORKFLOW_ICONS[children] : undefined;
  return <span className="inline-flex h-5 shrink-0 items-center gap-1 rounded-[5px] bg-ui-hover px-1.5 text-[11px] text-ui-secondary">{Icon && <Icon size={11} aria-hidden />}{children}{onRemove && <button type="button" aria-label={`Remove ${children}`} className={`rounded-sm ${dsFocus}`} onClick={onRemove}><X size={11} aria-hidden /></button>}</span>;
};
/** Chips for a spreadsheet: the automatic workflow chip first, then its own tags. */
export const SheetChips = ({ sheet }: { sheet: Sheet }) => <>{sheet.workflow && <Tag workflow>{sheet.workflow}</Tag>}{sheet.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</>;

const GAP = 4;
/** Shows the chips that fit the available width, then a +N chip whose tooltip lists every tag. */
export function TagsFit({ sheet }: { sheet: Sheet }) {
  const tags = tagsOf(sheet), key = tags.join('\u0000');
  const box = useRef<HTMLDivElement>(null), probe = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(tags.length);
  useLayoutEffect(() => {
    const element = box.current, ruler = probe.current; if (!element || !ruler) return;
    const fit = () => {
      const sizes = [...ruler.children].map(child => (child as HTMLElement).offsetWidth), plus = sizes.pop() ?? 0, room = element.clientWidth;
      let next = tags.length;
      while (next > 0 && sizes.slice(0, next).reduce((sum, size) => sum + size + GAP, -GAP) + (next < tags.length ? GAP + plus : 0) > room) next -= 1;
      setCount(next);
    };
    fit(); const observer = new ResizeObserver(fit); observer.observe(element); return () => observer.disconnect();
  }, [key, tags.length]);
  const hidden = tags.length - count;
  return <div ref={box} className="relative flex h-5 min-w-0 flex-1 items-center gap-1 overflow-hidden">
    <div ref={probe} aria-hidden className="pointer-events-none invisible absolute left-0 top-0 flex gap-1 whitespace-nowrap"><SheetChips sheet={sheet} /><Tag>{`+${tags.length}`}</Tag></div>
    {tags.slice(0, count).map(tag => <Tag key={tag} workflow={tag === sheet.workflow}>{tag}</Tag>)}
    {hidden > 0 && <Tooltip content={<span className="grid gap-0.5">{tags.map(tag => <span key={tag}>{tag}</span>)}</span>}><button type="button" aria-label={`${hidden} more tags: ${tags.join(', ')}`} className={`inline-flex h-5 shrink-0 items-center rounded-[5px] bg-ui-hover px-1.5 text-[11px] text-ui-secondary ${dsFocus}`}>+{hidden}</button></Tooltip>}
  </div>;
}

export function TagEditor({ tags, onChange, workflow }: { tags: readonly string[]; onChange: (tags: readonly string[]) => void; workflow?: string }) {
  const [draft, setDraft] = useState('');
  const add = () => { const next = draft.trim(); if (next && !tags.includes(next)) onChange([...tags, next]); setDraft(''); };
  return <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-md border border-ui-stroke px-2 py-1">
    {workflow && <Tag workflow>{workflow}</Tag>}
    {tags.map(tag => <Tag key={tag} onRemove={() => onChange(tags.filter(item => item !== tag))}>{tag}</Tag>)}
    <input aria-label="Add a tag" placeholder={tags.length ? '' : 'Add a tag'} value={draft} onChange={event => setDraft(event.target.value)} onBlur={add} onKeyDown={event => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); } }} className="h-5 min-w-16 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ui-muted" />
  </div>;
}

export type MenuAction = 'pin' | 'sync' | 'link' | 'clone' | 'merge' | 'mergeDelete' | 'rename' | 'tags' | 'delete' | 'download';
/** Same menu on every row and on the detail page. */
export function SheetMenu({ sheet, original, onAction, withDownload, label }: { sheet: Sheet; original?: Sheet; onAction: (action: MenuAction) => void; withDownload: boolean; label: string }) {
  const item = (action: MenuAction, text: string) => <DropdownMenuItem className={ROW} onSelect={() => onAction(action)}>{text}</DropdownMenuItem>;
  return <DropdownMenu><DropdownMenuTrigger render={<V2Icon label={`Actions for ${label}`}><MoreHorizontal size={16} aria-hidden /></V2Icon>} /><DropdownMenuContent align="end" className={`min-w-[210px] ${MENU}`}>
    {withDownload && item('download', 'Download')}
    {item('pin', sheet.pinned ? 'Unpin' : 'Pin')}
    {sheet.sharePoint && item('sync', 'Sync now')}
    {item('link', sheet.sharePoint ? 'Change SharePoint link…' : 'Link to SharePoint…')}
    {item('clone', 'Clone')}
    {original && <>{item('merge', `Merge into ${original.name}`)}{item('mergeDelete', 'Merge and delete')}</>}
    {item('rename', 'Rename')}
    {item('tags', 'Edit tags')}
    <DropdownMenuSeparator />
    <DropdownMenuItem className={ROW} variant="destructive" onSelect={() => onAction('delete')}>Delete</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>;
}
export const DownloadIcon = ({ name }: { name: string }) => <V2Icon label={`Download ${name}`}><Download size={16} aria-hidden /></V2Icon>;

/** The small tag on the worksheet runs read. */
export const RunsTag = () => <span className="rounded-[4px] bg-[color-mix(in_srgb,var(--ui-info)_16%,transparent)] px-1 text-[11px] text-ui-info">Runs</span>;
