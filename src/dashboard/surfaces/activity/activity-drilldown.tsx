import { useEffect, useMemo, useRef } from 'react';
import { Button, PageBreadcrumbs, TH, dsFocus } from '../../ds/ui.js';
import { LogPanel } from '../run-detail/log-panel.js';
import { StatusBadge } from '../shared/status/status.js';
import { activityDuration, type ActivitySummary } from './activity-view-model.js';
import { activityDrilldown, activityDrilldownTitle, nextActivitySort, ACTIVITY_RUN_PAGE_SIZE, type ActivityBrowse, type ActivityRunRecord } from './activity-drilldown-model.js';

function RunStatus({ run }: { run: ActivityRunRecord }) {
  return <StatusBadge presentation="queue" status={run.status === 'completed' ? run.readback === true ? 'verifiedDone' : 'doneWarnings' : run.status} />;
}

export function ActivityBreadcrumbs({ report, selection, onSelection }: { report: ActivitySummary; selection: ActivityBrowse; onSelection: (next: ActivityBrowse | null) => void }) {
  const result = report.runs ? activityDrilldown(report.runs, selection) : undefined;
  const title = activityDrilldownTitle(selection, result?.state === 'loaded' ? result.workflowLabel : undefined);
  const breadcrumbs = [{ label: 'Analytics', onClick: () => onSelection(null) },
    { label: title, onClick: () => onSelection({ ...selection, run: undefined }) },
    ...(selection.run ? [{ label: result?.state === 'loaded' && result.run ? result.run.subject : 'Run unavailable' }] : [])];
  return <PageBreadcrumbs label="Analytics breadcrumbs" items={breadcrumbs} />;
}

export function ActivityDrilldown({ report, selection, onSelection }: { report: ActivitySummary; selection: ActivityBrowse; onSelection: (next: ActivityBrowse | null) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const sortKey = `${selection.sort?.column ?? ''}:${selection.sort?.direction ?? ''}`;
  const focusContext = `${selection.metric}:${selection.workflow ?? ''}:${selection.run ?? ''}`;
  const previousFocus = useRef({ sortKey, focusContext });
  useEffect(() => {
    const previous = previousFocus.current;
    previousFocus.current = { sortKey, focusContext };
    if (previous.focusContext === focusContext && previous.sortKey !== sortKey) return;
    heading.current?.focus({ preventScroll: true });
  }, [focusContext, sortKey, selection.page]);
  const result = useMemo(() => report.runs ? activityDrilldown(report.runs, selection) : { state: 'unavailable' as const, reason: 'Run details are unavailable for this report.' }, [report.runs, selection]);
  const context = useMemo(() => result.state === 'loaded' && result.run ? { workflow: result.run.workflowLabel, displayId: result.run.displayId, attempt: result.run.attempt, reviewPending: result.run.status === 'waiting',
    timing: { text: activityDuration(result.run.seconds) } } : undefined, [result]);
  const title = activityDrilldownTitle(selection, result.state === 'loaded' ? result.workflowLabel : undefined);
  const showWorkflow = !selection.workflow;
  const showStatus = selection.metric === 'outstanding';
  return <section aria-label="Analytics runs" className="min-w-0">
    <h2 ref={heading} tabIndex={-1} className={`mb-1 mt-0 w-fit rounded-sm text-section ${dsFocus} ${result.state === 'loaded' && result.run ? 'sr-only' : ''}`}>{result.state === 'loaded' && result.run ? `${result.run.subject} logs` : title}</h2>
    {result.state === 'unavailable' ? <p role="alert" className="text-body text-ui-secondary">{result.reason}</p> : result.run ?
      <div className="mt-3 flex h-[calc(var(--ds-space-base)*72)] min-w-0 flex-col"><LogPanel key={result.run.id} title={result.run.subject}
        status={<RunStatus run={result.run} />} steps={result.run.steps} timeline={result.run.timeline}
        context={context} /></div>
      : <>
        <p className="mb-3 mt-0 text-caption text-ui-muted">{result.matches.length} {selection.metric === 'timed' ? `completed ${result.matches.length === 1 ? 'run' : 'runs'} with recorded duration` : result.matches.length === 1 ? 'run' : 'runs'}</p>
        <div className="overflow-hidden rounded-[var(--ds-radius-body-group)] border border-ui-stroke bg-ui-panel">
          <table aria-label={title} className="w-full table-fixed border-collapse text-body">
            <colgroup><col />{showWorkflow && <col className="w-[27%]" />}{showStatus && <col className="w-[20%]" />}<col className="w-[18%]" /></colgroup>
            <thead className="bg-ui-table text-caption text-ui-secondary"><tr>
              {['Name', ...(showWorkflow ? ['Workflow'] : []), ...(showStatus ? ['Status'] : []), 'Duration'].map(label => {
                const column = label === 'Name' ? 'name' : label === 'Duration' ? 'duration' : undefined;
                return <TH key={label} align={label === 'Duration' ? 'right' : 'left'}
                  sort={column ? selection.sort?.column === column ? selection.sort.direction : 'none' : undefined}
                  onSort={column ? () => onSelection(nextActivitySort(selection, column)) : undefined}
                  className="px-4 py-3 text-left last:text-right text-caption font-normal normal-case tracking-normal text-ui-secondary [&_button]:min-h-[var(--ds-h-sm)] [&_button]:text-caption [&_button]:font-normal [&_button]:tracking-normal [&_button]:text-ui-secondary">{label}</TH>;
              })}
            </tr></thead>
            <tbody>{result.rows.map(run => <tr key={run.id} className="border-t border-ui-stroke even:bg-ui-table">
              <td className="px-4 py-3"><button type="button" aria-label={`Open logs for ${run.subject}, ${run.displayId}`} onClick={() => onSelection({ ...selection, run: run.id })} className={`block max-w-full rounded-sm text-left text-ui-info hover:underline ${dsFocus}`}><span className="block text-control">{run.subject}</span><span className="block text-caption tabular-nums text-ui-muted">{run.displayId}</span></button></td>
              {showWorkflow && <td className="px-4 py-3">{run.workflowLabel}</td>}{showStatus && <td className="px-4 py-3"><RunStatus run={run} /></td>}<td className="px-4 py-3 text-right tabular-nums">{activityDuration(run.seconds)}</td>
            </tr>)}</tbody>
          </table>
          {!result.rows.length && <p className="m-0 px-4 py-6 text-center text-body text-ui-secondary">No matching runs in this period.</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ui-stroke px-4 py-2 text-caption text-ui-muted">
            <span>{result.matches.length ? `${result.start + 1}–${Math.min(result.matches.length, result.start + ACTIVITY_RUN_PAGE_SIZE)} of ${result.matches.length}` : '0 runs'}</span>
            <span className="flex gap-2"><Button size="sm" variant="ghost" disabled={selection.page === 0} onClick={() => onSelection({ ...selection, page: selection.page - 1 })}>Previous</Button><Button size="sm" variant="ghost" disabled={result.start + ACTIVITY_RUN_PAGE_SIZE >= result.matches.length} onClick={() => onSelection({ ...selection, page: selection.page + 1 })}>Next</Button></span>
          </div>
        </div>
      </>}
  </section>;
}
