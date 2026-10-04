import { useState } from 'react';
import { Input } from '../../ds/ui.js';
import type { ActivitySummary } from './activity-view-model.js';
import { estimatedSavedMinutes, type EffortBaseline } from './activity-effort-model.js';

export function ActivityEffort({ report }: { report: ActivitySummary }) {
  const [baselines, setBaselines] = useState<Record<string, EffortBaseline>>({});
  const estimates = report.workflows.map(workflow => estimatedSavedMinutes(workflow.completed, baselines[workflow.id] ?? { manual: '', assisted: '' }));
  const measured = estimates.filter((value): value is number => value !== null);
  const total = measured.reduce((sum, value) => sum + value, 0);
  const update = (id: string, key: keyof EffortBaseline, value: string) => setBaselines(current => ({ ...current, [id]: { ...(current[id] ?? { manual: '', assisted: '' }), [key]: value } }));
  return <section aria-labelledby="activity-effort-heading"><div className="mb-3 flex items-baseline justify-between gap-3"><h2 id="activity-effort-heading" className="m-0 text-section">Time saved</h2><span className="text-section tabular-nums">{measured.length ? `${(total / 60).toFixed(1)}h estimated` : 'Set a baseline'}</span></div>
    <p className="mb-3 text-caption text-ui-muted">Minutes of hands-on work per completed run. Estimates use your assumptions, including review time; run duration is separate.</p>
    <div className="overflow-hidden rounded-xl border border-ui-stroke bg-ui-panel"><table aria-label="Manual work baselines" className="w-full table-fixed text-body"><thead className="bg-ui-table text-caption text-ui-muted"><tr><th className="px-3 py-3 text-left font-normal">Workflow</th><th className="px-2 py-3 font-normal">Manual minutes</th><th className="px-2 py-3 font-normal">With HR GPT</th></tr></thead><tbody>{report.workflows.map(workflow => {
      const baseline = baselines[workflow.id] ?? { manual: '', assisted: '' };
      const invalid = baseline.manual !== '' && baseline.assisted !== '' && estimatedSavedMinutes(workflow.completed, baseline) === null;
      return <tr key={workflow.id} className="border-t border-ui-stroke"><th scope="row" className="px-3 py-3 text-left font-normal">{workflow.label}<span className="mt-1 block text-caption text-ui-muted">{workflow.completed} completed</span></th>{(['manual', 'assisted'] as const).map(key => <td key={key} className="px-2 py-3"><Input type="number" min="0" step="0.5" placeholder="—" aria-label={`${workflow.label} ${key === 'manual' ? 'manual' : 'HR GPT'} minutes`} aria-invalid={invalid || undefined} value={baseline[key]} onChange={event => update(workflow.id, key, event.target.value)} /></td>)}</tr>;
    })}</tbody></table></div>
    <p className="mt-2 text-caption text-ui-muted">{measured.length} of {report.workflows.length} workflows estimated. {measured.length < report.workflows.length ? 'Missing baselines are excluded.' : 'All completed runs included.'} Assumptions stay in this view.</p>
  </section>;
}
