export interface AssistantSource {
  readonly id: string;
  readonly title: string;
  readonly url: string;
  readonly excerpt: string;
  readonly version: string;
}

export interface AssistantMessage {
  readonly id: string;
  readonly role: 'operator' | 'assistant';
  readonly text: string;
  readonly sources?: readonly AssistantSource[];
}

export interface AssistantMockProposal {
  readonly id: string;
  readonly revision: string;
  readonly prompt: string;
  readonly workflow: { readonly id: string; readonly label: string; readonly version: string };
  readonly subjects: readonly { readonly id: string; readonly name: string }[];
  readonly values: readonly { readonly label: string; readonly value: string }[];
  readonly mode: 'dry-run' | 'read-only';
  readonly effects: readonly string[];
  readonly stopBefore: readonly string[];
}

export type AssistantTurn =
  | { readonly state: 'idle' }
  | { readonly state: 'waiting' | 'failed' | 'cancelled'; readonly requestId: number; readonly prompt: string }
  | { readonly state: 'proposal'; readonly proposal: AssistantMockProposal; readonly disposition: 'review' | 'edited' | 'cancelled' | 'confirmed' };

export interface AssistantState {
  readonly draft: string;
  readonly messages: readonly AssistantMessage[];
  readonly turn: AssistantTurn;
  readonly sequence: number;
}

export type AssistantAction =
  | { readonly type: 'edit'; readonly value: string }
  | { readonly type: 'send' | 'retry' | 'cancel' | 'confirm' | 'new-chat' }
  | { readonly type: 'reply'; readonly requestId: number; readonly proposal: AssistantMockProposal; readonly message: AssistantMessage }
  | { readonly type: 'fail'; readonly requestId: number };

export function assistantReducer(state: AssistantState, action: AssistantAction): AssistantState {
  const turn = state.turn;
  switch (action.type) {
    case 'new-chat':
      return { draft: '', messages: [], sequence: state.sequence, turn: { state: 'idle' } };
    case 'edit':
      return { ...state, draft: action.value, turn: turn.state === 'waiting' ? { ...turn, state: 'cancelled' } : turn.state === 'proposal' && turn.disposition === 'review' ? { ...turn, disposition: 'edited' } : turn };
    case 'send': {
      if (!state.draft.trim() || turn.state === 'waiting') return state;
      const requestId = state.sequence + 1;
      return { ...state, sequence: requestId, messages: [...state.messages, { id: `operator-${requestId}`, role: 'operator', text: state.draft }], turn: { state: 'waiting', requestId, prompt: state.draft } };
    }
    case 'retry':
      return turn.state === 'failed' && state.draft === turn.prompt
        ? { ...state, sequence: state.sequence + 1, turn: { ...turn, state: 'waiting', requestId: state.sequence + 1 } } : state;
    case 'reply':
      if (turn.state !== 'waiting' || turn.requestId !== action.requestId) return state;
      return { ...state, messages: [...state.messages, action.message], turn: { state: 'proposal', proposal: action.proposal, disposition: state.draft === turn.prompt ? 'review' : 'edited' } };
    case 'fail':
      return turn.state === 'waiting' && turn.requestId === action.requestId ? { ...state, turn: { ...turn, state: 'failed' } } : state;
    case 'cancel':
      if (turn.state === 'proposal' && turn.disposition !== 'confirmed') return { ...state, turn: { ...turn, disposition: 'cancelled' } };
      return turn.state === 'waiting' || turn.state === 'failed' ? { ...state, turn: { ...turn, state: 'cancelled' } } : state;
    case 'confirm':
      return turn.state === 'proposal' && turn.disposition === 'review' ? { ...state, turn: { ...turn, disposition: 'confirmed' } } : state;
  }
}

export const ASSISTANT_STARTERS = [
  'Check a person in Person Lookup (read-only)',
  'Dry-run separations for 2 people',
  'Explain what Emergency Contact does',
] as const;

export function assistantConfirmRefusal(state: AssistantState, revision: string, accountAvailable: boolean): string | undefined {
  const turn = state.turn;
  if (turn.state !== 'proposal') return 'No proposal to confirm.';
  if (turn.disposition === 'confirmed') return 'Mock confirmation recorded. No run was started.';
  if (turn.disposition === 'cancelled') return 'Proposal cancelled. No run was started.';
  if (!accountAvailable) return 'ChatGPT account unavailable. Confirmation is disabled.';
  if (turn.disposition === 'edited' || state.draft !== turn.proposal.prompt) return 'Request edited. Send it again to review a new proposal.';
  if (revision !== turn.proposal.revision) return 'Plan out of date. Send the request again to refresh it.';
  return undefined;
}
