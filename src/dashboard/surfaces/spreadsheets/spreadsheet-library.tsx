import type { Ref } from 'react';
import { Button, Input, Skeleton } from '../../ds/ui.js';
import type { RegisteredSpreadsheet, SpreadsheetType } from './spreadsheet-mock-model.js';
import { spreadsheetRowCount, spreadsheetTypeName, type KronosReportDatesPort } from './spreadsheet-library-model.js';
import './spreadsheet-library.css';

export function SpreadsheetLibrary({ files, types, busy, loading, failed, pendingImport, importTrigger, onImport, onCreateType, onEditType, onOpen, onDownload, onFileButton, reportDates }: {
  files: readonly RegisteredSpreadsheet[]; types: readonly SpreadsheetType[]; busy: boolean; loading: boolean; failed: boolean; pendingImport: boolean;
  importTrigger?: Ref<HTMLButtonElement>; onImport: () => void; onCreateType: (button: HTMLButtonElement) => void;
  onEditType: (type: SpreadsheetType, button: HTMLButtonElement) => void; onOpen: (file: RegisteredSpreadsheet) => void;
  onDownload?: (file: RegisteredSpreadsheet) => void; onFileButton?: (fileId: string, button: HTMLButtonElement | null) => void; reportDates?: KronosReportDatesPort;
}) {
  return <div className="hub-sheets-library">
    <h1>Spreadsheets</h1><p className="hub-sheets-intro">Choose, import, and organize your spreadsheet data.</p>
    <div className="hub-sheets-toolbar"><div><Button ref={importTrigger} className="hub-sheets-button hub-sheets-primary" disabled={busy} onClick={onImport}>{busy ? 'Importing…' : pendingImport ? 'Review import' : 'Import spreadsheet'}</Button></div><Button className="hub-sheets-button" onClick={event => onCreateType(event.currentTarget)}>Create type</Button></div>
    <div className="hub-sheets-table"><table aria-label="Registered spreadsheets"><thead><tr><th scope="col">Spreadsheet</th><th scope="col">Type</th><th scope="col">Rows</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {loading && !files.length ? [0, 1].map(row => <tr key={row}><td colSpan={4}><Skeleton className="h-8 w-full" /></td></tr>) : files.map(file => <tr key={file.id}><td>{file.name}{file.status && <small className="hub-sheets-caption">{file.status}</small>}</td><td>{spreadsheetTypeName(file, types)}</td><td>{spreadsheetRowCount(file)}</td><td><Button ref={button => onFileButton?.(file.id, button)} className="hub-sheets-button" disabled={busy || pendingImport || failed} aria-label={file.name} onClick={() => onOpen(file)}>Open</Button>{file.status && onDownload && <Button className="hub-sheets-button" disabled={busy || failed} aria-label={`Download ${file.name}`} onClick={() => onDownload(file)}>Download</Button>}</td></tr>)}
    </tbody></table>{!loading && !failed && !files.length && <p className="hub-sheets-empty">No spreadsheets yet. Import a spreadsheet to add it to your library.</p>}</div>
    <section className="hub-sheets-section"><h2>Spreadsheet types</h2><div className="hub-sheets-form">{types.map(type => <div key={type.id} className="hub-sheets-row"><div className="hub-sheets-label">{type.name}<span className="hub-sheets-note">Define which columns belong to this type.</span></div><div className="hub-sheets-control"><Button className="hub-sheets-button" aria-label={`Edit ${type.name}`} onClick={event => onEditType(type, event.currentTarget)}>Edit</Button></div></div>)}</div></section>
    <section className="hub-sheets-section"><h2>Kronos reports</h2><div className="hub-sheets-form">{(['start', 'end'] as const).map(field => <div key={field} className="hub-sheets-row"><label className="hub-sheets-label" htmlFor={`hub-sheets-kronos-${field}`}>{field === 'start' ? 'Start date' : 'End date'}<span className="hub-sheets-note">Default {field} date for Kronos reports.</span></label><div className="hub-sheets-control"><Input id={`hub-sheets-kronos-${field}`} className="hub-sheets-field" type="date" name={`kronos-${field}`} aria-label={`Kronos report ${field} date`} disabled={!reportDates || reportDates.disabled} value={reportDates?.[field] ?? ''} onChange={event => reportDates?.onChange(field, event.target.value)} /></div></div>)}</div>{!reportDates && <p role="status" className="hub-sheets-caption">Kronos report dates are unavailable.</p>}</section>
  </div>;
}
