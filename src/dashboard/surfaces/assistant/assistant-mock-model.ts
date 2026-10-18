import type { AssistantMockProposal, AssistantState } from './assistant-model.js';

export const ASSISTANT_MOCK_PROMPT = 'Check Avery Sample and Morgan Example in Person Lookup. Read only; stop before any changes.';
export const ASSISTANT_MOCK_REVISION = 'demo-context-7';
export const ASSISTANT_MOCK_SOURCE = {
  id: 'demo-read-only', title: 'Person Lookup · Read-only checks', url: 'https://example.org/relay/person-lookup',
  excerpt: 'Read the two systems and compare identity and employment status. Stop before any change to an employee record.',
  version: 'Synthetic public guide · demo-context-7',
} as const;

export function assistantMockProposal(prompt = ASSISTANT_MOCK_PROMPT, revision = ASSISTANT_MOCK_REVISION, id = 'demo-plan-1'): AssistantMockProposal {
  return {
    id, prompt, revision, workflow: { id: 'person-lookup', label: 'Person Lookup', version: 'demo-v1' },
    subjects: [{ id: 'DEMO-001', name: 'Avery Sample' }, { id: 'DEMO-002', name: 'Morgan Example' }],
    values: [{ label: 'Systems', value: 'UCPath and CRM' }, { label: 'Match', value: 'Exact synthetic subject IDs' }],
    mode: 'read-only', effects: ['Read identity and employment status for these two subjects.', 'Show the comparison in Queue and Logs.'],
    stopBefore: ['Any Save, Submit, or employee-record change.', 'Any identity ambiguity; ask the operator to resolve it.'],
  };
}

export function assistantMockState(scene = 'proposal'): AssistantState {
  const prompt = ASSISTANT_MOCK_PROMPT;
  const messages: AssistantState['messages'] = [
    { id: 'hello', role: 'assistant', text: 'I can explain a workflow or prepare a run for you to review. You choose whether to confirm it.' },
    { id: 'request', role: 'operator', text: prompt },
  ];
  const reply = { id: 'reply', role: 'assistant' as const, text: 'Here is the exact read-only proposal. Check the subjects and stop points before confirming.', sources: [ASSISTANT_MOCK_SOURCE] };
  if (scene === 'empty') return { draft: '', messages: [], sequence: 0, turn: { state: 'idle' } };
  if (scene === 'waiting' || scene === 'failed' || scene === 'cancelled') return { draft: prompt, messages, sequence: 1, turn: { state: scene, requestId: 1, prompt } };
  const history = scene === 'long' ? Array.from({ length: 18 }, (_, index) => ({
    id: `history-${index}`, role: index % 2 ? 'assistant' as const : 'operator' as const,
    text: index % 2 ? `Demo answer ${index + 1}: A read-only check compares the selected subjects. An identity disagreement stops the run for operator review. No employee record is changed.` : `Demo question ${index + 1}: Explain how the workflow handles an identity disagreement and where it stops.`,
    ...(index % 2 ? { sources: [ASSISTANT_MOCK_SOURCE] } : {}),
  })) : [];
  return { draft: prompt, messages: [...history, ...messages, reply], sequence: 1, turn: { state: 'proposal', proposal: { ...assistantMockProposal(), mode: scene === 'dry-run' ? 'dry-run' : 'read-only' }, disposition: scene === 'confirmed' ? 'confirmed' : 'review' } };
}
