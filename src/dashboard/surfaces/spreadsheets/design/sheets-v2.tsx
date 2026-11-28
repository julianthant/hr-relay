import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { closeDraft, copyMapping, dropImport, editMapping, importWorkbook, pendingImportName } from './sheets-v2-writes.js';
import { EmptyState, FailureNotice, PageHeading, SearchInput, dsIcon, useToasts } from '../../../ds/ui.js';
import { useSpreadsheetWiringAdapter, type LibraryChangeResult } from '../../../state/spreadsheet-wiring-adapter.js';
import { decodeEditableWorkbook } from '../../../../models/dashboard/workbooks.js';
import type { WorkbookLibraryAction, WorkbookLibraryEntry } from '../../../../models/dashboard/workbook-library.js';
import type { EditableWorkbook } from '../../../../rules/spreadsheets/workbook-io.js';
import { saveSpreadsheetDownload, spreadsheetDownload } from '../spreadsheet-chat-registration-model.js';
import { TagFilter } from './sheets-v2-tagfilter.js';
import { fieldsOf, newestFirst, operatorTags, sheetOf, tableOf, tagsOf, workflowTags, type ImportDraft } from './sheets-v2-model.js';
import { SheetDialog, type DialogKind } from './sheets-v2-dialogs.js';
import { SheetDetail, SheetDetailGrid, SheetDetailGridSkeleton } from './sheets-v2-detail.js';
import { DraftDetail, ImportMenu, SharePointImport } from './sheets-v2-import.js';
import { prepareSpreadsheetColumns } from '../spreadsheet-column-import-model.js';
import { importSpreadsheetInWorker } from '../spreadsheet-import-client.js';
import { SheetTable, SheetsSkeleton, type RowActions } from './sheets-v2-list.js';
import { Grey, V2Button, type MenuAction } from './sheets-v2-ui.js';
import '../spreadsheet-library.css';

const CREATED_ROWS = 8;

/** The Spreadsheets page on the served library. */
function unusableRowsNote(count: number) {
  return count > 0 ? `${count} ${count === 1 ? 'row has' : 'rows have'} no usable employee ID and will be read as missing.` : undefined;
}

export function SheetsV2({ onOpenRun }: { onOpenRun?: (runId: string, partitionDay: string) => void }) {
  const { toast } = useToasts();
  const [openId, setOpenId] = useState<string>();
  const wiring = useSpreadsheetWiringAdapter(true, openId ?? null, true);
  const { adapter, catalog, compatibility, catalogLoading, catalogRefreshing, catalogError, openError, draft, pendingLibraries } = wiring;
  const [dialog, setDialog] = useState<{ kind: DialogKind; id: string }>();
  const [importDraft, setImportDraft] = useState<ImportDraft>();
  const [sharePoint, setSharePoint] = useState(false);
  const [adding, setAdding] = useState(false);
  const [copying, setCopying] = useState(false);
  const reading = useRef(0);
  const [filter, setFilter] = useState<readonly string[]>([]);
  const [query, setQuery] = useState('');

  const sheets = useMemo(() => catalog.filter(entry => entry.state.origin.kind !== 'unavailable' && !entry.state.removed).map(sheetOf), [catalog]);
  const fields = useMemo(() => compatibility ? fieldsOf(compatibility) : [], [compatibility]);
  const get = (id: string) => sheets.find(item => item.id === id);
  const syncing = useRef(new Set<string>());
  const settled = async (work: Promise<LibraryChangeResult>, done?: string, failed = "Couldn't save the change") => {
    const result = await work;
    if (result.state === 'confirmed') { if (done) toast({ tone: 'success', title: done }); return true; }
    if (result.state === 'refused') toast({ tone: 'danger', key: failed, title: failed, description: result.message });
    else if (result.state === 'uncertain') toast({ tone: 'danger', key: 'sheets-pending', title: 'Not confirmed yet', description: result.message });
    else toast({ tone: 'success', key: 'sheets-recorded', title: 'Change recorded', description: result.message });
    return false;
  };
  const change = (id: string, edit: WorkbookLibraryAction['change'], done?: string, failed?: string) => {
    const entry = catalog.find(item => item.libraryId === id);
    if (!entry) return Promise.resolve(false);
    if (edit.kind !== 'sync') return settled(adapter.changeLibrary(entry, edit), done, failed);
    syncing.current.add(id);
    return settled(adapter.changeLibrary(entry, edit), done, failed).finally(() => { if (!adapter.snapshot().pendingLibraries.includes(id)) syncing.current.delete(id); });
  };
  const download = async (id: string) => {
    const sheet = get(id);
    try { if (sheet) saveSpreadsheetDownload(await spreadsheetDownload(decodeEditableWorkbook((await adapter.readNamedVersion(id, sheet.currentVersionId)).workbook))); }
    catch { toast({ tone: 'danger', key: 'sheets-download', title: "Couldn't download the spreadsheet" }); }
  };
  const menu = (id: string, action: MenuAction) => {
    const sheet = get(id);
    if (!sheet) return;
    if (action === 'sync') void change(id, { kind: 'sync' }, `Synced ${sheet.name}`, `Couldn't sync ${sheet.name}`);
    else if (action === 'download') void download(id);
    else if (action === 'pin') void change(id, { kind: sheet.pinned ? 'unpin' : 'pin' });
    else setDialog({ kind: action, id });
  };
  const bank = operatorTags(sheets);
  const rows: RowActions = { open: setOpenId, version: id => { void adapter.refreshCatalog(); setDialog({ kind: 'versions', id }); }, menu, logs: sheet => { if (sheet.run) onOpenRun?.(sheet.run.id, sheet.run.day); },
    tags: (id, tags) => void change(id, { kind: 'set-tags', tags: [...tags] }), bank };
  const warned = useRef(false);
  const back = () => {
    const id = openId;
    if (!id) return;
    void closeDraft(adapter, id, warned.current).then(closed => {
      if (closed) { warned.current = false; setOpenId(undefined); return; }
      warned.current = true;
      toast({ tone: 'danger', title: "Column changes aren't saved", description: 'Edit a column to retry, or choose Back again to discard.' });
    });
  };
  const saveMapping = (worksheet: string, patch: Record<string, string | null>) => {
    if (!openId) return;
    warned.current = false;
    void editMapping(adapter, openId, worksheet, patch).then(({ result, latest }) => {
      if (result && result.state !== 'confirmed' && latest) toast({ tone: 'danger', title: "Couldn't save the columns", description: result.reason });
    });
  };
  const add = async (draft: string, document: EditableWorkbook, tags: readonly string[]) => {
    const outcome = await importWorkbook(adapter, draft, document);
    if (outcome.state === 'added') {
      const created = outcome.libraryId;
      if (tags.length && created) {
        await adapter.loadCatalog();
        const entry = adapter.snapshot().catalog.find(item => item.libraryId === created);
        if (!entry || !await settled(adapter.changeLibrary(entry, { kind: 'set-tags', tags: [...tags] }))) toast({ tone: 'danger', title: `Added ${outcome.name} without its tags`, description: 'Add them with + on its row.' });
      }
      toast({ tone: 'success', title: `Added ${outcome.name}`, description: unusableRowsNote(outcome.rowsWithoutEid) });
      return true;
    }
    toast({ tone: 'danger', title: outcome.state === 'pending' ? `Still confirming ${pendingImportName(adapter)}` : "Couldn't add the spreadsheet",
      description: outcome.state === 'pending' ? 'Choose Add to library again to check.' : outcome.reason });
    return false;
  };
  const pickFile = async (file: File) => {
    const token = ++reading.current;
    setImportDraft({ id: crypto.randomUUID(), name: file.name.replace(/\.(xlsx|csv)$/iu, ''), tags: [] });
    try {
      const document = prepareSpreadsheetColumns(await importSpreadsheetInWorker(file.name, await file.arrayBuffer()));
      if (token === reading.current) setImportDraft(current => current && { ...current, document });
    } catch {
      if (token !== reading.current) return;
      setImportDraft(undefined);
      toast({ tone: 'danger', title: "Couldn't read that file", description: 'Choose an .xlsx or .csv file.' });
    }
  };
  const discardDraft = () => { reading.current++; setImportDraft(undefined); dropImport(adapter); };
  const addDraft = (draft: ImportDraft) => {
    if (!draft.document) return;
    setAdding(true);
    void add(draft.id, { ...draft.document, name: draft.name.trim() }, draft.tags).then(added => { setAdding(false); if (added) setImportDraft(current => current?.id === draft.id ? undefined : current); });
  };
  const copyAll = (worksheet: string) => {
    if (!openId) return;
    setCopying(true);
    void copyMapping(adapter, openId, worksheet).then(result => {
      setCopying(false);
      toast(result.state === 'confirmed' ? { tone: 'success', title: 'Columns copied' } : { tone: 'danger', title: "Couldn't copy the columns", description: result.message });
    });
  };
  const addSharePoint = async (request: { url: string; name: string }) => {
    const result = await adapter.importSharePoint({ source: 'sharepoint', url: request.url, name: request.name });
    if (result.state === 'confirmed') { toast({ tone: 'success', title: `Added ${request.name}` }); return true; }
    toast({ tone: 'danger', title: "Couldn't add the spreadsheet", description: result.message }); return false;
  };
  const checkPending = async (id: string) => {
    const result = await adapter.settleLibrary(id);
    const what = syncing.current.has(id) ? 'The sync' : 'The change';
    if (result.state === 'confirmed' || result.state === 'recorded') syncing.current.delete(id);
    if (result.state === 'confirmed') toast({ tone: 'success', title: `${what} went through` });
    else if (result.state === 'recorded') toast({ tone: 'success', key: 'sheets-pending', title: `${what} was recorded`, description: result.message });
    else toast({ tone: 'danger', key: 'sheets-pending', title: `${what} is not confirmed yet`, description: result.message });
  };

  const groups = { workflows: workflowTags(sheets), tags: operatorTags(sheets) };
  // A selected tag no sheet carries any more drops out, so the filter can never hold a choice it has no entry to clear.
  const activeFilter = useMemo(() => filter.filter(tag => workflowTags(sheets).includes(tag) || operatorTags(sheets).includes(tag)), [filter, sheets]);
  const catalogSettled = !catalogLoading && !catalogError;
  useEffect(() => { if (catalogSettled && activeFilter.length !== filter.length) setFilter(activeFilter); }, [catalogSettled, activeFilter, filter]);
  const visible = useMemo(() => newestFirst(sheets).filter(sheet => (!activeFilter.length || activeFilter.some(tag => tagsOf(sheet).includes(tag))) && sheet.name.toLowerCase().includes(query.trim().toLowerCase())), [sheets, activeFilter, query]);
  const tables = (['Pinned', 'Spreadsheets'] as const).map(title => ({ title, items: visible.filter(sheet => tableOf(sheet) === title) })).filter(table => table.items.length);
  const target = dialog && get(dialog.id);
  const open = openId ? get(openId) : undefined;

  const importMenu = <ImportMenu onFile={file => void pickFile(file)} onSharePoint={() => setSharePoint(true)} />;
  const pending = pendingLibraries.map(id => catalog.find(item => item.libraryId === id)).filter(Boolean);
  const pendingNote = (entries: readonly WorkbookLibraryEntry[]) => <span className="inline-flex min-h-6 items-center gap-2"><Loader2 aria-hidden className={`${dsIcon.md} animate-spin motion-reduce:animate-none`} />{entries.map(entry => <span key={entry.libraryId} className="inline-flex items-center gap-1">{syncing.current.has(entry.libraryId) ? `Syncing ${entry.name} isn't confirmed yet.` : `The change to ${entry.name} isn't confirmed yet.`}<V2Button look="line" onClick={() => void checkPending(entry.libraryId)}>Check result</V2Button></span>)}</span>;
  return <section aria-label="Spreadsheets" className="hub-sheets-library settings-compact-page min-w-0">
    {importDraft ? <DraftDetail draft={importDraft} bank={bank} fields={fields} adding={adding} onChange={setImportDraft} onDiscard={discardDraft} onAdd={() => addDraft(importDraft)} />
    : openId && open ? (<SheetDetail key={openId} sheet={open} onBack={back} onMenu={action => menu(openId, action)} onVersion={() => rows.version(openId)}>
      {pendingLibraries.includes(openId) && open && <div className="mb-2">{pendingNote([catalog.filter(item => item.libraryId === openId)[0]])}</div>}
      {draft ? <SheetDetailGrid sheet={open} document={draft.document} fields={fields} onMap={(worksheet, patch) => void saveMapping(worksheet, patch)} onCopy={copyAll} copying={copying} />
        : openError ? <Grey className="ds-text-ui">This spreadsheet couldn't be opened. <V2Button look="plain" onClick={back}>Back</V2Button></Grey>
        : <SheetDetailGridSkeleton name={open.name} />}
    </SheetDetail>) : <>
      <PageHeading title="Spreadsheets" description={pending.length ? pendingNote(pending as WorkbookLibraryEntry[]) : undefined} actions={importMenu} />
      <div>{catalogError ? <FailureNotice sentence="Couldn't load spreadsheets." action={{ label: 'Retry', onClick: () => void adapter.refreshCatalog() }} />
        : catalogLoading ? <SheetsSkeleton />
        : sheets.length === 0 ? <EmptyState title="No spreadsheets yet" action={importMenu} />
        : <div className="ds-table-list"><div className="ds-toolbar-row mb-5 flex items-center gap-2"><SearchInput aria-label="Search spreadsheets" placeholder="Search spreadsheets" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} className="min-w-0 flex-1" />
            <TagFilter groups={groups} value={activeFilter} onChange={setFilter} /></div>
          {tables.length ? tables.map(table => <SheetTable key={table.title} title={table.title} sheets={table.items} actions={rows} limit={table.title === 'Spreadsheets' ? CREATED_ROWS : undefined} />)
            : <Grey className="ds-text-ui">No spreadsheets match.</Grey>}
        </div>}</div>
    </>}
    {dialog && target && <SheetDialog kind={dialog.kind} sheet={target} deleteReady={!catalogLoading && !catalogRefreshing && !catalogError} onClose={() => setDialog(undefined)} actions={{
      rename: name => void change(target.id, { kind: 'rename', name }),
      clone: async name => {
        const result = await adapter.cloneLibrary(target.id, { name });
        if (result.state === 'confirmed') { toast({ tone: 'success', title: `Cloned ${target.name}` }); return undefined; }
        return result.message;
      },
      link: url => void change(target.id, { kind: 'link', url }, `Linked ${target.name}`),
      useVersion: versionId => void change(target.id, { kind: 'use-version', versionId }),
      createVersion: (name, from) => void change(target.id, { kind: 'create-version', name, from, useNow: false },
        from.kind === 'sharepoint' ? 'Created the version' : `Created ${name}`, "Couldn't create the version"),
      renameVersion: (versionId, name) => void change(target.id, { kind: 'rename-version', versionId, name }, `Renamed to ${name}`, "Couldn't rename the version"),
      canDeleteVersion: async versionId => {
        const refreshed = await adapter.refreshCatalog();
        if (refreshed?.state !== 'ready') return false;
        const entry = refreshed.catalog.find(item => item.libraryId === target.id && !item.state.removed);
        return entry !== undefined && sheetOf(entry).versions.find(version => version.id === versionId)?.inUse === false;
      },
      deleteVersion: versionId => void change(target.id, { kind: 'delete-version', versionId }, 'Deleted the version', "Couldn't delete the version"),
      remove: () => void change(target.id, { kind: 'remove' }).then(removed => { if (removed && openId === target.id) setOpenId(undefined); }),
    }} />}
    {sharePoint && <SharePointImport onClose={() => setSharePoint(false)} onAdd={addSharePoint} />}
  </section>;
}
