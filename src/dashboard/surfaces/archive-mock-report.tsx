import { ArrowLeft, ChevronRight, Download, FileText, Square } from 'lucide-react';
import { Badge, Button, PageHeading, StatusPill, TBody, TD, TH, THead, TR, dsIcon, useToasts } from '../ds/ui.js';
import { ArchiveFieldGroup, ArchiveFieldRows, ArchiveResourceState, ArchiveTable } from './archive-visual.js';
import { MOCK_ARCHIVE_REPORT_SECTIONS, mockArchiveDate, type MockArchiveRun } from './archive-mock-model.js';

export function MockArchiveReport({ run, section, onSection, onHistory, onBack }: {
 run: MockArchiveRun; section: number; onSection: (section: number) => void; onHistory: () => void; onBack: () => void;
}) {
 const { toast } = useToasts();
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
  <nav aria-label="Archive breadcrumbs" className="mock-archive-breadcrumbs"><Button variant="ghost" size="sm" onClick={onHistory}>Version history</Button><ChevronRight aria-hidden className={dsIcon.sm} /><span>{run.dashboard === 'unrecorded' ? 'Version not recorded' : `Dashboard ${run.dashboard}`}</span><ChevronRight aria-hidden className={dsIcon.sm} /><Button variant="ghost" size="sm" onClick={onBack}>{run.workflowLabel}</Button><ChevronRight aria-hidden className={dsIcon.sm} /><span className="text-[color:var(--ds-fg)]">Run {run.number}</span></nav>
  <PageHeading title={run.title} description={`${run.workflowLabel} · Run ${run.number}`} actions={<Button variant="ghost" size="sm" icon={<ArrowLeft className={dsIcon.sm} />} onClick={onBack}>All runs</Button>} />
  <div className="mock-archive-report-layout">
   <nav aria-label="Saved report sections" className="mock-archive-report-nav">{MOCK_ARCHIVE_REPORT_SECTIONS.map((label, index) => <Button key={label} variant="ghost" className="mock-archive-section-button" aria-current={section === index ? 'page' : undefined} onClick={() => onSection(index)}>{label}{index === 4 && <span className="ml-auto text-caption tabular-nums text-[color:var(--ds-fg-muted)]">{run.files.length}</span>}</Button>)}</nav>
   <div className="min-w-0">
    {section > 4 ? <ArchiveResourceState kind="error" title="This report section is unavailable" action={<Button variant="secondary" onClick={() => onSection(0)}>View workflow details</Button>} /> : <>
     <h2 className="mb-[16px] text-heading font-semibold">{MOCK_ARCHIVE_REPORT_SECTIONS[section]}</h2>
     {section === 0 && <div className="space-y-[16px]">
      <ArchiveFieldGroup title="Run summary" className="mock-archive-run-summary"><ArchiveFieldRows rows={[
       ...pairs([['Workflow', run.workflowLabel], ['Run number', String(run.number)], ['Dashboard version', run.dashboard === 'unrecorded' ? 'Not recorded' : run.dashboard], ['Workflow version', run.workflowVersion], ['Completed', mockArchiveDate(run.completed)], ['Total elapsed', run.elapsed], ['Archived', mockArchiveDate(run.archived)]]),
       { label: 'Outcome', value: <StatusPill status={run.outcome} /> },
       { label: 'Retained files', value: String(run.files.length) },
      ]} /></ArchiveFieldGroup>
      <ArchiveFieldGroup title="Subject"><ArchiveFieldRows rows={pairs([['Name', run.person], ['Employee ID', run.employeeId], ['Email', run.email], ['Work location', run.location]])} /></ArchiveFieldGroup>
      {run.outcome !== 'verifiedDone' && <div className="mock-archive-report-note"><p>{run.outcome === 'failed' ? 'UCPath confirmation was unavailable. The final step was not started; review the retained failure file.' : run.outcome === 'cancelled' ? 'The operator cancelled this run after identity confirmation. Remaining steps were not started.' : 'The workflow completed. A secondary confirmation could not be captured; the retained report records the warning.'}</p></div>}
     </div>}
     {section === 1 && <ArchiveFieldGroup title={run.workflowLabel} showHeading={false}><ArchiveFieldRows rows={pairs(run.fields)} /></ArchiveFieldGroup>}
     {section === 2 && <div className="mock-archive-table-wrap"><ArchiveTable label="Saved workflow steps" roomy><THead><TR><TH>Step</TH><TH>Outcome</TH><TH>Duration</TH></TR></THead><TBody>{run.steps.map((step, index) => <TR key={step.label}><TD><span className="mr-[12px] text-[color:var(--ds-fg-muted)] tabular-nums">{index + 1}</span>{step.label}</TD><TD>{step.status === 'notStarted' ? <Badge tone="neutral"><Square aria-hidden className={dsIcon.sm} />Not started</Badge> : <StatusPill status={step.status} label={step.status === 'verifiedDone' ? 'Completed' : undefined} />}</TD><TD className="tabular-nums">{step.duration}</TD></TR>)}</TBody></ArchiveTable></div>}
     {section === 3 && <ArchiveFieldGroup title="Settings captured when this run started" showHeading={false}><ArchiveFieldRows rows={pairs(run.settings)} /></ArchiveFieldGroup>}
     {section === 4 && <ArchiveFieldGroup title="Retained files" showHeading={false}>{run.files.map(file => <section className="mock-archive-file" key={file.name} aria-label={`File ${file.name}`}>
      <div className="flex items-center gap-[12px]"><FileText aria-hidden className="size-[20px] shrink-0 text-[color:var(--ds-fg-muted)]" /><div className="min-w-0 flex-1"><h3 className="truncate text-body font-medium" title={file.name}>{file.name}</h3><p className="mt-[4px] text-caption text-[color:var(--ds-fg-muted)]">Fictional retained file · {new TextEncoder().encode(file.content).length} bytes</p></div><Button size="sm" variant="secondary" icon={<Download className={dsIcon.sm} />} onClick={() => download(file.name, file.content)}>Download</Button></div>
      <details className="mt-[12px] text-body"><summary className="ds-focus w-fit cursor-pointer text-[color:var(--ds-fg-secondary)]">Preview file</summary><pre className="mock-archive-file-preview">{file.content}</pre></details>
     </section>)}</ArchiveFieldGroup>}
    </>}
   </div>
  </div>
 </article>;
}
