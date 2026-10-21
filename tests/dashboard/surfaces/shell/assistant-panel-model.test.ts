import { describe, it, expect } from 'vitest';
import { assistantWorkflowRows, createAssistantMockProducer, type AssistantFile } from '../../../../src/dashboard/surfaces/shell/assistant-panel-model.js';
const file: AssistantFile = { id: 'people', name: 'People.csv', status: 'Attached', workbook: { name: 'People.csv', themes: {}, hasFormulas: false, sheets: [{ id: 'people', name: 'People', width: 2, hidden: [], rows: [
  { id: 'header', cells: [{ value: 'Name' }, { value: 'Separation date' }] },
  { id: 'one', cells: [{ value: 'Alex Rivera' }, { value: '2026-10-19' }] },
  { id: 'two', cells: [{ value: 'Casey Lin' }, { value: '' }] },
  { id: 'empty', cells: [{ value: '' }, { value: '' }] },
] }] } };
const value = { text: 'run separations', files: [file], model: 'GPT-6.1 Sol', effort: 'Medium', approval: 'Ask only before submits' };
describe('assistant mock workflow review', () => {
  it('keeps row provenance and holds missing dates rather than inventing them', () => {
    expect(assistantWorkflowRows(file, 'separations')).toEqual([
      { sheet: 'People', row: 2, person: 'Alex Rivera', values: { Name: 'Alex Rivera', 'Separation date': '2026-10-19' }, issue: null },
      { sheet: 'People', row: 3, person: 'Casey Lin', values: { Name: 'Casey Lin', 'Separation date': '' }, issue: 'Needs date' },
    ]);
  });
  it('refuses a workflow without a readable spreadsheet and preserves the prior conversation', async () => {
    const producer = createAssistantMockProducer(), initial = producer.initial();
    await expect(producer.send(initial, { ...value, files: [] })).rejects.toThrow('Attach a spreadsheet');
    expect(initial.messages).toEqual([]);
    expect(initial.scene).toBe('new');
  });
  it('reviews actual supplied people and leaves workflow execution to the callback', async () => {
    const producer = createAssistantMockProducer();
    const next = await producer.send(producer.initial(), value);
    expect(next.source).toBe('mock'); expect(next.workflow?.state).toBe('review');
    expect(next.workflow?.rows.map(row => row.person)).toEqual(['Alex Rivera', 'Casey Lin']);
    expect(next.files).toEqual([file]);
    expect(next.workflow?.outputs).toEqual([]);
  });
  it('uses onboarding dates and refuses an empty workbook', async () => {
    expect(assistantWorkflowRows(file, 'onboarding').every(row => row.issue === 'Needs date')).toBe(true);
    const producer = createAssistantMockProducer();
    const empty = { ...file, workbook: { ...file.workbook!, sheets: [] } };
    await expect(producer.send(producer.initial(), { ...value, text: 'run onboardings', files: [empty] })).rejects.toThrow('no people');
  });
  it('does not simulate a saved result when an operator approves or cancels', async () => {
    const producer = createAssistantMockProducer('ask-write');
    expect((await producer.act(producer.initial(), 'approve')).scene).toBe('working');
    expect((await producer.act(producer.initial(), 'cancel')).scene).toBe('cancelling');
    expect((await producer.act(producer.initial(), 'decline')).scene).toBe('declined');
  });
});

for (const text of ['An ordinary first message', 'run separations']) {
  it(`preserves a custom title and auto-titles only New chat for ${text}`, async () => {
    const producer = createAssistantMockProducer();
    const initial = producer.initial();
    const custom = await producer.send({ ...initial, title: 'Operator title' }, { ...value, text });
    expect(custom.title).toBe('Operator title');
    const automatic = await producer.send(initial, { ...value, text });
    expect(automatic.title).toBe(text === 'run separations' ? 'Run separations' : text);
    const next = await producer.send(automatic, { ...value, text: 'run separations' });
    expect(next.title).toBe(automatic.title);
  });
}
