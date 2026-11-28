import { ERROR_CATALOG } from '../../../models/failures/error-catalog.js';
import { ASSISTANT_FAILURES, ASSISTANT_MODEL_COMMAND } from '../../../models/dashboard/assistant.js';
import type { AssistantApprovalMode, AssistantFailureCode, AssistantReplyPart, AssistantSessionView } from "../../../models/dashboard/assistant.js";
/** How the panel stands on the saved chat: still being read, unreadable, read with a note to show, or read clean. */
export type AssistantHistoryState = 'loading' | 'failed' | 'notice' | 'ready';
export function assistantHistoryState(loading: boolean, notice: string | undefined): AssistantHistoryState {
  if (loading) return 'loading';
  if (notice === ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNAVAILABLE) return 'failed';
  return notice ? 'notice' : 'ready';
}
export const ASSISTANT_UNKNOWN_NOTICE = ERROR_CATALOG.ASSISTANT_OUTCOME_UNKNOWN.text;
export interface AssistantSource {
  readonly id: string;
  readonly title: string;
  readonly url?: string;
  readonly excerpt: string;
  readonly version: string;
}

export interface AssistantMessage {
  readonly id: string;
  readonly role: 'operator' | 'assistant';
  /** Plain text: an operator message, a refusal, or a reply's words for titles and copy. */
  readonly text: string;
  /** A served reply's parts; the panel renders these instead of `text`. */
  readonly parts?: readonly AssistantReplyPart[];
  readonly sources?: readonly AssistantSource[];
  readonly code?: AssistantFailureCode;
  readonly attachments?: readonly { readonly id: string; readonly name: string }[];
}

export type AssistantTurn =
  | { readonly state: 'idle' }
  | { readonly state: 'waiting' | 'failed' | 'cancelled' | 'unknown'; readonly requestId: number; readonly prompt: string; readonly staged?: readonly string[]; readonly approvalMode?: AssistantApprovalMode;
      /** The served message id; a Retry of a lost reply resends it, so the server replays a turn it already accepted instead of running it again. */
      readonly messageId?: string };

export interface AssistantState {
  readonly draft: string;
  readonly messages: readonly AssistantMessage[];
  readonly turn: AssistantTurn;
  readonly sequence: number;
  readonly restored?: boolean;
  /** The served view of each session chip in the chat: status and Stop. */
  readonly sessions?: readonly AssistantSessionView[];
}

export type AssistantAction =
  | { readonly type: 'edit'; readonly value: string }
  | { readonly type: 'send'; readonly attachments?: readonly { readonly id: string; readonly name: string }[]; /** Staged attachment ids the request names. */ readonly staged?: readonly string[]; readonly messageId?: string; readonly approvalMode?: AssistantApprovalMode }
  | { readonly type: 'retry' | 'cancel' | 'new-chat' }
  | { readonly type: 'settle'; readonly requestId: number; readonly message: AssistantMessage }
  | { readonly type: 'fail' | 'uncertain'; readonly requestId: number };

export function assistantReducer(state: AssistantState, action: AssistantAction): AssistantState {
  const turn = state.turn;
  switch (action.type) {
    case 'new-chat':
      return { draft: '', messages: [], sequence: state.sequence, turn: { state: 'idle' } };
    case 'edit':
      return { ...state, draft: action.value, turn: turn.state === 'waiting' ? { ...turn, state: 'cancelled' } : turn };
    case 'send': {
      if (!state.draft.trim() || turn.state === 'waiting' || turn.state === 'unknown') return state;
      const requestId = state.sequence + 1;
      return { ...state, sequence: requestId, messages: [...state.messages, { id: `operator-${requestId}`, role: 'operator', text: state.draft, ...(action.attachments?.length ? { attachments: action.attachments } : {}) }], turn: { state: 'waiting', requestId, prompt: state.draft, ...(action.staged?.length ? { staged: action.staged } : {}), ...(action.messageId === undefined ? {} : { messageId: action.messageId }), ...(action.approvalMode === undefined ? {} : { approvalMode: action.approvalMode }) } };
    }
    case 'retry':
      return turn.state === 'failed' && state.draft === turn.prompt
        ? { ...state, sequence: state.sequence + 1, turn: { ...turn, state: 'waiting', requestId: state.sequence + 1 } } : state;
    case 'settle':
      if (turn.state !== 'waiting' || turn.requestId !== action.requestId) return state;
      return { ...state, messages: [...state.messages, action.message], turn: { state: 'idle' } };
    case 'uncertain':
      return turn.state === 'waiting' && turn.requestId === action.requestId ? { ...state, turn: { ...turn, state: 'unknown' } } : state;
    case 'fail':
      return turn.state === 'waiting' && turn.requestId === action.requestId ? { ...state, turn: { ...turn, state: 'failed' } } : state;
    case 'cancel':
      return turn.state === 'waiting' || turn.state === 'failed' ? { ...state, turn: { ...turn, state: 'cancelled' } } : state;
  }
}

export function assistantSetupCommand(text: string): 'model' | undefined {
  text = text.trim();
  if (text === ASSISTANT_MODEL_COMMAND || text.startsWith(ASSISTANT_MODEL_COMMAND + ' ')) return 'model';
  return undefined;
}
