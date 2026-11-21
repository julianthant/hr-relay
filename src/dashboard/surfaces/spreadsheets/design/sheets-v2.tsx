import { useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { closeDraft, editMapping, importWorkbook, pendingImportName } from './sheets-v2-writes.js';
import { EmptyState, FailureNotice, PageHeading, SearchInput, Skeleton, TableToolbar, dsIcon, useToasts } from '../../../ds/ui.js';
import { LoadingRegion, SkeletonText } from '../../shared/loading/loading.js';
import { useSpreadsheetWiringAdapter, type LibraryChangeResult } from '../../../state/spreadsheet-wiring-adapter.js';
import { decodeEditableWorkbook } from '../../../../models/dashboard/workbooks.js';
import type { WorkbookLibraryAction } from '../../../../models/dashboard/workbook-library.js';
import type { EditableWorkbook } from '../../../../rules/spreadsheets/workbook-io.js';
import { saveSpreadsheetDownload, spreadsheetDownload } from '../spreadsheet-chat-registration-model.js';
import { TagFilter } from './sheets-v2-tagfilter.js';
import { fieldsOf, newestFirst, operatorTags, sheetOf, tableOf, tagsOf, workflowTags } from './sheets-v2-model.js';
import { SheetDialog, type DialogKind } from './sheets-v2-dialogs.js';
import { SheetDetail } from './sheets-v2-detail.js';
import { ImportDialog } from './sheets-v2-import.js';
import { SheetTable, SheetsSkeleton, type RowActions } from './sheets-v2-list.js';
import { useNarrow } from './sheets-v2-narrow.js';
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
  const { adapter, catalog, compatibility, catalogLoading, catalogError, openError, draft, pendingLibraries } = wiring;
  const [dialog, setDialog] = useState<{ kind: DialogKind; id: string }>();
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<readonly string[]>([]);
  const [query, setQuery] = useState('');
  const [listRef, narrow] = useNarrow<HTMLDivElement>();

  const sheets = useMemo(() => catalog.filter(entry => entry.state.origin.kind !== 'unavailable' && !entry.state.removed).map(sheetOf), [catalog]);
  const fields = useMemo(() => compatibility ? fieldsOf(compatibility) : [], [compatibility]);
  const get = (id: string) => sheets.find(item => item.id === id);
  const syncing = useRef(new Set<string>());
  const settled = async (work: Promise<LibraryChangeResult>, done?: string, failed = "Couldn't save the change") => {
    const result = await work;
    if (result.state === 'confirmed') { if (done) toast({ tone: 'success', title: done }); return true; }
    toast({ tone: 'danger', key: failed, title: failed, description: result.message }); return false;
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
  const rows: RowActions = { open: setOpenId, version: id => setDialog({ kind: 'rollback', id }), menu, logs: sheet => { if (sheet.run) onOpenRun?.(sheet.run.id, sheet.run.day); } };
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
  const add = async (document: EditableWorkbook, tags: readonly string[]) => {
    const outcome = await importWorkbook(adapter, document);
    if (outcome.state === 'added') {
      const created = outcome.libraryId;
      if (tags.length && created) {
        await adapter.refreshCatalog();
        const entry = adapter.snapshot().catalog.find(item => item.libraryId === created);
        if (!entry || !await settled(adapter.changeLibrary(entry, { kind: 'set-tags', tags: [...tags] }))) toast({ tone: 'danger', title: `Added ${outcome.name} without its tags`, description: 'Choose Edit tags on it to add them.' });
      }
      toast({ tone: 'success', title: `Added ${outcome.name}`, description: unusableRowsNote(outcome.rowsWithoutEid) });
      return true;
    }
    toast({ tone: 'danger', title: outcome.state === 'pending' ? `Still confirming ${pendingImportName(adapter)}` : "Couldn't add the spreadsheet",
      description: outcome.state === 'pending' ? 'Choose Add to library again to check.' : outcome.reason });
    return false;
  };
  const addSharePoint = async (request: { url: string; name: string; tags: readonly string[] }) => {
    const result = await adapter.importSharePoint({ source: 'sharepoint', url: request.url, name: request.name, ...(request.tags.length ? { tags: [...request.tags] } : {}) });
    if (result.state === 'confirmed') { toast({ tone: 'success', title: `Added ${request.name}` }); return true; }
    toast({ tone: 'danger', title: "Couldn't add the spreadsheet", description: result.message }); return false;
  };
  const checkPending = async (id: string) => {
    const result = await adapter.settleLibrary(id);
    const what = syncing.current.has(id) ? 'The sync' : 'The change';
    if (result.state === 'confirmed') syncing.current.delete(id);
    toast(result.state === 'confirmed' ? { tone: 'success', title: `${what} went through` } : { tone: 'danger', key: 'sheets-pending', title: `${what} is not confirmed yet`, description: result.message });
  };

  const groups = { workflows: workflowTags(sheets), tags: operatorTags(sheets) };
  const visible = useMemo(() => newestFirst(sheets).filter(sheet => (!filter.length || filter.some(tag => tagsOf(sheet).includes(tag))) && sheet.name.toLowerCase().includes(query.trim().toLowerCase())), [sheets, filter, query]);
  const tables = (['Pinned', 'SharePoint', 'Spreadsheets'] as const).map(title => ({ title, items: visible.filter(sheet => tableOf(sheet) === title) })).filter(table => table.items.length);
  const target = dialog && get(dialog.id);
  const open = openId ? get(openId) : undefined;

  const pending = pendingLibraries.map(id => catalog.find(item => item.libraryId === id)).filter(Boolean);
  return <section aria-label="Spreadsheets" className="hub-sheets-library settings-compact-page min-w-0">
    {openId && open ? (draft ? <SheetDetail key={openId} sheet={open} document={draft.document} fields={fields} onBack={back} onMenu={action => menu(openId, action)} onVersion={() => setDialog({ kind: 'rollback', id: openId })} onMap={(worksheet, patch) => void saveMapping(worksheet, patch)} />
      : openError ? <Grey className="ds-text-ui">This spreadsheet couldn't be opened. <V2Button look="plain" onClick={back}>Back</V2Button></Grey>
      : <LoadingRegion label={`Opening ${open.name}`}><div aria-hidden><SkeletonText className="mb-2 w-48 ds-text-page-title" /><SkeletonText className="mb-5 w-72 ds-text-ui" />{[0, 1, 2, 3].map(index => <Skeleton key={index} className="mb-2 h-9 w-full" />)}</div></LoadingRegion>) : <>
      <PageHeading title="Spreadsheets" description={pending.length ? <span className="inline-flex min-h-6 items-center gap-2"><Loader2 aria-hidden className={`${dsIcon.md} animate-spin motion-reduce:animate-none`} />{pending.map(entry => <span key={entry!.libraryId} className="inline-flex items-center gap-1">{syncing.current.has(entry!.libraryId) ? `Syncing ${entry!.name} isn't confirmed yet.` : `The change to ${entry!.name} isn't confirmed yet.`}<V2Button look="line" onClick={() => void checkPending(entry!.libraryId)}>Check result</V2Button></span>)}</span> : "Reference lists your runs look people up in."} actions={<V2Button disabled={catalogLoading || !!catalogError} onClick={() => setImporting(true)}>Import</V2Button>} />
      <div ref={listRef}>{catalogError ? <FailureNotice sentence="Couldn't load spreadsheets." action={{ label: 'Retry', onClick: () => void adapter.refreshCatalog() }} />
        : catalogLoading ? <SheetsSkeleton narrow={narrow} />
        : sheets.length === 0 ? <EmptyState title="No spreadsheets yet" action={<V2Button onClick={() => setImporting(true)}>Import</V2Button>} />
        : <div className="ds-table-list"><TableToolbar search={<SearchInput variant="field" aria-label="Search spreadsheets" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} />}
            controls={groups.workflows.length > 0 || groups.tags.length > 0 ? <TagFilter groups={groups} value={filter} onChange={setFilter} /> : undefined} />
          {tables.length ? tables.map(table => <SheetTable key={table.title} title={table.title} heading={tables.length > 1 ? table.title : undefined} sheets={table.items} narrow={narrow} actions={rows} limit={table.title === 'Spreadsheets' ? CREATED_ROWS : undefined} />)
            : <Grey className="ds-text-ui">No spreadsheets match.</Grey>}
        </div>}</div>
    </>}
    {dialog && target && <SheetDialog kind={dialog.kind} sheet={target} onClose={() => setDialog(undefined)} actions={{
      rename: name => void change(target.id, { kind: 'rename', name }),
      clone: async name => {
        const result = await adapter.cloneLibrary(target.id, { name });
        if (result.state === 'confirmed') { toast({ tone: 'success', title: `Cloned ${target.name}` }); return undefined; }
        return result.message;
      },
      link: url => void change(target.id, { kind: 'link', url }, `Linked ${target.name}`),
      tags: tags => void change(target.id, { kind: 'set-tags', tags: [...tags] }),
      rollback: versionId => void change(target.id, { kind: 'use-version', versionId }),
      remove: () => void change(target.id, { kind: 'remove' }).then(removed => { if (removed && openId === target.id) setOpenId(undefined); }),
    }} />}
    {importing && <ImportDialog fields={fields} onClose={() => setImporting(false)} onAdd={add} onAddSharePoint={addSharePoint} />}
  </section>;
}
