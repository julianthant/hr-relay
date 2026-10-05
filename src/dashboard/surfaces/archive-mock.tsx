import { ChevronRight, Download, FileText, Folder, Layers3 } from 'lucide-react';
import { useMemo, useRef, useState } from 'react';
import { ArchiveBrowseStateSchema, EMPTY_ARCHIVE_BROWSE, type ArchiveBrowseState } from '../app/archive-route-model.js';
import { Button, DateRangeInput, Dialog, DialogContent, PageHeading, SearchInput, Select, TableList, TableToolbar, dsIcon, useToasts } from '../ds/ui.js';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '../ds/dropdown-menu.js';
import { ArchiveResourceState } from './archive-visual.js';
import { MockArchiveBump } from './archive-mock-bump.js';
import { MockArchiveReport } from './archive-mock-report.js';
import { MOCK_ARCHIVE_RUNS, mockArchiveWorkflows, mockArchiveDate, mockArchiveDateBoundary, mockArchiveExport, mockArchiveFilter, mockArchiveResultLabel, mockArchiveScope, type MockArchiveFolder, type MockArchiveRun } from './archive-mock-model.js';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../ds/breadcrumb.js';
import './archive-mock.css';

export function MockArchiveWorkspace({ selection, view, folder, browse, browseInvalid, onBrowse, onSelection, onView, onFolder, additionalReports }: {
 selection: string; view: 'runs' | 'versions'; folder: MockArchiveFolder | null;
 browse?: ArchiveBrowseState; browseInvalid?: boolean;
 additionalReports?: readonly MockArchiveRun[];
 onBrowse: (browse: ArchiveBrowseState, mode?: 'push' | 'replace') => void;
 onSelection: (id: string) => void; onView: (view: 'runs' | 'versions') => void;
 onFolder: (folder: MockArchiveFolder | null) => void;
}) {
 const { toast } = useToasts();
 const bumpTrigger = useRef<HTMLButtonElement>(null);
 const [exportOpen, setExportOpen] = useState(false);
 const browsing = browse ?? EMPTY_ARCHIVE_BROWSE;
 const reports = useMemo(() => [...MOCK_ARCHIVE_RUNS, ...additionalReports ?? []], [additionalReports]);
 const workflows = useMemo(() => mockArchiveWorkflows(reports), [reports]);
 const scope = mockArchiveScope(folder, reports);
 const report = selection === '' ? undefined : reports.find(row => row.id === selection &&
  (folder === null || row.dashboard === folder.dashboardKey && row.workflow === folder.workflow));
 const rows = scope === null ? [] : mockArchiveFilter(scope, browsing);
 const unavailable = scope === null || selection !== '' && report === undefined;
 const invalid = browseInvalid || browsing.after !== undefined || browsing.columns !== undefined;
 const filtered = Object.values(browsing.filters).some(value => value !== undefined && value !== '');
 const exportRows = report ? [report] : rows;
 const exportName = report ? `mock-run-${report.number}` : `mock-archive-${folder?.dashboardKey ?? 'all'}`;
 const recover = () => { onFolder(null); };
 const download = (format: 'json' | 'csv') => {
  setExportOpen(false);
  try {
   const url = URL.createObjectURL(new Blob([mockArchiveExport(exportRows, format)], { type: format === 'json' ? 'application/json' : 'text/csv;charset=utf-8' }));
   const link = document.createElement('a'); link.href = url; link.download = `${exportName}.${format}`;
   document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
   toast({ tone: 'success', title: 'Export downloaded', description: `${exportRows.length} ${exportRows.length === 1 ? 'report' : 'reports'} · ${format.toUpperCase()}` });
  } catch (error) { toast({ tone: 'danger', title: 'Export failed', description: error instanceof Error ? error.message : String(error) }); }
 };
 const updateFilters = (filters: ArchiveBrowseState['filters'], mode: 'push' | 'replace' = 'push') => {
  const next = ArchiveBrowseStateSchema.safeParse({ filters });
  if (!next.success) { toast({ tone: 'danger', title: 'Check the date range', description: 'The completed-through date must follow the completed-from date.' }); return; }
  onBrowse(next.data, mode);
 };
 const actions = <>
   {report !== undefined && !unavailable && !invalid && <DropdownMenu open={exportOpen} onOpenChange={setExportOpen}>
    <DropdownMenuTrigger asChild><Button variant="secondary" icon={<Download className={dsIcon.sm} />}>Export run</Button></DropdownMenuTrigger>
    <DropdownMenuContent aria-label="Export reports" align="end" className="w-70">
     <DropdownMenuGroup><DropdownMenuItem onSelect={() => download('json')}>JSON</DropdownMenuItem><DropdownMenuItem onSelect={() => download('csv')}>CSV</DropdownMenuItem></DropdownMenuGroup><p className="m-0 px-2 py-2 text-caption text-ui-muted">{exportRows.length} matching {exportRows.length === 1 ? 'report' : 'reports'}. JSON includes saved fields, settings and files.</p>
    </DropdownMenuContent>
   </DropdownMenu>}
   <Button ref={bumpTrigger} variant="secondary" onClick={() => onView('versions')}>Plan a bump</Button>
  </>;
 return <section aria-label="Archive" className="mock-archive settings-reference-page settings-data-section">
  {(folder === null && report === undefined || unavailable || invalid) && <PageHeading title="Archive" actionAlignment="title" actions={actions} />}
  {folder === null && report === undefined && !invalid && !unavailable && <TableToolbar
    search={<ArchiveMockSearch value={browsing.filters.search ?? ""} onChange={search => updateFilters({ ...browsing.filters, search: search || undefined }, "replace")} />}
    controls={<div className="mock-archive-index-filters">
    <Select aria-label="Archived workflow" value={browsing.filters.workflow ?? "all"} onChange={event => updateFilters({ ...browsing.filters, workflow: event.target.value === "all" ? undefined : event.target.value })} icon={<Folder className={dsIcon.sm} />}>
      <option value="all">All workflows</option>{workflows.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}
    </Select>
    <Select aria-label="Archived outcome" value={browsing.filters.outcome ?? "all"} onChange={event => updateFilters({ ...browsing.filters, outcome: event.target.value === "all" ? undefined : event.target.value as NonNullable<ArchiveBrowseState["filters"]["outcome"]> })}>
      <option value="all">All outcomes</option><option value="done">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option>
    </Select>
    </div>} />}
  {folder === null && report === undefined && !invalid && !unavailable && filtered && <div><Button size="sm" variant="ghost" onClick={() => updateFilters({})}>Reset filters</Button></div>}
  <div className="mock-archive-canvas">
    {invalid ? <ArchiveResourceState kind="error" title="This browsing state is unavailable" message="Choose a fresh scope to continue." action={<Button variant="secondary" onClick={() => onBrowse({ filters: {} }, 'replace')}>Reset browsing</Button>} />
     : unavailable ? <ArchiveResourceState kind="error" title="This saved report is unavailable" message="Choose a workflow to browse its saved reports." action={<Button variant="secondary" onClick={recover}>View version history</Button>} />
     : report ? <MockArchiveReport actions={actions} run={report} section={browsing.section ?? 0} onSection={section => onBrowse({ ...browsing, section }, 'replace')} onHistory={recover} onBack={() => folder ? onSelection('') : onFolder({ dashboardKey: report.dashboard, workflow: report.workflow })} />
     : folder === null ? <>
      <MockVersionFolders rows={rows} onFolder={onFolder} />
     </> : <>
      <div className="mock-archive-folder-header">
       <Breadcrumb aria-label="Archive breadcrumbs"><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><button type="button" onClick={recover}>Archive</button></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><span>{folder.dashboardKey === 'unrecorded' ? 'Version not recorded' : `Dashboard ${folder.dashboardKey}`}</span></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>{scope[0].workflowLabel}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
       <PageHeading title={scope[0].workflowLabel} actionAlignment="title" actions={actions} />
      </div>
      <TableList
       search={<ArchiveMockSearch value={browsing.filters.search ?? ''} onChange={search => updateFilters({ ...browsing.filters, search: search || undefined }, 'replace')} />}
       controls={<DateRangeInput label="Completed date range" fromLabel="Completed from (UTC)" toLabel="Completed through (UTC)" className="mock-archive-date-range"
        value={{ from: browsing.filters.from?.slice(0, 10) ?? '', to: browsing.filters.to?.slice(0, 10) ?? '' }}
        onChange={value => updateFilters({ ...browsing.filters, from: mockArchiveDateBoundary(value.from), to: mockArchiveDateBoundary(value.to, true) })} />}
       summary={`${rows.length} ${rows.length === 1 ? 'report' : 'reports'}`} summaryPosition="near-search">
       <MockArchiveRunTable rows={rows} onSelection={onSelection} />
      </TableList>
      {rows.length === 0 && <ArchiveResourceState kind="empty" title="No reports match these filters" message="Try another name, outcome or completed date." action={<Button variant="secondary" onClick={() => updateFilters({})}>Reset filters</Button>} />}
      {filtered && <Button variant="ghost" size="sm" onClick={() => updateFilters({})}>Reset filters</Button>}
     </>}
  </div>
  <Dialog open={view === 'versions'} onOpenChange={open => { if (!open) onView('runs'); }}>
   {view === 'versions' && <DialogContent size="md" className="ds-body-scope ds-body-overlay !w-[calc(100vw-var(--ds-space-section))] !max-w-[650px] !bg-[var(--ds-surface-overlay)]" title="Plan a version bump" description="Current dashboard 1.4" onCloseAutoFocus={event => { event.preventDefault(); bumpTrigger.current?.focus(); }}>
    <MockArchiveBump contextWorkflow={report?.workflow ?? folder?.workflow} onCancel={() => onView('runs')} onFinish={() => {
     onView('runs'); toast({ tone: 'info', title: 'Mock bump reviewed', description: 'No version or run was changed.' });
    }} />
   </DialogContent>}
  </Dialog>
 </section>;
}

function ArchiveMockSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
 return <SearchInput type="text" className="mock-archive-search" aria-label="Search saved reports" placeholder="Search archived reports" value={value} onChange={event => onChange(event.target.value)} onClear={() => onChange('')} />;
}

function MockVersionFolders({ rows, onFolder }: { rows: readonly MockArchiveRun[]; onFolder: (folder: MockArchiveFolder) => void }) {
 if (rows.length === 0) return <ArchiveResourceState kind="empty" title="No versions match this search" message="Search a person, workflow, version or saved field." />;
 return <div className="mock-archive-version-groups">{['1.3', '1.2', 'unrecorded'].map(key => {
  const versionRows = rows.filter(row => row.dashboard === key);
  if (versionRows.length === 0) return null;
  return <section key={key} aria-label={key === 'unrecorded' ? 'Version not recorded' : `Dashboard ${key}`}>
   <header className="mock-archive-version-heading"><h2><Layers3 aria-hidden className={dsIcon.md} />{key === 'unrecorded' ? 'Version not recorded' : `Dashboard ${key}`}</h2><span>{versionRows.length} {versionRows.length === 1 ? 'report' : 'reports'}</span></header>
   <div className="mock-archive-folders">{mockArchiveWorkflows(versionRows).map(workflow => {
    const matches = versionRows.filter(row => row.workflow === workflow.id);
    if (matches.length === 0) return null;
    return <button key={workflow.id} data-archive-workflow={workflow.id} className="mock-archive-folder ds-focus" onClick={() => onFolder({ dashboardKey: key, workflow: workflow.id })}>
     <span className="mock-archive-folder-icon"><Folder aria-hidden className={dsIcon.md} /></span><span className="min-w-0 flex-1 text-left"><strong>{workflow.label}</strong><span className="mock-archive-folder-description">{matches[0].workflowVersion === 'Not recorded' ? 'Workflow version not recorded' : `Workflow ${matches[0].workflowVersion}`}</span></span><span className="mock-archive-folder-count">{matches.length} {matches.length === 1 ? 'run' : 'runs'}</span><ChevronRight aria-hidden className={dsIcon.sm} />
    </button>;
   })}</div>
  </section>;
 })}</div>;
}

function MockArchiveRunTable({ rows, onSelection }: { rows: readonly MockArchiveRun[]; onSelection: (id: string) => void }) {
 return <table aria-label="Saved reports"><thead><tr>{['Run', 'Subject', 'Result', 'Workflow version', 'Completed (UTC)', 'Document', 'Files'].map((label, index) => <th key={label} scope="col" className={index === 3 || index === 4 || index === 6 ? '!text-right' : undefined}>{label}</th>)}<th scope="col"><span className="sr-only">Open report</span></th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="cursor-pointer" onClick={event => {
  if (event.target instanceof Element && event.target.closest('button')) return;
  onSelection(row.id);
 }}>
  <td><div className="mock-archive-run-identity"><span className="mock-archive-run-icon"><FileText aria-hidden className={dsIcon.md} /></span><div><Button variant="ghost" className="mock-archive-run-title" onClick={() => onSelection(row.id)}>{row.title}</Button><span className="mock-archive-run-number">Run {row.number}</span></div></div></td>
  <td><strong className="font-medium">{row.person}</strong><span className="mock-archive-run-number">{row.employeeId}</span></td><td>{mockArchiveResultLabel(row.outcome)}</td><td className="text-right tabular-nums">{row.workflowVersion}</td><td className="text-right">{row.completed ? <><time dateTime={row.completed}>{mockArchiveDate(row.completed)}</time><span className="mock-archive-run-number">{new Date(row.completed).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}</span></> : 'Not completed'}</td><td>{row.document}</td><td className="text-right tabular-nums">{row.files.length}</td><td><Button size="sm" variant="ghost" aria-label={`Open report for ${row.person}`} icon={<ChevronRight className={dsIcon.sm} />} onClick={() => onSelection(row.id)} /></td>
 </tr>)}</tbody></table>;
}
