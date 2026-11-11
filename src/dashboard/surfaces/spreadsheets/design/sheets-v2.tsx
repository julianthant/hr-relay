import { useMemo, useState } from 'react';
import { PageHeading, SearchInput, useToasts } from '../../../ds/ui.js';
import { useSpreadsheetWiringAdapter, type LibraryChangeResult } from '../../../state/spreadsheet-wiring-adapter.js';
import { decodeEditableWorkbook } from '../../../../models/dashboard/workbooks.js';
import type { WorkbookLibraryAction } from '../../../../models/dashboard/workbook-library.js';
import type { EditableWorkbook } from '../../../../rules/spreadsheets/workbook-io.js';
import { saveSpreadsheetDownload, spreadsheetDownload } from '../spreadsheet-chat-registration-model.js';
import { TagFilter } from './sheets-v2-tagfilter.js';
import { fieldsOf, newestFirst, sheetOf, tableOf, tagsOf, withMapping, workflowTags } from './sheets-v2-model.js';
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
  const { adapter, catalog, compatibility, catalogLoading, catalogError, openError, draft } = wiring;
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
    else setDialog({ kind: action, id });
  };
  const rows: RowActions = { open: setOpenId, version: id => setDialog({ kind: 'rollback', id }), menu, logs: sheet => { if (sheet.run) onOpenRun?.(sheet.run.id, sheet.run.day); } };
  const back = () => { if (openId) adapter.close(openId); setOpenId(undefined); };
  const saveMapping = async (worksheet: string, patch: Record<string, string | null>) => {
    if (!openId || !draft) return;
    const next: EditableWorkbook = { ...draft.document, sheets: draft.document.sheets.map(item => item.id === worksheet ? withMapping(item, patch) : item) };
    adapter.change(openId, next, true);
    const result = await adapter.save(openId, next);
    if (result.state !== 'confirmed') toast({ tone: 'danger', title: "Couldn't save the columns", description: result.reason });
  };
  const add = async (document: EditableWorkbook) => {
    const key = adapter.create(document), result = await adapter.save(key, document);
    if (result.state === 'confirmed') { toast({ tone: 'success', title: `Added ${document.name}` }); return true; }
    adapter.close(key); toast({ tone: 'danger', title: "Couldn't add the spreadsheet", description: result.reason }); return false;
  };

  const groups = { workflows: workflowTags(sheets), tags: [] };
  const visible = useMemo(() => newestFirst(sheets).filter(sheet => (!filter.length || filter.some(tag => tagsOf(sheet).includes(tag))) && sheet.name.toLowerCase().includes(query.trim().toLowerCase())), [sheets, filter, query]);
  const tables = (['SharePoint', 'Created'] as const).map(title => ({ title, items: visible.filter(sheet => tableOf(sheet) === title) })).filter(table => table.items.length);
  const target = dialog && get(dialog.id);
  const open = openId ? get(openId) : undefined;

  return <section aria-label="Spreadsheets" className="hub-sheets-library settings-compact-page min-w-0">
    {openId && open ? (draft ? <SheetDetail key={openId} sheet={open} document={draft.document} fields={fields} onBack={back} onMenu={action => menu(openId, action)} onVersion={() => setDialog({ kind: 'rollback', id: openId })} onMap={(worksheet, patch) => void saveMapping(worksheet, patch)} />
      : <Grey className="text-[13px]">{openError ? "This spreadsheet couldn't be opened." : 'Opening…'} <V2Button look="plain" onClick={back}>Back</V2Button></Grey>) : <>
      <PageHeading title="Spreadsheets" description="Reference lists your runs look people up in." actions={<V2Button disabled={catalogLoading || !!catalogError} onClick={() => setImporting(true)}>Import</V2Button>} />
      <div className="ds-toolbar-row mb-5 flex items-center gap-2"><SearchInput aria-label="Search spreadsheets" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} className="w-[260px]" />{groups.workflows.length > 0 && <TagFilter groups={groups} value={filter} onChange={setFilter} />}</div>
      <div ref={listRef}>{catalogError ? <Grey className="text-[13px]">Spreadsheets couldn't be loaded. <V2Button look="plain" onClick={() => void adapter.refreshCatalog()}>Check again</V2Button></Grey>
        : catalogLoading ? <Grey className="text-[13px]">Loading spreadsheets…</Grey>
        : tables.length ? tables.map(table => <SheetTable key={table.title} title={table.title} sheets={table.items} narrow={narrow} actions={rows} limit={table.title === 'Created' ? CREATED_ROWS : undefined} />)
        : <Grey className="text-[13px]">{sheets.length ? 'No spreadsheets match.' : 'No spreadsheets yet. Choose Import to add one.'}</Grey>}</div>
    </>}
    {dialog && target && <SheetDialog kind={dialog.kind} sheet={target} onClose={() => setDialog(undefined)} actions={{
      rename: name => void change(target.id, { kind: 'rename', name }), link: url => void change(target.id, { kind: 'link', url }, `Linked ${target.name}`),
      rollback: versionId => void change(target.id, { kind: 'use-version', versionId }),
      remove: () => void change(target.id, { kind: 'remove' }).then(removed => { if (removed && openId === target.id) setOpenId(undefined); }),
    }} />}
    {importing && <ImportDialog fields={fields} onClose={() => setImporting(false)} onAdd={add} />}
  </section>;
}
