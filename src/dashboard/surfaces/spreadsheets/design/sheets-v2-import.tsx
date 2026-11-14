import { useRef, useState } from 'react';
import { FileSpreadsheet, X } from 'lucide-react';
import { Dialog, DialogBody, DialogContent, DialogFooter, Input } from '../../../ds/ui.js';
import type { EditableWorkbook } from '../../../../rules/spreadsheets/workbook-io.js';
import { prepareSpreadsheetColumns } from '../spreadsheet-column-import-model.js';
import { importSpreadsheetInWorker } from '../spreadsheet-import-client.js';
import { MappingGrid } from './sheets-v2-grid.js';
import { datasetOf, mappingOf, withMapping, type Field } from './sheets-v2-model.js';
import { Grey, V2Button, V2Icon } from './sheets-v2-ui.js';
import './sheets-v2.css';

const field = '!bg-[var(--ui-field)] !border-[color:var(--ui-stroke-control)]';
const Labeled = ({ label, children }: { label: string; children: React.ReactNode }) => <div className="grid gap-1"><span className="text-[12px] text-ui-muted">{label}</span>{children}</div>;
const fileSize = (bytes: number) => bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Step 1 picks the file and names it; step 2 maps each worksheet's columns before it joins the library. */
export function ImportDialog({ fields, onClose, onAdd }: { fields: readonly Field[]; onClose: () => void; onAdd: (document: EditableWorkbook) => Promise<boolean> }) {
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [file, setFile] = useState<{ name: string; size: number; document: EditableWorkbook }>();
  const [name, setName] = useState('');
  const [tab, setTab] = useState(0);
  const [document, setDocument] = useState<EditableWorkbook>();
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const pick = async (picked: File) => {
    setError('');
    try { const prepared = prepareSpreadsheetColumns(await importSpreadsheetInWorker(picked.name, await picked.arrayBuffer())); setFile({ name: picked.name, size: picked.size, document: prepared }); setName(current => current || picked.name.replace(/\.(xlsx|csv)$/iu, '')); }
    catch { setFile(undefined); setError("Relay couldn't read that file."); }
  };
  const sheet = document?.sheets[tab];
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}><DialogContent size={step === 1 ? 'md' : 'xl'} className={step === 1 ? 'sv2-dialog !max-w-[480px]' : 'sv2-dialog'} title="Import a spreadsheet">
    <DialogBody>{step === 1 || !document || !sheet ? <div className="grid gap-3">
      <input ref={input} hidden type="file" accept=".xlsx,.csv" onChange={event => { const picked = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (picked) void pick(picked); }} />
      {file ? <div className="flex items-center gap-2.5 rounded-md border border-ui-stroke px-3 py-2"><FileSpreadsheet size={18} aria-hidden className="shrink-0 text-ui-muted" /><div className="min-w-0 flex-1"><div className="truncate text-[13px]">{file.name}</div><div className="text-[12px] text-ui-muted">{fileSize(file.size)}</div></div>
        <V2Icon label="Remove file" onClick={() => { setFile(undefined); setName(''); }}><X size={14} aria-hidden /></V2Icon></div>
        : <div className="flex items-center justify-between gap-3"><Grey>Choose an .xlsx or .csv file.</Grey><V2Button onClick={() => input.current?.click()}>Choose file</V2Button></div>}
      {error && <Grey className="text-ui-danger">{error}</Grey>}
      <Labeled label="Name"><Input aria-label="Name" className={field} value={name} onChange={event => setName(event.target.value)} /></Labeled>
    </div> : <MappingGrid key={sheet.id} fields={fields} dataset={datasetOf(sheet)} mapping={mappingOf(sheet, fields)} maxHeight="max-h-[260px]" columnsOpen
      onMap={patch => setDocument(current => current && { ...current, sheets: current.sheets.map(item => item.id === sheet.id ? withMapping(item, patch) : item) })}
      worksheets={{ names: document.sheets.map(item => item.name), current: sheet.name, onSelect: next => setTab(document.sheets.findIndex(item => item.name === next)) }} />}</DialogBody>
    <DialogFooter>{step === 1 ? <><V2Button onClick={onClose}>Cancel</V2Button><V2Button look="primary" disabled={!file || !name.trim()} onClick={() => { setDocument({ ...file!.document, name: name.trim() }); setTab(0); setStep(2); }}>Next</V2Button></>
      : <><V2Button look="plain" className="mr-auto" onClick={() => setStep(1)}>Back</V2Button><V2Button onClick={onClose}>Cancel</V2Button><V2Button look="primary" disabled={working} onClick={() => { setWorking(true); void onAdd(document!).then(added => { if (added) onClose(); else setWorking(false); }); }}>Add to library</V2Button></>}</DialogFooter>
  </DialogContent></Dialog>;
}
