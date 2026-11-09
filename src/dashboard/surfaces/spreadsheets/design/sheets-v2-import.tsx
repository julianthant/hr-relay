import { useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogFooter, Field, Input, SegmentedChoice } from '../../../ds/ui.js';
import { FIELDS, IMPORT_FILE, type FieldKey, guessColumn, samplesOf, type Dataset } from './sheets-v2-model.js';
import { ColumnPicker, Grey, TagEditor, V2Button } from './sheets-v2-ui.js';
import '../../run-start/launch-presentation.css';

const field = '!bg-[var(--ui-field)] !border-[color:var(--ui-stroke-control)]';
const IMPORT_DATASET: Dataset = { headers: IMPORT_FILE.headers, rows: [['10482917', 'Example, Person A', 'persona@example.org', 'Example Dept', '555-0100'], ['10482930', 'Example, Person B', 'personb@example.org', 'Sample Office', '555-0101']].map(row => row.map(text => ({ text }))) };

export function FieldRows({ dataset, values, onChange }: { dataset: Dataset; values: Readonly<Record<FieldKey, string | null>>; onChange: (key: FieldKey, header: string | null) => void }) {
  return <ul className="divide-y divide-ui-stroke">{FIELDS.map(item => <li key={item.key} className="flex items-center justify-between gap-6 py-2.5">
    <div className="min-w-0"><div className="text-[13px]">{item.label}</div><div className="truncate"><Grey>Used by {item.usedBy.join(', ')}</Grey></div></div>
    <div className="flex w-[280px] shrink-0 justify-end"><ColumnPicker label={item.label} dataset={dataset} value={values[item.key]} onChange={header => onChange(item.key, header)} /></div>
  </li>)}</ul>;
}

export function ImportDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (input: { name: string; tags: readonly string[]; sharePoint: string | null; mapping: Record<FieldKey, string | null> }) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<'mac' | 'sharepoint'>('mac');
  const [picked, setPicked] = useState(false);
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [tags, setTags] = useState<readonly string[]>([]);
  const [mapping, setMapping] = useState<Record<FieldKey, string | null>>(() => ({ eid: guessColumn('eid', IMPORT_FILE.headers), name: guessColumn('name', IMPORT_FILE.headers), email: guessColumn('email', IMPORT_FILE.headers) }));
  const source = mode === 'mac' ? picked : /^https:\/\//u.test(link.trim());
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="launch-design" size="lg" title="Import a spreadsheet" description={`Step ${step} of 2`}>
    <DialogBody>{step === 1 ? <div className="grid gap-4">
      <div className="w-[260px]"><SegmentedChoice label="Source" value={mode} options={[{ value: 'mac', label: 'This Mac' }, { value: 'sharepoint', label: 'SharePoint' }]} onChange={value => { setMode(value); setPicked(false); setLink(''); }} /></div>
      <input ref={input} hidden type="file" accept=".xlsx,.csv" onChange={event => { if (event.currentTarget.files?.[0]) { setPicked(true); setName(current => current || IMPORT_FILE.suggested); } event.currentTarget.value = ''; }} />
      {mode === 'mac' ? <div className="flex items-center justify-between gap-4"><div className="min-w-0"><div className="text-[13px]">{picked ? IMPORT_FILE.name : 'Excel or CSV file'}</div>{picked && <div className="truncate"><Grey>{IMPORT_FILE.rows} rows</Grey></div>}</div><V2Button onClick={() => input.current?.click()}><FileSpreadsheet size={14} aria-hidden />Choose file</V2Button></div>
        : <Field label="Workbook link"><Input className={field} placeholder="https://…sharepoint.com/…" value={link} onChange={event => { setLink(event.target.value); setName(current => current || (event.target.value ? 'SharePoint workbook' : '')); }} /></Field>}
      <Field label="Name"><Input className={field} value={name} onChange={event => setName(event.target.value)} /></Field>
      <div className="grid gap-1.5"><span className="text-[13px] font-medium">Tags</span><TagEditor tags={tags} onChange={setTags} /></div>
    </div> : <div className="grid gap-1"><Grey>Relay guessed from the header names and sample values. Change any it got wrong.</Grey><FieldRows dataset={IMPORT_DATASET} values={mapping} onChange={(key, header) => setMapping(current => ({ ...current, [key]: header }))} /></div>}</DialogBody>
    <DialogFooter>{step === 1 ? <><V2Button onClick={onClose}>Cancel</V2Button><V2Button disabled={!source || !name.trim()} onClick={() => setStep(2)}>Next</V2Button></>
      : <><V2Button look="plain" className="mr-auto" onClick={() => setStep(1)}>Back</V2Button><V2Button onClick={onClose}>Cancel</V2Button><V2Button look="primary" onClick={() => { onAdd({ name: name.trim(), tags, sharePoint: mode === 'mac' ? null : link.trim(), mapping }); onClose(); }}>Add to library</V2Button></>}</DialogFooter>
  </DialogContent></Dialog>;
}
export { samplesOf };
