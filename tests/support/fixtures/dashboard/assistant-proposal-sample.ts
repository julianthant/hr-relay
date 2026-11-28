import type { AssistantState } from '../../../../src/dashboard/surfaces/assistant/assistant-model.js';

export const ASSISTANT_MOCK_PROMPT = 'Check Avery Sample and Morgan Example in Person Lookup. Read only; stop before any changes.';

/** A chat whose last message asked for a proposal, in the turn state `scene` names. */
export function assistantMockState(scene: 'empty' | 'waiting' | 'failed' | 'cancelled' = 'waiting'): AssistantState {
  const prompt = ASSISTANT_MOCK_PROMPT;
  if (scene === 'empty') return { draft: '', messages: [], sequence: 0, turn: { state: 'idle' } };
  const messages: AssistantState['messages'] = [
    { id: 'hello', role: 'assistant', text: 'I can explain a workflow or propose a run. Reply yes to file a proposal.' },
    { id: 'request', role: 'operator', text: prompt },
  ];
  return { draft: prompt, messages, sequence: 1, turn: { state: scene, requestId: 1, prompt } };
}
