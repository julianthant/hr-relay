import type { ReactNode } from 'react';
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from '../ds/breadcrumb.js';
import { Download, FileText } from 'lucide-react';
import { Badge, Button, PageHeading, StatusPill, dsIcon, useToasts } from '../ds/ui.js';
import { ArchiveFieldGroup, ArchiveFieldRows, ArchiveResourceState } from './archive-visual.js';
import { MOCK_ARCHIVE_REPORT_SECTIONS, mockArchiveDate, type MockArchiveRun } from './archive-mock-model.js';
import { mockArchiveLogs } from './archive-mock-logs-model.js';
import { LogPanel } from './log-panel.js';

export function MockArchiveReport({ run, section, onSection, onHistory, onBack, actions }: {
 run: MockArchiveRun; section: number; onSection: (section: number) => void; onHistory: () => void; onBack: () => void; actions?: ReactNode;
}) {
 const { toast } = useToasts();
 const activeSection = section === 1 ? 0 : section;
 const currentSection = MOCK_ARCHIVE_REPORT_SECTIONS.find(item => item.id === activeSection);
 const logs = activeSection === 2 ? mockArchiveLogs(run) : undefined;
 const pairs = (values: readonly (readonly [string, string])[]) => values.map(([label, value]) => ({ label, value }));
 const download = (name: string, content: string) => {
  try {
   const url = URL.createObjectURL(new Blob([content], { type: name.endsWith('.json') ? 'application/json' : 'text/plain;charset=utf-8' }));
   const link = document.createElement('a'); link.href = url; link.download = name;
   document.body.append(link); link.click(); link.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
   toast({ tone: 'success', title: 'Mock file downloaded', description: name });
  } catch (error) { toast({ tone: 'danger', title: 'File could not be downloaded', description: error instanceof Error ? error.message : String(error) }); }
 };
 return <article aria-label="Saved run report">
  <div className="mock-archive-folder-header">
   <Breadcrumb aria-label="Archive breadcrumbs"><BreadcrumbList><BreadcrumbItem><BreadcrumbLink asChild><button type="button" onClick={onHistory}>Archive</button></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><span>{run.dashboard === 'unrecorded' ? 'Version not recorded' : `Dashboard ${run.dashboard}`}</span></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbLink asChild><button type="button" onClick={onBack}>{run.workflowLabel}</button></BreadcrumbLink></BreadcrumbItem><BreadcrumbSeparator /><BreadcrumbItem><BreadcrumbPage>Run {run.number}</BreadcrumbPage></BreadcrumbItem></BreadcrumbList></Breadcrumb>
   <PageHeading title={run.title} description={`${run.workflowLabel} · Run ${run.number}`} actionAlignment="title" actions={actions} />
  </div>
  <div className="mock-archive-report-layout">
   <nav aria-label="Saved report sections" className="mock-archive-report-nav">{MOCK_ARCHIVE_REPORT_SECTIONS.map(({ id, label }) => <Button key={id} variant="ghost" className="mock-archive-section-button" aria-current={activeSection === id ? 'page' : undefined} onClick={() => onSection(id)}>{label}{id === 4 && <span className="ml-auto text-caption tabular-nums text-[color:var(--ds-fg-muted)]">{run.files.length}</span>}</Button>)}</nav>
   <div className="min-w-0">
    {!currentSection ? <ArchiveResourceState kind="error" title="This report section is unavailable" action={<Button variant="secondary" onClick={() => onSection(0)}>View workflow details</Button>} /> : <>
     {activeSection !== 2 && <h2 className="mb-[16px] text-heading font-semibold">{currentSection.label}</h2>}
     {activeSection === 0 && <div className="space-y-[16px]">
      <ArchiveFieldGroup title="Run summary" className="mock-archive-run-summary"><ArchiveFieldRows rows={[
       ...pairs([['Workflow', run.workflowLabel], ['Run number', String(run.number)], ['Dashboard version', run.dashboard === 'unrecorded' ? 'Not recorded' : run.dashboard], ['Workflow version', run.workflowVersion], ['Completed', mockArchiveDate(run.completed)], ['Total elapsed', run.elapsed], ['Archived', mockArchiveDate(run.archived)]]),
       { label: 'Outcome', value: <StatusPill status={run.outcome} /> },
       { label: 'Retained files', value: String(run.files.length) },
      ]} /></ArchiveFieldGroup>
      <ArchiveFieldGroup title="Subject"><ArchiveFieldRows rows={pairs([['Name', run.person], ['Employee ID', run.employeeId], ['Email', run.email], ['Work location', run.location]])} /></ArchiveFieldGroup>
      <ArchiveFieldGroup title="Workflow fields"><ArchiveFieldRows rows={pairs(run.fields.filter(([label, value]) => !([['Name', run.person], ['Employee ID', run.employeeId], ['Email', run.email], ['Work location', run.location]]).some(([existingLabel, existingValue]) => label === existingLabel && value === existingValue)))} /></ArchiveFieldGroup>
      {run.outcome !== 'verifiedDone' && <div className="mock-archive-report-note"><p>{run.outcome === 'failed' ? 'UCPath confirmation was unavailable. The final step was not started; review the retained failure file.' : run.outcome === 'cancelled' ? 'The operator cancelled this run after identity confirmation. Remaining steps were not started.' : 'The workflow completed. A secondary confirmation could not be captured; the retained report records the warning.'}</p></div>}
     </div>}
     {logs && <div className="mock-archive-log-panel"><LogPanel key={run.id} title="Logs" steps={logs.steps} timeline={logs.timeline} toolbar={<Badge tone="neutral">Saved · UTC</Badge>} /></div>}
     {section === 3 && <ArchiveFieldGroup title="Settings captured when this run started" showHeading={false}><ArchiveFieldRows rows={pairs(run.settings)} /></ArchiveFieldGroup>}
     {section === 4 && <ArchiveFieldGroup title="Retained files" showHeading={false}>{run.files.map(file => <section className="mock-archive-file" key={file.name} aria-label={`File ${file.name}`}>
      <div className="flex items-center gap-[12px]"><FileText aria-hidden className="size-[20px] shrink-0 text-[color:var(--ds-fg-muted)]" /><div className="min-w-0 flex-1"><h3 className="truncate text-body font-medium" title={file.name}>{file.name}</h3><p className="mt-[4px] text-caption text-[color:var(--ds-fg-muted)]">Retained file · {new TextEncoder().encode(file.content).length} bytes</p></div><Button size="sm" variant="secondary" icon={<Download className={dsIcon.sm} />} onClick={() => download(file.name, file.content)}>Download</Button></div>
      <details className="mt-[12px] text-body"><summary className="ds-focus w-fit cursor-pointer text-[color:var(--ds-fg-secondary)]">Preview file</summary><pre className="mock-archive-file-preview">{file.content}</pre></details>
     </section>)}</ArchiveFieldGroup>}
    </>}
   </div>
  </div>
 </article>;
}
