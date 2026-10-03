import { ArrowLeft, ChevronRight, Download, Folder, Layers3, Search } from 'lucide-react';
import { useRef, useState } from 'react';
import { ArchiveBrowseStateSchema, EMPTY_ARCHIVE_BROWSE, type ArchiveBrowseState } from '../app/archive-route-model.js';
import { Badge, Button, DateInput, Dialog, DialogContent, Input, PageHeading, PanelToolbar, Popover, PopoverContent, PopoverTrigger, Select, TBody, TD, TH, THead, TR, dsIcon, useToasts } from '../ds/ui.js';
import { ArchiveResourceState, ArchiveTable } from './archive-visual.js';
import { MockArchiveBump } from './archive-mock-bump.js';
import { MockArchiveReport } from './archive-mock-report.js';
import { MOCK_ARCHIVE_CURRENT, MOCK_ARCHIVE_RUNS, MOCK_ARCHIVE_WORKFLOWS, mockArchiveDate, mockArchiveDateBoundary, mockArchiveExport, mockArchiveFilter, mockArchiveResultLabel, mockArchiveScope, type MockArchiveFolder, type MockArchiveRun } from './archive-mock-model.js';
import './archive-mock.css';

export function MockArchiveWorkspace({ selection, view, folder, browse, browseInvalid, onBrowse, onSelection, onView, onFolder }: {
 selection: string; view: 'runs' | 'versions'; folder: MockArchiveFolder | null;
 browse?: ArchiveBrowseState; browseInvalid?: boolean;
 onBrowse: (browse: ArchiveBrowseState, mode?: 'push' | 'replace') => void;
 onSelection: (id: string) => void; onView: (view: 'runs' | 'versions') => void;
 onFolder: (folder: MockArchiveFolder | null) => void;
}) {
 const { toast } = useToasts();
 const bumpTrigger = useRef<HTMLButtonElement>(null);
 const [exportOpen, setExportOpen] = useState(false);
 const browsing = browse ?? EMPTY_ARCHIVE_BROWSE;
 const scope = mockArchiveScope(folder);
 const report = selection === '' ? undefined : MOCK_ARCHIVE_RUNS.find(row => row.id === selection &&
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
   toast({ tone: 'success', title: 'Mock export downloaded', description: `${exportRows.length} fictional ${exportRows.length === 1 ? 'report' : 'reports'} · ${format.toUpperCase()}` });
  } catch (error) { toast({ tone: 'danger', title: 'Mock export failed', description: error instanceof Error ? error.message : String(error) }); }
 };
 const updateFilters = (filters: ArchiveBrowseState['filters'], mode: 'push' | 'replace' = 'push') => {
  const next = ArchiveBrowseStateSchema.safeParse({ filters });
  if (!next.success) { toast({ tone: 'danger', title: 'Check the date range', description: 'The completed-through date must follow the completed-from date.' }); return; }
  onBrowse(next.data, mode);
 };
 return <section aria-label="Archive mock" className="mock-archive ds-body-overlay flex min-h-0 flex-1 flex-col bg-[var(--ds-surface-page)]">
  <div className="mock-archive-toolbar-inset"><PanelToolbar label="Archive controls" variant="body" className="mock-archive-toolbar">
   {folder === null && report === undefined && !invalid && !unavailable ? <>
    <ArchiveMockSearch value={browsing.filters.search ?? ''} onChange={search => updateFilters({ ...browsing.filters, search: search || undefined }, 'replace')} />
    <span className="mock-archive-toolbar-count" role="status">{rows.length} matching reports</span>
    {filtered && <Button size="toolbar" variant="ghost" onClick={() => updateFilters({})}>Reset filters</Button>}
   </> : <Button size="toolbar" variant="ghost" icon={<ArrowLeft className={dsIcon.sm} />} onClick={recover}>Version history</Button>}
   <div className="mock-archive-toolbar-actions"><span className="mock-archive-toolbar-version">Dashboard {MOCK_ARCHIVE_CURRENT}</span><Badge tone="neutral">Mock · fictional data</Badge>
   {(folder !== null || report !== undefined) && !unavailable && !invalid && <Popover open={exportOpen} onOpenChange={setExportOpen}>
    <PopoverTrigger asChild><Button size="toolbar" variant="secondary" disabled={exportRows.length === 0} icon={<Download className={dsIcon.sm} />}>{report ? 'Export run' : 'Export workflow'}</Button></PopoverTrigger>
    <PopoverContent title="Export fictional reports" align="end" className="ds-body-scope ds-body-overlay !w-[280px] !bg-[var(--ds-surface-overlay)]">
     <div className="space-y-[12px] p-[16px]"><p className="text-body text-[color:var(--ds-fg-muted)]">{exportRows.length} matching {exportRows.length === 1 ? 'report' : 'reports'}. JSON includes saved fields, settings and files.</p><div className="flex gap-[8px]"><Button variant="secondary" className="flex-1" onClick={() => download('json')}>JSON</Button><Button variant="secondary" className="flex-1" onClick={() => download('csv')}>CSV</Button></div></div>
    </PopoverContent>
   </Popover>}
   <Button ref={bumpTrigger} size="toolbar" variant="secondary" onClick={() => onView('versions')}>Plan a bump</Button>
   </div>
  </PanelToolbar></div>
  <div className="min-h-0 flex-1 overflow-auto p-[var(--ds-shell-inset)]">
   <div className="mock-archive-canvas">
    {invalid ? <ArchiveResourceState kind="error" title="This browsing state is unavailable in the mock" message="Choose a fresh mock scope to continue." action={<Button variant="secondary" onClick={() => onBrowse({ filters: {} }, 'replace')}>Reset browsing</Button>} />
     : unavailable ? <ArchiveResourceState kind="error" title="This saved report is unavailable in the mock" message="This preview contains fictional runs only. Choose a mock workflow to browse its reports." action={<Button variant="secondary" onClick={recover}>View version history</Button>} />
     : report ? <MockArchiveReport run={report} section={browsing.section ?? 0} onSection={section => onBrowse({ ...browsing, section }, 'replace')} onHistory={recover} onBack={() => folder ? onSelection('') : onFolder({ dashboardKey: report.dashboard, workflow: report.workflow })} />
     : folder === null ? <>
      <MockVersionFolders rows={rows} onFolder={onFolder} />
     </> : <>
      <nav aria-label="Archive breadcrumbs" className="mock-archive-breadcrumbs"><Button variant="ghost" size="sm" onClick={recover}>Version history</Button><ChevronRight aria-hidden className={dsIcon.sm} /><span>{folder.dashboardKey === 'unrecorded' ? 'Version not recorded' : `Dashboard ${folder.dashboardKey}`}</span><ChevronRight aria-hidden className={dsIcon.sm} /><span className="text-[color:var(--ds-fg)]">{scope[0].workflowLabel}</span></nav>
      <PageHeading title={scope[0].workflowLabel} actions={<Button variant="ghost" size="sm" icon={<ArrowLeft className={dsIcon.sm} />} onClick={recover}>All workflows</Button>} />
      <dl className="mock-archive-metadata">
       <div><dt>Dashboard version</dt><dd>{folder.dashboardKey === 'unrecorded' ? 'Not recorded' : folder.dashboardKey}</dd></div>
       <div><dt>Archived runs</dt><dd>{scope.length}</dd></div>
       <div><dt>Workflow versions</dt><dd>{[...new Set(scope.map(row => row.workflowVersion))].join(', ')}</dd></div>
      </dl>
      <div className="mock-archive-filters">
       <label className="mock-archive-field"><span>Search reports</span><ArchiveMockSearch value={browsing.filters.search ?? ''} onChange={search => updateFilters({ ...browsing.filters, search: search || undefined }, 'replace')} /></label>
       <label className="mock-archive-field"><span>Dashboard version</span><Select value={folder.dashboardKey} onChange={event => onFolder({ ...folder, dashboardKey: event.target.value })}>{['1.3', '1.2', 'unrecorded'].map(key => <option key={key} value={key}>{key === 'unrecorded' ? 'Not recorded' : key}</option>)}</Select></label>
       <label className="mock-archive-field"><span>Workflow</span><Select value={folder.workflow} onChange={event => onFolder({ ...folder, workflow: event.target.value })}>{MOCK_ARCHIVE_WORKFLOWS.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</Select></label>
       <DateInput label="Completed from (UTC)" value={browsing.filters.from?.slice(0, 10) ?? ''} max={browsing.filters.to?.slice(0, 10)} onChange={value => updateFilters({ ...browsing.filters, from: mockArchiveDateBoundary(value) })} />
       <DateInput label="Completed through (UTC)" value={browsing.filters.to?.slice(0, 10) ?? ''} min={browsing.filters.from?.slice(0, 10)} onChange={value => updateFilters({ ...browsing.filters, to: mockArchiveDateBoundary(value, true) })} />
      </div>
      <div className="mock-archive-table-wrap"><MockArchiveRunTable rows={rows} onSelection={onSelection} /></div>
      {rows.length === 0 && <ArchiveResourceState kind="empty" title="No reports match these filters" message="Try another name, outcome or completed date." action={<Button variant="secondary" onClick={() => updateFilters({})}>Reset filters</Button>} />}
      <div className="mock-archive-table-footer"><span>{rows.length} of {scope.length} fictional reports</span>{filtered && <Button variant="ghost" size="sm" onClick={() => updateFilters({})}>Reset filters</Button>}</div>
     </>}
   </div>
  </div>
  <Dialog open={view === 'versions'} onOpenChange={open => { if (!open) onView('runs'); }}>
   {view === 'versions' && <DialogContent size="md" className="ds-body-scope ds-body-overlay !w-[calc(100vw-var(--ds-space-section))] !max-w-[650px] !bg-[var(--ds-surface-overlay)]" title="Plan a version bump" description="Current dashboard 1.4 · fictional preview" onCloseAutoFocus={event => { event.preventDefault(); bumpTrigger.current?.focus(); }}>
    <MockArchiveBump contextWorkflow={report?.workflow ?? folder?.workflow} onCancel={() => onView('runs')} onFinish={() => {
     onView('runs'); toast({ tone: 'info', title: 'Mock bump reviewed', description: 'No version or run was changed.' });
    }} />
   </DialogContent>}
  </Dialog>
 </section>;
}

function ArchiveMockSearch({ value, onChange }: { value: string; onChange: (value: string) => void }) {
 return <div className="mock-archive-search"><Search aria-hidden className={dsIcon.sm} /><Input aria-label="Search saved reports" placeholder="Name, ID, document or field…" value={value} onChange={event => onChange(event.target.value)} /></div>;
}

function MockVersionFolders({ rows, onFolder }: { rows: readonly MockArchiveRun[]; onFolder: (folder: MockArchiveFolder) => void }) {
 if (rows.length === 0) return <ArchiveResourceState kind="empty" title="No versions match this search" message="Search a person, workflow, version or saved field." />;
 return <div className="mock-archive-version-groups">{['1.3', '1.2', 'unrecorded'].map(key => {
  const versionRows = rows.filter(row => row.dashboard === key);
  if (versionRows.length === 0) return null;
  return <section key={key} aria-label={key === 'unrecorded' ? 'Version not recorded' : `Dashboard ${key}`}>
   <header className="mock-archive-version-heading"><h2><Layers3 aria-hidden className={dsIcon.md} />{key === 'unrecorded' ? 'Version not recorded' : `Dashboard ${key}`}</h2><span>{key === 'unrecorded' ? 'Historical runs' : `Archived ${mockArchiveDate(versionRows[0].archived)}`}</span></header>
   <div className="mock-archive-folders">{MOCK_ARCHIVE_WORKFLOWS.map(workflow => {
    const matches = versionRows.filter(row => row.workflow === workflow.id);
    if (matches.length === 0) return null;
    return <button key={workflow.id} className="mock-archive-folder ds-focus" onClick={() => onFolder({ dashboardKey: key, workflow: workflow.id })}>
     <span className="mock-archive-folder-icon"><Folder aria-hidden className={dsIcon.md} /></span><span className="min-w-0 flex-1 text-left"><strong>{workflow.label}</strong><span className="mock-archive-folder-description">{key === 'unrecorded' ? 'Workflow version not recorded' : `Workflow ${matches[0].workflowVersion}`}</span></span><span className="mock-archive-folder-count">{matches.length} {matches.length === 1 ? 'run' : 'runs'}</span><ChevronRight aria-hidden className={dsIcon.sm} />
    </button>;
   })}</div>
  </section>;
 })}</div>;
}

function MockArchiveRunTable({ rows, onSelection }: { rows: readonly MockArchiveRun[]; onSelection: (id: string) => void }) {
 return <ArchiveTable label="Saved reports" roomy><THead><TR>{['Run', 'Subject', 'Result', 'Workflow version', 'Completed (UTC)', 'Document', 'Files'].map((label, index) => <TH key={label} className={index === 3 || index === 4 || index === 6 ? 'text-right' : undefined}>{label}</TH>)}<TH><span className="sr-only">Open report</span></TH></TR></THead><TBody>{rows.map(row => <TR key={row.id} className="cursor-pointer" onClick={event => {
  if (event.target instanceof Element && event.target.closest('button')) return;
  onSelection(row.id);
 }}>
  <TD><Button variant="ghost" className="mock-archive-run-title" onClick={() => onSelection(row.id)}>{row.title}</Button><span className="mock-archive-run-number">Run {row.number}</span></TD>
  <TD><strong className="font-medium">{row.person}</strong><span className="mock-archive-run-number">{row.employeeId}</span></TD><TD>{mockArchiveResultLabel(row.outcome)}</TD><TD className="text-right tabular-nums">{row.workflowVersion}</TD><TD className="text-right"><time dateTime={row.completed}>{mockArchiveDate(row.completed)}</time><span className="mock-archive-run-number">{new Date(row.completed).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })}</span></TD><TD>{row.document}</TD><TD className="text-right tabular-nums">{row.files.length}</TD><TD><Button size="sm" variant="ghost" aria-label={`Open report for ${row.person}`} icon={<ChevronRight className={dsIcon.sm} />} onClick={() => onSelection(row.id)} /></TD>
 </TR>)}</TBody></ArchiveTable>;
}
