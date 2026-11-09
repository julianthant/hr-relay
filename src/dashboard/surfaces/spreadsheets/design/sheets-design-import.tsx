import { useRef, useState } from 'react';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, Disclosure } from '../../../ds/ui.js';
import { ColumnMapping } from './sheets-design-columns.js';
import { DECLARED_FIELDS, FIELD_LABELS, IMPORT_COLUMNS, IMPORT_FILE, REQUIRED_FIELDS, type FieldKey } from './sheets-design-fixtures.js';
import type { SheetsStep } from './sheets-design-mode.js';
import '../../run-start/launch-presentation.css';

const STEPS: readonly SheetsStep[] = ['pick', 'columns'];
const NEEDS = DECLARED_FIELDS.map(key => ({ key, label: FIELD_LABELS[key], required: REQUIRED_FIELDS.includes(key) }));

export function FilePickRow({ title, hint, onFile }: { title: string; hint: string; onFile: (file: File) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return <div className="flex items-center justify-between gap-3 rounded-md border border-ui-stroke bg-ui-table p-3">
    <input ref={input} hidden type="file" accept=".xlsx,.csv" onChange={event => { const picked = event.currentTarget.files?.[0]; if (picked) onFile(picked); event.currentTarget.value = ''; }} />
    <div className="min-w-0"><div className="text-body font-medium">{title}</div><div className="text-caption text-ui-muted">{hint}</div></div>
    <Button variant="secondary" icon={<Upload className="size-3.5" />} onClick={() => input.current?.click()}>Choose file</Button>
  </div>;
}

export function SheetsImportDialog({ open, onOpenChange, startStep, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; startStep: SheetsStep; onDone?: (mapping: Partial<Record<FieldKey, string>>) => void }) {
  const [step, setStep] = useState<SheetsStep>(startStep);
  const [mapped, setMapped] = useState<Record<string, string>>({ eid: 'Employee ID', person: 'Full name', start: '', action: '' });
  const index = STEPS.indexOf(step);
  const others = IMPORT_COLUMNS.filter(column => !Object.values(mapped).includes(column.header));
  const close = () => { onOpenChange(false); setStep('pick'); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="launch-design" size="lg" title={step === 'pick' ? 'Import a spreadsheet' : 'Check the columns'} description={`Step ${index + 1} of ${STEPS.length}`}>
    <DialogBody>
      {step === 'pick' ? <FilePickRow title="Spreadsheet" hint="Excel or CSV file" onFile={() => setStep('columns')} /> : <div className="grid gap-4">
        <div className="flex items-center gap-2 rounded-[7px] border border-ui-stroke bg-ui-table px-3 py-2 text-body"><FileSpreadsheet size={16} aria-hidden /><span className="min-w-0 flex-1 truncate">{IMPORT_FILE.name}</span><span className="text-caption text-ui-muted">{IMPORT_FILE.rows} rows, {IMPORT_FILE.sheet}</span></div>
        <p className="text-body text-ui-muted">We matched what we could from the headers. Choose the rest.</p>
        <ColumnMapping needs={NEEDS} headers={IMPORT_COLUMNS.map(column => column.header)} samples={header => IMPORT_COLUMNS.find(column => column.header === header)?.sample ?? ''} values={mapped} onChange={(key, header) => setMapped(current => ({ ...current, [key]: header }))} />
        <Disclosure summary={`Other columns (${others.length})`} summaryClassName="text-body"><ul className="grid gap-1 pl-5 text-body">{others.map(column => <li key={column.header} className="flex justify-between gap-3"><span>{column.header}</span><span className="text-caption text-ui-muted">{column.sample}</span></li>)}</ul></Disclosure>
      </div>}
    </DialogBody>
    <DialogFooter>
      <Button variant="muted" onClick={close}>Cancel</Button>
      {step === 'columns' && <><Button variant="ghost" onClick={() => setStep('pick')}>Back</Button><Button variant="primary" disabled={!mapped.eid || !mapped.person} onClick={() => { onDone?.(mapped); close(); }}>Import spreadsheet</Button></>}
    </DialogFooter>
  </DialogContent></Dialog>;
}
