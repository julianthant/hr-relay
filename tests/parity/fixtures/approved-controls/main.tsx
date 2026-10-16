import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DsBodyScope, TooltipProvider } from '../../../../src/dashboard/ds/ui.js';
import { QueuePanel } from '../../../../src/dashboard/surfaces/queue/queue.js';
import { seedMockRuns } from '../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js';
import { mockQueueOutcomes, mockQueueSurfaces } from '../../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js';
import { ActivityView } from '../../../../src/dashboard/surfaces/activity/activity-view.js';
import { ACTIVITY_SAMPLE_RANGE, ACTIVITY_SAMPLE_TODAY, activitySample } from '../../../../src/dashboard/surfaces/activity/activity-fixture.js';
import { SpreadsheetEditor } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor.js';
import { newEditableWorkbook, type SpreadsheetSaveResult } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
import './style.css';
const query = new URLSearchParams(location.search);
const surface = query.get('surface') ?? 'save';
const mode = query.get('mode') ?? 'confirmed';
document.documentElement.setAttribute('data-demo-theme', 'dark');
document.body.setAttribute('data-demo-theme', 'dark');
let calls = 0;
function countCall() { document.body.setAttribute('data-action-calls', String(++calls)); }
function Fixture() {
  const [book, setBook] = useState(newEditableWorkbook), [dirty, setDirty] = useState(true);
  if (surface === 'queue') {
    const runs = seedMockRuns().filter(run => run.workflowId === 'person-lookup');
    if (runs.length !== 8) throw new Error('lookup-fixture-missing');
    const surfaces = mockQueueSurfaces(runs, '2026-08-03');
    return <QueuePanel outcomes={mockQueueOutcomes(runs)} surfaces={surfaces} state={{ nowIso: '2026-08-03T20:00:00.000Z', openWells: new Set() }} handlers={{ onSelect() {} }} workflowLabelOf={() => 'Person Lookup'} panelLabel="Person Lookup" day="2026-08-03" />;
  }
  if (surface === 'export') return <ActivityView data={activitySample(ACTIVITY_SAMPLE_RANGE, 'normal')} range={ACTIVITY_SAMPLE_RANGE} today={ACTIVITY_SAMPLE_TODAY} period="custom" onPreset={() => {}} onRange={() => {}} onExport={() => {
    countCall();
    if (mode === 'pending') return new Promise<void>(() => {});
    return Promise.reject(new Error('Synthetic export refusal'));
  }} />;
  return <SpreadsheetEditor document={book} dirty={dirty} onDocument={(next, changed) => { if (!next) throw new Error('fixture-document-closed'); setBook(next); setDirty(changed); }} onSave={async draft => {
    countCall();
    if (mode === 'pending') return new Promise<SpreadsheetSaveResult>(() => {});
    if (mode === 'confirmed') return { state: 'confirmed', version: 7, readback: structuredClone(draft) };
    if (mode === 'mismatch') return { state: 'confirmed', version: 7, readback: { ...draft, name: 'Other workbook' } };
    if (mode !== 'refused' && mode !== 'conflict' && mode !== 'uncertain') throw new Error('fixture-mode-invalid');
    return { state: mode, reason: 'The library did not confirm this draft.' };
  }} />;
}
const container = document.getElementById('controls-fixture');
if (!container) throw new Error('controls-fixture-missing');
createRoot(container).render(<TooltipProvider><main className="min-h-screen bg-ui-canvas p-6 text-ui-primary"><DsBodyScope><Fixture /></DsBodyScope></main></TooltipProvider>);
