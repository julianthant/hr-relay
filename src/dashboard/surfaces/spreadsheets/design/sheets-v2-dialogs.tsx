import { useState, type ReactNode } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, Field, Input, Select, dsIcon, dsText } from '../../../ds/ui.js';
import { type Sheet, stamp } from './sheets-v2-model.js';
import './sheets-v2.css';
import { Grey, V2Button, V2Icon } from './sheets-v2-ui.js';

export type DialogKind = 'rename' | 'link' | 'clone' | 'versions' | 'delete';

function Shell({ title, description, onClose, footer, children, size = 'sm' }: { title: string; description?: ReactNode; onClose: () => void; footer: ReactNode; children?: ReactNode; size?: 'sm' | 'md' }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="sv2-dialog" size={size} title={title} description={description}>
    {children && <DialogBody>{children}</DialogBody>}
    <DialogFooter>{footer}</DialogFooter>
  </DialogContent></Dialog>;
}
const Cancel = ({ onClose }: { onClose: () => void }) => <V2Button onClick={onClose}>Cancel</V2Button>;

export interface DialogActions { rename: (name: string) => void; clone: (name: string) => Promise<string | undefined>; link: (url: string) => void; useVersion: (versionId: string) => void; remove: () => void;
  createVersion: (name: string, from: { kind: 'sharepoint' } | { kind: 'version'; versionId: string }) => void; renameVersion: (versionId: string, name: string) => void; deleteVersion: (versionId: string) => void }

export function SheetDialog({ kind, sheet, actions, deleteReady, onClose }: { kind: DialogKind; sheet: Sheet; actions: DialogActions; deleteReady: boolean; onClose: () => void }) {
  const [text, setText] = useState(kind === 'rename' ? sheet.name : kind === 'clone' ? `Copy of ${sheet.name}` : kind === 'link' ? sheet.sharePoint ?? '' : '');
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  const done = (run: () => void) => () => { run(); onClose(); };
  if (kind === 'rename') return <Shell title="Rename spreadsheet" onClose={onClose} footer={<><Cancel onClose={onClose} /><V2Button look="primary" disabled={!text.trim()} onClick={done(() => actions.rename(text.trim()))}>Rename</V2Button></>}>
    <Field label="Name"><Input value={text} onChange={event => setText(event.target.value)} /></Field></Shell>;
  if (kind === 'clone') {
    const send = () => { setBusy(true); void actions.clone(text.trim()).then(message => { if (message === undefined) onClose(); else { setRefusal(message); setBusy(false); } }); };
    return <Shell title="Clone spreadsheet" description={`A copy of ${sheet.name} as it is now.`} onClose={onClose} footer={<><Cancel onClose={onClose} /><V2Button look="primary" disabled={!text.trim() || busy} onClick={send}>Clone</V2Button></>}>
      <Field label="Name"><Input aria-label="Name" value={text} onChange={event => { setText(event.target.value); setRefusal(''); }} /></Field>
      {refusal && <Grey className="mt-2 block text-ui-danger">{refusal}</Grey>}</Shell>;
  }
  if (kind === 'link') return <Shell title={sheet.sharePoint ? 'Change SharePoint link' : 'Link to SharePoint'} description="Relay pulls this workbook in. It becomes read-only here." onClose={onClose}
    footer={<><Cancel onClose={onClose} /><V2Button look="primary" disabled={!/^https:\/\//u.test(text.trim())} onClick={done(() => actions.link(text.trim()))}>Link</V2Button></>}>
    <Field label="Workbook link"><Input placeholder="https://…sharepoint.com/…" value={text} onChange={event => setText(event.target.value)} /></Field></Shell>;
  if (kind === 'versions') return <VersionsDialog sheet={sheet} actions={actions} deleteReady={deleteReady} onClose={onClose} />;
  return <ConfirmDialog open onOpenChange={open => { if (!open) onClose(); }} title={`Delete ${sheet.name}?`} confirmLabel="Delete spreadsheet" destructive onConfirm={done(actions.remove)}
    description="Runs that read it keep their results. SharePoint files are unchanged." />;
}

type VersionStep = { step: 'list' } | { step: 'new' } | { step: 'rename' | 'delete' | 'use'; id: string };

function VersionsDialog({ sheet, actions, deleteReady, onClose }: { sheet: Sheet; actions: DialogActions; deleteReady: boolean; onClose: () => void }) {
  const [view, setView] = useState<VersionStep>({ step: 'list' });
  const [picked, setPicked] = useState<string>();
  const [text, setText] = useState('');
  const [from, setFrom] = useState(sheet.sharePoint ? 'sharepoint' : sheet.currentVersionId);
  const target = 'id' in view ? sheet.versions.find(entry => entry.id === view.id) : undefined;
  const list = () => setView({ step: 'list' });
  const done = (run: () => void) => () => { run(); onClose(); };
  if (view.step === 'use' && target) return <ConfirmDialog open onOpenChange={open => { if (!open) onClose(); }} title={`Use ${target.name}?`} detail={sheet.name} confirmLabel="Use version" onConfirm={done(() => actions.useVersion(target.id))}
    description={<><span className="block">Runs read {target.name} from now on. Other versions are kept.</span>{sheet.sharePoint && <span className="block">The next sync replaces it.</span>}</>} />;
  if (view.step === 'delete' && target && deleteReady && !target.inUse) return <ConfirmDialog open onOpenChange={open => { if (!open) onClose(); }} title={`Delete ${target.name}?`} confirmLabel="Delete version" destructive onConfirm={done(() => actions.deleteVersion(target.id))}
    description="Runs that used it keep their results." />;
  if (view.step === 'rename' && target) return <Shell title="Rename version" description={sheet.name} onClose={onClose} footer={<><V2Button onClick={list}>Back</V2Button><V2Button look="primary" disabled={!text.trim()} onClick={done(() => actions.renameVersion(target.id, text.trim()))}>Rename</V2Button></>}>
    <Field label="Name"><Input aria-label="Name" value={text} onChange={event => setText(event.target.value)} /></Field></Shell>;
  if (view.step === 'new') return <Shell title="New version" description={sheet.name} onClose={onClose} footer={<><V2Button onClick={list}>Back</V2Button>
    <V2Button look="primary" disabled={!text.trim()} onClick={done(() => actions.createVersion(text.trim(), from === 'sharepoint' ? { kind: 'sharepoint' } : { kind: 'version', versionId: from }))}>Create</V2Button></>}>
    <div className="grid gap-3"><Field label="Name"><Input aria-label="Name" value={text} onChange={event => setText(event.target.value)} /></Field>
    <Field label="Start from"><Select aria-label="Start from" value={from} onChange={event => setFrom(event.target.value)}>
      {sheet.sharePoint && <option value="sharepoint">SharePoint, as it is now</option>}
      {sheet.versions.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
    </Select></Field></div></Shell>;
  return <Shell title="Versions" description={`${sheet.name} · in use: ${sheet.versionName}`} size="md" onClose={onClose}
    footer={<><V2Button className="mr-auto" onClick={() => { setText(''); setView({ step: 'new' }); }}>New version</V2Button><Cancel onClose={onClose} />
      <V2Button look="primary" disabled={picked === undefined} onClick={() => picked && setView({ step: 'use', id: picked })}>Use version</V2Button></>}>
    <ul role="radiogroup" aria-label="Versions" className="divide-y divide-ui-stroke rounded-md border border-ui-stroke">{sheet.versions.map(entry => { const current = entry.id === sheet.currentVersionId; return <li key={entry.id} className="flex items-center gap-1 pr-2">
      <button type="button" role="radio" aria-checked={picked === entry.id} disabled={current} onClick={() => setPicked(entry.id)} className={`flex min-w-0 flex-1 items-center gap-3 px-3 py-2 text-left ${dsText.ui} hover:bg-ui-hover disabled:opacity-60 ${picked === entry.id ? 'bg-ui-hover' : ''}`}>
        <span aria-hidden className={`size-3.5 shrink-0 rounded-full border ${picked === entry.id ? 'border-ui-info bg-ui-info' : 'border-ui-stroke-control'}`} />
        <span className="min-w-0 flex-1 truncate">{entry.name}</span><span className="w-28 shrink-0 tabular-nums text-ui-muted">{stamp(entry.at)}</span><span className="w-12 shrink-0 text-right">{entry.inUse && <Grey>In use</Grey>}</span>
      </button>
      <V2Icon label={`Rename ${entry.name}`} onClick={() => { setText(entry.name); setView({ step: 'rename', id: entry.id }); }}><Pencil aria-hidden className={dsIcon.md} /></V2Icon>
      <V2Icon label={`Delete ${entry.name}`} disabled={entry.inUse || !deleteReady} onClick={() => setView({ step: 'delete', id: entry.id })}><Trash2 aria-hidden className={dsIcon.md} /></V2Icon>
    </li>; })}</ul>
    <Grey className="mt-2 block">Versions in use can't be deleted.</Grey>{sheet.sharePoint && <Grey className="block">The next sync replaces the current version.</Grey>}</Shell>;
}
