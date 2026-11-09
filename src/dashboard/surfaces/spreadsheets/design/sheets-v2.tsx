import { useEffect, useMemo, useState } from 'react';
import { SearchInput, useToasts } from '../../../ds/ui.js';
import { TagFilter } from './sheets-v2-tagfilter.js';
import { DATASETS, FIELDS, IMPORT_SHEETS, NOW, guessColumn, initialSheets, newestFirst, tableOf, tagGroups, tagsOf, type FieldKey, type Sheet } from './sheets-v2-model.js';
import { sheetsParam, sheetsScenario } from './sheets-v2-mode.js';
import { SheetDialog, type DialogKind } from './sheets-v2-dialogs.js';
import { SheetDetail } from './sheets-v2-detail.js';
import { ImportDialog } from './sheets-v2-import.js';
import { SheetTable, useNarrow, type RowActions } from './sheets-v2-list.js';
import { Grey, V2Button, type MenuAction } from './sheets-v2-ui.js';
import '../spreadsheet-library.css';

const CREATED_ROWS = 8;
const note = (sheet: Sheet, text: string): Sheet => ({ ...sheet, updatedAt: NOW, versions: [{ n: sheet.versions[0].n + 1, at: NOW, note: text }, ...sheet.versions] });

export function SheetsV2({ onOpenRun }: { onOpenRun?: (runId: string, partitionDay: string) => void }) {
  const { toast } = useToasts();
  const [sheets, setSheets] = useState<readonly Sheet[]>(() => initialSheets(sheetsScenario()));
  const [openId, setOpenId] = useState<string>();
  const [dialog, setDialog] = useState<{ kind: DialogKind; id: string }>();
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<readonly string[]>([]);
  const [query, setQuery] = useState('');
  const [listRef, narrow] = useNarrow<HTMLDivElement>();
  useEffect(() => { if (sheetsParam('relaySheetsSync') === 'failed') toast({ tone: 'danger', title: "Couldn't sync Contact roster", description: 'Relay keeps the last version.' }); }, [toast]);

  const get = (id: string) => sheets.find(item => item.id === id)!;
  const change = (id: string, edit: (sheet: Sheet) => Sheet) => setSheets(current => current.map(item => item.id === id ? edit(item) : item));
  const clone = (source: Sheet) => { const copy: Sheet = { ...source, id: `clone-${sheets.length}`, name: `${source.name} copy`, pinned: false, workflow: undefined, run: undefined, sharePoint: null, from: { id: source.id, version: source.versions[0].n }, createdAt: NOW, updatedAt: NOW, versions: [{ n: 1, at: NOW, note: `Cloned from ${source.name}` }] }; setSheets(current => [...current, copy]); toast({ tone: 'success', title: `Cloned ${source.name}` }); };
  const menu = (id: string, action: MenuAction) => {
    const sheet = get(id);
    if (action === 'pin') change(id, item => ({ ...item, pinned: !item.pinned }));
    else if (action === 'sync') { change(id, item => note(item, 'Synced from SharePoint')); toast({ tone: 'success', title: `Synced ${sheet.name}` }); }
    else if (action === 'clone') clone(sheet);
    else if (action === 'link') setDialog({ kind: 'link', id });
    else if (action === 'merge' || action === 'mergeDelete') setDialog({ kind: action, id });
    else if (action === 'rename') setDialog({ kind: 'rename', id });
    else if (action === 'tags') setDialog({ kind: 'tags', id });
    else if (action === 'delete') setDialog({ kind: 'delete', id });
  };
  const rows: RowActions = { open: setOpenId, version: id => setDialog({ kind: 'rollback', id }), menu, logs: sheet => onOpenRun?.(sheet.run!, sheet.createdAt.slice(0, 10)) };

  const visible = useMemo(() => newestFirst(sheets).filter(sheet => (!filter.length || filter.some(tag => tagsOf(sheet).includes(tag))) && sheet.name.toLowerCase().includes(query.trim().toLowerCase())), [sheets, filter, query]);
  const tables = (['Pinned', 'SharePoint', 'Created'] as const).map(title => ({ title, items: visible.filter(sheet => tableOf(sheet) === title) })).filter(table => table.items.length);
  const target = dialog && sheets.find(item => item.id === dialog.id);
  const groups = tagGroups(sheets);

  return <section aria-label="Spreadsheets" className="hub-sheets-library min-w-0 text-[13px]">
    {openId && sheets.some(item => item.id === openId) ? <SheetDetail key={openId} sheet={get(openId)} sheets={sheets} onBack={() => setOpenId(undefined)} onOpen={setOpenId} onMenu={action => menu(openId, action)} onVersion={() => setDialog({ kind: 'rollback', id: openId })}
      onRuns={name => change(openId, item => ({ ...item, runsSheet: name, mapping: Object.fromEntries(FIELDS.map(f => [f.key, guessColumn(f.key, DATASETS[item.worksheets.find(w => w.name === name)!.data].headers)])) as Record<FieldKey, string | null> }))}
      onMap={patch => change(openId, item => ({ ...item, mapping: { ...item.mapping, ...patch } }))} /> : <>
      <div className="mb-6 flex items-center justify-between gap-4"><div className="min-w-0"><h1 className="sv2-title">Spreadsheets</h1><p className="sv2-desc truncate">Reference lists your runs look people up in.</p></div><V2Button onClick={() => setImporting(true)}>Import</V2Button></div>
      <div className="ds-toolbar-row mb-5 flex items-center gap-2"><SearchInput aria-label="Search spreadsheets" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} onClear={() => setQuery('')} className="w-[260px]" /><TagFilter groups={groups} value={filter} onChange={setFilter} /></div>
      <div ref={listRef}>{tables.length ? tables.map(table => <SheetTable key={table.title} title={table.title} sheets={table.items} all={sheets} narrow={narrow} actions={rows} limit={table.title === 'Created' ? CREATED_ROWS : undefined} />)
        : <Grey className="text-[13px]">{sheets.length ? 'No spreadsheets match.' : 'No spreadsheets yet. Choose Import to add one.'}</Grey>}</div>
    </>}
    {dialog && target && <SheetDialog kind={dialog.kind} sheet={target} sheets={sheets} onClose={() => setDialog(undefined)} actions={{
      rename: name => change(target.id, item => ({ ...item, name })), tags: next => change(target.id, item => ({ ...item, tags: next })),
      link: url => change(target.id, item => note({ ...item, sharePoint: url, pinned: item.pinned }, 'Synced from SharePoint')),
      merge: (into, andDelete) => { change(into.id, item => note(item, `Merged from ${target.name}`)); if (andDelete) { setSheets(current => current.filter(item => item.id !== target.id)); if (openId === target.id) setOpenId(undefined); } toast({ tone: 'success', title: `Merged into ${into.name}` }); },
      rollback: version => change(target.id, item => note(item, `Rolled back to v${version}`)),
      remove: () => { setSheets(current => current.filter(item => item.id !== target.id)); if (openId === target.id) setOpenId(undefined); },
    }} />}
    {importing && <ImportDialog onClose={() => setImporting(false)} onAdd={input => setSheets(current => [...current, { id: `imported-${current.length}`, name: input.name, tags: input.tags, pinned: false, sharePoint: input.sharePoint, from: null, createdAt: NOW, updatedAt: NOW, versions: [{ n: 1, at: NOW, note: input.sharePoint ? 'Synced from SharePoint' : 'Imported' }], mapping: input.mapping, worksheets: IMPORT_SHEETS.map(item => ({ name: item.name, data: item.data })), runsSheet: input.sheetName }])} />}
  </section>;
}
