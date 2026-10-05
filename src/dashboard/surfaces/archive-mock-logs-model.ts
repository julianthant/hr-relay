import type { MockArchiveRun } from './archive-mock-model.js';
import type { LogEntry, LogStep } from './log-feed-model.js';
import { logSampleCapture } from './logs/log-selected-fixture.js';
import type { LogTimelineStage } from './logs/log-timeline-model.js';

export function mockArchiveLogs(run: MockArchiveRun): { steps: readonly LogStep[]; timeline: readonly LogTimelineStage[] } {
 if (run.savedLogs) return run.savedLogs;
 if (run.completed === undefined) throw new Error('ARCHIVE_SNAPSHOT_LOGS_MISSING');
 const durations = run.steps.map(step => step.status === 'notStarted' ? 0 : Number.parseInt(step.duration, 10));
 let cursor = Date.parse(run.completed) - durations.reduce((total, seconds) => total + seconds, 0) * 1000;
 const time = (value: number) => new Date(value).toISOString().slice(11, 19);
 const steps: LogStep[] = [], timeline: LogTimelineStage[] = [];
 run.steps.forEach((step, index) => {
  const id = `${run.id}-step-${index}`, started = cursor, finished = cursor + durations[index] * 1000;
  cursor = finished;
  const pending = step.status === 'notStarted';
  timeline.push({ id, label: step.label, state: pending ? 'pending' : step.status === 'failed' ? 'failed' : 'completed',
   ...(!pending ? { stepId: id, time: time(started), durationLabel: step.duration } : {}),
   substeps: [{ id: `${id}-action`, label: pending ? 'Not started' : step.status === 'failed' ? 'Confirmation unavailable' : step.status === 'doneWarnings' ? 'Completed with warning' : 'Recorded actions', state: pending ? 'pending' : step.status === 'failed' ? 'failed' : 'completed', ...(!pending ? { durationLabel: step.duration } : {}) }],
  });
  if (pending) return;
  const system = /Kuali/u.test(step.label) ? 'Kuali' : /CRM/u.test(step.label) ? 'CRM' : /timecard/u.test(step.label) ? 'Kronos' : /contact request|packet/u.test(step.label) ? 'Request portal' : 'UCPath';
  const writes = /^(Create|File|Update|Finalize|Complete)/u.test(step.label);
  const identity = /identity|verification|status|Search UCPath/u.test(step.label);
  const rows: readonly (readonly [string, string])[] = /timecard/u.test(step.label)
   ? [['Employee name', run.person], ['Employee ID', run.employeeId], ['Last day worked', run.fields.find(([label]) => label === 'Last day worked')![1]], ['Last punch', '16:00'], ['Sick pay', 'None']]
   : identity
   ? [['Employee name', run.person], ['Employee ID', run.employeeId], ['Work location', run.location]]
   : [['Employee name', run.person], ['Employee ID', run.employeeId], ...run.fields.filter(([label]) => label !== 'Employee ID')];
  const captured = time(started + 1000), actionTime = time(started + 2000);
  const entries: LogEntry[] = [
   { kind: 'fields', id: `${id}-fields`, title: writes ? 'Prepared values' : 'Recorded fields',
    fields: rows.map(([label, value], field) => ({ id: `${id}-field-${field}`, time: captured, kind: writes ? 'fill' : 'read', label, value })),
    screenshots: [logSampleCapture(system, step.label, captured, writes ? 'form' : identity ? 'person' : 'fields', rows)],
   },
   { kind: 'click', id: `${id}-click`, time: actionTime, label: writes ? /Finalize|Complete|Update/u.test(step.label) ? 'Save' : 'Save and Submit' : identity ? 'Search' : index === 0 ? 'Open request' : /timecard/u.test(step.label) ? 'Open timecard' : 'Open record' },
  ];
  if (step.status === 'failed' || step.status === 'doneWarnings') {
   entries.push({ kind: 'decision', id: `${id}-result`, time: time(finished), decision: {
    title: step.status === 'failed' ? 'Confirmation unavailable' : 'Secondary confirmation unavailable',
    state: step.status === 'failed' ? 'failed' : 'held',
    message: step.status === 'failed' ? 'The confirmation could not be captured. The following step was not started.' : 'The workflow completed, but the secondary confirmation could not be captured.',
    attemptedAction: `Verify ${step.label.toLocaleLowerCase()}`,
    lastCompleted: index > 0 ? run.steps[index - 1].label : 'Recorded request fields',
    field: { label: 'Employee ID', value: run.employeeId, outcome: 'Recorded' },
    screenshots: [
     logSampleCapture(system, 'Recorded employee', captured, 'browser', [['Employee', run.person], ['Employee ID', run.employeeId]]),
     logSampleCapture(system, 'Confirmation unavailable', time(finished), 'browser', [['Employee', run.person], ['Employee ID', run.employeeId], ['Confirmation', 'Unavailable']]),
    ],
    footer: step.status === 'failed' ? `Saved failure file: failure-${run.number}.txt` : 'Warning retained in the saved report',
   } });
  } else entries.push({ kind: 'note', id: `${id}-result`, time: time(finished), message: `${step.label} completed in ${step.duration}.`, tone: 'positive' });
  if (run.outcome === 'cancelled' && index === 1) entries.push({ kind: 'note', id: `${id}-cancelled`, time: time(finished), message: 'The operator cancelled this run. Remaining steps were not started.' });
  steps.push({ id, title: step.label, time: time(started), system, entries });
 });
 return { steps, timeline };
}
