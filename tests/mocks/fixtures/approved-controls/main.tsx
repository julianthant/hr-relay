import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DsBodyScope, TooltipProvider } from '../../../../src/dashboard/ds/ui.js';
import { QueueSurfaceWireSchema } from '../../../../src/models/dashboard/projection.js';
import { QueuePanel } from '../../../../src/dashboard/surfaces/queue/queue.js';
import { mockRunLog, seedMockRuns } from '../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js';
import { mockQueueOutcomes, mockQueueSurfaces } from '../../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js';
import { ActivityView } from '../../../../src/dashboard/surfaces/activity/activity-view.js';
import { ACTIVITY_SAMPLE_RANGE, ACTIVITY_SAMPLE_TODAY, activitySample } from '../../../../src/dashboard/surfaces/activity/activity-fixture.js';
import { SessionsView } from '../../../../src/dashboard/surfaces/sessions/sessions-view.js';
import { SessionsR2, SessionsStates } from './sessions-states.js';
import { sessionsSample } from '../../../../src/dashboard/surfaces/sessions/sessions-fixture.js';
import './style.css';
const query = new URLSearchParams(location.search);
const surface = query.get('surface') ?? 'save';
const mode = query.get('mode') ?? 'confirmed';
if (surface === 'sessions-bar') { document.documentElement.dataset.hub = ''; await import('../../../../src/dashboard/surfaces/shell/permanent-shell.css'); await import('../../../../src/dashboard/ds/theme/hub-theme.css'); }
const theme = query.get('theme') ?? 'dark';
document.documentElement.setAttribute('data-demo-theme', theme);
document.body.setAttribute('data-demo-theme', theme);
let calls = 0;
function countCall() { document.body.setAttribute('data-action-calls', String(++calls)); }
function SessionsBarHarness() {
  const [open, setOpen] = useState(query.get('open') === '1');
  return <div className="dashboard-shell">
    <SessionsView open={open} onOpenChange={setOpen} onControl={() => {}} onAdd={() => {}} workflows={[{ id: 'separations', label: 'Separations' }]} data={sessionsSample('active')} account={{ onSettings: () => {}, onLogout: () => {} }} />
  </div>;
}
function Fixture() {
  if (surface === 'sessions-states') return <SessionsStates />;
  if (surface === 'sessions-r2') return <SessionsR2 />;
  if (surface === 'sessions-bar') return <SessionsBarHarness />;
  if (surface === 'sessions') return <SessionsView open onOpenChange={() => {}} onControl={() => {}} onAdd={() => {}} workflows={[]} data={{ state: 'ready', workers:
    (['unopened', 'starting', 'active', 'ready', 'closed', 'unavailable'] as const).map((state, index) => ({
      id: `label-worker-${index}`, label: `Worker ${index + 1}`, workflowId: 'person-lookup', workflow: 'Person Lookup', state: 'idle', action: 'Ready for the next run',
      browsers: [{ id: 'ucpath', label: 'UCPATH', state }, { id: 'crm', label: 'CRM', state }],
    })) }} />;
  if (surface === 'queue') {
    const runs = seedMockRuns().filter(run => run.workflowId === 'person-lookup');
    if (runs.length !== 8) throw new Error('lookup-fixture-missing');
    const surfaces = mockQueueSurfaces(runs, '2026-08-03T16:10:00.000Z').map((surface, index) => {
      const { endTime } = mockRunLog(runs[index]);
      const end = `2026-08-03T${String(Number(endTime.slice(0, 2)) + 7).padStart(2, '0')}${endTime.slice(2)}.000Z`;
      return QueueSurfaceWireSchema.parse({ ...surface, startedAt: '2026-08-03T16:10:00.000Z', updatedAt: end,
        endedAt: surface.endedAt.state === 'present' ? { ...surface.endedAt, value: end } : surface.endedAt,
        gateOpenedAt: surface.gateOpenedAt.state === 'present' ? { ...surface.gateOpenedAt, value: end } : surface.gateOpenedAt });
    });
    return <QueuePanel outcomes={mockQueueOutcomes(runs)} surfaces={surfaces} state={{ nowIso: '2026-08-03T20:00:00.000Z', openWells: new Set() }} handlers={{ onSelect() {} }} workflowLabelOf={() => 'Person Lookup'} panelLabel="Person Lookup" day="2026-08-03" />;
  }
  if (surface === 'export') return <ActivityView data={activitySample(ACTIVITY_SAMPLE_RANGE, 'normal')} range={ACTIVITY_SAMPLE_RANGE} today={ACTIVITY_SAMPLE_TODAY} onRange={() => {}} onExport={() => {
    countCall();
    if (mode === 'pending') return new Promise<void>(() => {});
    return Promise.reject(new Error('Synthetic export refusal'));
  }} />;
  throw new Error('fixture-surface-unknown');
}
const container = document.getElementById('controls-fixture');
if (!container) throw new Error('controls-fixture-missing');
createRoot(container).render(<TooltipProvider><main className="min-h-screen bg-ui-canvas p-6 text-ui-primary"><DsBodyScope><Fixture /></DsBodyScope></main></TooltipProvider>);
