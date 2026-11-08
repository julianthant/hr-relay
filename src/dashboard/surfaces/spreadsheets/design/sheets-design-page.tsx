import { useState, type ReactNode } from 'react';
import { AlertTriangle, Check, Download, MoreHorizontal } from 'lucide-react';
import { Badge, Button, Card, CardBody, CardFooter, CardHeader, Checkbox, Dialog, DialogBody, DialogContent, DialogFooter, Disclosure, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Field, IconButton, Input, Select, Tab, TabList, TabPanel, Tabs } from '../../../ds/ui.js';
import { formatInstantDate } from '../../../lib/date-format.js';
import { SpreadsheetVersions } from '../spreadsheet-versions.js';
import { libraryEntry, sheetsOther, sheetsReferences, sheetsResults, type Reference, type ResultGroup, type SheetFile } from './sheets-design-fixtures.js';
import { SheetsImportDialog } from './sheets-design-import.js';
import { sheetsScenario, sheetsStep, type SheetsDesign } from './sheets-design-mode.js';

type DialogKind = 'rename' | 'remove' | 'merge' | 'link';
interface Actions { versions: (file: SheetFile, kind: 'reference' | 'other') => void; dialog: (kind: DialogKind, files: readonly SheetFile[]) => void; open: (file: SheetFile) => void; importFor: (referenceId?: string) => void }

const noop = async () => ({ state: 'confirmed' as const });
const when = (iso: string) => formatInstantDate(iso);
const plural = (count: number, one: string) => `${count.toLocaleString()} ${one}${count === 1 ? '' : 's'}`;

function FileMenu({ file, kind, actions, label }: { file: SheetFile; kind: 'reference' | 'other'; actions: Actions; label: string }) {
  return <DropdownMenu><DropdownMenuTrigger render={<IconButton label={`Actions for ${label}`} icon={<MoreHorizontal size={16} />} />} /><DropdownMenuContent align="end">
    <DropdownMenuItem onSelect={() => actions.open(file)}>Open</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => actions.versions(file, kind)}>Versions</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => actions.dialog('rename', [file])}>Rename</DropdownMenuItem>
    {file.sharePoint ? <DropdownMenuItem onSelect={() => undefined}>Sync now</DropdownMenuItem> : <DropdownMenuItem onSelect={() => actions.dialog('link', [file])}>Link to SharePoint</DropdownMenuItem>}
    <DropdownMenuItem onSelect={() => undefined}>Download</DropdownMenuItem>
    <DropdownMenuItem variant="destructive" onSelect={() => actions.dialog('remove', [file])}>Remove</DropdownMenuItem>
  </DropdownMenuContent></DropdownMenu>;
}

function ColumnLine({ match }: { match: NonNullable<SheetFile['eid']> }) {
  return match.header
    ? <li className="flex items-center gap-1.5 whitespace-nowrap text-caption text-ui-muted"><Check size={12} aria-hidden className="shrink-0" />{match.label}: <span className="text-ui-primary">{match.header}</span></li>
    : <li className="flex items-center gap-1.5 whitespace-nowrap text-caption text-ui-danger"><AlertTriangle size={12} aria-hidden className="shrink-0" />{match.label}: not found</li>;
}
const needsCheck = (file: SheetFile) => !file.eid?.header || !file.person?.header;

function ReferenceCard({ item, actions }: { item: Reference; actions: Actions }) {
  const file = item.file;
  return <Card className="h-full"><CardHeader className="items-start justify-between"><div className="min-w-0"><h3 className="text-title font-semibold">{item.title}</h3><p className="text-caption text-ui-muted">{item.note}</p></div>
    {!file ? <Badge tone="warning">Missing</Badge> : needsCheck(file) ? <Badge tone="warning">Check columns</Badge> : <Badge tone="info">Ready</Badge>}</CardHeader>
    <CardBody grow className="grid content-start gap-2 pt-3">
      {file ? <><button type="button" className="truncate text-left text-body font-medium underline-offset-2 hover:underline" onClick={() => actions.open(file)}>{file.name}</button>
        <p className="text-caption text-ui-muted">{plural(file.rows, 'row')} · Updated {when(file.updatedAt)}</p>
        <ul className="grid gap-1">{file.eid && <ColumnLine match={file.eid} />}{file.person && <ColumnLine match={file.person} />}</ul></>
        : <div className="grid gap-2 rounded-[7px] border border-dashed border-ui-stroke p-4 text-center"><p className="text-body text-ui-muted">No roster yet. {item.workflow} cannot look people up.</p><Button variant="primary" className="justify-self-center" onClick={() => actions.importFor(item.id)}>Import a roster</Button></div>}
    </CardBody>
    {file && <CardFooter className="justify-end"><Button onClick={() => actions.importFor(item.id)}>Replace</Button><Button onClick={() => actions.open(file)}>Open</Button><FileMenu file={file} kind="reference" actions={actions} label={file.name} /></CardFooter>}
  </Card>;
}

function ReferenceCards({ items, actions }: { items: readonly Reference[]; actions: Actions }) {
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">{items.map(item => <ReferenceCard key={item.id} item={item} actions={actions} />)}</div>;
}

function ReferenceTable({ items, actions }: { items: readonly Reference[]; actions: Actions }) {
  return <div className="overflow-hidden rounded-[10px] border border-ui-stroke"><table aria-label="Used by workflows" className="hub-sheets-data"><thead><tr><th scope="col" className="!w-[30%]">Reference</th><th scope="col" className="w-[30%]">Current file</th><th scope="col" className="w-[18%]">Columns</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>
    {items.map(item => <tr key={item.id}><td className="!w-[30%]"><strong className="font-medium">{item.title}</strong><span className="hub-sheets-caption">{item.note}</span></td>
      {item.file ? <><td className="!min-w-0"><button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => actions.open(item.file!)}>{item.file.name}</button><span className="hub-sheets-caption">{plural(item.file.rows, 'row')} · Updated {when(item.file.updatedAt)}</span></td>
        <td><ul>{item.file.eid && <ColumnLine match={item.file.eid} />}{item.file.person && <ColumnLine match={item.file.person} />}</ul></td>
        <td><div className="hub-sheets-actions"><Button onClick={() => actions.importFor(item.id)}>Replace</Button><Button onClick={() => actions.open(item.file!)}>Open</Button><FileMenu file={item.file} kind="reference" actions={actions} label={item.file.name} /></div></td></>
        : <><td colSpan={2}><span className="text-ui-muted">Missing. {item.workflow} cannot look people up.</span></td><td><div className="hub-sheets-actions"><Button variant="primary" onClick={() => actions.importFor(item.id)}>Import a roster</Button></div></td></>}
    </tr>)}
  </tbody></table></div>;
}

function ResultRows({ group, actions }: { group: ResultGroup; actions: Actions }) {
  return <ul className="divide-y divide-ui-stroke">{group.files.map(file => <li key={file.id} className="flex items-center gap-3 py-2.5">
    <div className="min-w-0 flex-1"><p className="truncate text-body font-medium">{file.name}</p><p className="text-caption text-ui-muted">{file.run} · {when(file.createdAt)}</p></div>
    <Button onClick={() => actions.open({ id: file.id, name: file.name, rows: 0, updatedAt: file.createdAt })}>Open</Button><IconButton label={`Download ${file.name}`} icon={<Download size={16} />} />
  </li>)}</ul>;
}

function Results({ groups, layout, actions }: { groups: readonly ResultGroup[]; layout: 'disclosure' | 'columns'; actions: Actions }) {
  if (!groups.length) return <p className="hub-sheets-empty rounded-[10px] border border-dashed border-ui-stroke">Workbooks made by workflows will appear here, one for each run.</p>;
  if (layout === 'columns') return <div className="grid grid-cols-[repeat(auto-fill,minmax(360px,1fr))] gap-4">{groups.map(group => <Card key={group.workflow}><CardHeader><h3 className="text-title font-semibold">{group.workflow}</h3></CardHeader><CardBody className="pt-1"><ResultRows group={group} actions={actions} /></CardBody></Card>)}</div>;
  return <div className="grid gap-2">{groups.map((group, index) => <Disclosure key={group.workflow} variant="body" defaultOpen={index === 0} summary={group.workflow}><ResultRows group={group} actions={actions} /></Disclosure>)}</div>;
}

function OtherTable({ files, actions }: { files: readonly SheetFile[]; actions: Actions }) {
  const [selection, setSelection] = useState<string[]>([]);
  const selected = files.filter(file => selection.includes(file.id));
  if (!files.length) return <p className="hub-sheets-empty rounded-[10px] border border-dashed border-ui-stroke">Imports that no workflow uses will appear here.</p>;
  return <div className="overflow-hidden rounded-[10px] border border-ui-stroke">
    {selected.length > 0 && <div className="flex items-center gap-2 border-b border-ui-stroke bg-ui-table px-3 py-2 text-body"><span className="flex-1">{selected.length} selected</span><Button disabled={selected.length < 2} onClick={() => actions.dialog('merge', selected)}>Merge</Button><Button onClick={() => actions.dialog('remove', selected)}>Remove</Button><Button onClick={() => setSelection([])}>Clear</Button></div>}
    <table aria-label="Other spreadsheets" className="hub-sheets-data"><thead><tr><th scope="col"><Checkbox label={<span className="sr-only">Select all spreadsheets</span>} checked={selection.length === files.length ? true : selection.length ? 'indeterminate' : false} onCheckedChange={checked => setSelection(checked ? files.map(file => file.id) : [])} /></th><th scope="col">Spreadsheet</th><th scope="col">Source</th><th scope="col">Rows</th><th scope="col">Updated</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {files.map(file => <tr key={file.id}><td><Checkbox label={<span className="sr-only">Select {file.name}</span>} checked={selection.includes(file.id)} onCheckedChange={checked => setSelection(current => checked ? [...current, file.id] : current.filter(id => id !== file.id))} /></td>
        <td><button type="button" className="text-left font-medium underline-offset-2 hover:underline" onClick={() => actions.open(file)}>{file.name}</button></td><td>{file.sharePoint ? 'SharePoint' : 'This Mac'}</td><td>{file.rows.toLocaleString()}</td><td>{when(file.updatedAt)}</td>
        <td><div className="hub-sheets-actions"><Button onClick={() => actions.versions(file, 'other')}>Versions</Button><FileMenu file={file} kind="other" actions={actions} label={file.name} /></div></td></tr>)}
    </tbody></table></div>;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="hub-sheets-section"><h2>{title}</h2>{description && <p className="hub-sheets-caption -mt-2 mb-3">{description}</p>}{children}</section>;
}

function ActionDialog({ state, onClose }: { state: { kind: DialogKind; files: readonly SheetFile[] } | undefined; onClose: () => void }) {
  const [value, setValue] = useState('');
  const kind = state?.kind;
  return <Dialog open={!!state} onOpenChange={open => { if (!open) onClose(); }}><DialogContent title={kind === 'merge' ? 'Merge spreadsheets' : kind === 'remove' ? 'Remove spreadsheets?' : kind === 'rename' ? 'Rename spreadsheet' : 'Link to SharePoint'}><DialogBody>
    {kind === 'merge' ? <div className="grid gap-4"><p>The originals are retained in version history. The merged spreadsheet becomes local reference data.</p><ul>{state!.files.map(file => <li key={file.id}>{file.name} · {file.rows} rows</li>)}</ul><Field label="Merged spreadsheet name"><Input value={value} onChange={event => setValue(event.target.value)} /></Field><Field label="People in both spreadsheets"><Select><option>Keep both and ask during lookups</option><option>Keep the row from the newer saved spreadsheet</option></Select></Field></div>
      : kind === 'remove' ? <><p>These spreadsheets will no longer be available for lookups. Retained run evidence stays available. SharePoint files are unchanged.</p><ul>{state!.files.map(file => <li key={file.id}>{file.name}</li>)}</ul></>
      : <Field label={kind === 'rename' ? 'Spreadsheet name' : 'SharePoint file URL'}><Input value={value || (kind === 'rename' ? state!.files[0].name : '')} onChange={event => setValue(event.target.value)} /></Field>}
  </DialogBody><DialogFooter><Button onClick={onClose}>Cancel</Button><Button onClick={onClose}>{kind === 'merge' ? 'Merge spreadsheets' : kind === 'remove' ? 'Remove' : 'Save'}</Button></DialogFooter></DialogContent></Dialog>;
}

export function SheetsDesignPage({ design }: { design: SheetsDesign }) {
  const scenario = sheetsScenario(), startStep = sheetsStep();
  const references = sheetsReferences(scenario), results = sheetsResults(scenario), others = sheetsOther(scenario);
  const [tab, setTab] = useState('used');
  const [versions, setVersions] = useState<ReturnType<typeof libraryEntry> | null>(null);
  const [dialog, setDialog] = useState<{ kind: DialogKind; files: readonly SheetFile[] }>();
  const [importOpen, setImportOpen] = useState(startStep !== undefined), [preset, setPreset] = useState<string>();
  const actions: Actions = { versions: (file, kind) => setVersions(libraryEntry(file, kind)), dialog: (kind, files) => setDialog({ kind, files }), open: () => undefined, importFor: id => { setPreset(id); setImportOpen(true); } };
  const head = <div className="mb-6 flex items-start justify-between gap-4"><div><h1>Spreadsheets</h1><p className="hub-sheets-intro !mb-0">Rosters your workflows look people up in, and the workbooks they make.</p></div>
    <div className="flex items-center gap-2"><Button variant="primary" onClick={() => actions.importFor()}>Import spreadsheet</Button><DropdownMenu><DropdownMenuTrigger render={<IconButton label="More spreadsheet actions" icon={<MoreHorizontal size={16} />} />} /><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => undefined}>Create type</DropdownMenuItem></DropdownMenuContent></DropdownMenu></div></div>;
  const body = design === 'a' ? <>
    <Section title="Used by workflows" description="A reference for looking up people."><ReferenceCards items={references} actions={actions} /></Section>
    <Section title="Results"><Results groups={results} layout="disclosure" actions={actions} /></Section>
    <Section title="Other spreadsheets"><OtherTable files={others} actions={actions} /></Section></>
    : design === 'b' ? <>
    <Section title="Used by workflows" description="A reference for looking up people."><ReferenceTable items={references} actions={actions} /></Section>
    <Section title="Other spreadsheets"><OtherTable files={others} actions={actions} /></Section>
    <Section title="Results" description="Newest first, one workbook for each run."><Results groups={results} layout="columns" actions={actions} /></Section></>
    : <>
    <Tabs value={tab} onValueChange={setTab}><TabList label="Spreadsheet groups"><Tab value="used" count={references.filter(item => item.file).length || undefined}>Used by workflows</Tab><Tab value="results">Results</Tab><Tab value="other" count={others.length || undefined}>Other spreadsheets</Tab></TabList>
      <TabPanel value="used" className="pt-4"><ReferenceCards items={references} actions={actions} /></TabPanel>
      <TabPanel value="results" className="pt-4"><Results groups={results} layout="disclosure" actions={actions} /></TabPanel>
      <TabPanel value="other" className="pt-4"><OtherTable files={others} actions={actions} /></TabPanel></Tabs></>;
  return <section aria-label="Spreadsheets" className="spreadsheet-workspace settings-reference-page hub-sheets-library min-w-0 text-body">
    {head}{body}
    <SheetsImportDialog key={`${importOpen}:${preset ?? ''}`} open={importOpen} onOpenChange={setImportOpen} references={references} startStep={importOpen && startStep && !preset ? startStep : preset ? 'purpose' : 'pick'} preset={preset} />
    <SpreadsheetVersions entry={versions} pending={false} onClose={() => setVersions(null)} onDownload={async () => undefined} onChange={noop} onCheck={noop} />
    <ActionDialog state={dialog} onClose={() => setDialog(undefined)} />
  </section>;
}
