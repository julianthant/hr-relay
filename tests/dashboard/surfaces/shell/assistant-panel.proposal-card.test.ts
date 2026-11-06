// @vitest-environment jsdom
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { presentResult } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import { ASSISTANT_UNKNOWN_NOTICE } from '../../../../src/dashboard/surfaces/assistant/assistant-model.js';
import { ProposalCard } from '../../../../src/dashboard/surfaces/shell/assistant-panel.js';
import { AssistantActionProposalSchema, type AssistantProposalRow } from '../../../../src/models/dashboard/assistant.js';
import { ASSISTANT_START_PROPOSAL } from '../../../support/fixtures/dashboard/assistant-start.js';

type Disposition = Parameters<typeof ProposalCard>[0]['disposition'];
const start = ASSISTANT_START_PROPOSAL.effect === 'workflow-start' ? ASSISTANT_START_PROPOSAL : undefined!;
const withRows = (planned: AssistantProposalRow[], patch: Record<string, unknown> = {}, workflowId = start.workflowId) => AssistantActionProposalSchema.parse({
  ...start, source: 'entries', workflowId, startPlan: { ...start.startPlan, workflowId, planned }, ...patch });
const person = (name: string, employeeId: string): AssistantProposalRow => ({ title: `EID ${employeeId}`, subtitle: 'Person Lookup', display: { kind: 'person', name, employeeId } });
const pause = AssistantActionProposalSchema.parse({ chatId: start.chatId, actionId: start.actionId, revision: 1, expiresAt: '2099-01-01T00:00:00Z',
  label: 'Pause Onboarding', targetLabel: 'Onboarding request', effect: 'run-action', action: 'pause', workflowId: 'onboarding',
  run: { runId: '00000000-0000-4000-8000-000000000004', expectedVersion: 3 }, row: { title: 'Onboarding request', display: { kind: 'request' } } });

function render(proposal: typeof pause, disposition: Disposition = 'review') {
  const view = presentResult({ state: 'action-proposal', proposal }, 1, 'prompt').proposal!;
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(createElement(ProposalCard, { proposal: view, disposition, onCancel() {}, onConfirm() {} }));
  const facts = [...host.querySelectorAll('dt')].map(term => [term.textContent, term.nextElementSibling?.textContent]);
  const confirm = [...host.querySelectorAll('button')].find(button => button.textContent === 'Confirm');
  return { host, facts, confirm };
}

describe('assistant proposal card rows', () => {
  it('shows one line per person in served order: Person with name and EID, EID alone, or Name alone, then the total', () => {
    const { facts } = render(withRows([person('Vega, Morgan', '10000002'), person('Sample, Avery', '10101010'), { title: 'EID 10000003', display: { kind: 'person', employeeId: '10000003' } },
      { title: 'Lin, Casey', display: { kind: 'person', name: 'Lin, Casey' } }], { targetLabel: '4 people' }));
    expect(facts.slice(0, -1)).toEqual([['Person', 'Vega, Morgan EID 10000002'], ['Person', 'Sample, Avery EID 10101010'],
      ['EID', '10000003'], ['Name', 'Lin, Casey'], ['Total', '4']]);
    expect(facts.at(-1)).toEqual(['Options', 'Read only']);
  });
  it('shows Separations document numbers as documents, never as people', () => {
    const { facts } = render(withRows([{ title: 'Doc 4501', display: { kind: 'document', documentNumber: '4501' } }, { title: 'Doc 4502', display: { kind: 'document', documentNumber: '4502' } }],
      { label: 'Start Separations', targetLabel: '2 documents' }, 'separations'));
    for (const term of ['Person', 'EID', 'Name']) expect(facts.map(([label]) => label)).not.toContain(term);
    expect(facts.slice(0, 3)).toEqual([['Document', '4501'], ['Document', '4502'], ['Total', '2']]);
  });
  it('shows a single request by its title without a total', () => {
    const { facts } = render(withRows([{ title: 'Onboarding for the reviewed sheet row', display: { kind: 'request' } }], { targetLabel: 'Onboarding for the reviewed sheet row' }));
    expect(facts).toEqual([['Request', 'Onboarding for the reviewed sheet row'], ['Options', 'Read only']]);
  });
  it('shows a run action\'s row with the local change mode', () => {
    const { facts, confirm } = render(pause);
    expect(facts).toEqual([['Request', 'Onboarding request'], ['Options', 'Local change · Pause']]);
    expect(confirm?.disabled).toBe(false);
  });
  it('renders no card for an unknown outcome; its one line is the transcript message', () => {
    expect(render(withRows([person('Sample, Avery', '10101010')]), 'unknown').host.innerHTML).toBe('');
    expect(presentResult({ state: 'unknown', actionId: start.actionId, action: withRows([person('Sample, Avery', '10101010')]) }, 1, 'prompt').message.text).toBe(ASSISTANT_UNKNOWN_NOTICE);
    expect(ASSISTANT_UNKNOWN_NOTICE).toBe('Couldn\'t finish this.');
  });
  it('names the one row or the served count on the resolved line', () => {
    expect(render(withRows([person('Sample, Avery', '10101010')]), 'confirmed').host.textContent).toBe('Start Person Lookup · Sample, AveryStarted');
    expect(render(withRows([person('Vega, Morgan', '10000002'), person('Sample, Avery', '10101010')], { targetLabel: '2 people' }), 'cancelled').host.textContent).toBe('Start Person Lookup · 2 peopleNot started');
    expect(render(pause, 'confirmed').host.textContent).toBe('Pause Onboarding · Onboarding requestDone');
  });
});
