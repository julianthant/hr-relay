import { useSpreadsheetWiringAdapter } from "../../state/spreadsheet-wiring-adapter.js";
import { useViewNavigation, useViewState } from "../../app/navigation/view-route-model.js";
import { importSpreadsheetInWorker } from "./spreadsheet-import-client.js";
import { spreadsheetImportError } from "./spreadsheet-import-model.js";
import { spreadsheetTypeColumn, spreadsheetTypeColumns, spreadsheetTypeError, spreadsheetTypeHeaders } from './spreadsheet-type-model.js';
import { SpreadsheetEditor } from "./spreadsheet-editor.js";
import { decodeEditableWorkbook, type WorkbookType } from '../../../models/dashboard/workbooks.js';
import type { WorkbookLibraryEntry, WorkbookLibraryVersion, WorkbookLibraryAction } from '../../../models/dashboard/workbook-library.js';
import type { LibraryChangeResult } from '../../state/spreadsheet-wiring-adapter.js';
import { mockWorkbookTypes, mockWorkbookLibrary } from './spreadsheet-library-model.js';
import { type EditableWorkbook } from '../../../rules/spreadsheets/workbook-io.js';
import { useEffect, useRef, useState, type RefObject } from "react";
import { Banner, Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, Field, Input, Select, useToasts } from "../../ds/ui.js";
import { SpreadsheetImportDialog } from "./spreadsheet-import.js";
import { SpreadsheetColumnImport } from "./spreadsheet-column-import.js";
import { prepareSpreadsheetColumns, selectSpreadsheetColumns } from "./spreadsheet-column-import-model.js";
import { SpreadsheetLibrary } from "./spreadsheet-library.js";
import { SpreadsheetVersions } from "./spreadsheet-versions.js";
import { spreadsheetDownload, saveSpreadsheetDownload } from "./spreadsheet-chat-registration-model.js";
import { saveMockSpreadsheet, putMockSpreadsheetType, registeredSpreadsheetWorkbook, registerLocalSpreadsheet, retainSpreadsheetCopy, useSpreadsheetMocks, type RegisteredSpreadsheet } from "./spreadsheet-mock-model.js";

export function SpreadsheetTypeDialog({ open, onOpenChange, type, workbook, returnFocus, onSave, pending = false }: { open: boolean; onOpenChange: (open: boolean) => void; type?: WorkbookType; workbook?: EditableWorkbook | null; returnFocus: RefObject<HTMLButtonElement | null>; onSave: (type: WorkbookType) => Promise<LibraryChangeResult>; pending?: boolean }) {
  const { toast } = useToasts();
  const input = useRef<HTMLInputElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const [name, setName] = useState(type?.name ?? '');
  const [columns, setColumns] = useState(() => spreadsheetTypeColumns(type));
  const [header, setHeader] = useState('');
  const headers = spreadsheetTypeHeaders(workbook);
  const validation = spreadsheetTypeError(name, columns);
  const [error, setError] = useState(pending ? 'This type change is not yet confirmed. Check its result before editing it.' : ''), [busy, setBusy] = useState(false), [uncertain, setUncertain] = useState(pending);
  const [id] = useState(() => crypto.randomUUID());
  const addHeader = () => {
    const column = spreadsheetTypeColumn(header), existing = columns.find(item => item.id === column.id);
    if (existing) { setError(`“${header}” is already included as “${existing.name}”. The existing column is unchanged.`); return; }
    setColumns(current => [...current, column]); setHeader(''); setError('');
  };
  const save = async () => {
    if (validation) { setError(validation); return; }
    setBusy(true); setError('');
    try {
      const fields = columns.map(column => column.id);
      const result = await onSave(uncertain && type ? type : { id: type?.id ?? id, name: name.trim(), fields, defaultWorkbookId: type?.defaultWorkbookId ?? null,
        keyFieldId: type?.keyFieldId && fields.includes(type.keyFieldId) ? type.keyFieldId : fields.includes('eid') ? 'eid' : null,
        fieldLabels: Object.fromEntries(columns.map(column => [column.id, column.name.trim()])), requiredFields: columns.filter(column => column.required).map(column => column.id) });
      if (result.state === 'confirmed') { onOpenChange(false); toast({ tone: 'success', title: 'Spreadsheet type saved' }); }
      else { setError(result.message); setUncertain(result.state === 'uncertain'); }
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent hideClose className="hub-sheets-dialog hub-sheets-type-dialog" title={type ? 'Edit spreadsheet type' : 'Create spreadsheet type'} onOpenAutoFocus={event => { event.preventDefault(); if (uncertain) saveButton.current?.focus(); else input.current?.focus(); }} onCloseAutoFocus={event => { if (returnFocus.current) { event.preventDefault(); returnFocus.current.focus(); } }}>
    <DialogBody><Field label="Type name"><Input ref={input} autoComplete="off" name="spreadsheet-type-name" className="hub-sheets-field" value={name} disabled={busy || uncertain} onChange={event => { setName(event.target.value); setError(''); }} /></Field>
      <fieldset onChange={() => setError('')} disabled={busy || uncertain} className="hub-sheets-type-columns"><legend>Columns ({columns.length})</legend>
        <p className="hub-sheets-caption">Name each column and choose which fields are required.</p>
        {columns.map((column, index) => <div key={column.id} className="hub-sheets-type-column">
          <Input aria-label={`Column ${index + 1} name`} value={column.name} onChange={event => setColumns(current => current.map(item => item.id === column.id ? { ...item, name: event.target.value } : item))} />
          <Checkbox label={`Required column ${index + 1}`} checked={column.required} onCheckedChange={required => setColumns(current => current.map(item => item.id === column.id ? { ...item, required: required === true } : item))} />
          <Button aria-label={`Remove column ${index + 1}`} onClick={() => setColumns(current => current.filter(item => item.id !== column.id))}>Remove</Button>
        </div>)}
        <Button onClick={() => setColumns(current => [...current, spreadsheetTypeColumn()])}>Add column</Button>
        {headers.length > 0 && <div className="hub-sheets-header-suggestions"><Field label="Imported workbook headers"><Select value={header} onChange={event => setHeader(event.target.value)}><option value="">Choose a header</option>{headers.map(value => <option key={value} value={value}>{value}</option>)}</Select></Field><Button disabled={!header} onClick={addHeader}>Add selected header</Button></div>}
      </fieldset>
      {error && <Banner tone="danger" title="Type not saved">{error}</Banner>}
    </DialogBody>
    <DialogFooter><Button className="hub-sheets-button" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button ref={saveButton} className="hub-sheets-button hub-sheets-primary" disabled={busy} onClick={() => void save()}>{uncertain ? 'Check result' : busy ? 'Saving…' : 'Save type'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function SpreadsheetsSettings({ workbook, workbookDirty, onWorkbook, onOpenRun, source = "served" }: { source?: "mock" | "served"; onOpenRun?: (runId: string, partitionDay: string) => void; workbook: EditableWorkbook | null; workbookDirty: boolean; onWorkbook: (next: EditableWorkbook | null, dirty: boolean) => void }) {
  const mocks = useSpreadsheetMocks();
  const mockTypes = source === "mock" ? mockWorkbookTypes(mocks.types) : [];
  const { toast } = useToasts();
  const [selectedId, setSelectedId] = useViewState("spreadsheet", workbook?.libraryId ?? null);
  const served = useSpreadsheetWiringAdapter(source === "served", selectedId, true);
  const files = source === "served" ? served.files : mocks.files;
  const types = source === "served" ? served.types : mockTypes;
  const catalog = source === "served" ? served.catalog : mockWorkbookLibrary(mocks.files, mockTypes);
  const navigation = useViewNavigation();
  const versionTrigger = useRef<HTMLElement | null>(null);
  const [versionsId, setVersionsId] = useState<string | null>(null);
  const downloadVersion = async (entry: WorkbookLibraryEntry, version: WorkbookLibraryVersion) => {
    const document = source === 'served' ? decodeEditableWorkbook((await served.adapter.readNamedVersion(entry.libraryId, version.id)).workbook)
      : registeredSpreadsheetWorkbook(mocks.files.find(file => file.id === entry.libraryId)!);
    saveSpreadsheetDownload(await spreadsheetDownload(document));
  };
  const changeLibrary = async (entry: WorkbookLibraryEntry, change: WorkbookLibraryAction['change']): Promise<LibraryChangeResult> => {
    if (source === 'mock') return { state: 'refused', message: 'Library changes require the served workbook library.' };
    const result = await served.adapter.changeLibrary(entry, change);
    if (result.state === 'confirmed' && change.kind === 'remove' && selectedId === entry.libraryId) { setSelectedId(null); onWorkbook(null, false); }
    return result;
  };
  const showVersions = (entry: WorkbookLibraryEntry, button: HTMLElement) => { versionTrigger.current = button instanceof HTMLButtonElement ? button : libraryButtons.current.get(entry.libraryId) ?? null; setVersionsId(entry.libraryId); };
  const openDocument = (id: string) => { setSelectedId(id); navigation?.update({ spreadsheetSheet: undefined, spreadsheetPage: 0, spreadsheetColumnPage: 0, spreadsheetRowsQuery: "", spreadsheetMapping: undefined, spreadsheetImport: false, spreadsheetImportView: "mapping", spreadsheetImportSheet: undefined, spreadsheetImportColumnPage: 0 }); setImportOpen(false); };
  const upload = useRef<HTMLInputElement>(null);
  const libraryButtons = useRef(new Map<string, HTMLButtonElement>());
  const [busy, setBusy] = useState(false);
  const [localFileError, setFileError] = useState("");
  const fileError = localFileError || (source === "served" ? served.error || served.openError || served.catalogError : "");
  const loading = source === "served" && !fileError ? served.loading || served.catalogLoading ? "Loading spreadsheets…" : served.opening ? "Loading spreadsheet…" : "" : "";
  const [importOpen, setImportOpen] = useViewState("spreadsheetImport", false);
  const [importView, setImportView] = useViewState("spreadsheetImportView", "mapping");
  const importTrigger = useRef<HTMLButtonElement>(null);
  const [editingId, setEditingId] = useViewState("spreadsheetMapping", undefined);
  const pendingImport = workbook && !workbook.libraryId && (source === "mock" || selectedId === null || editingId !== undefined) ? workbook : null;
  const editing = files.find(file => file.id === editingId);
  const [typeId, setTypeId] = useViewState("spreadsheetType", undefined);
  const typeOpen = typeId !== undefined;
  const setTypeOpen = (open: boolean) => setTypeId(open ? null : undefined);
  const viewType = (source === "served" ? served.pendingTypes.find(type => type.id === typeId) : undefined) ?? types.find(type => type.id === typeId);
  const setViewType = (type: WorkbookType | undefined) => setTypeId(type?.id ?? null);
  const typeTrigger = useRef<HTMLButtonElement>(null);
  const selected = selectedId === null ? undefined : files.find(file => file.id === (source === "served" ? served.key : selectedId));
  const visibleWorkbook = pendingImport ? null : source === "served" ? served.draft?.document ?? null : selected ? workbook?.libraryId === selected.id ? workbook : registeredSpreadsheetWorkbook(selected) : null;
  const currentDirty = source === "served" ? served.draft?.dirty ?? false : visibleWorkbook === workbook && workbookDirty;
  const notifyWorkbook = useRef(onWorkbook); notifyWorkbook.current = onWorkbook;
  const savedLibraryId = served.draft?.opened?.libraryId;
  useEffect(() => {
    if (source !== "served" || !savedLibraryId || selectedId === savedLibraryId) return;
    if (navigation) navigation.update({ spreadsheet: savedLibraryId }, "replace");
    else setSelectedId(savedLibraryId);
  }, [source, savedLibraryId, selectedId, navigation, setSelectedId]);
  const servedDocument = served.draft?.document, servedDirty = served.draft?.dirty;
  useEffect(() => { if (source === "served" && servedDocument && !pendingImport) notifyWorkbook.current(servedDocument, servedDirty!); }, [source, servedDocument, servedDirty, pendingImport]);
  const openFile = (file: RegisteredSpreadsheet) => { if (pendingImport) return; openDocument(file.id); if (source === "mock") onWorkbook(registeredSpreadsheetWorkbook(file), false); };
  const documentChange = (next: EditableWorkbook | null, dirty: boolean) => {
    if (source === "mock" && selected && !dirty && (next || workbook && !workbookDirty)) retainSpreadsheetCopy(selected.id, next ?? workbook!);
    if (source === "served" && next && selectedId !== null) { served.adapter.change(selectedId, next, dirty); onWorkbook(next, served.adapter.draft(selectedId)!.dirty); }
    else onWorkbook(next, dirty);
    if (!next) {
      if (source === "served" && selectedId !== null) served.adapter.close(selectedId);
      setSelectedId(null);
      if (selected) window.requestAnimationFrame(() => libraryButtons.current.get(selected.id)?.focus());
    }
  };
  const importFile = async (file: File) => {
    setBusy(true); setFileError("");
    try { const document = prepareSpreadsheetColumns(await importSpreadsheetInWorker(file.name, await file.arrayBuffer())); onWorkbook(document, true); setSelectedId(null); setImportView("columns"); navigation?.update({ spreadsheetImportSheet: document.sheets[0].id, spreadsheetImportColumnPage: 0, spreadsheetMapping: undefined }); setImportOpen(true); }
    catch (error) { setFileError(spreadsheetImportError(error)); }
    finally { setBusy(false); if (upload.current) upload.current.value = ""; }
  };
  const confirmImport = () => {
    if (!pendingImport) throw new Error("SPREADSHEET_IMPORT_DRAFT_UNAVAILABLE");
    const document = selectSpreadsheetColumns(pendingImport);
    if (source === "served") {
      if (editingId) { const original = served.adapter.draft(editingId); if (!original) throw new Error("SPREADSHEET_DRAFT_UNAVAILABLE"); const next = { ...document, libraryId: original.opened?.libraryId }; served.adapter.change(editingId, next, true); openDocument(editingId); onWorkbook(next, true); }
      else { const id = served.adapter.create(document); openDocument(id); onWorkbook(document, true); }
    } else { const registered = registerLocalSpreadsheet(document, editingId); openDocument(registered.id); onWorkbook({ ...document, libraryId: registered.id }, false); }
    toast({ tone: "success", title: editingId ? "Column mappings saved" : "Spreadsheet imported" });
  };
  return <section aria-label="Spreadsheets" className="spreadsheet-workspace settings-reference-page min-w-0 text-body">
    <input ref={upload} disabled={busy || !!pendingImport} type="file" accept=".xlsx,.csv" aria-label="Open XLSX or CSV" className="sr-only" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
    {loading && <p role="status" className="text-caption text-ui-muted">{loading}</p>}
    {fileError && <Banner tone="danger" title="Spreadsheet unavailable">{fileError}{source === "served" && <Button disabled={served.catalogRefreshing} onClick={() => void served.adapter.refreshCatalog()}>Refresh library</Button>}</Banner>}
    {selectedId !== null && !selected && source === "mock" ? <Banner tone="danger" title="Spreadsheet unavailable"><p>This file is no longer registered.</p><Button onClick={() => setSelectedId(null)}>Open library</Button></Banner> : visibleWorkbook ? <SpreadsheetEditor key={source === "served" ? served.key : selectedId ?? visibleWorkbook.name} document={visibleWorkbook} dirty={currentDirty} onHistory={source === "served" && served.draft?.opened ? () => { versionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setVersionsId(served.draft!.opened!.libraryId); } : undefined} exportKeepsDirty={source === "served"} onSaveValues={source === 'served' && served.draft?.opened ? (name, draft) => served.adapter.saveValuesVersion(selectedId!, name, draft) : undefined} onSave={source === "served" ? (served.loading || served.refreshing || served.error || served.openError || served.catalogError) && !served.draft?.intent ? undefined : draft => served.adapter.save(selectedId!, draft) : saveMockSpreadsheet} onDocument={documentChange} onExported={() => toast({ tone: "success", title: "Spreadsheet copy exported" })} onMapping={selected ? () => {
      setEditingId(selected.id);
      if (selected.typeId === 'local') {
        const draft = { ...visibleWorkbook, libraryId: undefined };
        onWorkbook(draft.sheets.every(sheet => sheet.columnBindings) ? draft : prepareSpreadsheetColumns(draft), true);
        setImportView('columns');
      } else setImportView('mapping');
      setImportOpen(true);
    } : undefined} /> : <>
      {pendingImport && <Banner tone="info" title="Import ready to review">{pendingImport.name} · Choose columns before adding this file to your library.</Banner>}
      <SpreadsheetLibrary files={catalog} types={types} busy={busy} loading={source === "served" && served.catalogLoading} failed={source === "served" && !!(served.error || served.openError || served.catalogError || served.catalogRefreshing)} pending={source === "served" ? served.pendingLibraries : []} pendingImport={!!pendingImport} importTrigger={importTrigger} onImport={() => { if (pendingImport) { setImportView("columns"); setImportOpen(true); } else upload.current?.click(); }} onCreateType={button => { typeTrigger.current = button; setViewType(source === 'served' ? served.pendingTypes.find(type => !types.some(current => current.id === type.id)) : undefined); }} onEditType={(type, button) => { typeTrigger.current = button; setViewType(type); }} onOpen={entry => { const file = files.find(file => (served.adapter.draft(file.id)?.opened?.libraryId ?? file.id) === entry.libraryId); if (file) openFile(file); else openDocument(entry.libraryId); }} onVersions={showVersions} onDownload={entry => downloadVersion(entry, entry.state.versions.find(version => version.id === entry.state.selectedVersionId)!)} onChange={changeLibrary} onCheck={entry => served.adapter.settleLibrary(entry.libraryId)} onOpenRun={onOpenRun} onFileButton={(id, node) => { if (node) libraryButtons.current.set(id, node); else libraryButtons.current.delete(id); }} />
    </>}
    {importView === "columns" ? pendingImport ? <SpreadsheetColumnImport open={importOpen} document={pendingImport} onOpenChange={setImportOpen} onChange={next => onWorkbook(next, true)} onCancel={() => { setImportOpen(false); onWorkbook(null, false); }} onConfirm={confirmImport} returnFocus={importTrigger} /> : importOpen && <Dialog open onOpenChange={setImportOpen}><DialogContent title="Import unavailable" description="Choose the file again to review its columns."><DialogBody>The pending file is no longer in memory.</DialogBody><DialogFooter><Button onClick={() => setImportOpen(false)}>Close</Button></DialogFooter></DialogContent></Dialog> : <SpreadsheetImportDialog open={importOpen} onOpenChange={setImportOpen} existing={editing} onRegistered={() => { if (!editing) setSelectedId(null); }} />}
    <SpreadsheetVersions key={versionsId ?? "closed"} returnFocus={versionTrigger} entry={catalog.find(entry => entry.libraryId === versionsId) ?? null} pending={source === "served" && versionsId !== null && served.pendingLibraries.includes(versionsId)} onClose={() => setVersionsId(null)} onDownload={downloadVersion} onChange={changeLibrary} onCheck={entry => served.adapter.settleLibrary(entry.libraryId)} />
    <SpreadsheetTypeDialog key={`${typeId ?? "new"}:${String(typeOpen)}`} open={typeOpen} onOpenChange={setTypeOpen} type={viewType} workbook={pendingImport ?? visibleWorkbook ?? workbook} pending={source === "served" && served.pendingTypes.some(type => type.id === viewType?.id)} returnFocus={typeTrigger} onSave={async type => {
      if (source === 'served') return served.adapter.saveType(type);
      putMockSpreadsheetType(type);
      return { state: 'confirmed' };
    }} />
  </section>;
}
