import { useSpreadsheetWiringAdapter } from "../../state/spreadsheet-wiring-adapter.js";
import { useViewNavigation, useViewState } from "../../app/navigation/view-route-model.js";
import { importSpreadsheetInWorker } from "./spreadsheet-import-client.js";
import { SpreadsheetEditor } from "./spreadsheet-editor.js";
import { type EditableWorkbook } from "./spreadsheet-editor-model.js";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Banner, Button, Dialog, DialogBody, DialogContent, DialogFooter, Field, Input, useToasts } from "../../ds/ui.js";
import { SpreadsheetImportDialog } from "./spreadsheet-import.js";
import { SpreadsheetColumnImport } from "./spreadsheet-column-import.js";
import { prepareSpreadsheetColumns, selectSpreadsheetColumns } from "./spreadsheet-column-import-model.js";
import { SpreadsheetLibrary } from "./spreadsheet-library.js";
import { SpreadsheetVersions } from "./spreadsheet-versions.js";
import type { KronosReportDatesPort } from "./spreadsheet-library-model.js";
import { spreadsheetChatRegistrationPort, saveSpreadsheetDownload } from "./spreadsheet-chat-registration-model.js";
import { saveMockSpreadsheet, addMockSpreadsheetType, renameMockSpreadsheetType, registeredSpreadsheetWorkbook, registerLocalSpreadsheet, retainSpreadsheetCopy, useSpreadsheetMocks, type RegisteredSpreadsheet, type SpreadsheetType } from "./spreadsheet-mock-model.js";

export function SpreadsheetTypeDialog({ open, onOpenChange, type, returnFocus }: { open: boolean; onOpenChange: (open: boolean) => void; type?: SpreadsheetType; returnFocus: RefObject<HTMLButtonElement | null> }) {
  const { toast } = useToasts();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(type?.name ?? '');
  const [error, setError] = useState('');
  const save = () => {
    try {
      if (type) renameMockSpreadsheetType(type.id, name);
      else addMockSpreadsheetType(name, ['First name', 'Last name', 'Employee ID']);
      onOpenChange(false); toast({ tone: 'success', title: 'Spreadsheet type saved' });
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); }
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent hideClose className="hub-sheets-dialog hub-sheets-type-dialog" title={type ? 'Edit spreadsheet type' : 'Create spreadsheet type'} onOpenAutoFocus={event => { event.preventDefault(); input.current?.focus(); }} onCloseAutoFocus={event => { if (returnFocus.current) { event.preventDefault(); returnFocus.current.focus(); } }}>
    <DialogBody><Field label="Type name" error={error || undefined}><Input ref={input} autoComplete="off" name="spreadsheet-type-name" className="hub-sheets-field" value={name} onChange={event => setName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && name.trim()) { event.preventDefault(); save(); } }} /></Field><p className="hub-sheets-caption">Columns: {(type?.fields ?? ['First name', 'Last name', 'Employee ID']).join(', ')}</p></DialogBody>
    <DialogFooter><Button className="hub-sheets-button" onClick={() => onOpenChange(false)}>Cancel</Button><Button className="hub-sheets-button hub-sheets-primary" disabled={!name.trim()} onClick={save}>Save type</Button></DialogFooter>
  </DialogContent></Dialog>;
}

export function SpreadsheetsSettings({ workbook, workbookDirty, onWorkbook, reportDates, source = "served" }: { reportDates?: KronosReportDatesPort; source?: "mock" | "served"; workbook: EditableWorkbook | null; workbookDirty: boolean; onWorkbook: (next: EditableWorkbook | null, dirty: boolean) => void }) {
  const mocks = useSpreadsheetMocks();
  const { types } = mocks;
  const { toast } = useToasts();
  const [selectedId, setSelectedId] = useViewState("spreadsheet", workbook?.libraryId ?? null);
  const served = useSpreadsheetWiringAdapter(source === "served", selectedId);
  const files = source === "served" ? served.files : mocks.files;
  const navigation = useViewNavigation();
  const versionTrigger = useRef<HTMLElement | null>(null);
  const [versionsId, setVersionsId] = useState<string | null>(null);
  const readVersions = useCallback((id: string) => served.adapter.history(id), [served.adapter]);
  const registration = spreadsheetChatRegistrationPort(served.adapter);
  const download = async (file: RegisteredSpreadsheet) => {
    if (file.version === undefined) throw new Error("SPREADSHEET_VERSION_UNAVAILABLE");
    setBusy(true); setFileError("");
    try { saveSpreadsheetDownload(await registration.download({ libraryId: served.adapter.draft(file.id)?.opened?.libraryId ?? file.id, version: file.version, name: file.name, status: file.status ?? "Attached" })); }
    catch (error) { setFileError(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };
  const openDocument = (id: string) => { setSelectedId(id); navigation?.update({ spreadsheetSheet: undefined, spreadsheetPage: 0, spreadsheetColumnPage: 0, spreadsheetRowsQuery: "", spreadsheetMapping: undefined, spreadsheetImport: false, spreadsheetImportView: "mapping", spreadsheetImportSheet: undefined, spreadsheetImportColumnPage: 0 }); setImportOpen(false); };
  const upload = useRef<HTMLInputElement>(null);
  const libraryButtons = useRef(new Map<string, HTMLButtonElement>());
  const [busy, setBusy] = useState(false);
  const [localFileError, setFileError] = useState("");
  const fileError = localFileError || (source === "served" ? served.error || served.openError : "");
  const loading = source === "served" && !fileError ? served.loading ? "Loading spreadsheets…" : served.opening ? "Loading spreadsheet…" : "" : "";
  const [importOpen, setImportOpen] = useViewState("spreadsheetImport", false);
  const [importView, setImportView] = useViewState("spreadsheetImportView", "mapping");
  const importTrigger = useRef<HTMLButtonElement>(null);
  const [editingId, setEditingId] = useViewState("spreadsheetMapping", undefined);
  const pendingImport = workbook && !workbook.libraryId && (source === "mock" || selectedId === null || editingId !== undefined) ? workbook : null;
  const editing = files.find(file => file.id === editingId);
  const [typeId, setTypeId] = useViewState("spreadsheetType", undefined);
  const typeOpen = typeId !== undefined;
  const setTypeOpen = (open: boolean) => setTypeId(open ? null : undefined);
  const viewType = types.find(type => type.id === typeId);
  const setViewType = (type: SpreadsheetType | undefined) => setTypeId(type?.id ?? null);
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
    catch (error) { setFileError(error instanceof Error ? error.message : String(error)); }
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
    {fileError && <Banner tone="danger" title="Spreadsheet unavailable">{fileError}</Banner>}
    {selectedId !== null && !selected && source === "mock" ? <Banner tone="danger" title="Spreadsheet unavailable"><p>This file is no longer registered.</p><Button onClick={() => setSelectedId(null)}>Open library</Button></Banner> : visibleWorkbook ? <SpreadsheetEditor key={source === "served" ? served.key : selectedId ?? visibleWorkbook.name} document={visibleWorkbook} dirty={currentDirty} onHistory={source === "served" && served.draft?.opened ? () => { versionTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setVersionsId(served.draft!.opened!.libraryId); } : undefined} exportKeepsDirty={source === "served"} onSave={source === "served" ? (served.loading || served.refreshing || served.error || served.openError) && !served.draft?.intent ? undefined : draft => served.adapter.save(selectedId!, draft) : saveMockSpreadsheet} onDocument={documentChange} onExported={() => toast({ tone: "success", title: "Spreadsheet copy exported" })} onMapping={selected ? () => {
      setEditingId(selected.id);
      if (selected.typeId === 'local') {
        const draft = { ...visibleWorkbook, libraryId: undefined };
        onWorkbook(draft.sheets.every(sheet => sheet.columnBindings) ? draft : prepareSpreadsheetColumns(draft), true);
        setImportView('columns');
      } else setImportView('mapping');
      setImportOpen(true);
    } : undefined} /> : <>
      {pendingImport && <Banner tone="info" title="Import ready to review">{pendingImport.name} · Choose columns before adding this file to your library.</Banner>}
      <SpreadsheetLibrary files={files} types={types} busy={busy} loading={source === "served" && served.loading} failed={!!fileError || source === "served" && served.refreshing} pendingImport={!!pendingImport} importTrigger={importTrigger} onImport={() => { if (pendingImport) { setImportView("columns"); setImportOpen(true); } else upload.current?.click(); }} onCreateType={button => { typeTrigger.current = button; setViewType(undefined); }} onEditType={(type, button) => { typeTrigger.current = button; setViewType(type); }} onOpen={openFile} onDownload={source === "served" ? file => { void download(file); } : undefined} onFileButton={(id, node) => { if (node) libraryButtons.current.set(id, node); else libraryButtons.current.delete(id); }} reportDates={reportDates} />
    </>}
    {importView === "columns" ? pendingImport ? <SpreadsheetColumnImport open={importOpen} document={pendingImport} onOpenChange={setImportOpen} onChange={next => onWorkbook(next, true)} onCancel={() => { setImportOpen(false); onWorkbook(null, false); }} onConfirm={confirmImport} returnFocus={importTrigger} /> : importOpen && <Dialog open onOpenChange={setImportOpen}><DialogContent title="Import unavailable" description="Choose the file again to review its columns."><DialogBody>The pending file is no longer in memory.</DialogBody><DialogFooter><Button onClick={() => setImportOpen(false)}>Close</Button></DialogFooter></DialogContent></Dialog> : <SpreadsheetImportDialog open={importOpen} onOpenChange={setImportOpen} existing={editing} onRegistered={() => { if (!editing) setSelectedId(null); }} />}
    <SpreadsheetVersions key={versionsId ?? "closed"} returnFocus={versionTrigger} libraryId={versionsId} read={readVersions} onClose={() => setVersionsId(null)} onDownload={async record => { saveSpreadsheetDownload(await registration.download({ libraryId: record.libraryId, version: record.version, name: record.workbook.name, status: record.version > 1 ? 'Updated' : 'Attached' })); }} />
    <SpreadsheetTypeDialog key={`${typeId ?? "new"}:${String(typeOpen)}`} open={typeOpen} onOpenChange={setTypeOpen} type={viewType} returnFocus={typeTrigger} />
  </section>;
}
