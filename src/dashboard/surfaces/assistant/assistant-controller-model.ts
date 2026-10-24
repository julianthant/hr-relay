import { ChatGptAccountContext, useChatGptAccount } from '../settings/general/chatgpt-account-model.js';
import { useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AssistantQueries } from '../../client/index.js';
import type { AssistantResult, AssistantSubject } from '../../../models/dashboard/assistant.js';
import { ASSISTANT_FAILURES } from '../../../models/dashboard/assistant.js';
import { assistantReducer, type AssistantAction, type AssistantMessage, type AssistantMockProposal, type AssistantState } from './assistant-model.js';

export const ASSISTANT_CONFIRM_HOLD = 'Confirmation is unavailable until the server can verify this proposal before preparation. No run has started.';
type Binding = Readonly<{ authority: unknown; subjectRef?: AssistantSubject['subjectRef'] }>;
const emptyState = (): AssistantState => ({ draft: '', messages: [], sequence: 0, turn: { state: 'idle' } });

function presentResult(result: AssistantResult, requestId: number, prompt: string): { message: AssistantMessage; proposal?: AssistantMockProposal; disposition?: "unknown" } {
  const id = `assistant-${requestId}`;
  switch (result.state) {
    case 'answered': return { message: { id, role: 'assistant', text: result.text, sources: result.citations.map((citation, index) => ({
      id: `${id}-source-${index}`, title: `${citation.path}:${citation.startLine}-${citation.endLine}`, excerpt: citation.quote, version: citation.revision,
    })) } };
    case 'refused': return { message: { id, role: 'assistant', text: ASSISTANT_FAILURES[result.code] } };
    case 'resolution-required': return { message: { id, role: 'assistant', text: ASSISTANT_FAILURES.ASSISTANT_SUBJECT_REQUIRED } };
    case 'unknown':
    case 'action-proposal': {
      const unknown = result.state === 'unknown', p = result.state === 'unknown' ? result.action : result.proposal;
      return { ...(unknown ? { disposition: 'unknown' as const } : {}), message: { id, role: 'assistant', text: unknown ? 'Action outcome is unknown. Do not retry this action.' : 'Review this local action. No change has been applied.' }, proposal: {
        id: p.actionId, revision: String(p.revision), prompt, action: { chatId: p.chatId, actionId: p.actionId, revision: p.revision }, expiresAt: p.expiresAt,
        workflow: { id: 'notification', label: p.label, version: String(p.revision) }, subjects: [], mode: 'local-change',
        values: [{ label: 'Notification', value: p.targetLabel }, { label: 'Expires', value: p.expiresAt }],
        effects: ['Changes only the bound current local notifications. No HR transaction is submitted.'], stopBefore: [],
      } };
    }
    case 'proposal': {
      const p = result.proposal;
      return { message: { id, role: 'assistant', text: 'Review this dry-run proposal. No workflow has executed and no transaction has been committed.' }, proposal: {
        id, revision: p.descriptorFingerprint, prompt, workflow: { id: p.workflowId, label: p.workflowId, version: String(p.descriptorVersion) },
        subjects: [{ id: p.subject.employeeId ?? p.subject.subjectRef, name: p.subject.displayName }], mode: 'dry-run',
        values: [{ label: 'Configuration', value: p.configFingerprint }, { label: 'Input', value: p.inputFingerprint }, { label: 'Options', value: p.optionsFingerprint }, { label: 'Expires', value: p.expiresAt }],
        effects: ['Proposal only. No workflow executed. No transaction committed.'],
        stopBefore: [`${p.stopBefore.nodeId}: ${p.stopBefore.commitTaskId} (after ${p.stopBefore.afterPrepareTaskId})`],
      } };
    }
  }
}

export function createAssistantController(client: AssistantQueries, initialBinding: Binding) {
  let state = emptyState(), binding = initialBinding;
  let outstanding: { requestId: number; abort: AbortController; binding: Binding } | undefined;
  const listeners = new Set<() => void>();
  function publish(next: AssistantState) { state = next; for (const listener of listeners) listener(); }
  function abort() {
    if (outstanding !== undefined) publish(assistantReducer(state, { type: 'uncertain', requestId: outstanding.requestId }));
    outstanding?.abort.abort(); outstanding = undefined;
  }
  async function respond(requestId: number, prompt: string) {
    const request = { requestId, abort: new AbortController(), binding };
    outstanding = request;
    try {
      const result = await client.assistantRespond({ message: prompt, ...(binding.subjectRef === undefined ? {} : { subjectRef: binding.subjectRef }) }, request.abort.signal);
      if (outstanding !== request || request.abort.signal.aborted || binding !== request.binding) return;
      const presented = presentResult(result, requestId, prompt);
      publish(assistantReducer(state, { type: 'settle', requestId, ...presented }));
    } catch {
      if (outstanding === request && !request.abort.signal.aborted && binding === request.binding) publish(assistantReducer(state, { type: 'uncertain', requestId }));
    } finally { if (outstanding === request) outstanding = undefined; }
  }
  async function decide(decision: 'confirm' | 'cancel') {
    const turn = state.turn;
    if (turn.state !== 'proposal' || turn.proposal.action === undefined || turn.disposition !== 'review'
      || state.draft !== turn.proposal.prompt || client.assistantDecide === undefined) return;
    const proposal = turn.proposal, identity = turn.proposal.action, capturedBinding = binding, abort = new AbortController();
    if (identity === undefined) return;
    publish(assistantReducer(state, { type: 'action-state', id: proposal.id, disposition: 'confirming' }));
    try {
      const result = await client.assistantDecide({ ...identity, decision }, abort.signal);
      if (binding !== capturedBinding) return;
      const disposition = result.state === 'applied' ? 'confirmed' : result.state === 'cancelled' ? 'cancelled' : result.state === 'unknown' ? 'unknown' : 'stale';
      publish(assistantReducer(state, { type: 'action-state', id: proposal.id, disposition,
        message: { id: `action-${proposal.id}`, role: 'assistant', text: result.state === 'applied' ? 'Local action completed.'
          : result.state === 'cancelled' ? 'Action cancelled.' : result.state === 'unknown' ? 'Action outcome is unknown. Do not retry this action.' : ASSISTANT_FAILURES[result.code] } }));
    } catch {
      if (binding === capturedBinding) publish(assistantReducer(state, { type: 'action-state', id: proposal.id, disposition: 'unknown' }));
    }
  }
  return Object.freeze({
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    abort,
    bind(next: Binding) {
      if (next.authority === binding.authority && next.subjectRef === binding.subjectRef) return;
      binding = next; abort();
      if (state.turn.state === 'proposal') publish({ ...state, turn: { ...state.turn, disposition: state.turn.disposition === 'confirming' || state.turn.disposition === 'unknown' ? 'unknown' : 'stale' } });
      else publish(assistantReducer(state, { type: 'cancel' }));
    },
    action(action: AssistantAction) {
      if ((action.type === 'edit' || action.type === 'new-chat') && state.turn.state === 'proposal' && state.turn.proposal.action !== undefined && state.turn.disposition === 'review') {
        void decide('cancel');
        publish(assistantReducer(state, action));
        return;
      }
      if (action.type === 'confirm') { void decide('confirm'); return; }
      if (action.type === 'cancel' && state.turn.state === 'proposal' && state.turn.proposal.action !== undefined) { void decide('cancel'); return; }
      if (state.turn.state === 'proposal' && (state.turn.disposition === 'confirming' || state.turn.disposition === 'unknown') && action.type !== 'new-chat') return;
      if (action.type === 'action-state' || action.type === 'reply' || action.type === 'settle' || action.type === 'fail' || action.type === 'uncertain') return;
      if (action.type === 'edit' || action.type === 'new-chat' || action.type === 'cancel') abort();
      const previous = state;
      publish(assistantReducer(state, action));
      if (state !== previous && state.turn.state === 'waiting' && (action.type === 'send' || action.type === 'retry')) void respond(state.turn.requestId, state.turn.prompt);
    },
  });
}

export function useAssistantController(client: AssistantQueries, authority: unknown, subjectRef?: string, shellMounted = true, chatId = "default") {
  const [launcherBottom, setLauncherBottom] = useState<string>();
  useLayoutEffect(() => {
    if (!shellMounted) return;
    const panel = document.querySelector('[aria-label="Session Panel"]');
    const bar = panel?.querySelector('[aria-label="Session actions"]');
    if (!(panel instanceof HTMLElement) || !(bar instanceof HTMLElement)) throw new Error('ASSISTANT_UNAVAILABLE');
    const measure = () => {
      const extra = panel.getBoundingClientRect().height - bar.getBoundingClientRect().height;
      if (!Number.isFinite(extra) || extra < 0) throw new Error('ASSISTANT_UNAVAILABLE');
      setLauncherBottom(`calc(var(--ds-space-section) + var(--ds-toast-inset-bottom) + ${extra}px)`);
    };
    const observer = new ResizeObserver(measure); observer.observe(panel); observer.observe(bar); measure();
    return () => observer.disconnect();
  }, [shellMounted]);
  const accountPort = useContext(ChatGptAccountContext);
  const account = useChatGptAccount(accountPort);
  const bindingAuthority = useMemo(() => ({ authority, account, shellMounted }), [authority, account, shellMounted]);
  const sessions = useMemo(() => ({ client, controllers: new Map<string, ReturnType<typeof createAssistantController>>() }), [client]);
  const controllers = sessions.controllers;
  const controller = useMemo(() => {
    let current = controllers.get(chatId);
    if (!current) { current = createAssistantController(sessions.client, { authority: undefined }); controllers.set(chatId, current); }
    return current;
  }, [controllers, sessions, chatId]);
  useLayoutEffect(() => {
    for (const current of controllers.values()) current.bind({ authority: bindingAuthority, ...(subjectRef === undefined ? {} : { subjectRef }) });
  }, [controller, controllers, bindingAuthority, subjectRef]);
  useEffect(() => () => { if (controller.snapshot().turn.state === 'waiting') controller.action({ type: 'cancel' }); else controller.abort(); }, [controller]);
  useEffect(() => () => { for (const current of controllers.values()) current.abort(); }, [controllers]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  return { state, authorityKey: bindingAuthority, forgetSession: (id: string) => { controllers.get(id)?.abort(); controllers.delete(id); }, launcherBottom, onAction: controller.action, revision: state.turn.state === 'proposal' ? state.turn.proposal.revision : '',
    accountAvailable: accountPort.mode === 'live' && account.state === 'connected' && account.planUsage === 'enabled',
    accountHeading: account.state === 'connected' ? 'ChatGPT plan usage unavailable' : 'ChatGPT connection unavailable',
    accountNotice: account.state === 'connected' ? account.planUsage === 'limit-reached' ? ASSISTANT_FAILURES.ASSISTANT_USAGE_LIMIT : ASSISTANT_FAILURES.ASSISTANT_PLAN_DISABLED : ASSISTANT_FAILURES.ASSISTANT_ACCOUNT_EXPIRED, confirmRefusal: state.turn.state === 'proposal' && state.turn.proposal.action !== undefined && client.assistantDecide !== undefined ? undefined : ASSISTANT_CONFIRM_HOLD,
    statusText: 'Read and propose', footnote: 'Review the exact action before confirming. Workflow execution requires dashboard Run.' };
}
