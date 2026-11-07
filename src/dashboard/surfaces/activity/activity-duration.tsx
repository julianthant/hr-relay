import type { ReactNode } from 'react';
import { Skeleton, dsFocus } from '../../ds/ui.js';
import { SkeletonText } from '../shared/loading/loading.js';
import { activityDuration, type ActivitySummary } from './activity-view-model.js';
import { workflowDurationChart } from './activity-duration-model.js';
import './activity-duration.css';

function DurationFrame({ children, ticks }: { children: ReactNode; ticks: readonly ReactNode[] }) {
  return <div className="activity-duration-chart">
    <div className="activity-duration-grid activity-duration-header" aria-hidden>
      <span>Workflow</span><span>Elapsed time</span><span>Average</span>
    </div>
    {children}
    <div className="activity-duration-grid activity-duration-axis" aria-hidden>
      <span /><div className="activity-duration-ticks">{ticks.map((tick, index) => <span key={index}>{tick}</span>)}</div><span />
    </div>
  </div>;
}

export function ActivityDurations({ report, onWorkflow }: { report: ActivitySummary; onWorkflow?: (workflow: string) => void }) {
  const chart = workflowDurationChart(report.durationWorkflows ?? report.workflows);
  return <section aria-labelledby="activity-duration-heading" className="activity-durations">
    <h2 id="activity-duration-heading" className="mb-1 mt-0 text-section">Average workflow time</h2>
    <p className="mb-3 mt-0 text-body text-ui-secondary">Elapsed time per completed run in this period.</p>
    <figure className="m-0" aria-label="Average workflow time">
      <DurationFrame ticks={chart.ticks.map(seconds => activityDuration(seconds))}>
        {chart.rows.length ? <ol className="activity-duration-rows">{chart.rows.map(workflow => {
          const row = <>
          <div className="activity-duration-copy"><span className="text-body">{workflow.label}</span>
            <span className="text-caption text-ui-muted">{workflow.successfulTiming.measured} of {workflow.completed} completed runs timed</span>
          </div>
          <div className="activity-duration-plot" aria-hidden>
            <div className="activity-duration-guides">{chart.ticks.map((_, index) => <span key={index} />)}</div>
            {workflow.widthPercent !== null && <span className="activity-duration-bar" style={{ width: `${workflow.widthPercent}%` }} />}
          </div>
          <span className={`activity-duration-value text-body ${workflow.averageSeconds === null ? 'text-ui-secondary' : ''}`}>
            {workflow.averageSeconds === null ? workflow.successfulTiming.measured === 0 ? 'Not timed' : 'Unavailable' : activityDuration(workflow.averageSeconds)}
          </span></>;
          return <li key={workflow.id}>{onWorkflow ? <button type="button" aria-label={`View timed completed runs for ${workflow.label}`} className={`activity-duration-grid activity-duration-row activity-duration-open ${dsFocus}`} onClick={() => onWorkflow(workflow.id)}>{row}</button> : <div className="activity-duration-grid activity-duration-row">{row}</div>}</li>;
        })}</ol> : <p className="activity-duration-empty text-body text-ui-secondary">No workflow activity in this period</p>}
      </DurationFrame>
    </figure>
  </section>;
}

export function ActivityDurationsSkeleton() {
  return <section className="activity-durations" aria-hidden>
    <h2 className="mb-1 mt-0 text-section">Average workflow time</h2>
    <p className="mb-3 mt-0 text-body text-ui-secondary">Elapsed time per completed run in this period.</p>
    <DurationFrame ticks={Array.from({ length: 5 }, (_, index) => <SkeletonText key={index} className="w-6" />)}>
      <div className="activity-duration-rows">{[0, 1].map(row => <div key={row} className="activity-duration-grid activity-duration-row">
        <div className="activity-duration-copy"><div className="text-body"><SkeletonText className="w-3/4" /></div><div className="text-caption"><SkeletonText className="w-4/5" /></div></div>
        <div className="activity-duration-plot"><Skeleton className={`h-3 ${row === 0 ? 'w-3/5' : 'w-2/5'}`} /></div>
        <div className="activity-duration-value text-body"><SkeletonText className="ml-auto w-14" /></div>
      </div>)}</div>
    </DurationFrame>
  </section>;
}
