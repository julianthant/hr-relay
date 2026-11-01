import { useDeferredValue, useMemo, useState, type RefObject } from 'react';
import { useViewState } from '../../app/navigation/view-route-model.js';
import { Banner, Button, Checkbox, ChoicePicker, Dialog, DialogBody, DialogContent, DialogFooter, SearchInput, Select } from '../../ds/ui.js';
import { cellText, columnName, type EditableSheet, type EditableWorkbook } from './spreadsheet-editor-model.js';
import { setSpreadsheetColumnField, setSpreadsheetHeaderRow, spreadsheetColumnErrors, spreadsheetColumnValueErrors, spreadsheetColumnValueIssues, spreadsheetHeaderRow } from './spreadsheet-column-import-model.js';
import { SPREADSHEET_FIELDS, spreadsheetField } from './spreadsheet-fields-model.js';
import '../run-start/launch-presentation.css';

const PAGE_SIZE = 20;
export function SpreadsheetColumnImport({ open, document, onOpenChange, onChange, onCancel, onConfirm, returnFocus }: {
  open: boolean; document: EditableWorkbook; onOpenChange: (open: boolean) => void;
  onChange: (next: EditableWorkbook) => void; onCancel: () => void; onConfirm: () => void;
  returnFocus: RefObject<HTMLButtonElement | null>;
}) {
  const [sheetId, setSheetId] = useViewState('spreadsheetImportSheet', document.sheets[0].id);
  const [requestedPage, setPage] = useViewState('spreadsheetImportColumnPage', 0);
  const [query, setQuery] = useState('');
  const search = useDeferredValue(query.trim().toLowerCase());
  const sheet = document.sheets.find(entry => entry.id === sheetId);
  const matches = useMemo(() => sheet ? Array.from({ length: sheet.width }, (_, column) => column).filter(column => `${columnName(column)} ${cellText(sheet.rows[spreadsheetHeaderRow(sheet) - 1].cells[column])} ${sheet.columnBindings?.[column].fieldId ? spreadsheetField(sheet.columnBindings[column].fieldId).label : ''}`.toLowerCase().includes(search)) : [], [sheet, search]);
  const page = Math.min(requestedPage, Math.max(0, Math.ceil(matches.length / PAGE_SIZE) - 1));
  const visible = matches.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const errors = useMemo(() => spreadsheetColumnErrors(document), [document]);
  const issues = useMemo(() => spreadsheetColumnValueIssues(document), [document]);
  const selected = document.sheets.reduce((total, entry) => total + entry.width - entry.hidden.length, 0);
  const keptSheets = document.sheets.filter(entry => entry.width > entry.hidden.length).length;
  const updateSheet = (next: EditableSheet) => onChange({ ...document, sheets: document.sheets.map(entry => entry.id === next.id ? next : entry) });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent size="xl" title="Choose spreadsheet columns" description="Keep original columns or match them to dashboard fields." className="launch-design spreadsheet-dialog" onCloseAutoFocus={event => { if (returnFocus.current) { event.preventDefault(); returnFocus.current.focus(); } }}>
    <DialogBody className="spreadsheet-main flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-4"><div className="min-w-0"><h3 className="truncate text-body font-semibold" title={document.name}>{document.name}</h3><p className="mt-1 text-caption text-ui-muted">Unselected columns are removed from the imported copy.</p></div><ChoicePicker label="Sheet to import" hideLabel className="w-[190px] shrink-0" value={sheetId} options={document.sheets.map(entry => ({ value: entry.id, label: entry.name }))} onChange={id => { setSheetId(id); setPage(0); setQuery(''); }} /></div>
      {!sheet ? <Banner tone="danger" title="Sheet unavailable">Choose a sheet from this file.</Banner> : <>
        <div className="flex shrink-0 items-center justify-between gap-3"><Checkbox label="Keep all columns in this sheet" checked={sheet.hidden.length === 0 ? true : sheet.hidden.length === sheet.width ? false : 'indeterminate'} onCheckedChange={checked => updateSheet({ ...sheet, hidden: checked ? [] : Array.from({ length: sheet.width }, (_, column) => column) })} /><div className="flex items-center gap-3"><label className="flex items-center gap-2 text-caption text-ui-muted">Header row<Select aria-label="Header row" value={spreadsheetHeaderRow(sheet)} className="h-9 w-20" onChange={event => { updateSheet(setSpreadsheetHeaderRow(sheet, Number(event.target.value))); setPage(0); }}>{sheet.rows.slice(0, 50).map((row, index) => <option key={row.id} value={index + 1}>{index + 1}</option>)}</Select></label><SearchInput aria-label="Find import column" placeholder="Find a column" className="h-9 w-[230px]" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} onClear={() => { setQuery(''); setPage(0); }} /></div></div>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-[7px] border border-ui-stroke">
          <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 border-b border-ui-stroke bg-ui-table px-4 py-2 text-caption text-ui-muted"><span>Source column · sample</span><span>Dashboard field</span></div>
          {visible.map(column => { const kept = !sheet.hidden.includes(column); const letter = columnName(column); const header = spreadsheetHeaderRow(sheet); const binding = sheet.columnBindings?.[column]; const field = binding?.fieldId ? spreadsheetField(binding.fieldId) : undefined; const invalid = spreadsheetColumnValueErrors(sheet, column); const sample = sheet.rows.slice(header, header + 3).map(row => cellText(row.cells[column])).filter(Boolean).join(' · '); return <div key={column} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-5 border-b border-ui-stroke px-4 py-3 last:border-0">
            <div className="min-w-0"><Checkbox label={<span>{letter} · {cellText(sheet.rows[header - 1].cells[column]) || 'Untitled column'}</span>} checked={kept} onCheckedChange={checked => updateSheet({ ...sheet, hidden: checked ? sheet.hidden.filter(index => index !== column) : [...sheet.hidden, column] })} /><p className="mt-1 truncate pl-7 text-caption text-ui-muted" title={sample}>{sample || 'No sample value'}</p></div>
            <div className="min-w-0"><Select aria-label={`Dashboard field for ${letter}`} value={binding?.fieldId ?? ''} disabled={!kept} onChange={event => updateSheet(setSpreadsheetColumnField(sheet, column, event.target.value || null))} className="h-9 w-full"><option value="">Keep original values</option>{SPREADSHEET_FIELDS.map(option => <option key={option.id} value={option.id}>{option.label}</option>)}</Select>{kept && <p className={`mt-1 text-caption ${invalid ? 'text-ui-danger' : 'text-ui-muted'}`}>{invalid ? `${invalid} ${invalid === 1 ? 'value does' : 'values do'} not match · ${field?.format}` : field ? field.id.startsWith('roster.') ? 'Original tracker values kept.' : `${field.type} · ${field.format}` : 'Original values kept.'}</p>}</div>
          </div>; })}
          {!matches.length && <p className="p-5 text-caption text-ui-muted">No matching columns.</p>}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 text-caption text-ui-muted"><span>{sheet.width - sheet.hidden.length} of {sheet.width} columns selected · {Math.max(0, sheet.rows.length - spreadsheetHeaderRow(sheet)).toLocaleString()} rows</span><div className="flex items-center gap-2"><Button variant="ghost" size="sm" disabled={!page} onClick={() => setPage(page - 1)} aria-label="Previous import columns">Previous</Button><span>{matches.length ? page * PAGE_SIZE + 1 : 0}–{Math.min(matches.length, (page + 1) * PAGE_SIZE)} of {matches.length}</span><Button variant="ghost" size="sm" disabled={(page + 1) * PAGE_SIZE >= matches.length} onClick={() => setPage(page + 1)} aria-label="Next import columns">Next</Button></div></div>
      </>}
      {issues.length > 0 && <p role="status" className="shrink-0 text-caption text-ui-danger">{issues[0]}{issues.length > 1 ? ` ${issues.length - 1} more to review.` : ''} Values will be kept. Correct execution fields before running a workflow.</p>}
      {errors.length > 0 && <p role="status" className="shrink-0 text-caption text-ui-danger">{errors[0]}{errors.length > 1 ? ` ${errors.length - 1} more to review.` : ''}</p>}
    </DialogBody><DialogFooter meta={`${selected} ${selected === 1 ? "column" : "columns"} selected across ${keptSheets} ${keptSheets === 1 ? "sheet" : "sheets"}`}><Button variant="muted" onClick={onCancel}>Cancel import</Button><Button variant="primary" disabled={errors.length > 0} onClick={onConfirm}>Import selected columns</Button></DialogFooter>
  </DialogContent></Dialog>;
}
