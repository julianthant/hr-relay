import { useId, useState } from 'react';
import { Input } from '../../ds/ui.js';
import type { ActivitySummary } from './activity-view-model.js';
import { estimatedSavedMinutes, type EffortBaseline } from './activity-effort-model.js';
import './activity-effort.css';

export function ActivityEffort({ report }: { report: ActivitySummary }) {
  const id = useId();
  const [baselines, setBaselines] = useState<Record<string, EffortBaseline>>({});
  const estimates = report.workflows.map(workflow => estimatedSavedMinutes(workflow.completed, baselines[workflow.id] ?? { manual: '', assisted: '' }));
  const measured = estimates.filter((value): value is number => value !== null);
  const total = measured.reduce((sum, value) => sum + value, 0);
  const included = report.workflows.filter((_, index) => estimates[index] !== null);
  const completed = included.reduce((sum, workflow) => sum + workflow.completed, 0);
  const manual = included.reduce((sum, workflow) => sum + workflow.completed * Number(baselines[workflow.id].manual), 0);
  const assisted = manual - total;
  const update = (workflow: string, key: keyof EffortBaseline, value: string) => setBaselines(current => ({ ...current, [workflow]: { ...(current[workflow] ?? { manual: '', assisted: '' }), [key]: value } }));
  return <section aria-labelledby="activity-effort-heading" className="activity-effort">
    <h2 id="activity-effort-heading" className="mb-3 mt-0 text-section">Time saved</h2>
    <p className="activity-effort-description">Hands-on minutes per completed run, including review. Run duration is separate.</p>
    <div className="activity-effort-table"><table aria-label="Manual work baselines"><colgroup><col className="activity-effort-workflow" /><col /><col /><col className="activity-effort-savings" /></colgroup><thead><tr><th scope="col">Workflow</th><th scope="col">Manual min/run</th><th scope="col">HR GPT min/run</th><th scope="col">Time saved</th></tr></thead><tbody>{report.workflows.map((workflow, index) => {
      const baseline = baselines[workflow.id] ?? { manual: '', assisted: '' };
      const saved = estimates[index];
      const invalid = baseline.manual !== '' && baseline.assisted !== '' && saved === null;
      const errorId = `${id}-${workflow.id}-error`;
      return <tr key={workflow.id}><th scope="row">{workflow.label}<span>{workflow.completed} completed</span>{invalid && <span id={errorId} role="alert" className="activity-effort-error">Use nonnegative minutes; HR GPT must not exceed manual.</span>}</th>{(['manual', 'assisted'] as const).map(key => <td key={key}><Input type="number" min="0" step="0.5" placeholder="—" aria-label={`${workflow.label} ${key === 'manual' ? 'manual' : 'HR GPT'} minutes`} aria-invalid={invalid || undefined} aria-describedby={invalid ? errorId : undefined} value={baseline[key]} onChange={event => update(workflow.id, key, event.target.value)} /></td>)}<td className="activity-effort-result">{saved === null ? <span className="text-ui-muted">{invalid ? 'Check baseline' : 'Not estimated'}</span> : <><strong>{(saved / 60).toFixed(1)}h</strong><span>{Number(baseline.manual) - Number(baseline.assisted)} min / run</span></>}</td></tr>;
    })}{!report.workflows.length && <tr><td colSpan={4} className="activity-effort-empty">No workflow activity in this period</td></tr>}</tbody>
      <tfoot aria-label="Estimated time saved" aria-live="polite"><tr><th scope="row">Estimated total<span>{completed} of {report.completed} completed runs · {measured.length} of {report.workflows.length} workflows</span></th><td>{measured.length ? `${(manual / 60).toFixed(1)}h` : '—'}</td><td>{measured.length ? `${(assisted / 60).toFixed(1)}h` : '—'}</td><td className="activity-effort-result">{measured.length ? <><strong>{(total / 60).toFixed(1)}h estimated</strong><span>{manual > 0 ? Math.round(total / manual * 100) : 0}% less hands-on time</span></> : <span className="activity-effort-prompt">{report.workflows.length ? 'Set a baseline' : 'Not estimated'}</span>}</td></tr></tfoot>
    </table></div>
    <p className="activity-effort-note">Estimates use your assumptions. Missing or invalid baselines are excluded.</p>
  </section>;
}
