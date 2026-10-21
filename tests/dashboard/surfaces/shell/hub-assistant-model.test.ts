import { createDashboardClient } from '../../../../src/dashboard/client/index.js';
import { createSpreadsheetWiringAdapter } from '../../../../src/dashboard/state/spreadsheet-wiring-adapter.js';
import { describe, it, expect } from 'vitest';
import { createHubAssistantSession, prepareHubWorkflow } from '../../../../src/dashboard/surfaces/shell/hub-assistant-model.js';
import { assistantWorkflowRows, type AssistantFile, type AssistantWorkflowRequest } from '../../../../src/dashboard/surfaces/shell/assistant-panel-model.js';
import { workflowComposition } from '../../../../src/dashboard/app/workflow-sources.js';
import { addSpreadsheetColumn } from '../../../../src/dashboard/surfaces/spreadsheets/spreadsheet-editor-model.js';
const file: AssistantFile = { id: 'people', name: 'People.csv', status: 'Attached', workbook: { name: 'People.csv', themes: [], hasFormulas: false, sheets: [{ id: 'people', name: 'People', width: 3, hidden: [], rows: [
  { id: 'header', cells: ['Name', 'Separation date', 'Kuali ID'].map(value => ({ value })) },
  { id: 'one', cells: ['Alex Rivera', '2026-10-19', '2230001'].map(value => ({ value })) },
  { id: 'two', cells: ['Morgan Vega', '', '2230002'].map(value => ({ value })) },
] }] } };
const composition = workflowComposition({ separations: 'mock', onboarding: 'mock' });
const request: AssistantWorkflowRequest = { workflowId: 'separations', source: 'mock', dryRun: true, conversationId: 'chat', file, rows: assistantWorkflowRows(file, 'separations').filter(row => row.issue === null) };
describe('integrated assistant sample runs', () => {
  it('starts only reviewed rows through the existing mock launch path and preserves held cells', () => {
    const { runs, result } = prepareHubWorkflow(request, composition, 10);
    expect(runs).toHaveLength(1); expect(runs[0].subject).toBe('2230001'); expect(runs[0].title).toBe('Alex Rivera'); expect(runs[0].draft.dryRun).toBe(true);
    expect(result.state).toBe('complete'); if (result.state !== 'complete') throw Error('missing result');
    expect(result.files.map(file => file.status)).toEqual(['Updated', 'Generated']);
    expect(result.files[0].workbook?.sheets[0].rows.map(row => row.cells.map(cell => cell.value))).toEqual([
      ['Name', 'Separation date', 'Kuali ID', 'Relay result'], ['Alex Rivera', '2026-10-19', '2230001', 'Sample dry run complete'], ['Morgan Vega', '', '2230002', ''],
    ]);
    expect(file.workbook?.sheets[0].width).toBe(3);
  });
  it('refuses served composition, held rows and missing launch identities', () => {
    expect(() => prepareHubWorkflow(request, workflowComposition({ separations: 'served' }), 0)).toThrow('sample dry runs only');
    expect(() => prepareHubWorkflow({ ...request, rows: assistantWorkflowRows(file, 'separations') }, composition, 0)).toThrow('Review');
    expect(() => prepareHubWorkflow({ ...request, rows: [{ ...request.rows[0], values: { Name: 'Alex Rivera' } }] }, composition, 0)).toThrow('Kuali ID');
    expect(() => prepareHubWorkflow({ ...request, rows: [{ ...request.rows[0], values: { 'Kuali ID': '2230001\n2230002' } }] }, composition, 0)).toThrow('one Kuali ID per row');
  });
  it('adds the result column at the selected header and preserves sparse rows', () => {
    const sheet = addSpreadsheetColumn({ id: 's', name: 'Sheet', width: 2, hidden: [], headerRow: 2, rows: [{ id: 'preamble', cells: [{ value: 'Source' }] }, { id: 'head', cells: [{ value: 'Name' }, { value: 'Date' }] }] }, 'Result');
    expect(sheet.rows.map(row => row.cells.map(cell => cell.value))).toEqual([['Source', null, ''], ['Name', 'Date', 'Result']]);
  });
});

it('publishes non-workbook files only after a committed send and keeps their exact blob', async () => {
  const client = createDashboardClient({ baseUrl: 'http://localhost', fetchImpl: () => { throw Error('A mock file must not make a served request.'); } });
  const session = createHubAssistantSession('chat', createSpreadsheetWiringAdapter(client));
  const raw = new File(['Sample notes'], 'Notes.txt', { type: 'text/plain' });
  const attached = await session.attach(raw);
  expect(session.files.snapshot()).toHaveLength(0);
  const sent = { ...session.producer.initial(), files: [attached] };
  session.producer.retain(sent); session.producer.retain(sent);
  expect(session.files.snapshot()).toHaveLength(1);
  const entry = session.reference(attached), opened = await session.files.open(entry);
  expect(opened.kind).toBe('mock');
  if (opened.kind !== 'mock') throw Error('Missing mock file');
  expect(opened.blob).toBe(raw); expect(await opened.blob.text()).toBe('Sample notes');
});
