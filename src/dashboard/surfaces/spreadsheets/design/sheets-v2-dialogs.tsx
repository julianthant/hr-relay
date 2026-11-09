import { useState, type ReactNode } from 'react';
import { Dialog, DialogBody, DialogContent, DialogFooter, Field, Input } from '../../../ds/ui.js';
import { type Sheet, mergePreview, stamp } from './sheets-v2-model.js';
import './sheets-v2.css';
import { Grey, Picker, TagEditor, V2Button } from './sheets-v2-ui.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '../../../ds/ui.js';

export type DialogKind = 'rename' | 'tags' | 'link' | 'merge' | 'rollback' | 'delete';
const field = '!bg-[var(--ui-field)] !border-[color:var(--ui-stroke-control)]';

function Shell({ title, description, onClose, footer, children, size = 'sm' }: { title: string; description?: string; onClose: () => void; footer: ReactNode; children?: ReactNode; size?: 'sm' | 'md' }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="sv2-dialog" size={size} title={title} description={description}>
    {children && <DialogBody>{children}</DialogBody>}
    <DialogFooter>{footer}</DialogFooter>
  </DialogContent></Dialog>;
}
const Cancel = ({ onClose }: { onClose: () => void }) => <V2Button onClick={onClose}>Cancel</V2Button>;

export interface DialogActions {
  rename: (name: string) => void; tags: (tags: readonly string[]) => void; link: (url: string) => void;
  merge: (target: Sheet) => void; rollback: (version: number) => void; remove: () => void;
}

export function SheetDialog({ kind, sheet, sheets, actions, onClose }: { kind: DialogKind; sheet: Sheet; sheets: readonly Sheet[]; actions: DialogActions; onClose: () => void }) {
  const [text, setText] = useState(kind === 'rename' ? sheet.name : kind === 'link' ? sheet.sharePoint ?? '' : '');
  const [tags, setTags] = useState(sheet.tags);
  const [target, setTarget] = useState<Sheet>();
  const [version, setVersion] = useState<number>();
  const done = (run: () => void) => () => { run(); onClose(); };
  if (kind === 'rename') return <Shell title="Rename spreadsheet" onClose={onClose} footer={<><Cancel onClose={onClose} /><V2Button look="primary" disabled={!text.trim()} onClick={done(() => actions.rename(text.trim()))}>Rename</V2Button></>}>
    <Field label="Name"><Input className={field} value={text} onChange={event => setText(event.target.value)} /></Field></Shell>;
  if (kind === 'tags') return <Shell title="Edit tags" description={sheet.name} onClose={onClose} footer={<><Cancel onClose={onClose} /><V2Button look="primary" onClick={done(() => actions.tags(tags))}>Save</V2Button></>}><TagEditor tags={tags} onChange={setTags} workflow={sheet.workflow} /></Shell>;
  if (kind === 'link') return <Shell title={sheet.sharePoint ? 'Change SharePoint link' : 'Link to SharePoint'} description="Relay pulls this workbook in. It becomes read-only here." onClose={onClose}
    footer={<><Cancel onClose={onClose} /><V2Button look="primary" disabled={!/^https:\/\//u.test(text.trim())} onClick={done(() => actions.link(text.trim()))}>Link</V2Button></>}>
    <Field label="Workbook link"><Input className={field} placeholder="https://…sharepoint.com/…" value={text} onChange={event => setText(event.target.value)} /></Field></Shell>;
  if (kind === 'merge') {
    const targets = sheets.filter(item => item.id !== sheet.id && !item.sharePoint), preview = target && mergePreview(target);
    return <Shell title={`Merge ${sheet.name} into…`} description="Rows match on Employee ID. No rows are removed." size="md" onClose={onClose}
      footer={<>{preview && <Grey className="mr-auto">{preview.added} added · {preview.updated} updated</Grey>}<Cancel onClose={onClose} /><V2Button look="primary" disabled={!target} onClick={done(() => actions.merge(target!))}>Merge</V2Button></>}>
      <DropdownMenu><DropdownMenuTrigger render={<Picker aria-label="Target spreadsheet" className="w-full">{target?.name ?? <span className="text-ui-muted">Choose a spreadsheet</span>}</Picker>} /><DropdownMenuContent align="start" className="min-w-[320px]">
        <DropdownMenuRadioGroup value={target?.id ?? ''} onValueChange={id => setTarget(targets.find(item => item.id === id))}>{targets.map(item => <DropdownMenuRadioItem closeOnClick key={item.id} value={item.id}>{item.name}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
      </DropdownMenuContent></DropdownMenu></Shell>;
  }
  if (kind === 'rollback') return <Shell title="Roll back" description={`${sheet.name} · now v${sheet.versions[0].n}`} size="md" onClose={onClose}
    footer={<>{sheet.sharePoint && <Grey className="mr-auto">The next sync replaces it.</Grey>}<Cancel onClose={onClose} /><V2Button look="primary" disabled={version === undefined} onClick={done(() => actions.rollback(version!))}>Roll back</V2Button></>}>
    <ul role="radiogroup" aria-label="Versions" className="divide-y divide-ui-stroke rounded-md border border-ui-stroke">{sheet.versions.map((entry, index) => <li key={entry.n}>
      <button type="button" role="radio" aria-checked={version === entry.n} disabled={index === 0} onClick={() => setVersion(entry.n)} className={`flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-ui-hover disabled:opacity-60 ${version === entry.n ? 'bg-ui-hover' : ''}`}>
        <span aria-hidden className={`size-3.5 shrink-0 rounded-full border ${version === entry.n ? 'border-ui-info bg-ui-info' : 'border-ui-stroke-control'}`} />
        <span className="w-8 tabular-nums">v{entry.n}</span><span className="w-28 shrink-0 tabular-nums text-ui-muted">{stamp(entry.at)}</span><span className="min-w-0 flex-1 truncate">{entry.note}</span>{index === 0 && <Grey>Current</Grey>}
      </button></li>)}</ul></Shell>;
  return <Shell title={`Delete ${sheet.name}?`} description="Runs that read it keep their results. SharePoint files are unchanged." onClose={onClose} footer={<><Cancel onClose={onClose} /><V2Button look="danger" onClick={done(actions.remove)}>Delete</V2Button></>} />;
}
