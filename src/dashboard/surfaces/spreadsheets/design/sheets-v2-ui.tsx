import { forwardRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ChevronDown, Download, MoreHorizontal, X } from 'lucide-react';
import { Button, IconButton, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger, dsFocus } from '../../../ds/ui.js';
import { type Dataset, type Sheet, samplesOf } from './sheets-v2-model.js';

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
  return <Button ref={ref} variant="outline" className={`min-w-0 justify-between ${className}`} iconAfter={<ChevronDown size={14} aria-hidden className="shrink-0 text-ui-muted" />} {...props}><span className="min-w-0 truncate">{children}</span></Button>;
});

export const Grey = ({ children, className = '' }: { children: ReactNode; className?: string }) => <span className={`text-[12px] text-ui-muted ${className}`}>{children}</span>;
export const Tag = ({ children, onRemove }: { children: string; onRemove?: () => void }) => <span className="inline-flex h-5 items-center gap-1 rounded-[5px] bg-ui-hover px-1.5 text-[11px] text-ui-secondary">{children}{onRemove && <button type="button" aria-label={`Remove ${children}`} className={`rounded-sm ${dsFocus}`} onClick={onRemove}><X size={11} aria-hidden /></button>}</span>;

export function TagEditor({ tags, onChange }: { tags: readonly string[]; onChange: (tags: readonly string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => { const next = draft.trim(); if (next && !tags.includes(next)) onChange([...tags, next]); setDraft(''); };
  return <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded-md border border-ui-stroke px-2 py-1">
    {tags.map(tag => <Tag key={tag} onRemove={() => onChange(tags.filter(item => item !== tag))}>{tag}</Tag>)}
    <input aria-label="Add a tag" placeholder={tags.length ? '' : 'Add a tag'} value={draft} onChange={event => setDraft(event.target.value)} onBlur={add} onKeyDown={event => { if (event.key === 'Enter' || event.key === ',') { event.preventDefault(); add(); } }} className="h-5 min-w-16 flex-1 bg-transparent text-[13px] outline-none placeholder:text-ui-muted" />
  </div>;
}

export type MenuAction = 'pin' | 'sync' | 'link' | 'clone' | 'merge' | 'rename' | 'tags' | 'delete' | 'download';
/** Same menu on every row and on the detail page. */
export function SheetMenu({ sheet, onAction, withDownload, label }: { sheet: Sheet; onAction: (action: MenuAction) => void; withDownload: boolean; label: string }) {
  const item = (action: MenuAction, text: string) => <DropdownMenuItem onSelect={() => onAction(action)}>{text}</DropdownMenuItem>;
  return <DropdownMenu><DropdownMenuTrigger render={<V2Icon label={`Actions for ${label}`}><MoreHorizontal size={16} aria-hidden /></V2Icon>} /><DropdownMenuContent align="end" className="min-w-[210px]">
    {withDownload && item('download', 'Download')}
    {item('pin', sheet.pinned ? 'Unpin' : 'Pin')}
    {sheet.sharePoint && item('sync', 'Sync now')}
    {item('link', sheet.sharePoint ? 'Change SharePoint link…' : 'Link to SharePoint…')}
    {item('clone', 'Clone')}
    {!sheet.sharePoint && item('merge', 'Merge into…')}
    {item('rename', 'Rename')}
    {item('tags', 'Edit tags')}
    <DropdownMenuSeparator />
    <DropdownMenuItem variant="destructive" onSelect={() => onAction('delete')}>Delete</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>;
}
export const DownloadIcon = ({ name }: { name: string }) => <V2Icon label={`Download ${name}`}><Download size={16} aria-hidden /></V2Icon>;

/** Column picker for one field: soft-bordered, shows each header with sample values. */
export function ColumnPicker({ label, dataset, value, onChange }: { label: string; dataset: Dataset; value: string | null; onChange: (header: string | null) => void }) {
  return <DropdownMenu><DropdownMenuTrigger render={<Picker aria-label={`${label} column`} className="w-full max-w-[280px]">{value ?? <span className="text-ui-muted">Not mapped</span>}</Picker>} /><DropdownMenuContent align="start" className="min-w-[400px]">
    <DropdownMenuRadioGroup value={value ?? ''} onValueChange={next => onChange(next === '' ? null : next)}>
      <DropdownMenuRadioItem closeOnClick value=""><span className="text-ui-muted">Not mapped</span></DropdownMenuRadioItem>
      {dataset.headers.map(header => <DropdownMenuRadioItem closeOnClick key={header} value={header}><span className="flex min-w-0 flex-1 items-baseline justify-between gap-4"><span className="whitespace-nowrap">{header}</span><Grey className="truncate">{samplesOf(dataset, header)}</Grey></span></DropdownMenuRadioItem>)}
    </DropdownMenuRadioGroup>
  </DropdownMenuContent></DropdownMenu>;
}
