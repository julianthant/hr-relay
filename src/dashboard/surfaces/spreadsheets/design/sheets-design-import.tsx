import { useState } from 'react';
import { Check, FileSpreadsheet } from 'lucide-react';
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogFooter, Disclosure, Dropzone, Field, Select } from '../../../ds/ui.js';
import { IMPORT_COLUMNS, IMPORT_FILE, type Reference } from './sheets-design-fixtures.js';
import type { SheetsStep } from './sheets-design-mode.js';

const STEPS: readonly SheetsStep[] = ['pick', 'purpose', 'columns'];
const OTHER = 'other';

function Matched({ label, value }: { label: string; value: string }) {
  return <Field label={label} description={`Matched from the column headers. Samples: ${IMPORT_COLUMNS.find(column => column.header === value)?.sample ?? ''}`}><div className="flex items-center gap-2"><Select aria-label={label} className="h-9 min-w-0 flex-1" defaultValue={value}>{IMPORT_COLUMNS.map(column => <option key={column.header}>{column.header}</option>)}</Select><Badge tone="info"><Check size={12} aria-hidden /> Matched</Badge></div></Field>;
}

export function SheetsImportDialog({ open, onOpenChange, references, startStep, preset, onDone }: { open: boolean; onOpenChange: (open: boolean) => void; references: readonly Reference[]; startStep: SheetsStep; preset?: string; onDone?: (purpose: string) => void }) {
  const [step, setStep] = useState<SheetsStep>(startStep);
  const [purpose, setPurpose] = useState(preset ?? references.find(item => !item.file)?.id ?? OTHER);
  const reference = references.find(item => item.id === purpose);
  const isReference = reference !== undefined;
  const index = STEPS.indexOf(step);
  const title = step === 'pick' ? 'Import a spreadsheet' : step === 'purpose' ? 'What is this for?' : 'Check the columns';
  const next = () => setStep(STEPS[index + 1]);
  const finish = () => { onDone?.(purpose); onOpenChange(false); setStep('pick'); };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent size="lg" title={title} description={`Step ${index + 1} of ${STEPS.length}`}>
    <DialogBody>
      {step !== 'pick' && <div className="mb-4 flex items-center gap-2 rounded-[7px] border border-ui-stroke bg-ui-table px-3 py-2 text-body"><FileSpreadsheet size={16} aria-hidden /><span className="min-w-0 flex-1 truncate">{IMPORT_FILE.name}</span><span className="text-caption text-ui-muted">{IMPORT_FILE.rows} rows · {IMPORT_FILE.sheet}</span></div>}
      {step === 'pick' && <Dropzone label="Choose a spreadsheet" accept=".xlsx,.csv" hint="Excel or CSV file" onFile={next} />}
      {step === 'purpose' && <fieldset className="grid gap-2"><legend className="sr-only">What is this spreadsheet for?</legend>{[
        ...references.map(item => ({ id: item.id, title: item.title, note: `${item.note}${item.file ? ' It replaces the current file.' : ' None imported yet.'}` })),
        { id: OTHER, title: 'Other', note: 'Keep it in your library. No workflow uses it.' },
      ].map(option => <label key={option.id} className={`flex cursor-pointer items-start gap-3 rounded-[7px] border px-3 py-2.5 text-left ${purpose === option.id ? 'border-ui-primary bg-ui-table' : 'border-ui-stroke'}`}><input type="radio" name="sheet-purpose" className="mt-1" checked={purpose === option.id} onChange={() => setPurpose(option.id)} /><span className="grid gap-0.5"><span className="text-body font-medium">{option.title}</span><span className="text-caption text-ui-muted">{option.note}</span></span></label>)}</fieldset>}
      {step === 'columns' && <div className="grid gap-4">
        {isReference ? <><p className="text-body text-ui-muted">{reference.workflow} finds people by these columns. We matched them from the headers.</p>
          <Matched label="EID column" value="Employee ID" /><Matched label="Name column" value="Full name" /></> : <p className="text-body text-ui-muted">All columns are kept as they are.</p>}
        <Disclosure summary={`Other columns (${IMPORT_COLUMNS.filter(column => !column.role).length})`}><ul className="grid gap-1 text-body">{IMPORT_COLUMNS.filter(column => !column.role).map(column => <li key={column.header} className="flex justify-between gap-3"><span>{column.header}</span><span className="text-caption text-ui-muted">{column.sample}</span></li>)}</ul></Disclosure>
      </div>}
    </DialogBody>
    <DialogFooter meta={step === 'columns' ? `${IMPORT_FILE.rows} rows will be imported` : undefined}>
      <Button variant="muted" onClick={() => { onOpenChange(false); setStep('pick'); }}>Cancel</Button>
      {index > 0 && <Button onClick={() => setStep(STEPS[index - 1])}>Back</Button>}
      {step === 'columns' ? <Button variant="primary" onClick={finish}>{isReference ? (reference.file ? `Replace ${reference.title}` : `Import ${reference.title}`) : 'Import spreadsheet'}</Button> : step === 'purpose' ? <Button variant="primary" onClick={next}>Next</Button> : null}
    </DialogFooter>
  </DialogContent></Dialog>;
}
