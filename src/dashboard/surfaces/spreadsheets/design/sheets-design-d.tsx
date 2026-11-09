import { useEffect, useState, type ReactNode } from 'react';
import { Check, Download, MoreHorizontal } from 'lucide-react';
import { Badge, Button, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Drawer, DrawerContent, IconButton, dsFocus, useToasts } from '../../../ds/ui.js';
import { formatInstantDate } from '../../../lib/date-format.js';
import { SpreadsheetVersions } from '../spreadsheet-versions.js';
import { ActionDialog, FileMenu, Section, type Actions, type DialogKind } from './sheets-design-page.js';
import { ColumnMapping } from './sheets-design-columns.js';
import { IMPORT_FILE, REFERENCE_SHEETS, libraryEntry, sheetSamples, sheetsOther, sheetsReferences, sheetsResults, type ColumnMatch, type Reference, type ResultFile, type ResultGroup, type SheetFile } from './sheets-design-fixtures.js';
import { FilePickRow, SheetsImportDialog } from './sheets-design-import.js';
import { sheetsParam, sheetsScenario } from './sheets-design-mode.js';
import '../../run-start/launch-presentation.css';

const noop = async () => ({ state: 'confirmed' as const });
const when = (iso: string) => formatInstantDate(iso);
const ROWS = 'grid items-center gap-x-4 px-3 py-2.5 text-body';
const COLS = 'grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)_64px_92px_150px_130px]';
const COLS_CHECK = 'grid-cols-[22px_minmax(0,1.4fr)_minmax(0,1.3fr)_64px_92px_150px_130px]';
const frame = 'overflow-hidden rounded-[10px] border border-ui-stroke';
const NEEDS = [{ key: 'eid', need: 'EID' }, { key: 'person', need: 'Name' }] as const;
type Key = (typeof NEEDS)[number]['key'];

const Dot = () => <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-[var(--warning)]" />;
const missingMatches = (file: SheetFile) => NEEDS.filter(item => !file[item.key]?.header);
const needsText = (file: SheetFile) => `Needs ${missingMatches(file).map(item => `${item.need === 'EID' ? 'an' : 'a'} ${item.need} column`).join(' and ')}`;

function ListHead({ cells, check }: { cells: readonly string[]; check?: ReactNode }) {
  return <div className={`${ROWS} ${check ? COLS_CHECK : COLS} border-b border-ui-stroke bg-ui-table text-caption text-ui-muted`}>{check}{cells.map((cell, index) => <span key={index}>{cell}</span>)}<span className={cells.length > 4 ? '' : 'col-span-2'} /></div>;
}
function ListRow({ lead, sub, second, rows, updated, status, end, check, onActivate }: { lead: ReactNode; sub?: ReactNode; second?: ReactNode; rows?: ReactNode; updated?: ReactNode; status?: ReactNode; end?: ReactNode; check?: ReactNode; onActivate?: () => void }) {
  const keys = onActivate ? { tabIndex: 0, onKeyDown: (event: { key: string; target: unknown; currentTarget: unknown; preventDefault: () => void }) => { if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { event.preventDefault(); onActivate(); } } } : {};
  return <div onClick={onActivate} {...keys} className={`${ROWS} ${check ? COLS_CHECK : COLS} border-t border-ui-stroke first:border-t-0 ${onActivate ? `cursor-pointer hover:bg-ui-hover ${dsFocus}` : ''}`}>{check && <div onClick={event => event.stopPropagation()}>{check}</div>}
    <div className="min-w-0"><div className="truncate font-medium">{lead}</div>{sub && <div className="text-caption text-ui-muted">{sub}</div>}</div>
    <div className="min-w-0">{second}</div><span className="tabular-nums">{rows}</span><span>{updated}</span>{status !== undefined && <div className="min-w-0">{status}</div>}<div className={`flex items-center justify-end gap-1 ${status === undefined ? 'col-span-2' : ''}`} onClick={event => event.stopPropagation()}>{end}</div>
  </div>;
}

function UsedList({ items, sync, actions, onOpen, onReplace }: { items: readonly Reference[]; sync: string | null; actions: Actions; onOpen: (id: string, columns: boolean) => void; onReplace: (id: string) => void }) {
  return <div className={frame} role="table" aria-label="Used by workflows"><ListHead cells={['Reference', 'Current file', 'Rows', 'Updated', 'Status']} />{items.map(item => {
    const file = item.file, broken = file ? missingMatches(file).length > 0 : false;
    const caption = file?.sharePoint && sync === 'ok' ? <span className="text-caption text-ui-muted">Synced 5 min ago</span> : null;
    const status = !file ? <span className="flex items-center gap-1.5 whitespace-nowrap text-caption"><Dot />Missing</span>
      : broken ? <span className="flex items-center gap-1.5 whitespace-nowrap text-caption"><Dot />{needsText(file)}</span>
      : file.sharePoint && sync === 'failed' ? <span className="flex items-center gap-1.5 whitespace-nowrap text-caption"><Dot />Sync failed</span> : <span className="text-caption text-ui-muted">Ready</span>;
    return <ListRow key={item.id} onActivate={file ? () => onOpen(item.id, broken) : undefined} lead={item.title}
      second={file ? <><div className="truncate" title={file.name}>{file.name}</div>{caption}</> : <span className="text-ui-muted">No roster yet</span>}
      rows={file?.rows.toLocaleString()} updated={file && when(file.updatedAt)} status={status}
      end={file ? <FileMenu file={file} kind="reference" actions={actions} label={file.name} onReplace={() => onReplace(item.id)} /> : <Button variant="primary" onClick={() => actions.importFor(item.id)}>Import a roster</Button>} />;
  })}</div>;
}

function ResultsList({ groups, actions }: { groups: readonly ResultGroup[]; actions: Actions }) {
  const [earlier, setEarlier] = useState<ResultGroup>();
  if (!groups.length) return <p className="hub-sheets-empty rounded-[10px] border border-dashed border-ui-stroke">Workbooks made by workflows will appear here, one for each run.</p>;
  const asOpen = (file: ResultFile) => actions.open({ id: file.id, name: file.name, rows: 0, updatedAt: file.createdAt });
  const download = (file: ResultFile) => <IconButton label={`Download ${file.name}`} icon={<Download size={16} />} />;
  return <div className={frame} role="table" aria-label="Results"><ListHead cells={['Workflow', 'Newest workbook', '', 'Created']} />{groups.map(group => {
    const [newest, ...older] = group.files;
    return <ListRow key={group.workflow} lead={group.workflow} sub={newest.run} second={newest.name} updated={when(newest.createdAt)} onActivate={() => asOpen(newest)}
      end={<>{download(newest)}{older.length > 0 && <DropdownMenu><DropdownMenuTrigger render={<IconButton label={`Actions for ${newest.name}`} icon={<MoreHorizontal size={16} />} />} /><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setEarlier(group)}>Earlier results ({older.length})</DropdownMenuItem></DropdownMenuContent></DropdownMenu>}</>} />;
  })}
    <Dialog open={!!earlier} onOpenChange={open => { if (!open) setEarlier(undefined); }}><DialogContent className="launch-design" size="md" title="Earlier results" description={earlier?.workflow}>
      <DialogBody><ul className="divide-y divide-ui-stroke rounded-[7px] border border-ui-stroke">{earlier?.files.slice(1).map(file => <li key={file.id} className="flex items-center gap-3 px-3 py-2">
        <button type="button" className={`min-w-0 flex-1 rounded-[5px] text-left hover:bg-ui-hover ${dsFocus}`} onClick={() => asOpen(file)}><span className="block truncate text-body font-medium">{file.name}</span><span className="block text-caption text-ui-muted">{file.run}, {when(file.createdAt)}</span></button>{download(file)}</li>)}</ul></DialogBody>
      <DialogFooter><Button variant="muted" onClick={() => setEarlier(undefined)}>Close</Button></DialogFooter>
    </DialogContent></Dialog></div>;
}

function OtherList({ files, sync, actions }: { files: readonly SheetFile[]; sync: string | null; actions: Actions }) {
  const [selection, setSelection] = useState<string[]>([]);
  const selected = files.filter(file => selection.includes(file.id));
  if (!files.length) return <p className="hub-sheets-empty rounded-[10px] border border-dashed border-ui-stroke">Imports that no workflow uses will appear here.</p>;
  return <div className={frame}>
    {selected.length > 0 && <div className="flex items-center gap-2 border-b border-ui-stroke bg-ui-table px-3 py-2 text-body"><span className="flex-1">{selected.length} selected</span><Button disabled={selected.length < 2} onClick={() => actions.dialog('merge', selected)}>Merge</Button><Button onClick={() => actions.dialog('remove', selected)}>Remove</Button><Button onClick={() => setSelection([])}>Clear</Button></div>}
    <div role="table" aria-label="Other spreadsheets"><ListHead cells={['Spreadsheet', 'Source', 'Rows', 'Updated']} check={<Checkbox label={<span className="sr-only">Select all spreadsheets</span>} checked={selection.length === files.length ? true : selection.length ? 'indeterminate' : false} onCheckedChange={checked => setSelection(checked ? files.map(file => file.id) : [])} />} />
      {files.map(file => <ListRow key={file.id} check={<Checkbox label={<span className="sr-only">Select {file.name}</span>} checked={selection.includes(file.id)} onCheckedChange={checked => setSelection(current => checked ? [...current, file.id] : current.filter(id => id !== file.id))} />}
        lead={<span title={file.name}>{file.name}</span>} onActivate={() => actions.open(file)}
        second={file.sharePoint ? <><div>SharePoint</div>{sync === 'failed' ? <span className="flex items-center gap-1.5 text-caption text-ui-muted"><Dot />Sync failed</span> : sync === 'ok' ? <span className="text-caption text-ui-muted">Synced 5 min ago</span> : null}</> : 'This Mac'} rows={file.rows.toLocaleString()} updated={when(file.updatedAt)}
        end={<FileMenu file={file} kind="other" actions={actions} label={file.name} />} />)}
    </div></div>;
}

function ReferenceDrawer({ item, focusColumns, onClose, onSave, onReplace }: { item: Reference | undefined; focusColumns: boolean; onClose: () => void; onSave: (id: string, picks: Partial<Record<Key, string>>) => void; onReplace: (id: string) => void }) {
  const file = item?.file, sheet = item ? REFERENCE_SHEETS[item.id] : undefined;
  const initial = { eid: file?.eid?.header ?? '', person: file?.person?.header ?? '' };
  const [values, setValues] = useState<Record<string, string>>(initial);
  useEffect(() => { if (focusColumns) document.getElementById('sheets-drawer-columns')?.scrollIntoView({ block: 'start' }); }, [focusColumns, item?.id]);
  const entry = file && item ? libraryEntry(file, 'reference') : undefined;
  const changed = values.eid !== initial.eid || values.person !== initial.person, complete = values.eid !== '' && values.person !== '';
  return <Drawer open={!!item} onOpenChange={open => { if (!open) onClose(); }}><DrawerContent title={item?.title ?? ''} description={item ? `${item.workflow} looks people up here.` : undefined} size="560px">
    {item && file && sheet && entry && <div className="flex h-full min-h-0 flex-col text-body">
      <div className="grid min-h-0 flex-1 content-start gap-6 overflow-y-auto p-6">
        <section aria-label="File"><dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5"><dt className="text-ui-muted">File</dt><dd className="font-medium">{file.name}</dd><dt className="text-ui-muted">Source</dt><dd>{file.sharePoint ? 'SharePoint' : 'This Mac'}</dd><dt className="text-ui-muted">Rows</dt><dd>{file.rows.toLocaleString()}</dd><dt className="text-ui-muted">Updated</dt><dd>{when(file.updatedAt)}</dd></dl></section>
        <section aria-label="Preview"><h3 className="mb-2 text-title font-semibold">Preview</h3><div className="overflow-hidden rounded-[7px] border border-ui-stroke"><table className="w-full text-caption"><thead><tr className="bg-ui-table text-left text-ui-muted">{sheet.headers.map(name => <th key={name} className="px-2.5 py-1.5 font-medium">{name}</th>)}</tr></thead><tbody>{sheet.rows.map((row, index) => <tr key={index} className="border-t border-ui-stroke">{row.map((cell, column) => <td key={column} className="whitespace-nowrap px-2.5 py-1">{cell}</td>)}</tr>)}</tbody></table></div><p className="mt-1.5 text-caption text-ui-muted">First 8 of {file.rows.toLocaleString()} rows.</p></section>
        <section id="sheets-drawer-columns" aria-label="Columns"><h3 className="mb-1 text-title font-semibold">Columns</h3><p className="mb-3 text-caption text-ui-muted">Choose the column that holds each value {item.workflow} needs.</p>
          <ColumnMapping needs={NEEDS.map(entry => ({ key: entry.key, label: entry.need }))} headers={sheet.headers} samples={header => sheetSamples(sheet, header)} values={values} onChange={(key, header) => setValues(current => ({ ...current, [key]: header }))} /></section>
        <section aria-label="Versions"><h3 className="mb-2 text-title font-semibold">Versions</h3><ul className="divide-y divide-ui-stroke rounded-[7px] border border-ui-stroke">{entry.state.versions.toReversed().map(version => <li key={version.id} className="flex items-center justify-between gap-3 px-3 py-2"><span>{version.name}<span className="block text-caption text-ui-muted">{when(version.savedAt)}</span></span>{version.id === entry.state.selectedVersionId && <Badge>In use</Badge>}</li>)}</ul></section>
      </div>
      <div className="flex shrink-0 items-center justify-between gap-2 border-t border-ui-stroke px-6 py-3"><div className="flex gap-2"><Button onClick={() => onReplace(item.id)}>Replace</Button><Button>Open</Button><Button>Download</Button></div><Button variant="primary" disabled={!changed || !complete} onClick={() => onSave(item.id, { eid: values.eid, person: values.person })}>Save columns</Button></div>
    </div>}
  </DrawerContent></Drawer>;
}

function ReplaceDialog({ item, onClose, onConfirm }: { item: Reference | undefined; onClose: () => void; onConfirm: (id: string) => void }) {
  const [checked, setChecked] = useState(false);
  const close = () => { setChecked(false); onClose(); };
  return <Dialog open={!!item} onOpenChange={open => { if (!open) close(); }}><DialogContent className="launch-design" size="lg" title={`Replace ${item?.title ?? ''}`} description={checked ? 'Step 2 of 2' : 'Step 1 of 2'}>
    <DialogBody>{!checked ? <FilePickRow title="New file" hint="Excel or CSV file" onFile={() => setChecked(true)} /> : <div className="grid gap-4">
      <div className="flex items-center gap-2 rounded-[7px] border border-ui-stroke bg-ui-table px-3 py-2"><span className="min-w-0 flex-1 truncate">{IMPORT_FILE.name}</span><span className="text-caption text-ui-muted">{IMPORT_FILE.rows} rows</span></div>
      <ul className="grid gap-1.5">{['EID column: Employee ID', 'Name column: Full name'].map(line => <li key={line} className="flex items-center gap-2"><Check size={14} aria-hidden />{line}</li>)}</ul>
      <p className="text-body text-ui-muted">The current file {item?.file?.name} is kept as a version. {item?.workflow} uses the new file for lookups from now on.</p></div>}</DialogBody>
    <DialogFooter><Button variant="muted" onClick={close}>Cancel</Button>{checked && <Button variant="primary" onClick={() => { onConfirm(item!.id); close(); }}>Replace file</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}

export function SheetsDesignD() {
  const scenario = sheetsScenario(), sync = sheetsParam('relaySheetsSync'), dropped = sheetsParam('relaySheetsMissing');
  const [refs, setRefs] = useState<readonly Reference[]>(() => sheetsReferences(scenario).map(item => item.id === dropped ? { ...item, file: null } : item));
  const results = sheetsResults(scenario), others = sheetsOther(scenario);
  const { toast } = useToasts();
  const [drawer, setDrawer] = useState<{ id: string; columns: boolean }>();
  const [replacing, setReplacing] = useState<string>();
  const [importOpen, setImportOpen] = useState(false), [target, setTarget] = useState<string>();
  const [added, setAdded] = useState<readonly SheetFile[]>([]);
  const [versions, setVersions] = useState<ReturnType<typeof libraryEntry> | null>(null);
  const [dialog, setDialog] = useState<{ kind: DialogKind; files: readonly SheetFile[] }>();
  useEffect(() => { if (sync === 'failed') toast({ tone: 'danger', title: "Couldn't sync Example contact roster.xlsx", description: 'SharePoint did not answer. Relay keeps using the last synced version.' }); }, [sync, toast]);
  const update = (id: string, change: (file: SheetFile) => SheetFile) => setRefs(current => current.map(item => item.id === id && item.file ? { ...item, file: change(item.file) } : item));
  const actions: Actions = { versions: (file, kind) => setVersions(libraryEntry(file, kind)), dialog: (kind, files) => setDialog({ kind, files }), open: () => undefined, importFor: id => { setTarget(id); setImportOpen(true); } };
  const match = (label: string, header: string): ColumnMatch => ({ label, header });
  const saveColumns = (id: string, picks: Partial<Record<Key, string>>) => { update(id, file => ({ ...file, eid: picks.eid ? match('EID column', picks.eid) : file.eid, person: picks.person ? match('Name column', picks.person) : file.person })); setDrawer(undefined); toast({ tone: 'success', title: 'Columns saved' }); };
  const replaced = (id: string) => update(id, file => ({ ...file, name: IMPORT_FILE.name, rows: IMPORT_FILE.rows, updatedAt: '2026-11-08T17:30:00Z' }));
  const imported = () => { const made = { id: target ?? `imported-${added.length + 1}`, name: IMPORT_FILE.name, rows: IMPORT_FILE.rows, updatedAt: '2026-11-08T17:30:00Z', eid: match('EID column', 'Employee ID'), person: match('Name column', 'Full name') }; if (target) setRefs(current => current.map(item => item.id === target ? { ...item, file: made } : item)); else setAdded(current => [...current, made]); };
  const head = <div className="mb-6 flex items-center justify-between gap-4"><div><h1>Spreadsheets</h1><p className="hub-sheets-intro !mb-0">Rosters your workflows look people up in, and the workbooks they make.</p></div>
    <div className="flex items-center gap-2"><Button variant="primary" onClick={() => { setTarget(undefined); setImportOpen(true); }}>Import spreadsheet</Button><DropdownMenu><DropdownMenuTrigger render={<IconButton label="More spreadsheet actions" icon={<MoreHorizontal size={16} />} />} /><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => undefined}>Create type</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>;
  return <section aria-label="Spreadsheets" className="spreadsheet-workspace settings-reference-page hub-sheets-library min-w-0 text-body">
    {head}
    <Section title="Used by workflows"><UsedList items={refs} sync={sync} actions={actions} onOpen={(id, columns) => setDrawer({ id, columns })} onReplace={setReplacing} /></Section>
    <Section title="Results"><ResultsList groups={results} actions={actions} /></Section>
    <Section title="Other spreadsheets"><OtherList files={[...others, ...added]} sync={sync} actions={actions} /></Section>
    <ReferenceDrawer key={drawer?.id ?? 'closed'} item={refs.find(item => item.id === drawer?.id)} focusColumns={drawer?.columns ?? false} onClose={() => setDrawer(undefined)} onSave={saveColumns} onReplace={id => { setDrawer(undefined); setReplacing(id); }} />
    <ReplaceDialog key={replacing ?? 'none'} item={refs.find(item => item.id === replacing)} onClose={() => setReplacing(undefined)} onConfirm={replaced} />
    <SheetsImportDialog key={String(importOpen)} open={importOpen} onOpenChange={setImportOpen} startStep="pick" onDone={imported} />
    <SpreadsheetVersions entry={versions} pending={false} onClose={() => setVersions(null)} onDownload={async () => undefined} onChange={noop} onCheck={noop} />
    <ActionDialog state={dialog} onClose={() => setDialog(undefined)} />
  </section>;
}
