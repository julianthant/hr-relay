import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, FileSpreadsheet, FolderOpen, Plus, X } from 'lucide-react';
import { Banner, Button, Dialog, DialogBody, DialogContent, DialogFooter, IconButton, Input, PageHeading, SearchInput, Select } from '../ds/ui.js';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ds/dropdown-menu.js';
import { cellText, columnName, downloadSpreadsheet, editSpreadsheetCell, importSpreadsheet, newEditableWorkbook, sortSpreadsheet, spreadsheetCsv, spreadsheetForeground, spreadsheetXlsx, type EditableSheet, type EditableWorkbook } from './spreadsheet-editor-model.js';
import './spreadsheet-editor.css';

export function SpreadsheetEditor({ document, dirty, onDocument }: { document: EditableWorkbook | null; dirty: boolean; onDocument: (next: EditableWorkbook | null, dirty: boolean) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [sheetId, setSheetId] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [columnOpen, setColumnOpen] = useState(false);
  const [columnTitle, setColumnTitle] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [sort, setSort] = useState<{ column: number; direction: 'asc' | 'desc' } | null>(null);
  const [focused, setFocused] = useState('');
  const sheet = document?.sheets.find(item => item.id === sheetId) ?? document?.sheets[0];
  const applySheet = (next: EditableSheet, changed = true) => {
    if (!document) throw new Error('SPREADSHEET_DOCUMENT_UNAVAILABLE');
    onDocument({ ...document, sheets: document.sheets.map(item => item.id === next.id ? next : item) }, dirty || changed);
  };
  const open = async (file: File) => {
    setBusy(true); setError('');
    try { const next = await importSpreadsheet(file.name, await file.arrayBuffer()); onDocument(next, false); setSheetId(next.sheets[0].id); setQuery(''); setPage(0); setSort(null); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  const exportFile = async (format: 'csv' | 'xlsx') => {
    if (!document || !sheet) throw new Error('SPREADSHEET_DOCUMENT_UNAVAILABLE');
    setBusy(true); setError('');
    try { downloadSpreadsheet(format === 'csv' ? spreadsheetCsv(sheet) : await spreadsheetXlsx(document), document.name, format); onDocument(document, format === 'csv' && document.sheets.length > 1 || document.sheets.some(item => item.hidden.length > 0) ? dirty : false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const columns = sheet ? Array.from({ length: sheet.width }, (_, index) => index).filter(index => !sheet.hidden.includes(index)) : [];
  const rows = sheet?.rows.slice(1).filter(row => !query.trim() || columns.some(column => cellText(row.cells[column]).toLowerCase().includes(query.trim().toLowerCase()))) ?? [];
  const pages = Math.max(1, Math.ceil(rows.length / 50)), currentPage = Math.min(page, pages - 1);
  return <section aria-label="Spreadsheet editor" className="spreadsheet-editor">
    <input ref={input} disabled={busy} type="file" accept=".xlsx,.csv" className="sr-only" aria-label="Open XLSX or CSV" onChange={event => { const file = event.target.files?.[0]; if (file) void open(file); }} />
    <PageHeading title={document?.name ?? 'Spreadsheets'} description={document ? `${document.sheets.length} ${document.sheets.length === 1 ? 'sheet' : 'sheets'} · ${dirty ? 'Edited copy' : 'Local copy'}` : 'View, edit and export XLSX or CSV files.'} actions={document ? <IconButton label="Close spreadsheet" icon={<X className="size-4" />} onClick={() => dirty ? setCloseOpen(true) : onDocument(null, false)} /> : <Button size="sm" disabled={busy} icon={<FolderOpen className="size-4" />} onClick={() => input.current?.click()}>{busy ? 'Opening…' : 'Open file'}</Button>} />
    {error && <Banner tone="danger" title="Spreadsheet unavailable">{error}</Banner>}
    {!document ? <div className="spreadsheet-drop-zone" onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file && !busy) void open(file); }}><FileSpreadsheet aria-hidden className="size-7 text-ui-info" /><p>Drop an XLSX or CSV file here</p><span>Your original file stays unchanged.</span><Button size="sm" variant="ghost" disabled={busy} icon={<Plus className="size-3.5" />} onClick={() => { const next = newEditableWorkbook(); onDocument(next, true); setSheetId(next.sheets[0].id); }}>New spreadsheet</Button></div> : sheet && <>
      <div className="spreadsheet-editor-toolbar"><Select disabled={busy} aria-label="Workbook sheet" value={sheet.id} onChange={event => { setSheetId(event.target.value); setPage(0); setSort(null); setQuery(''); }}>{document.sheets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
        <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="ghost" icon={<Columns3 className="size-3.5" />}>Columns <span className="text-ui-muted">{columns.length}/{sheet.width}</span></Button></DropdownMenuTrigger><DropdownMenuContent aria-label="Visible columns" className="w-60">{Array.from({ length: sheet.width }, (_, column) => <DropdownMenuCheckboxItem key={column} closeOnClick={false} checked={!sheet.hidden.includes(column)} disabled={busy || columns.length === 1 && !sheet.hidden.includes(column)} onCheckedChange={checked => applySheet({ ...sheet, hidden: checked ? sheet.hidden.filter(index => index !== column) : [...sheet.hidden, column] })}>{columnName(column)} · {cellText(sheet.rows[0].cells[column]) || 'Untitled'}</DropdownMenuCheckboxItem>)}</DropdownMenuContent></DropdownMenu>
        <IconButton label="Add column" disabled={busy || (sheet.width + 1) * sheet.rows.length > 100000} icon={<Plus className="size-3.5" />} onClick={() => { setColumnTitle(''); setColumnOpen(true); }} />
        <DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" variant="ghost" disabled={busy} icon={<Download className="size-3.5" />}>Export copy</Button></DropdownMenuTrigger><DropdownMenuContent aria-label="Export spreadsheet" align="end" className="w-52"><DropdownMenuItem onSelect={() => void exportFile('xlsx')}>Excel workbook (.xlsx)</DropdownMenuItem><DropdownMenuItem onSelect={() => void exportFile('csv')}>Current sheet (.csv)</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </div>
      <SearchInput aria-label="Search spreadsheet cells" placeholder="Search this sheet" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} onClear={() => setQuery('')} />
      <div className="spreadsheet-grid-scroll"><table aria-label={`${sheet.name} cells`} className="spreadsheet-grid"><thead><tr><th className="spreadsheet-row-number" aria-label="Row" /><th colSpan={columns.length} className="spreadsheet-column-band">Click a column letter to sort. Edit values directly.</th></tr><tr><th className="spreadsheet-row-number">1</th>{columns.map(column => <th key={column} style={{ background: sheet.rows[0].cells[column]?.background, color: spreadsheetForeground(sheet.rows[0].cells[column]?.background) }}><button disabled={busy} type="button" aria-label={`Sort column ${columnName(column)}`} onClick={() => { const direction = sort?.column === column && sort.direction === 'asc' ? 'desc' : 'asc'; applySheet(sortSpreadsheet(sheet, column, direction)); setSort({ column, direction }); setPage(0); }} className="spreadsheet-column-sort">{columnName(column)}{sort?.column === column && (sort.direction === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</button><Input disabled={busy} className="spreadsheet-cell-input" aria-label={`${columnName(column)}1`} value={cellText(sheet.rows[0].cells[column])} onFocus={() => setFocused(`${columnName(column)}1`)} onChange={event => applySheet(editSpreadsheetCell(sheet, sheet.rows[0].id, column, event.target.value))} /></th>)}</tr></thead><tbody>{rows.slice(currentPage * 50, currentPage * 50 + 50).map(row => <tr key={row.id}><th scope="row" className="spreadsheet-row-number">{sheet.rows.indexOf(row) + 1}</th>{columns.map(column => {
        const cell = row.cells[column], position = `${columnName(column)}${sheet.rows.indexOf(row) + 1}`;
        return <td key={column} style={{ background: cell.background, color: spreadsheetForeground(cell.background) }} data-fill={cell.background ? 'imported' : undefined}><Input disabled={busy} className="spreadsheet-cell-input" aria-label={position} value={cellText(cell)} onFocus={() => setFocused(position)} onChange={event => applySheet(editSpreadsheetCell(sheet, row.id, column, event.target.value))} /></td>;
      })}</tr>)}</tbody></table>{rows.length === 0 && <p className="p-5 text-center text-ui-muted">{query ? 'No cells match your search.' : 'No data rows yet.'}</p>}</div>
      <footer className="spreadsheet-editor-footer"><Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} disabled={busy || (sheet.rows.length + 1) * sheet.width > 100000} onClick={() => { applySheet({ ...sheet, rows: [...sheet.rows, { id: crypto.randomUUID(), cells: Array.from({ length: sheet.width }, () => ({ value: '' })) }] }); setQuery(''); setPage(Math.floor((sheet.rows.length - 1) / 50)); }}>Add row</Button><span>{focused || `${rows.length} rows`}</span><div className="ml-auto flex items-center gap-2"><IconButton label="Previous spreadsheet page" disabled={currentPage === 0} icon={<ChevronLeft className="size-3.5" />} onClick={() => setPage(currentPage - 1)} /><span>{currentPage + 1}/{pages}</span><IconButton label="Next spreadsheet page" disabled={currentPage >= pages - 1} icon={<ChevronRight className="size-3.5" />} onClick={() => setPage(currentPage + 1)} /></div></footer>
      <p className="text-caption text-ui-muted">Exports include all rows and visible columns. XLSX includes every sheet and preserves cell fills; CSV contains values from this sheet.{document.hasFormulas && ' Formula cells use their saved values; formulas are not recalculated.'}</p>
    </>}
    <Dialog open={columnOpen} onOpenChange={setColumnOpen}><DialogContent title="Add column" size="sm"><DialogBody><Input autoFocus aria-label="Column title" placeholder="Column title" value={columnTitle} onChange={event => setColumnTitle(event.target.value)} /></DialogBody><DialogFooter><Button variant="secondary" onClick={() => setColumnOpen(false)}>Cancel</Button><Button disabled={!columnTitle.trim()} onClick={() => { if (!sheet) throw new Error('SPREADSHEET_SHEET_UNAVAILABLE'); applySheet({ ...sheet, width: sheet.width + 1, rows: sheet.rows.map((row, index) => ({ ...row, cells: [...row.cells, { value: index === 0 ? columnTitle.trim() : '' }] })) }); setColumnOpen(false); }}>Add column</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={closeOpen} onOpenChange={setCloseOpen}><DialogContent title="Close edited spreadsheet?" description="Export a copy to keep your changes before closing." size="sm"><DialogFooter><Button variant="secondary" onClick={() => setCloseOpen(false)}>Keep editing</Button><Button variant="danger" onClick={() => { onDocument(null, false); setCloseOpen(false); }}>Discard copy</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
