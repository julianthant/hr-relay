import { useViewState } from "../../app/navigation/view-route-model.js";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "../../ds/primitives/breadcrumb.js";
import { useDeferredValue, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Columns3, Download, Plus, Undo2, Redo2 } from 'lucide-react';
import { Banner, Button, Dialog, DialogBody, DialogContent, DialogFooter, IconButton, Input, PageHeading, SearchInput, Select } from '../../ds/ui.js';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../../ds/primitives/dropdown-menu.js';
import { cellText, columnName, downloadSpreadsheet, editSpreadsheetCell, sortSpreadsheet, spreadsheetForeground, type EditableSheet, type EditableWorkbook } from './spreadsheet-editor-model.js';
import { exportSheetInWorker, exportSpreadsheetInWorker } from "./spreadsheet-import-client.js";
import { EMPTY_WORKBOOK_HISTORY, recordWorkbookEdit, stepWorkbookHistory, type WorkbookHistory } from './spreadsheet-history-model.js';
import './spreadsheet-editor.css';

export function SpreadsheetEditor({ document, dirty, onDocument, onMapping }: { document: EditableWorkbook; dirty: boolean; onMapping?: () => void; onDocument: (next: EditableWorkbook | null, dirty: boolean) => void }) {
  const [sheetId, setSheetId] = useViewState('spreadsheetSheet', '');
  const [query, setQuery] = useViewState('spreadsheetRowsQuery', '', 'replace');
  const [page, setPage] = useViewState('spreadsheetPage', 0);
  const [columnPage, setColumnPage] = useViewState('spreadsheetColumnPage', 0);
  const [columnQuery, setColumnQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [columnOpen, setColumnOpen] = useState(false);
  const [columnTitle, setColumnTitle] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [sort, setSort] = useState<{ column: number; direction: 'asc' | 'desc' } | null>(null);
  const [focused, setFocused] = useState('');
  const [history, setHistory] = useState<WorkbookHistory>(EMPTY_WORKBOOK_HISTORY);
  const editGroup = useRef<string | undefined>(undefined);
  const savedCopy = useRef<EditableWorkbook | undefined>(dirty ? undefined : document);
  const deferredQuery = useDeferredValue(query);
  const sheet = sheetId ? document.sheets.find(item => item.id === sheetId) : document.sheets[0];
  const applySheet = (next: EditableSheet, changed = true) => {
    if (!document) throw new Error('SPREADSHEET_DOCUMENT_UNAVAILABLE');
    const updated = { ...document, sheets: document.sheets.map(item => item.id === next.id ? next : item) };
    if (changed) setHistory(current => recordWorkbookEdit(current, document, updated, editGroup.current));
    onDocument(updated, updated !== savedCopy.current);
  };
  const stepHistory = (direction: 'undo' | 'redo') => {
    const next = stepWorkbookHistory(history, document, direction);
    setHistory(next.history); editGroup.current = undefined; setSort(null);
    onDocument(next.document, next.document !== savedCopy.current);
  };
  const exportFile = async (format: 'csv' | 'xlsx') => {
    if (!document || !sheet) throw new Error('SPREADSHEET_DOCUMENT_UNAVAILABLE');
    setBusy(true); setError('');
    try { downloadSpreadsheet(format === 'csv' ? await exportSheetInWorker(sheet) : await exportSpreadsheetInWorker(document), document.name, format); const partial = format === 'csv' && document.sheets.length > 1 || document.sheets.some(item => item.hidden.length > 0); if (!partial) savedCopy.current = document; onDocument(document, partial ? dirty : false); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setBusy(false); }
  };
  const width = sheet?.width ?? 0, hidden = sheet?.hidden;
  const columns = useMemo(() => Array.from({ length: width }, (_, index) => index).filter(index => !hidden?.includes(index)), [width, hidden]);
  const indexedRows = useMemo(() => sheet?.rows.slice(1).map((row, index) => ({ row, number: index + 2 })) ?? [], [sheet?.rows]);
  const rows = useMemo(() => {
    const needle = deferredQuery.trim().toLocaleLowerCase();
    return needle ? indexedRows.filter(({ row }) => columns.some(column => cellText(row.cells[column]).toLocaleLowerCase().includes(needle))) : indexedRows;
  }, [indexedRows, columns, deferredQuery]);
  const columnPages = Math.max(1, Math.ceil(columns.length / 20));
  const currentColumnPage = Math.min(columnPage, columnPages - 1);
  const visibleColumns = columns.slice(currentColumnPage * 20, currentColumnPage * 20 + 20);
  const headers = sheet?.rows[0].cells;
  const columnMatches = useMemo(() => {
    if (!headers) return [];
    const needle = columnQuery.trim().toLocaleLowerCase();
    return Array.from({ length: width }, (_, column) => column).filter(column => `${columnName(column)} ${cellText(headers[column])}`.toLocaleLowerCase().includes(needle));
  }, [width, headers, columnQuery]);
  const pages = Math.max(1, Math.ceil(rows.length / 50)), currentPage = Math.min(page, pages - 1);
  return <section aria-label="Spreadsheet editor" className="spreadsheet-editor" onKeyDown={event => {
    const target = event.target as HTMLElement;
    if (!(event.metaKey || event.ctrlKey) || event.altKey || busy || target.closest('[role="dialog"]')) return;
    if (target.matches('input, textarea, [contenteditable="true"]') && !target.classList.contains('spreadsheet-cell-input')) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    event.preventDefault(); stepHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo');
  }} onBlur={event => { if (event.target.classList.contains('spreadsheet-cell-input')) { editGroup.current = undefined; setHistory(current => ({ ...current, group: undefined })); } }}>
    <Breadcrumb><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><button type="button" onClick={() => dirty ? setCloseOpen(true) : onDocument(null, false)}>Spreadsheets</button></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage className="truncate">{document.name}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
    <PageHeading title={document.name} description={`${document.sheets.length} ${document.sheets.length === 1 ? 'sheet' : 'sheets'} · ${dirty ? 'Edited copy' : 'Saved copy'}`} actions={onMapping && <Button variant="secondary" onClick={onMapping}>Edit column mappings</Button>} />
    {!sheet && <Banner tone="danger" title="Sheet unavailable"><p>This sheet is no longer in the workbook.</p><Button onClick={() => { setSheetId(''); setPage(0); }}>Open first sheet</Button></Banner>}
    {error && <Banner tone="danger" title="Spreadsheet unavailable">{error}</Banner>}
    {sheet && <>
      <div className="spreadsheet-editor-toolbar"><Select disabled={busy} aria-label="Workbook sheet" value={sheet.id} onChange={event => { setSheetId(event.target.value); setPage(0); setSort(null); setQuery(''); setColumnPage(0); }}>{document.sheets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select>
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="secondary" icon={<Columns3 className="size-3.5" />}>Columns <span className="text-ui-muted">{columns.length}/{sheet.width}</span></Button></DropdownMenuTrigger><DropdownMenuContent aria-label="Visible columns" className="w-60"><SearchInput aria-label="Find a column" placeholder="Find a column" value={columnQuery} onChange={event => setColumnQuery(event.target.value)} onClear={() => setColumnQuery('')} onKeyDown={event => event.stopPropagation()} />{columnMatches.slice(0, 100).map(column => <DropdownMenuCheckboxItem key={column} closeOnClick={false} checked={!sheet.hidden.includes(column)} disabled={busy || columns.length === 1 && !sheet.hidden.includes(column)} onCheckedChange={checked => applySheet({ ...sheet, hidden: checked ? sheet.hidden.filter(index => index !== column) : [...sheet.hidden, column] })}>{columnName(column)} · {cellText(sheet.rows[0].cells[column]) || 'Untitled'}</DropdownMenuCheckboxItem>)}{columnMatches.length > 100 && <p className="px-2 text-caption text-ui-muted">Showing 100 of {columnMatches.length} columns. Narrow your search.</p>}</DropdownMenuContent></DropdownMenu>
        <IconButton variant="outline" label="Add column" disabled={busy || (sheet.width + 1) * sheet.rows.length > 100000} icon={<Plus className="size-3.5" />} onClick={() => { setColumnTitle(''); setColumnOpen(true); }} />
        <IconButton variant="outline" label="Undo spreadsheet edit" disabled={busy || !history.undo.length} icon={<Undo2 className="size-3.5" />} onClick={() => stepHistory('undo')} />
        <IconButton variant="outline" label="Redo spreadsheet edit" disabled={busy || !history.redo.length} icon={<Redo2 className="size-3.5" />} onClick={() => stepHistory('redo')} />
        <DropdownMenu><DropdownMenuTrigger asChild><Button variant="secondary" disabled={busy} icon={<Download className="size-3.5" />}>Export copy</Button></DropdownMenuTrigger><DropdownMenuContent aria-label="Export spreadsheet" align="end" className="w-52"><DropdownMenuItem onSelect={() => void exportFile('xlsx')}>Excel workbook (.xlsx)</DropdownMenuItem><DropdownMenuItem onSelect={() => void exportFile('csv')}>Current sheet (.csv)</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
      </div>
      <SearchInput aria-label="Search spreadsheet cells" placeholder="Search this sheet" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} onClear={() => setQuery('')} />
      <div className="spreadsheet-grid-scroll" aria-busy={query !== deferredQuery}><table aria-label={`${sheet.name} cells`} className="spreadsheet-grid"><thead><tr><th className="spreadsheet-row-number">1</th>{visibleColumns.map(column => <th key={column} style={{ background: sheet.rows[0].cells[column]?.background, color: spreadsheetForeground(sheet.rows[0].cells[column]?.background) }}><button disabled={busy} type="button" aria-label={`Sort column ${columnName(column)}`} onClick={() => { const direction = sort?.column === column && sort.direction === 'asc' ? 'desc' : 'asc'; applySheet(sortSpreadsheet(sheet, column, direction)); setSort({ column, direction }); setPage(0); }} className="spreadsheet-column-sort">{columnName(column)}{sort?.column === column && (sort.direction === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}</button><Input disabled={busy} className="spreadsheet-cell-input" aria-label={`${columnName(column)}1`} value={cellText(sheet.rows[0].cells[column])} onFocus={() => { setFocused(`${columnName(column)}1`); editGroup.current = crypto.randomUUID(); }} onChange={event => applySheet(editSpreadsheetCell(sheet, sheet.rows[0].id, column, event.target.value))} /></th>)}</tr></thead><tbody>{rows.slice(currentPage * 50, currentPage * 50 + 50).map(({ row, number }) => <tr key={row.id}><th scope="row" className="spreadsheet-row-number">{number}</th>{visibleColumns.map(column => {
        const cell = row.cells[column], position = `${columnName(column)}${number}`;
        return <td key={column} style={{ background: cell.background, color: spreadsheetForeground(cell.background) }} data-fill={cell.background ? 'imported' : undefined}><Input disabled={busy} className="spreadsheet-cell-input" aria-label={position} value={cellText(cell)} onFocus={() => { setFocused(position); editGroup.current = crypto.randomUUID(); }} onChange={event => applySheet(editSpreadsheetCell(sheet, row.id, column, event.target.value))} /></td>;
      })}</tr>)}</tbody></table>{rows.length === 0 && <p className="p-5 text-center text-ui-muted">{query ? 'No cells match your search.' : 'No data rows yet.'}</p>}</div>
      {columnPages > 1 && <div className="flex items-center justify-end gap-2 text-caption text-ui-muted" aria-label="Spreadsheet column pages"><span>Columns {columnName(visibleColumns[0])}–{columnName(visibleColumns.at(-1)!)} · {columns.length} visible</span><IconButton variant="outline" label="Previous spreadsheet columns" disabled={busy || currentColumnPage === 0} icon={<ChevronLeft className="size-3.5" />} onClick={() => setColumnPage(currentColumnPage - 1)} /><IconButton variant="outline" label="Next spreadsheet columns" disabled={busy || currentColumnPage >= columnPages - 1} icon={<ChevronRight className="size-3.5" />} onClick={() => setColumnPage(currentColumnPage + 1)} /></div>}
      <footer className="spreadsheet-editor-footer"><Button variant="secondary" icon={<Plus className="size-3.5" />} disabled={busy || (sheet.rows.length + 1) * sheet.width > 100000} onClick={() => { applySheet({ ...sheet, rows: [...sheet.rows, { id: crypto.randomUUID(), cells: Array.from({ length: sheet.width }, () => ({ value: '' })) }] }); setQuery(''); setPage(Math.floor((sheet.rows.length - 1) / 50)); }}>Add row</Button><span>{focused || `${rows.length} rows`}</span><div className="ml-auto flex items-center gap-2"><IconButton variant="outline" label="Previous spreadsheet page" disabled={currentPage === 0} icon={<ChevronLeft className="size-3.5" />} onClick={() => setPage(currentPage - 1)} /><span>{currentPage + 1}/{pages}</span><IconButton variant="outline" label="Next spreadsheet page" disabled={currentPage >= pages - 1} icon={<ChevronRight className="size-3.5" />} onClick={() => setPage(currentPage + 1)} /></div></footer>
    </>}
    <Dialog open={columnOpen} onOpenChange={setColumnOpen}><DialogContent title="Add column" size="sm"><DialogBody><Input autoFocus aria-label="Column title" placeholder="Column title" value={columnTitle} onChange={event => setColumnTitle(event.target.value)} /></DialogBody><DialogFooter><Button variant="secondary" onClick={() => setColumnOpen(false)}>Cancel</Button><Button disabled={!columnTitle.trim()} onClick={() => { if (!sheet) throw new Error('SPREADSHEET_SHEET_UNAVAILABLE'); applySheet({ ...sheet, width: sheet.width + 1, rows: sheet.rows.map((row, index) => ({ ...row, cells: [...row.cells, { value: index === 0 ? columnTitle.trim() : '' }] })) }); setColumnOpen(false); }}>Add column</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={closeOpen} onOpenChange={setCloseOpen}><DialogContent title="Close edited spreadsheet?" description="Export a copy to keep your changes before closing." size="sm"><DialogFooter><Button variant="secondary" onClick={() => setCloseOpen(false)}>Keep editing</Button><Button variant="danger" onClick={() => { onDocument(null, false); setCloseOpen(false); }}>Discard copy</Button></DialogFooter></DialogContent></Dialog>
  </section>;
}
