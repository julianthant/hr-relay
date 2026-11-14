import { useMemo, useRef, useState } from 'react';
import { closeDraft, editMapping, importWorkbook, pendingImportName } from './sheets-v2-writes.js';
import { PageHeading, SearchInput, useToasts } from '../../../ds/ui.js';
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
import { SheetTable, type RowActions } from './sheets-v2-list.js';
import { useNarrow } from './sheets-v2-narrow.js';
import { Grey, V2Button, type MenuAction } from './sheets-v2-ui.js';
import '../spreadsheet-library.css';

const CREATED_ROWS = 8;

/** The Spreadsheets page on the served library. */
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
  const settled = async (work: Promise<LibraryChangeResult>, done?: string) => {
    const result = await work;
    if (result.state === 'confirmed') { if (done) toast({ tone: 'success', title: done }); return true; }
    toast({ tone: 'danger', title: "Couldn't save the change", description: result.message }); return false;
  };
  const change = (id: string, edit: WorkbookLibraryAction['change'], done?: string) => {
    const entry = catalog.find(item => item.libraryId === id);
    return entry ? settled(adapter.changeLibrary(entry, edit), done) : Promise.resolve(false);
  };
  const download = async (id: string) => {
    const sheet = get(id);
    try { if (sheet) saveSpreadsheetDownload(await spreadsheetDownload(decodeEditableWorkbook((await adapter.readNamedVersion(id, sheet.currentVersionId)).workbook))); }
    catch { toast({ tone: 'danger', title: "Couldn't download the spreadsheet" }); }
  };
  const menu = (id: string, action: MenuAction) => {
    const sheet = get(id);
    if (!sheet) return;
    if (action === 'sync') void change(id, { kind: 'sync' }, `Synced ${sheet.name}`);
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
      toast({ tone: 'danger', title: "Your column changes aren't saved", description: 'Change a column to try again, or choose Back again to discard them.' });
    });
  };
  const saveMapping = (worksheet: string, patch: Record<string, string | null>) => {
    if (!openId) return;
    warned.current = false;
    void editMapping(adapter, openId, worksheet, patch).then(({ result, latest }) => {
      if (result && result.state !== 'confirmed' && latest) toast({ tone: 'danger', title: "Couldn't save the columns", description: result.reason });
    });
  };
  const add = async (document: EditableWorkbook) => {
    const outcome = await importWorkbook(adapter, document);
    if (outcome.state === 'added') { toast({ tone: 'success', title: `Added ${outcome.name}` }); return true; }
    toast({ tone: 'danger', title: outcome.state === 'pending' ? `Still confirming ${pendingImportName(adapter)}` : "Couldn't add the spreadsheet",
      description: outcome.state === 'pending' ? 'Choose Add to library again to check it. It is not added twice.' : outcome.reason });
    return false;
  };
  const checkPending = async (id: string) => {
    const result = await adapter.settleLibrary(id);
    toast(result.state === 'confirmed' ? { tone: 'success', title: 'The change went through' } : { tone: 'danger', title: 'The change is not confirmed yet', description: result.message });
  };

  const groups = { workflows: workflowTags(sheets), tags: operatorTags(sheets) };
  const visible = useMemo(() => newestFirst(sheets).filter(sheet => (!filter.length || filter.some(tag => tagsOf(sheet).includes(tag))) && sheet.name.toLowerCase().includes(query.trim().toLowerCase())), [sheets, filter, query]);
  const tables = (['Pinned', 'SharePoint', 'Created'] as const).map(title => ({ title, items: visible.filter(sheet => tableOf(sheet) === title) })).filter(table => table.items.length);
  const target = dialog && get(dialog.id);
  const open = openId ? get(openId) : undefined;

  const pending = pendingLibraries.map(id => catalog.find(item => item.libraryId === id)).filter(Boolean);
  return <section aria-label="Spreadsheets" className="hub-sheets-library settings-compact-page min-w-0">
    {pending.map(entry => <Grey key={entry!.libraryId} className="mb-3 text-[13px]">A change to {entry!.name} isn't confirmed yet. <V2Button look="plain" onClick={() => void checkPending(entry!.libraryId)}>Check result</V2Button></Grey>)}
    {openId && open ? (draft ? <SheetDetail key={openId} sheet={open} document={draft.document} fields={fields} onBack={back} onMenu={action => menu(openId, action)} onVersion={() => setDialog({ kind: 'rollback', id: openId })} onMap={(worksheet, patch) => void saveMapping(worksheet, patch)} />
      : <Grey className="text-[13px]">{openError ? "This spreadsheet couldn't be opened." : 'Opening…'} <V2Button look="plain" onClick={back}>Back</V2Button></Grey>) : <>
      <PageHeading title="Spreadsheets" description="Reference lists your runs look people up in." actions={<V2Button disabled={catalogLoading || !!catalogError} onClick={() => setImporting(true)}>Import</V2Button>} />
      <div className="ds-toolbar-row mb-5 flex items-center gap-2"><SearchInput aria-label="Search spreadsheets" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} className="w-[260px]" />{(groups.workflows.length > 0 || groups.tags.length > 0) && <TagFilter groups={groups} value={filter} onChange={setFilter} />}</div>
      <div ref={listRef}>{catalogError ? <Grey className="text-[13px]">Spreadsheets couldn't be loaded. <V2Button look="plain" onClick={() => void adapter.refreshCatalog()}>Check again</V2Button></Grey>
        : catalogLoading ? <Grey className="text-[13px]">Loading spreadsheets…</Grey>
        : tables.length ? tables.map(table => <SheetTable key={table.title} title={table.title} sheets={table.items} narrow={narrow} actions={rows} limit={table.title === 'Created' ? CREATED_ROWS : undefined} />)
        : <Grey className="text-[13px]">{sheets.length ? 'No spreadsheets match.' : 'No spreadsheets yet. Choose Import to add one.'}</Grey>}</div>
    </>}
    {dialog && target && <SheetDialog kind={dialog.kind} sheet={target} onClose={() => setDialog(undefined)} actions={{
      rename: name => void change(target.id, { kind: 'rename', name }), link: url => void change(target.id, { kind: 'link', url }, `Linked ${target.name}`),
      tags: tags => void change(target.id, { kind: 'set-tags', tags: [...tags] }),
      rollback: versionId => void change(target.id, { kind: 'use-version', versionId }),
      remove: () => void change(target.id, { kind: 'remove' }).then(removed => { if (removed && openId === target.id) setOpenId(undefined); }),
    }} />}
    {importing && <ImportDialog fields={fields} onClose={() => setImporting(false)} onAdd={add} />}
  </section>;
}
