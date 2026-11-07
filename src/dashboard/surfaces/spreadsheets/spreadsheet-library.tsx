import { useState, type Ref } from 'react';
import { Download, History, MoreHorizontal, RefreshCw } from 'lucide-react';
import { Badge, Banner, Notice, Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Field, IconButton, Input, SearchInput, Select, Skeleton, TableList } from '../../ds/ui.js';
import type { WorkbookLibraryAction, WorkbookLibraryEntry } from '../../../models/dashboard/workbook-library.js';
import type { WorkbookType } from '../../../models/dashboard/workbooks.js';
import type { LibraryChangeResult } from '../../state/spreadsheet-wiring-adapter.js';
import { formatInstantDate } from '../../lib/date-format.js';
import './spreadsheet-library.css';

export function SpreadsheetLibrary({ files, types, busy, loading, failed, pendingImport, pending = [], importTrigger, onImport, onCreateType, onEditType, onOpen, onDownload, onVersions, onChange, onCheck, onOpenRun, onFileButton }: {
  files: readonly WorkbookLibraryEntry[]; types: readonly WorkbookType[]; busy: boolean; loading: boolean; failed: boolean; pendingImport: boolean; pending?: readonly string[];
  importTrigger?: Ref<HTMLButtonElement>; onImport: () => void; onCreateType: (button: HTMLButtonElement) => void;
  onEditType: (type: WorkbookType, button: HTMLButtonElement) => void; onOpen: (file: WorkbookLibraryEntry) => void;
  onDownload: (file: WorkbookLibraryEntry) => Promise<void>; onVersions: (file: WorkbookLibraryEntry, button: HTMLElement) => void;
  onChange: (file: WorkbookLibraryEntry, change: WorkbookLibraryAction['change']) => Promise<LibraryChangeResult>;
  onCheck: (file: WorkbookLibraryEntry) => Promise<LibraryChangeResult>; onOpenRun?: (runId: string, partitionDay: string) => void;
  onFileButton?: (fileId: string, button: HTMLButtonElement | null) => void;
}) {
  const [query, setQuery] = useState(''), [typeId, setTypeId] = useState(''), [selection, setSelection] = useState<string[]>([]);
  const [dialog, setDialog] = useState<{ kind: 'rename' | 'type' | 'link' | 'remove' | 'merge'; files: readonly WorkbookLibraryEntry[] }>();
  const [duplicates, setDuplicates] = useState<'keep-newer' | 'keep-both'>('keep-both');
  const [value, setValue] = useState(''), [working, setWorking] = useState(false), [error, setError] = useState('');
  const selected = files.filter(file => selection.includes(file.libraryId));
  const local = files.filter(file => file.state.origin.kind !== 'workflow');
  const visible = local.filter(file => (!typeId || file.type.id === typeId) && `${file.name} ${file.worksheets.map(sheet => sheet.name).join(' ')}`.toLowerCase().includes(query.toLowerCase().trim()));
  const outputs = files.filter(file => file.state.origin.kind === 'workflow');
  const disabled = busy || loading || failed || pendingImport || working;
  const perform = async (work: () => Promise<LibraryChangeResult | void>): Promise<LibraryChangeResult> => {
    setWorking(true); setError('');
    try { const result = await work(); if (result && result.state !== 'confirmed') setError(result.message); return result ?? { state: 'confirmed' }; }
    catch (error) { const message = error instanceof Error ? error.message : String(error); setError(message); return { state: 'uncertain', message }; }
    finally { setWorking(false); }
  };
  const openDialog = (kind: NonNullable<typeof dialog>['kind'], entries: readonly WorkbookLibraryEntry[]) => { setDialog({ kind, files: entries }); setValue(kind === 'rename' ? entries[0].name : kind === 'type' ? entries[0].metadata.typeId : ''); setError(''); };
  const change = () => perform(async () => {
    if (!dialog) return;
    if (dialog.kind === 'merge') {
      const result = await onChange(dialog.files[0], { kind: 'merge', name: value.trim(), duplicates, sources: dialog.files.slice(1).map(file => ({ libraryId: file.libraryId, expectedVersion: file.version, expectedRevision: file.state.revision })) });
      if (result.state !== 'confirmed') return result;
      setSelection([]); setDialog(undefined); return;
    }
    for (const file of dialog.files) {
      const result = await onChange(file, dialog.kind === 'remove' ? { kind: 'remove' } : dialog.kind === 'rename' ? { kind: 'rename', name: value.trim() } : dialog.kind === 'link' ? { kind: 'link', url: value.trim() } : { kind: 'metadata', metadata: { ...file.metadata, typeId: value } });
      if (result.state !== 'confirmed') return result;
      setSelection(current => current.filter(id => id !== file.libraryId));
    }
    setDialog(undefined);
  });
  return <div className="hub-sheets-library">
    <h1>Spreadsheets</h1><p className="hub-sheets-intro">Reference data and workbooks made by your workflows.</p>
    {error && !dialog && <Notice tone="danger" title="Library action unavailable" description={error} />}
    <section className="hub-sheets-section"><h2>Your spreadsheets</h2>
      <TableList search={selected.length ? <span>{selected.length} selected</span> : <SearchInput aria-label="Search spreadsheets" placeholder="Search spreadsheets…" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} />} controls={selected.length ? <><Button className="hub-sheets-button" disabled={disabled || selected.length < 2 || selected.some(file => pending.includes(file.libraryId))} onClick={() => openDialog('merge', selected)}>Merge</Button><Button className="hub-sheets-button" disabled={disabled || selected.some(file => pending.includes(file.libraryId))} onClick={() => openDialog('remove', selected)}>Remove</Button><Button className="hub-sheets-button" onClick={() => setSelection([])}>Clear</Button></> : <><Select variant="toolbar" aria-label="Spreadsheet type" value={typeId} onChange={event => setTypeId(event.target.value)}><option value="">All types</option>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</Select><Button className="hub-sheets-button" onClick={event => onCreateType(event.currentTarget)}>Create type</Button><Button className="hub-sheets-button hub-sheets-primary" ref={importTrigger} disabled={busy || loading || failed || working} onClick={onImport}>{busy ? 'Importing…' : pendingImport ? 'Review import' : 'Import spreadsheet'}</Button></>}>
        <table aria-label="Your spreadsheets" className="hub-sheets-data"><thead><tr><th scope="col"><Checkbox label={<span className="sr-only">Select all visible spreadsheets</span>} disabled={disabled || !visible.length} checked={visible.length > 0 && visible.every(file => selection.includes(file.libraryId))} onCheckedChange={checked => setSelection(checked ? visible.map(file => file.libraryId) : [])} /></th><th scope="col">Spreadsheet</th><th scope="col">Type</th><th scope="col">Source</th><th scope="col">Rows</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>
        {loading && !files.length ? [0, 1].map(row => <tr key={row}><td colSpan={6}><Skeleton className="h-8 w-full" /></td></tr>) : visible.map(file => {
          const version = file.state.versions.find(version => version.id === file.state.selectedVersionId)!;
          const unavailable = disabled || pending.includes(file.libraryId);
          return <tr key={file.libraryId}><td><Checkbox label={<span className="sr-only">Select {file.name}</span>} disabled={unavailable} checked={selection.includes(file.libraryId)} onCheckedChange={checked => setSelection(current => checked ? [...current, file.libraryId] : current.filter(id => id !== file.libraryId))} /></td><td><Button ref={button => onFileButton?.(file.libraryId, button)} variant="ghost" disabled={unavailable} aria-label={`Open ${file.name}`} onClick={() => onOpen(file)}>{file.name}</Button><span className="hub-sheets-caption">{file.worksheets.map(sheet => sheet.name).join(', ')} · {version.name}</span></td><td><Badge>{file.type.name}</Badge></td><td>{file.metadata.sharePoint ? <><a href={file.metadata.sharePoint.url} target="_blank" rel="noreferrer">SharePoint</a><span className="hub-sheets-caption">{version.source === 'sharepoint' ? `Synced ${formatInstantDate(version.savedAt)}` : 'Linked'}</span></> : file.state.origin.kind === 'unavailable' ? <span>Source unavailable</span> : 'This Mac'}</td><td>{file.rowCount}</td><td><div className="hub-sheets-actions">
            {pending.includes(file.libraryId) && <Button disabled={working} onClick={() => void perform(() => onCheck(file))}>Check result</Button>}
            {file.metadata.sharePoint && <IconButton label={`Sync ${file.name}`} disabled={unavailable} icon={<RefreshCw size={16} />} onClick={() => void perform(() => onChange(file, { kind: 'sync' }))} />}
            <IconButton label={`Versions of ${file.name}`} disabled={disabled} icon={<History size={16} />} onClick={event => onVersions(file, event.currentTarget)} />
            <DropdownMenu><DropdownMenuTrigger render={<IconButton label={`Actions for ${file.name}`} disabled={unavailable} icon={<MoreHorizontal size={16} />} />} /><DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onOpen(file)}>Open</DropdownMenuItem><DropdownMenuItem onSelect={event => onVersions(file, event.currentTarget)}>Versions</DropdownMenuItem><DropdownMenuItem onSelect={() => openDialog('rename', [file])}>Rename</DropdownMenuItem><DropdownMenuItem onSelect={() => openDialog('type', [file])}>Change type</DropdownMenuItem>
              {file.metadata.sharePoint ? <DropdownMenuItem onSelect={() => void perform(() => onChange(file, { kind: 'sync' }))}>Sync now</DropdownMenuItem> : <DropdownMenuItem onSelect={() => openDialog('link', [file])}>Link to SharePoint</DropdownMenuItem>}
              <DropdownMenuItem onSelect={() => void perform(() => onDownload(file))}>Download</DropdownMenuItem><DropdownMenuItem variant="destructive" onSelect={() => openDialog('remove', [file])}>Remove</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu>
          </div></td></tr>;
        })}</tbody></table>
        {!loading && !failed && !visible.length && <p className="hub-sheets-empty">{local.length ? 'No spreadsheets match your search.' : 'No spreadsheets yet. Import a spreadsheet to add it to your library.'}</p>}
      </TableList>
    </section>
    <section className="hub-sheets-section"><h2>Workflow outputs</h2><div className="hub-sheets-table"><table aria-label="Workflow outputs"><thead><tr><th scope="col">Workbook</th><th scope="col">Run</th><th scope="col">Created</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>{outputs.map(file => {
      const origin = file.state.origin;
      if (origin.kind !== 'workflow') return null;
      const unavailable = disabled || pending.includes(file.libraryId);
      return <tr key={file.libraryId}><td>{file.name}<span className="hub-sheets-caption">{origin.workflowLabel} · {origin.rowCount} {origin.rowSubject === 'person' ? origin.rowCount === 1 ? 'person' : 'people' : origin.rowCount === 1 ? 'record' : 'records'}</span></td><td>{origin.runId}</td><td>{formatInstantDate(file.state.versions[0].savedAt)}</td><td><div className="hub-sheets-actions"><IconButton label={`Download ${file.name}`} icon={<Download size={16} />} disabled={unavailable} onClick={() => void perform(() => onDownload(file))} /><Button disabled={unavailable || !onOpenRun} onClick={() => onOpenRun?.(origin.runId, origin.partitionDay)}>Open run</Button>{pending.includes(file.libraryId) ? <Button disabled={working} onClick={() => void perform(() => onCheck(file))}>Check result</Button> : <Button disabled={unavailable} onClick={() => openDialog('remove', [file])}>Remove</Button>}</div></td></tr>;
    })}</tbody></table>{!loading && !failed && !outputs.length && <p className="hub-sheets-empty">Workbooks made by workflows will appear here.</p>}</div></section>
    <section className="hub-sheets-section"><h2>Spreadsheet types</h2><div className="hub-sheets-form">{types.map(type => <div key={type.id} className="hub-sheets-row"><div className="hub-sheets-label">{type.name}<span className="hub-sheets-note">Define which columns belong to this type.</span></div><div className="hub-sheets-control"><Button aria-label={`Edit ${type.name}`} onClick={event => onEditType(type, event.currentTarget)}>Edit</Button></div></div>)}</div></section>
    <Dialog open={!!dialog} onOpenChange={open => { if (!open && !working) setDialog(undefined); }}><DialogContent title={dialog?.kind === 'merge' ? 'Merge spreadsheets' : dialog?.kind === 'remove' ? 'Remove spreadsheets?' : dialog?.kind === 'rename' ? 'Rename spreadsheet' : dialog?.kind === 'type' ? 'Change spreadsheet type' : 'Link to SharePoint'}><DialogBody>
      {dialog?.kind === 'merge' ? <div className="grid gap-4"><p>The originals are retained in version history. The merged spreadsheet becomes local reference data.</p><ul>{dialog.files.map(file => <li key={file.libraryId}>{file.name} · {file.rowCount} rows</li>)}</ul><Field label="Merged spreadsheet name"><Input value={value} disabled={working} onChange={event => setValue(event.target.value)} /></Field><Field label="People in both spreadsheets"><Select value={duplicates} disabled={working} onChange={event => setDuplicates(event.target.value === 'keep-newer' ? 'keep-newer' : 'keep-both')}><option value="keep-both">Keep both and ask during lookups</option><option value="keep-newer" disabled={!dialog.files[0].type.keyFieldId}>Keep the row from the newer saved spreadsheet</option></Select></Field><p className="hub-sheets-caption">Matching key: {dialog.files[0].type.keyFieldId ?? 'No key declared for this type'}. Layout differences and tied saved times require review.</p></div> : dialog?.kind === 'remove' ? <><p>These spreadsheets will no longer be available for lookups. Retained run evidence stays available. SharePoint files are unchanged.</p><ul>{dialog.files.map(file => <li key={file.libraryId}>{file.name}</li>)}</ul></> : <Field label={dialog?.kind === 'type' ? 'Spreadsheet type' : dialog?.kind === 'rename' ? 'Spreadsheet name' : 'SharePoint file URL'}>{dialog?.kind === 'type' ? <Select value={value} disabled={working} onChange={event => setValue(event.target.value)}>{types.map(type => <option key={type.id} value={type.id}>{type.name}</option>)}</Select> : <Input value={value} disabled={working} onChange={event => setValue(event.target.value)} />}</Field>}
      {error && <Banner tone="danger" title="Library action unavailable">{error}</Banner>}
    </DialogBody><DialogFooter><Button disabled={working} onClick={() => setDialog(undefined)}>Cancel</Button><Button disabled={working || dialog?.kind !== 'remove' && !value.trim() || !!dialog?.files.some(file => pending.includes(file.libraryId))} onClick={() => void change()}>{working ? 'Working…' : dialog?.kind === 'merge' ? 'Merge spreadsheets' : dialog?.kind === 'remove' ? 'Remove' : 'Save'}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}
