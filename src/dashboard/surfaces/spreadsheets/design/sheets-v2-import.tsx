import { useRef, useState } from 'react';
import { FileSpreadsheet, X } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogFooter, Input, SegmentedChoice } from '../../../ds/ui.js';
import { FIELDS, IMPORT_FILE, IMPORT_SHEETS, type FieldKey, bestSheet, guessColumn } from './sheets-v2-model.js';
import { MappingGrid } from './sheets-v2-grid.js';
import { Slide } from './sheets-v2-slide.js';
import { SheetTabs, TagEditor, V2Icon, V2Button } from './sheets-v2-ui.js';
import './sheets-v2.css';

const field = '!bg-[var(--ui-field)] !border-[color:var(--ui-stroke-control)]';
type Mode = 'local' | 'sharepoint';
const Labeled = ({ label, children }: { label: string; children: React.ReactNode }) => <div className="grid gap-1"><span className="text-[12px] text-ui-muted">{label}</span>{children}</div>;
const guess = (sheetName: string): Record<FieldKey, string | null> => {
  const headers = IMPORT_SHEETS.find(sheet => sheet.name === sheetName)!.dataset.headers;
  return Object.fromEntries(FIELDS.map(item => [item.key, guessColumn(item.key, headers)])) as Record<FieldKey, string | null>;
};

export interface ImportInput { name: string; tags: readonly string[]; sharePoint: string | null; sheetName: string; mapping: Record<FieldKey, string | null> }
export function ImportDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (input: ImportInput) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [mode, setMode] = useState<Mode>('local');
  const [picked, setPicked] = useState(false);
  const [link, setLink] = useState('');
  const [name, setName] = useState('');
  const [tags, setTags] = useState<readonly string[]>([]);
  // Relay picks the sheet whose headers best match the fields; the tabs switch it before Add to library.
  const [sheetName, setSheetName] = useState(bestSheet);
  const [mapping, setMapping] = useState(() => guess(bestSheet()));
  const ready = mode === 'local' ? picked : /^https:\/\//u.test(link.trim());
  const index = mode === 'local' ? 0 : 1;
  const sheet = IMPORT_SHEETS.find(item => item.name === sheetName)!;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent size={step === 1 ? 'md' : 'xl'} className={step === 1 ? 'sv2-dialog !max-w-[480px]' : 'sv2-dialog'} title="Import a spreadsheet">
    <DialogBody>{step === 1 ? <div className="grid gap-3">
      <input ref={input} hidden type="file" accept=".xlsx,.csv" onChange={event => { if (event.currentTarget.files?.[0]) { setPicked(true); setName(current => current || IMPORT_FILE.suggested); } event.currentTarget.value = ''; }} />
      <div className="flex items-center justify-between gap-3">
        <div className="w-[200px]"><SegmentedChoice hideLabel label="Source" value={mode} options={[{ value: 'local', label: 'Local' }, { value: 'sharepoint', label: 'SharePoint' }]} onChange={value => { setMode(value); setPicked(false); setLink(''); }} /></div>
        <Slide id={mode} index={index} className="h-7 w-[104px]">{mode === 'local' && <V2Button onClick={() => input.current?.click()}>Choose file</V2Button>}</Slide>
      </div>
      <Slide id={mode} index={index}>{mode === 'local'
        ? picked && <div className="flex items-center gap-2.5 rounded-md border border-ui-stroke px-3 py-2"><FileSpreadsheet size={18} aria-hidden className="shrink-0 text-ui-muted" /><div className="min-w-0 flex-1"><div className="truncate text-[13px]">{IMPORT_FILE.name}</div><div className="text-[12px] text-ui-muted">{IMPORT_FILE.rows} rows · {IMPORT_FILE.size}</div></div>
          <V2Icon label="Remove file" onClick={() => { setPicked(false); setName(''); }}><X size={14} aria-hidden /></V2Icon></div>
        : <Input aria-label="SharePoint workbook link" className={field} placeholder="Paste a SharePoint workbook link" value={link} onChange={event => { setLink(event.target.value); setName(current => current || (event.target.value ? 'SharePoint workbook' : '')); }} />}</Slide>
      <Labeled label="Name"><Input aria-label="Name" className={field} value={name} onChange={event => setName(event.target.value)} /></Labeled>
      <Labeled label="Tags"><TagEditor tags={tags} onChange={setTags} /></Labeled>
    </div> : <MappingGrid key={sheetName} dataset={sheet.dataset} mapping={mapping} onMap={patch => setMapping(current => ({ ...current, ...patch }))} maxHeight="max-h-[260px]"
      tabs={<SheetTabs names={IMPORT_SHEETS.map(item => item.name)} current={sheetName} runs={sheetName} onSelect={next => { setSheetName(next); setMapping(guess(next)); }} />} />}</DialogBody>
    <DialogFooter>{step === 1 ? <><V2Button onClick={onClose}>Cancel</V2Button><V2Button look="primary" disabled={!ready} onClick={() => setStep(2)}>Next</V2Button></>
      : <><V2Button look="plain" className="mr-auto" onClick={() => setStep(1)}>Back</V2Button><V2Button onClick={onClose}>Cancel</V2Button><V2Button look="primary" onClick={() => { onAdd({ name: name.trim() || IMPORT_FILE.suggested, tags, sharePoint: mode === 'local' ? null : link.trim(), sheetName, mapping }); onClose(); }}>Add to library</V2Button></>}</DialogFooter>
  </DialogContent></Dialog>;
}
