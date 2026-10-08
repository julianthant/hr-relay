import { createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { QueuePanel } from '../../../src/dashboard/surfaces/queue/queue.js';
import { RunIdSchema, ItemIdSchema } from '../../../src/rules/identity/ids.js';
import { QueueSurfaceWireSchema } from '../../../src/models/dashboard/projection.js';
import { LogFeed } from '../../../src/dashboard/surfaces/run-detail/logs/log-feed.js';
import type { LogStep } from '../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js';
import '../../../src/dashboard/app/index.css';

const uuid = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const absent = (reason: string) => ({ state: 'absent', reason });
const now = '2026-08-03T18:00:00.000Z';
const base = QueueSurfaceWireSchema.parse({
  runId: uuid(1), itemId: uuid(1), workflowId: 'performance-fixture', traceId: 'pf-100001-0001', attempt: 1, lineage: { state: 'root' },
  actorId: 'fixture', appVersion: { state: 'present', value: '0.1.0' }, descriptorVersion: 1, descriptorHash: 'a'.repeat(64), configFingerprint: 'b'.repeat(64),
  resolvedInstances: [], dryRun: true, priority: 'interactive', runNumber: { state: 'present', value: 1 }, session: absent('No session'),
  containment: 'root', linkedRuns: [], facts: absent('No result'), startedAt: now, updatedAt: now, endedAt: absent('Not ended'), gateOpenedAt: absent('No gate'),
  displayName: absent('Not renamed'), title: 'Synthetic record', subtitle: absent('No subtitle'), status: 'queued', liveMessage: absent('No message'), warnings: absent('No warnings'),
  pipeline: [], panelKind: 'run', availableSections: ['logs'], actions: [], rowRevision: 1, surfaceKind: 'single',
});
const noop = () => undefined;
const label = () => 'Performance fixture';
const openWells = new Set<string>();
const params = new URLSearchParams(location.search);
const kind = params.get('kind') === 'logs' ? 'logs' : 'queue';
const count = Number(params.get('count') ?? 1240);
if (!Number.isInteger(count) || count < 1 || count > 20000) throw new Error('PERFORMANCE_FIXTURE_COUNT_INVALID');
const rows = Array.from({ length: count }, (_, index) => ({ ...base, runId: RunIdSchema.parse(uuid(index + 1)), itemId: base.itemId }));
// Unique logical items, preserving the same strict queue row grammar.
const surfaces = rows.map(row => ({ ...row, itemId: ItemIdSchema.parse(row.runId), title: `Synthetic record ${row.runId.slice(-6)}` }));
const steps: readonly LogStep[] = Array.from({ length: count }, (_, index) => ({ id: `step-${index}`, time: '10:00 AM', title: `Synthetic step ${index}`, entries: [{ kind: 'note', id: `entry-${index}`, time: '10:00 AM', message: `Synthetic action ${index}` }] }));

function Fixture() {
  const [selected, setSelected] = useState<string>();
  return <main className="h-screen p-4"><div className="flex h-full min-h-0 flex-col" style={{ width: kind === 'queue' ? 420 : 900 }}>
    {kind === 'queue' ? <QueuePanel surfaces={surfaces} panelLabel="Performance fixture" day="2026-08-03" state={{ selectedRunId: selected, nowIso: now, openWells }} handlers={{ onSelect: setSelected }} workflowLabelOf={label} />
      : <LogFeed steps={steps} navigation={jump => <button onClick={() => jump(`step-${count - 1}`)}>Jump to final step</button>} />}
    <button onClick={noop}>End fixture</button>
  </div></main>;
}
const root = document.getElementById('root');
if (!root) throw new Error('PERFORMANCE_FIXTURE_ROOT_MISSING');
const renderer = createRoot(root);
const start = performance.now();
flushSync(() => renderer.render(createElement(Fixture)));
requestAnimationFrame(() => requestAnimationFrame(() => {
  document.body.dataset.ready = String(performance.now() - start);
  Reflect.set(window, 'disposeFixture', () => { renderer.unmount(); });
}));
