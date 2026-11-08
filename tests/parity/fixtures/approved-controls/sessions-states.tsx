import type { SessionNode, SessionWorker } from '../../../../src/dashboard/surfaces/sessions/sessions-view-model.js';
import { IDLE_REFRESH_MS } from '../../../../src/dashboard/surfaces/sessions/session-idle-model.js';
import { WorkerCard } from '../../../../src/dashboard/surfaces/sessions/worker-card.js';

const nodes = (count: number, completed: number, state: SessionNode['state'] = 'active'): readonly SessionNode[] =>
  Array.from({ length: count }, (_, index) => ({ id: `step-${index}`, label: `Step ${index + 1}`, state: index < completed ? 'completed' : index === completed ? state : 'pending' }));
const browser = (label: string, state: SessionWorker['browsers'][number]['state']) => ({ id: `${label}-${state}`, label, state });
const separations = { workflowId: 'separations', workflow: 'Separations', subject: 'Alex Morgan' };
const lookup = { workflowId: 'person-lookup', workflow: 'Person Lookup', subject: 'Jordan Lee' };
const base = { ...separations, state: 'running', action: 'Read the timecard', elapsed: '2m 14s', timeline: nodes(22, 11), browsers: [browser('Kuali', 'ready'), browser('UCPath', 'ready'), browser('Kronos', 'active')] } as const;

/** Every card state the served model produces; the first column of the parity sheet. */
const STATES: readonly (readonly [string, Partial<SessionWorker>])[] = [
  ['Failed (crashed, last values)', { state: 'failed', elapsed: '6m 02s', problem: 'Worker stopped unexpectedly.', timeline: nodes(22, 11, 'failed'), browsers: [browser('Kuali', 'closed'), browser('UCPath', 'closed'), browser('Kronos', 'closed')] }],
  ['Stopped by you (last values)', { state: 'stopped', elapsed: '3m 40s', problem: 'You stopped this worker.', timeline: nodes(22, 11, 'paused'), browsers: [browser('Kuali', 'closed'), browser('UCPath', 'closed'), browser('Kronos', 'closed')] }],
  ['Failed, as served today (no step or sessions)', { ...lookup, state: 'failed', elapsed: '1m 12s', action: '', problem: 'Worker stopped unexpectedly.', timeline: undefined, browsers: [] }],
  ['Waiting', { state: 'waiting', action: 'Confirm the matching employee', timeline: nodes(22, 14, 'waiting') }],
  ['Paused', { state: 'paused', timeline: nodes(22, 11, 'paused') }],
  ['Pausing after this item', { note: 'Pausing after this item' }],
  ['Stopping after this item', { note: 'Stopping after this item' }],
  ['Run failed mid-step', { ...lookup, action: 'Read the job summary', elapsed: '41s', timeline: nodes(4, 3, 'failed'), problem: 'This step failed.', browsers: [browser('UCPath', 'ready')] }],
  ['Browsers: Unavailable, Failed, Closed', { browsers: [browser('Kuali', 'ready'), browser('SharePoint', 'unavailable'), browser('UCPath', 'failed'), browser('Kronos', 'closed')] }],
  ['Starting', { subject: 'Casey Rivera', state: 'starting', action: 'Preparing worker', elapsed: '12s', timeline: nodes(22, 0), browsers: [browser('Kuali', 'starting'), browser('UCPath', 'unopened'), browser('Kronos', 'unopened')] }],
  ['Idle', { ...lookup, subject: undefined, state: 'idle', action: 'Ready for the next run', elapsed: undefined, timeline: undefined, browsers: [browser('UCPath', 'ready')] }],
  ['Seven browser sessions', { browsers: [browser('Kuali', 'ready'), browser('UCPath', 'active'), browser('Kronos', 'ready'), browser('OnBase', 'ready'), browser('CRM', 'starting'), browser('SharePoint', 'unavailable'), browser('Duo', 'ready')] }],
  ['Long names', { subject: 'Alexandria Montgomery-Hernandez Fitzgerald', action: 'Verify the matching person against the Work-Study roster', timeline: nodes(22, 5) }],
];

export function SessionsStates() {
  return <div data-sessions-states className="grid w-[1400px] grid-cols-4 items-stretch gap-x-4 gap-y-6 p-6">{STATES.map(([title, patch], index) => <div key={title} className="flex min-w-0 flex-col gap-2 [&>article]:flex-1">
    <span className="text-caption text-ui-secondary">{title}</span>
    <WorkerCard countdown={patch.state === 'idle' ? { remainingMs: IDLE_REFRESH_MS, waiting: false } : undefined} worker={{ id: `state-${index}`, label: `Worker ${index + 1}`, ...base, ...patch }} onControl={() => {}} />
  </div>)}</div>;
}
