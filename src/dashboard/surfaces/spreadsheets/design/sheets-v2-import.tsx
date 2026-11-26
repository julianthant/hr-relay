import { useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Link2, Plus, Upload } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Field as FormField, Input, PageBreadcrumbs, PageHeading, dsFocus, dsIcon } from '../../../ds/ui.js';
import type { EditableWorkbook } from '../../../../rules/spreadsheets/workbook-io.js';
import { copyColumnMapping } from '../../../../rules/spreadsheets/column-mapping.js';
import { SheetDetailGridSkeleton, WorkbookGrid } from './sheets-v2-detail.js';
import { withMapping, type Field, type ImportDraft } from './sheets-v2-model.js';
import { Grey, Tag, TagMenu, V2Button } from './sheets-v2-ui.js';
import './sheets-v2.css';

const Option = ({ icon, title, note }: { icon: ReactNode; title: string; note: string }) =>
  <span className="flex items-start gap-2.5">{icon}<span className="grid"><span>{title}</span><Grey>{note}</Grey></span></span>;

/** Import is a menu: a file from this computer opens a draft page, a SharePoint link opens its small dialog. */
export function ImportMenu({ disabled, onFile, onSharePoint }: { disabled: boolean; onFile: (file: File) => void; onSharePoint: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <input ref={input} hidden type="file" accept=".xlsx,.csv" aria-label="Spreadsheet file" onChange={event => { const picked = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (picked) onFile(picked); }} />
    <DropdownMenu><DropdownMenuTrigger render={<V2Button disabled={disabled} icon={<Plus aria-hidden className={dsIcon.md} />} iconAfter={<ChevronDown aria-hidden className={`${dsIcon.md} text-ui-muted`} />}>Import</V2Button>} />
      <DropdownMenuContent align="end" className="w-[260px]">
        <DropdownMenuItem onSelect={() => input.current?.click()}><Option icon={<Upload aria-hidden className={`${dsIcon.lg} mt-0.5 shrink-0`} />} title="From this computer" note=".xlsx or .csv" /></DropdownMenuItem>
        <DropdownMenuItem onSelect={onSharePoint}><Option icon={<Link2 aria-hidden className={`${dsIcon.lg} mt-0.5 shrink-0`} />} title="SharePoint link" note="Stays in sync" /></DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  </>;
}

/** A picked file as a page: its name, tags and preview. Nothing is in the library until Add to library. */
export function DraftDetail({ draft, bank, fields, adding, onChange, onDiscard, onAdd }: { draft: ImportDraft; bank: readonly string[]; fields: readonly Field[]; adding: boolean;
  onChange: (draft: ImportDraft) => void; onDiscard: () => void; onAdd: () => void }) {
  const { document } = draft;
  const edit = (next: EditableWorkbook) => onChange({ ...draft, document: next });
  return <div className="min-w-0">
    <PageBreadcrumbs items={[{ label: 'Spreadsheets', onClick: onDiscard }, { label: draft.name || 'New spreadsheet' }]} />
    <PageHeading className="mb-[var(--ds-space-page-heading-content)]"
      title={<input aria-label="Name" value={draft.name} placeholder="Name" onChange={event => onChange({ ...draft, name: event.target.value })} className={`w-full min-w-0 rounded-sm bg-transparent font-[inherit] text-[length:inherit] leading-[inherit] outline-none placeholder:text-ui-muted ${dsFocus}`} />}
      description={<span className="flex min-w-0 items-center gap-1.5 whitespace-nowrap">
        {draft.tags.map(tag => <Tag key={tag} onRemove={() => onChange({ ...draft, tags: draft.tags.filter(item => item !== tag) })}>{tag}</Tag>)}
        <TagMenu name={draft.name || 'the new spreadsheet'} tags={draft.tags} bank={bank} onChange={tags => onChange({ ...draft, tags })} />
        <span aria-hidden>·</span><span>Not in the library yet</span></span>}
      actions={<><V2Button look="plain" onClick={onDiscard}>Discard</V2Button><V2Button look="primary" disabled={!document || !draft.name.trim() || adding} onClick={onAdd}>Add to library</V2Button></>} />
    {document ? <WorkbookGrid document={document} fields={fields}
      onMap={(worksheet, patch) => edit({ ...document, sheets: document.sheets.map(item => item.id === worksheet ? withMapping(item, patch) : item) })}
      onCopy={worksheet => edit(copyColumnMapping(document, worksheet))} />
      : <SheetDetailGridSkeleton name={draft.name} />}
  </div>;
}

/** A SharePoint workbook joins the library as soon as Relay reads it, so it needs only its link and a name. */
export function SharePointImport({ onClose, onAdd }: { onClose: () => void; onAdd: (request: { url: string; name: string }) => Promise<boolean> }) {
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [working, setWorking] = useState(false);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent size="sm" className="sv2-dialog" title="Add a SharePoint link">
    <DialogBody><div className="grid gap-3">
      <FormField label="Workbook link"><Input aria-label="Workbook link" placeholder="https://…sharepoint.com/…" value={link} onChange={event => setLink(event.target.value)} /></FormField>
      <FormField label="Name"><Input aria-label="Name" value={name} onChange={event => setName(event.target.value)} /></FormField>
    </div></DialogBody>
    <DialogFooter><V2Button onClick={onClose}>Cancel</V2Button><V2Button look="primary" disabled={working || !name.trim() || !/^https:\/\//u.test(link.trim())}
      onClick={() => { setWorking(true); void onAdd({ url: link.trim(), name: name.trim() }).then(added => { if (added) onClose(); else setWorking(false); }); }}>Add</V2Button></DialogFooter>
  </DialogContent></Dialog>;
}
