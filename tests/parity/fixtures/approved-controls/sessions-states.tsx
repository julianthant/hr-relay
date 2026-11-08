import { WorkerCardWireSchema, UnavailableWorkerCardWireSchema, type DashboardDayWire } from '../../../../src/models/dashboard/projection.js';
import { IDLE_REFRESH_MS } from '../../../../src/dashboard/surfaces/sessions/session-idle-model.js';
import { sessionsFromDay } from '../../../../src/dashboard/surfaces/sessions/sessions-view-model.js';
import { WorkerCard } from '../../../../src/dashboard/surfaces/sessions/worker-card.js';

const NOW = '2026-08-03T17:00:00.000Z';
const ago = (seconds: number) => new Date(Date.parse(NOW) - seconds * 1000).toISOString();
const uuidOf = (seed: number) => { const digits = String(seed).padStart(12, '0'); return `${digits.slice(0, 8)}-${digits.slice(8, 12)}-4000-8000-${digits}`; };
const traceOf = (seed: number) => { const tick = String(seed % 60).padStart(2, '0'); return `pl-09${tick}${tick}-${String(seed % 10000).padStart(4, '0')}`; };

type Step = DashboardDayWire['queueSurfaces'][number]['pipeline'][number];
type StepState = Step['state'];
const NAMED = new Map([[11, 'Read the timecard'], [14, 'Confirm the matching employee'], [5, 'Verify the matching person against the Work-Study roster']]);
const pipeline = (count: number, done: number, at: StepState = 'active'): Step[] =>
  Array.from({ length: count }, (_, index) => ({ id: `step-${index}`, label: NAMED.get(index) ?? `Step ${index + 1}`, state: index < done ? 'done' : index === done ? at : 'pending' }));
const lookupSteps = (done: number, at: StepState = 'active'): Step[] => ['Open UCPath', 'Search the employee', 'Verify the matching person', 'Read the job summary'].map((label, index) => ({ id: `lookup-${index}`, label, state: index < done ? 'done' : index === done ? at : 'pending' }));

const rows: Record<string, { seed: number; workflowId: string; title: string; steps: Step[]; message?: string }> = {};
const row = (key: string, workflowId: string, title: string, steps: Step[], message?: string) => { rows[key] = { seed: 100 + Object.keys(rows).length, workflowId, title, steps, message }; return rows[key].seed; };

const member = (ordinal: number, workflowId: string) => ({ workflowId, workerId: `${workflowId}-worker-${ordinal}`, ordinal, poolIndex: ordinal, membershipRevision: 1 });
const browser = (seed: number, system: string, health: 'authenticated' | 'starting' | 'unknown' | 'failed', signIn?: string) => ({ sessionId: uuidOf(seed), system, openedAt: ago(130),
  observation: { state: 'present', health, observedAt: ago(10), browserMode: 'headed', configFingerprint: 'a'.repeat(64) }, ...(signIn === undefined ? {} : { signIn }) });
const THREE = ['kuali', 'ucpath', 'new-kronos'];
const threeOpen = (seed: number) => [browser(seed, 'kuali', 'authenticated', 'signed-in'), browser(seed + 1, 'ucpath', 'authenticated', 'signed-in'), browser(seed + 2, 'new-kronos', 'unknown', 'signed-in')];
const allReady = (seed: number) => [browser(seed, 'kuali', 'authenticated', 'signed-in'), browser(seed + 1, 'ucpath', 'authenticated', 'signed-in'), browser(seed + 2, 'new-kronos', 'authenticated', 'signed-in')];
const runOf = (key: string) => ({ state: 'present', runId: uuidOf(rows[key].seed), traceId: traceOf(rows[key].seed) });
const settled = (key: string, reason: 'crashed' | 'operator' | 'shutdown', seconds: number, node: string) => ({ state: 'failed', directive: 'stop', endedAt: ago(0), stopReason: reason, startedAt: ago(seconds),
  currentRun: { state: 'absent', reason: 'the worker is settled' }, browsers: [], lastBrowsers: threeOpen(700).map(({ signIn: _signIn, observation: _observation, ...rest }) => rest),
  lastRun: { state: 'present', runId: uuidOf(rows[key].seed), traceId: traceOf(rows[key].seed), step: { nodeId: node, state: 'open', startedAt: ago(seconds / 2) } },
  timeline: { state: 'present' } });

const crashedRun = row('crashed', 'separations', 'Alex Morgan', pipeline(22, 11, 'pending'));
const stoppedRun = row('stopped', 'separations', 'Alex Morgan', pipeline(22, 11, 'pending'));
const waitingRun = row('waiting', 'separations', 'Alex Morgan', pipeline(22, 14, 'blocked'));
const liveRun = row('live', 'separations', 'Alex Morgan', pipeline(22, 11));
const failedStepRun = row('failed-step', 'person-lookup', 'Jordan Lee', lookupSteps(3, 'failed'));
const startingRun = row('starting', 'separations', 'Casey Rivera', pipeline(22, 0), 'Preparing worker');
const longRun = row('long', 'separations', 'Alexandria Montgomery-Hernandez Fitzgerald', pipeline(22, 5));
const signedOutRun = row('signed-out', 'separations', 'Alex Morgan', pipeline(22, 11));
const duoRun = row('needs-duo', 'separations', 'Alex Morgan', pipeline(22, 11));
const signingRun = row('signing-in', 'separations', 'Alex Morgan', pipeline(22, 0));
void [crashedRun, stoppedRun, waitingRun, liveRun, failedStepRun, startingRun, longRun, signedOutRun, duoRun, signingRun];

const SEP = 'separations';
const LOOKUP = 'person-lookup';
const base = (ordinal: number, workflowId: string, key: string, over: Record<string, unknown>) => ({
  member: member(ordinal, workflowId), workerId: `${workflowId}-worker-${ordinal}`, workflowId, state: 'running', directive: 'run', startedAt: ago(134),
  currentRun: runOf(key), browserRequirements: { state: 'present', systems: THREE }, browsers: threeOpen(200 + ordinal * 10), timeline: { state: 'present' },
  leaseVersion: 1, revision: 1, ...over,
});

/** Every card state the served model produces, built as served worker cards and folded through the real day model. The first thirteen reproduce the approved sheet. */
const STATES: readonly (readonly [string, Record<string, unknown>])[] = [
  ['Failed (crashed, last values)', base(1, SEP, 'crashed', settled('crashed', 'crashed', 362, 'step-11'))],
  ['Stopped by you (last values)', base(2, SEP, 'stopped', settled('stopped', 'operator', 220, 'step-11'))],
  ['Failed, run record gone', base(3, LOOKUP, 'failed-step', { state: 'failed', directive: 'stop', endedAt: ago(0), stopReason: 'crashed', startedAt: ago(72), currentRun: { state: 'absent', reason: 'the worker is settled' },
    browserRequirements: { state: 'present', systems: ['ucpath'] }, browsers: [], lastRun: { state: 'unavailable', reason: 'run-unavailable' }, timeline: { state: 'unavailable', reason: 'run-unavailable' } })],
  ['Waiting', base(4, SEP, 'waiting', { state: 'waiting', browsers: allReady(210) })],
  ['Paused', base(5, SEP, 'live', { state: 'paused', directive: 'pause', browsers: allReady(220) })],
  ['Pausing after this item', base(6, SEP, 'live', { directive: 'pause' })],
  ['Stopping after this item', base(7, SEP, 'live', { directive: 'stop' })],
  ['Run failed mid-step', base(8, LOOKUP, 'failed-step', { startedAt: ago(41), browserRequirements: { state: 'present', systems: ['ucpath'] }, browsers: [browser(300, 'ucpath', 'authenticated', 'signed-in')] })],
  ['Browsers: Unavailable, Failed, Closed', base(9, SEP, 'live', { browserRequirements: { state: 'present', systems: ['kuali', 'sharepoint', 'ucpath', 'new-kronos'] }, closedBrowserSystems: ['new-kronos'],
    browsers: [browser(310, 'kuali', 'authenticated', 'signed-in'), { sessionId: uuidOf(311), system: 'sharepoint', openedAt: ago(100), observation: { state: 'unavailable', reason: 'The SharePoint page did not answer.' } }, browser(312, 'ucpath', 'failed')] })],
  ['Starting', base(10, SEP, 'starting', { state: 'starting', startedAt: ago(12), browsers: [browser(320, 'kuali', 'starting', 'signing-in')] })],
  ['Idle', base(11, LOOKUP, 'failed-step', { state: 'idle', currentRun: { state: 'absent', reason: 'no claimable work' }, browserRequirements: { state: 'present', systems: ['ucpath'] }, browsers: [browser(330, 'ucpath', 'authenticated', 'signed-in')], timeline: undefined })],
  ['Seven browser sessions', base(12, SEP, 'live', { browserRequirements: { state: 'present', systems: ['kuali', 'ucpath', 'new-kronos', 'onbase', 'crm', 'sharepoint', 'servicenow'] },
    browsers: [browser(340, 'kuali', 'authenticated', 'signed-in'), browser(341, 'ucpath', 'unknown', 'signed-in'), browser(342, 'new-kronos', 'authenticated', 'signed-in'), browser(343, 'onbase', 'authenticated', 'signed-in'),
      browser(344, 'crm', 'starting', 'signing-in'), { sessionId: uuidOf(345), system: 'sharepoint', openedAt: ago(100), observation: { state: 'unavailable', reason: 'The SharePoint page did not answer.' } }, browser(346, 'servicenow', 'authenticated', 'signed-in')] })],
  ['Long names', base(13, SEP, 'long', {})],
  ['Needs Duo and Signed out', base(14, SEP, 'needs-duo', { browsers: [browser(400, 'kuali', 'starting', 'needs-duo'), browser(401, 'ucpath', 'unknown', 'signed-out'), browser(402, 'new-kronos', 'authenticated', 'signed-in')] })],
  ['Waiting: signing in', base(15, SEP, 'signing-in', { state: 'waiting', waitingActivity: 'authenticating', browsers: [browser(410, 'kuali', 'authenticated', 'signed-in'), browser(411, 'ucpath', 'starting', 'signing-in')] })],
  ['Idle after a finished run', base(16, LOOKUP, 'failed-step', { state: 'idle', currentRun: { state: 'absent', reason: 'no claimable work' }, browserRequirements: { state: 'present', systems: ['ucpath'] }, browsers: [browser(420, 'ucpath', 'authenticated', 'signed-in')],
    lastRun: { state: 'present', runId: uuidOf(rows['failed-step'].seed), traceId: traceOf(rows['failed-step'].seed), outcome: 'done', endedAt: ago(300) }, timeline: undefined })],
];
const UNAVAILABLE = UnavailableWorkerCardWireSchema.parse({ member: member(17, SEP), workerId: `${SEP}-worker-17`, availability: { state: 'unavailable', reason: 'worker-card-unavailable' } });

const queueSurfaces = Object.values(rows).map(({ seed, workflowId, title, steps, message }) => ({ runId: uuidOf(seed), traceId: traceOf(seed), workflowId, title, pipeline: steps,
  liveMessage: message === undefined ? { state: 'absent', reason: 'none' } : { state: 'present', value: message } }));
const catalog = [{ id: SEP, label: 'Separations' }, { id: LOOKUP, label: 'Person Lookup' }];
const workers = STATES.map(([title, card], index) => {
  const view = sessionsFromDay({ workerAuthority: { state: 'present', members: [] }, workerCards: [WorkerCardWireSchema.parse(card)], queueSurfaces } as unknown as DashboardDayWire, catalog as never, NOW);
  if (view.state !== 'ready' || view.workers.length !== 1) throw new Error(`sessions-states-unavailable:${title}`);
  return [title, { ...view.workers[0], id: `state-${index}` }] as const;
});
const unavailableView = sessionsFromDay({ workerAuthority: { state: 'present', members: [] }, workerCards: [], unavailableWorkerCards: [UNAVAILABLE], queueSurfaces } as unknown as DashboardDayWire, catalog as never, NOW);
if (unavailableView.state !== 'ready') throw new Error('sessions-states-unavailable-card');
const unavailable = unavailableView.workers[0];

export function SessionsStates() {
  const all = [...workers, ['One card that could not be built', { ...unavailable, id: 'state-unavailable' }] as const];
  return <div data-sessions-states className="grid w-[1400px] grid-cols-4 items-stretch gap-x-4 gap-y-6 p-6">{all.map(([title, worker]) => <div key={title} className="flex min-w-0 flex-col gap-2 [&>article]:flex-1">
    <span className="text-caption text-ui-secondary">{title}</span>
    <WorkerCard countdown={worker.state === 'idle' ? { remainingMs: IDLE_REFRESH_MS, waiting: false } : undefined} worker={worker} onControl={() => {}} />
  </div>)}</div>;
}
