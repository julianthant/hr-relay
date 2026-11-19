import { useState, type ReactNode } from 'react';
import { Chip, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, Field, Input, RadioGroup } from '../../../ds/ui.js';
import { type Sheet, addTag, stamp, MAX_TAG_LENGTH } from './sheets-v2-model.js';
import './sheets-v2.css';
import { Grey, V2Button } from './sheets-v2-ui.js';

export type DialogKind = 'rename' | 'link' | 'clone' | 'rollback' | 'delete' | 'tags';

function Shell({ title, description, onClose, footer, children, size = 'sm' }: { title: string; description?: ReactNode; onClose: () => void; footer: ReactNode; children?: ReactNode; size?: 'sm' | 'md' }) {
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="sv2-dialog" size={size} title={title} description={description}>
    {children && <DialogBody>{children}</DialogBody>}
    <DialogFooter>{footer}</DialogFooter>
  </DialogContent></Dialog>;
}
const Cancel = ({ onClose }: { onClose: () => void }) => <V2Button onClick={onClose}>Cancel</V2Button>;

export interface DialogActions { rename: (name: string) => void; clone: (name: string) => Promise<string | undefined>; link: (url: string) => void; rollback: (versionId: string) => void; remove: () => void; tags: (tags: readonly string[]) => void }

export function SheetDialog({ kind, sheet, actions, onClose }: { kind: DialogKind; sheet: Sheet; actions: DialogActions; onClose: () => void }) {
  const [text, setText] = useState(kind === 'rename' ? sheet.name : kind === 'clone' ? `Copy of ${sheet.name}` : kind === 'link' ? sheet.sharePoint ?? '' : '');
  const [version, setVersion] = useState<string>();
  const [tags, setTags] = useState<readonly string[]>(sheet.tags);
  const [confirming, setConfirming] = useState(false);
  const [refusal, setRefusal] = useState('');
  const [busy, setBusy] = useState(false);
  const done = (run: () => void) => () => { run(); onClose(); };
  const picked = sheet.versions.find(entry => entry.id === version);
  if (kind === 'rename') return <Shell title="Rename spreadsheet" onClose={onClose} footer={<><Cancel onClose={onClose} /><V2Button look="primary" disabled={!text.trim()} onClick={done(() => actions.rename(text.trim()))}>Rename</V2Button></>}>
    <Field label="Name"><Input value={text} onChange={event => setText(event.target.value)} /></Field></Shell>;
  if (kind === 'clone') {
    const send = () => { setBusy(true); void actions.clone(text.trim()).then(message => { if (message === undefined) onClose(); else { setRefusal(message); setBusy(false); } }); };
    return <Shell title="Clone spreadsheet" description={`A copy of ${sheet.name} as it is now.`} onClose={onClose} footer={<><Cancel onClose={onClose} /><V2Button look="primary" disabled={!text.trim() || busy} onClick={send}>Clone</V2Button></>}>
      <Field label="Name"><Input aria-label="Name" value={text} onChange={event => { setText(event.target.value); setRefusal(''); }} /></Field>
      {refusal && <Grey className="mt-2 block text-ui-danger">{refusal}</Grey>}</Shell>;
  }
  if (kind === 'tags') {
    const add = () => { const next = addTag(tags, text); if (next) { setTags(next); setText(''); } };
    return <Shell title="Edit tags" description={sheet.name} onClose={onClose} footer={<><Cancel onClose={onClose} /><V2Button look="primary" onClick={done(() => actions.tags(tags))}>Save</V2Button></>}>
      <Field label="Tags"><div className="flex gap-2"><Input aria-label="New tag" maxLength={MAX_TAG_LENGTH} placeholder="Add a tag" value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(); } }} />
        <V2Button disabled={!addTag(tags, text)} onClick={add}>Add</V2Button></div></Field>
      <div className="mt-3 flex flex-wrap gap-1">{tags.map(tag => <Chip key={tag} onRemove={() => setTags(tags.filter(item => item !== tag))} removeLabel="Remove tag">{tag}</Chip>)}</div></Shell>;
  }
  if (kind === 'link') return <Shell title={sheet.sharePoint ? 'Change SharePoint link' : 'Link to SharePoint'} description="Relay pulls this workbook in. It becomes read-only here." onClose={onClose}
    footer={<><Cancel onClose={onClose} /><V2Button look="primary" disabled={!/^https:\/\//u.test(text.trim())} onClick={done(() => actions.link(text.trim()))}>Link</V2Button></>}>
    <Field label="Workbook link"><Input placeholder="https://…sharepoint.com/…" value={text} onChange={event => setText(event.target.value)} /></Field></Shell>;
  if (kind === 'rollback' && confirming && picked) return <ConfirmDialog open onOpenChange={open => { if (!open) onClose(); }} title={`Roll back to v${picked.n}?`} detail={sheet.name} confirmLabel="Roll back" onConfirm={done(() => actions.rollback(picked.id))}
    description={<><span className="block">Runs read v{picked.n} from now on. Other versions are kept.</span>{sheet.sharePoint && <span className="block">The next sync replaces it.</span>}</>} />;
  if (kind === 'rollback') return <Shell title={sheet.versions.length > 1 ? 'Roll back' : 'Version history'} description={`${sheet.name} · now v${sheet.version}`} size="md" onClose={onClose}
    footer={<>{sheet.sharePoint && <Grey className="mr-auto">The next sync replaces it.</Grey>}<Cancel onClose={onClose} /><V2Button look="primary" disabled={version === undefined} onClick={() => setConfirming(true)}>Roll back</V2Button></>}>
    <RadioGroup label="Versions" name="sheet-version" value={version ?? ''} onValueChange={setVersion}
      options={sheet.versions.map(entry => ({ value: entry.id, disabled: entry.id === sheet.currentVersionId,
        label: <span className="flex min-w-0 items-baseline gap-3"><span className="w-8 tabular-nums">v{entry.n}</span><span className="w-28 shrink-0 tabular-nums text-ui-muted">{stamp(entry.at)}</span><span className="min-w-0 flex-1 truncate">{entry.note}</span>{entry.id === sheet.currentVersionId && <Grey>Current</Grey>}</span> }))} /></Shell>;
  return <ConfirmDialog open onOpenChange={open => { if (!open) onClose(); }} title={`Delete ${sheet.name}?`} confirmLabel="Delete spreadsheet" destructive onConfirm={done(actions.remove)}
    description="Runs that read it keep their results. SharePoint files are unchanged." />;
}
