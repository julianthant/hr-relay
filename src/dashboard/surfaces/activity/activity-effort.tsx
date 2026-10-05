import { useId, useState } from 'react';
import { Input } from '../../ds/ui.js';
import type { ActivitySummary } from './activity-view-model.js';
import { estimatedSavedMinutes, manualMinutes, successfulRunMinutes } from './activity-effort-model.js';
import './activity-effort.css';

export function ActivityEffort({ report }: { report: ActivitySummary }) {
  const id = useId();
  const [baselines, setBaselines] = useState<Record<string, string>>({});
  const estimates = report.workflows.map(workflow => estimatedSavedMinutes(baselines[workflow.id] ?? '', workflow.successfulTiming));
  const included = report.workflows.filter((_, index) => estimates[index] !== null);
  const total = estimates.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const covered = included.reduce((sum, workflow) => sum + workflow.successfulTiming.measured, 0);
  const manual = included.reduce((sum, workflow) => sum + workflow.successfulTiming.measured * Number(baselines[workflow.id]), 0);
  const automated = manual - total;
  return <section aria-labelledby="activity-effort-heading" className="activity-effort">
    <h2 id="activity-effort-heading" className="mb-3 mt-0 text-section">Time saved</h2>
    <div className="activity-effort-table"><table aria-label="Manual work baselines">
      <colgroup><col className="activity-effort-workflow" /><col /><col /><col className="activity-effort-savings" /></colgroup>
      <thead><tr><th scope="col">Workflow</th><th scope="col">Manual min/run</th><th scope="col">HR GPT min/run</th><th scope="col">Time saved</th></tr></thead>
      <tbody>{report.workflows.map((workflow, index) => {
        const baseline = baselines[workflow.id] ?? '';
        const invalid = baseline.trim() !== '' && manualMinutes(baseline) === null;
        const saved = estimates[index];
        const average = successfulRunMinutes(workflow.successfulTiming);
        const errorId = `${id}-${workflow.id}-error`;
        return <tr key={workflow.id}>
          <th scope="row">{workflow.label}<span>{workflow.completed} completed</span>{invalid && <span id={errorId} role="alert" className="activity-effort-error">Enter zero or more manual minutes.</span>}</th>
          <td><Input type="number" name={`${workflow.id}-manual-minutes`} min="0" step="0.5" placeholder="—" aria-label={`${workflow.label} manual minutes`} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} value={baseline} onChange={event => setBaselines(current => ({ ...current, [workflow.id]: event.target.value }))} /></td>
          <td>{average === null ? <span className="activity-effort-prompt">Unavailable</span> : <><strong className="font-normal">{average.toFixed(1)}</strong><span>{workflow.successfulTiming.measured} of {workflow.completed} successful runs timed</span></>}</td>
          <td className="activity-effort-result">{saved === null ? <span className="activity-effort-prompt">{invalid ? 'Check baseline' : average === null ? 'Unavailable' : 'Set manual time'}</span> : <><strong>{(Math.abs(saved) / 60).toFixed(1)}h{saved < 0 ? ' more' : ''}</strong><span>{Math.abs(Number(baseline) - average!).toFixed(1)} min/run {saved < 0 ? 'longer' : 'saved'}</span></>}</td>
        </tr>;
      })}{!report.workflows.length && <tr><td colSpan={4} className="activity-effort-empty">No workflow activity in this period</td></tr>}</tbody>
      <tfoot aria-label="Estimated time saved" aria-live="polite"><tr>
        <th scope="row">Estimated total<span>{covered} of {report.completed} successful runs · {included.length} of {report.workflows.length} workflows</span></th>
        <td>{included.length ? `${(manual / 60).toFixed(1)}h` : '—'}</td><td>{included.length ? `${(automated / 60).toFixed(1)}h` : '—'}</td>
        <td className="activity-effort-result">{included.length ? <><strong>{(Math.abs(total) / 60).toFixed(1)}h {total < 0 ? 'more' : 'estimated'}</strong><span>{manual > 0 ? `${Math.round(Math.abs(total) / manual * 100)}% ${total < 0 ? 'more' : 'less'} time` : total < 0 ? 'Longer than manual' : 'No difference'}</span></> : <span className="activity-effort-prompt">{report.workflows.length ? 'Set manual time' : 'Not estimated'}</span>}</td>
      </tr></tfoot>
    </table></div>
  </section>;
}
