import { useDelayedLoading } from "../shared/loading/loading-model.js";
import { LoadingRegion, SettingsRowsSkeleton } from "../shared/loading/loading.js";
import { dsStatusOf } from "../shared/status/status-model.js";
import { useEffect, useMemo, useRef } from 'react';
import { ArrowDownUp } from 'lucide-react';
import { Button, PageBreadcrumbs, SearchInput, Select, dsFocus, dsIcon } from '../../ds/ui.js';
import { LogPanel } from '../run-detail/log-panel.js';
import { StatusBadge } from '../shared/status/status.js';
import { activityDuration, type ActivitySummary } from './activity-view-model.js';
import { activityDrilldown, activityDrilldownTitle, activityOrderValue, setActivityOrder, ACTIVITY_RUN_ORDERS, ACTIVITY_RUN_PAGE_SIZE, type ActivityDrilldownData, type ActivityBrowse, type ActivityRunRecord, type ActivitySelectionHandler } from './activity-drilldown-model.js';

function RunStatus({ run }: { run: ActivityRunRecord }) {
  return <StatusBadge presentation="queue" status={(run.status === 'completed' ? run.readback === true ? 'verifiedDone' : 'doneWarnings' : run.status === 'waiting' ? 'waiting' : dsStatusOf(run.status))} />;
}

export function ActivityBreadcrumbs({ report, selection, onSelection, browse }: { report: ActivitySummary; selection: ActivityBrowse; onSelection: ActivitySelectionHandler; browse?: ActivityDrilldownData }) {
  const result = browse ?? (report.runs ? activityDrilldown(report.runs, selection) : undefined);
  const title = activityDrilldownTitle(selection, result?.state === 'loaded' ? result.workflowLabel : undefined);
  const breadcrumbs = [{ label: 'Analytics', onClick: () => onSelection(null) },
    { label: title, onClick: () => onSelection({ ...selection, run: undefined }) },
    ...(selection.run ? [{ label: result?.state === 'loaded' && result.run ? result.run.subject : 'Run unavailable' }] : [])];
  return <PageBreadcrumbs label="Analytics breadcrumbs" items={breadcrumbs} />;
}

export function ActivityDrilldown({ report, selection, onSelection, browse, pending = false }: { report: ActivitySummary; selection: ActivityBrowse; onSelection: ActivitySelectionHandler; browse?: ActivityDrilldownData; pending?: boolean }) {
  const missing = pending && browse === undefined;
  const show = useDelayedLoading(missing);
  const heading = useRef<HTMLHeadingElement>(null);
  const filterKey = JSON.stringify([selection.sort, selection.query]);
  const focusContext = `${selection.metric}:${selection.workflow ?? ''}:${selection.run ?? ''}`;
  const previousFocus = useRef({ filterKey, focusContext });
  useEffect(() => {
    const previous = previousFocus.current;
    previousFocus.current = { filterKey, focusContext };
    if (previous.focusContext === focusContext && previous.filterKey !== filterKey) return;
    heading.current?.focus({ preventScroll: true });
  }, [focusContext, filterKey, selection.page]);
  const result = useMemo(() => browse ?? (report.runs ? activityDrilldown(report.runs, selection) : { state: 'unavailable' as const, reason: 'Run details are unavailable for this report.' }), [browse, report.runs, selection]);
  const context = useMemo(() => result.state === 'loaded' && result.run ? { workflow: result.run.workflowLabel, displayId: result.run.displayId, attempt: result.run.attempt, reviewPending: result.run.status === 'waiting',
    timing: { text: activityDuration(result.run.seconds) } } : undefined, [result]);
  const title = activityDrilldownTitle(selection, result.state === 'loaded' ? result.workflowLabel : undefined);
  const steps = result.state === "loaded" ? result.run?.steps : undefined;
  const timeline = result.state === "loaded" ? result.run?.timeline : undefined;
  const showWorkflow = !selection.workflow;
  const showStatus = selection.metric === 'outstanding';
  return <section aria-label="Analytics runs" className="min-w-0">
    <h2 ref={heading} tabIndex={-1} className={`mb-1 mt-0 w-fit rounded-sm text-section ${dsFocus} ${result.state === 'loaded' && result.run ? 'sr-only' : ''}`}>{result.state === 'loaded' && result.run ? `${result.run.subject} logs` : title}</h2>
    {missing ? show && <LoadingRegion label="Loading Analytics runs"><SettingsRowsSkeleton rows={3} presentation="result" /></LoadingRegion> : result.state === 'unavailable' || result.run && (result.run.steps === undefined || result.run.timeline === undefined) ? <p role="alert" className="text-body text-ui-secondary">{result.state === 'unavailable' ? result.reason : 'Run details are unavailable for this report.'}</p> : result.run && steps !== undefined && timeline !== undefined ?
      <div className="mt-3 flex h-[calc(var(--ds-space-base)*72)] min-w-0 flex-col"><LogPanel key={result.run.id} title={result.run.subject}
        status={<RunStatus run={result.run} />} steps={steps} timeline={timeline}
        context={context} /></div>
      : <>
        <p className="mb-3 mt-0 text-caption text-ui-muted" role="status">{result.totalMatches}{selection.query?.trim() ? ` of ${result.total}` : ''} {selection.metric === 'timed' ? `completed ${result.total === 1 ? 'run' : 'runs'} with recorded duration` : result.total === 1 ? 'run' : 'runs'}</p>
        <div role="group" aria-label="Run filters" className="mb-3 flex min-w-0 items-center gap-3">
          <SearchInput aria-label="Search runs" placeholder="Search name or run ID" variant="toolbar" className="min-w-0 flex-1" maxLength={500}
            value={selection.query ?? ''} onChange={event => onSelection({ ...selection, query: event.target.value, page: 0, run: undefined }, 'replace')}
            onClear={() => onSelection({ ...selection, query: undefined, page: 0, run: undefined })} />
          <Select aria-label="Run order" variant="toolbar" value={activityOrderValue(selection)}
            icon={<ArrowDownUp aria-hidden className={dsIcon.sm} />} onChange={event => onSelection(setActivityOrder(selection, event.target.value))}>
            {ACTIVITY_RUN_ORDERS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
          </Select>
        </div>
        <div className="overflow-hidden rounded-[var(--ds-radius-body-group)] border border-ui-stroke bg-ui-panel">
          <table aria-label={title} className="w-full table-fixed border-collapse text-body">
            <colgroup><col />{showWorkflow && <col className="w-[27%]" />}{showStatus && <col className="w-[20%]" />}<col className="w-[18%]" /></colgroup>
            <thead className="bg-ui-table text-caption text-ui-secondary"><tr>{['Name', ...(showWorkflow ? ['Workflow'] : []), ...(showStatus ? ['Status'] : []), 'Duration'].map(label => <th key={label} scope="col" className="px-4 py-3 text-left font-normal last:text-right">{label}</th>)}</tr></thead>
            <tbody>{result.rows.map(run => <tr key={run.id} className="border-t border-ui-stroke even:bg-ui-table">
              <td className="px-4 py-3"><button type="button" aria-label={`Open logs for ${run.subject}, ${run.displayId}`} disabled={pending} onClick={() => onSelection({ ...selection, run: run.id })} className={`block max-w-full rounded-sm text-left text-ui-info hover:underline ${dsFocus}`}><span className="block text-control">{run.subject}</span><span className="block text-caption tabular-nums text-ui-muted">{run.displayId}</span></button></td>
              {showWorkflow && <td className="px-4 py-3">{run.workflowLabel}</td>}{showStatus && <td className="px-4 py-3"><RunStatus run={run} /></td>}<td className="px-4 py-3 text-right tabular-nums">{activityDuration(run.seconds)}</td>
            </tr>)}</tbody>
          </table>
          {!result.rows.length && <p className="m-0 px-4 py-6 text-center text-body text-ui-secondary">{selection.query?.trim() ? 'No runs match your search.' : 'No matching runs in this period.'}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ui-stroke px-4 py-2 text-caption text-ui-muted">
            <span>{result.totalMatches ? `${result.start + 1}–${Math.min(result.totalMatches, result.start + ACTIVITY_RUN_PAGE_SIZE)} of ${result.totalMatches}` : '0 runs'}</span>
            <span className="flex gap-2"><Button size="sm" variant="ghost" disabled={pending || selection.page === 0} onClick={() => onSelection({ ...selection, page: selection.page - 1 })}>Previous</Button><Button size="sm" variant="ghost" disabled={pending || result.start + ACTIVITY_RUN_PAGE_SIZE >= result.totalMatches} onClick={() => onSelection({ ...selection, page: selection.page + 1 })}>Next</Button></span>
          </div>
        </div>
      </>}
  </section>;
}
