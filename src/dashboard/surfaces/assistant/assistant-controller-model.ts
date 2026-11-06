import type { DashboardCommandBinding } from '../../app/dashboard-app-model.js';
import { AssistantModelPreferenceCommandRequestSchema } from '../../../rules/commands/commands.js';
import { LOCAL_OPERATOR_ACTOR_ID } from '../../../rules/identity/ids.js';
import { systemClock } from '../../../rules/time/clock.js';
import { ChatGptAccountContext, useChatGptAccount } from '../settings/general/chatgpt-account-model.js';
import { useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AssistantQueries } from '../../client/index.js';
import type { AssistantReceipt, AssistantResult } from '../../../models/dashboard/assistant.js';
import { ASSISTANT_EFFORT_LABELS, AssistantModelPreferenceSchema, assistantModelLabel } from "../../../models/config/assistant-model-preference.js";
import { ASSISTANT_FAILURES, ASSISTANT_VERIFY_COMMAND, ASSISTANT_MODEL_COMMAND, AssistantModelPreferenceViewSchema, type AssistantModelPreferenceView } from '../../../models/dashboard/assistant.js';
import { assistantSetupCommand, assistantReducer, type AssistantAction, type AssistantMessage, type AssistantMockProposal, type AssistantState } from './assistant-model.js';
import { ASSISTANT_UNSAVED_REPLY, type AssistantHistory } from './assistant-history-model.js';
import { ERROR_CATALOG } from '../../../models/failures/error-catalog.js';
import { canonicalJsonStringify } from '../../../rules/validation/canonical-json.js';
import { AssistantActionDecisionSchema, type AssistantActionProposal } from '../../../models/dashboard/assistant.js';

export const ASSISTANT_CONFIRM_HOLD = 'Confirmation is unavailable until the server can verify this proposal before preparation. No run has started.';
type Binding = Readonly<{ authority: unknown; subjectRef?: string;
  commands?: Pick<DashboardCommandBinding, 'executor' | 'scope' | 'feedback'>;
  refreshAccount?: () => Promise<void>;
  preferenceChanged?: (view: AssistantModelPreferenceView, saved: boolean) => void;
}>;
/** SHA-256 hex of the canonical JSON of the exact proposal the card rendered; the server compares it before approval. */
export async function assistantProposalDigest(proposal: AssistantActionProposal): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJsonStringify(proposal)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const emptyState = (): AssistantState => ({ draft: '', messages: [], sequence: 0, turn: { state: 'idle' } });

export function presentResult(result: AssistantResult, requestId: number, prompt: string): { message: AssistantMessage; proposal?: AssistantMockProposal; disposition?: "unknown" } {
  const id = `assistant-${requestId}`;
  switch (result.state) {
    case 'answered': return { message: { id, role: 'assistant', text: result.text } };
    case 'refused': return { message: { id, role: 'assistant', text: ASSISTANT_FAILURES[result.code], code: result.code } };
    case 'unknown':
    case 'action-proposal': {
      const unknown = result.state === 'unknown', p = result.state === 'unknown' ? result.action : result.proposal;
      const start = p.effect === 'workflow-start' ? p : undefined;
      return { ...(unknown ? { disposition: 'unknown' as const } : {}), message: { id, role: 'assistant', text: unknown ? 'Action outcome is unknown. Do not retry this action.' : 'Review this proposal. No action has been applied.' }, proposal: {
        id: p.actionId, revision: String(p.revision), prompt, issued: p, action: { chatId: p.chatId, actionId: p.actionId, revision: p.revision }, expiresAt: p.expiresAt,
        workflow: { id: p.effect === 'local-write' ? 'notification' : p.workflowId, label: p.label, version: String(p.revision) },
        mode: start === undefined ? 'local-change' : start.dryRun ? 'dry-run' : 'read-only',
        values: start !== undefined ? [
          { label: 'Input', value: start.startPlan.planned.map(run => [run.title, run.subtitle].filter(Boolean).join(' · ')).join(', ') },
          { label: 'Runs', value: String(start.startPlan.planned.length) },
          { label: 'Mode', value: start.startPlan.dryRun ? 'Dry run' : 'Live read' },
          { label: 'Browser', value: start.startPlan.browserMode === 'headed' ? 'Headed' : 'Headless' },
          { label: 'Captures', value: start.startPlan.captureBrowserScreenshots ? 'On' : 'Off' },
          { label: 'Expires', value: p.expiresAt },
        ] : p.effect === 'run-action' ? [{ label: 'Action', value: p.action === 'pause' ? 'Pause' : p.action === 'resume' ? 'Resume' : 'Cancel' }, { label: 'Expires', value: p.expiresAt }]
          : [{ label: 'Notification', value: p.targetLabel }, { label: 'Expires', value: p.expiresAt }],
        effects: [start !== undefined ? 'Starts the reviewed plan after confirmation. No HR transaction is submitted.' : p.effect === 'run-action' ? 'Changes only this run in the local queue.' : 'Changes only the bound current local notifications. No HR transaction is submitted.'], stopBefore: []
      } };
    }
  }
}

/** One served chat: its id, the cached revision a send expects, and where receipts and local outcomes go. */
export interface AssistantControllerHistory {
  readonly conversationId: string;
  read(): AssistantState | undefined;
  retain(state: AssistantState): void;
  revision(): number;
  receipt(receipt: AssistantReceipt): void;
  local(text: string): Promise<void>;
  /** The stored outcome of one sent turn, read back from the server. */
  outcome(messageId: string): Promise<AssistantMessage | undefined>;
  decided(actionId: string): Promise<boolean>;
  unsaved(): void;
}
export function createAssistantController(client: AssistantQueries, initialBinding: Binding, history?: AssistantControllerHistory) {
  let state = history?.read() ?? emptyState(), binding = initialBinding;
  let outstanding: { requestId: number; prompt: string; abort: AbortController; binding: Binding } | undefined;
  let pendingDecision: { actionId: string; abort: AbortController; binding: Binding } | undefined;
  let retired = false;
  let conversationId = history?.conversationId ?? crypto.randomUUID();
  const listeners = new Set<() => void>();
  function publish(next: AssistantState) { if (retired) return; state = next; history?.retain(state); for (const listener of listeners) listener(); }
  function abort() {
    if (outstanding !== undefined) publish(assistantReducer(state, assistantSetupCommand(outstanding.prompt) === 'verify' ? { type: 'cancel' } : { type: 'uncertain', requestId: outstanding.requestId }));
    outstanding?.abort.abort(); outstanding = undefined;
  }
  const preferenceText = (view: AssistantModelPreferenceView) => `Assistant model: ${assistantModelLabel(view.preference.slug)} (${ASSISTANT_EFFORT_LABELS[view.preference.effort]}).`;
  async function respond(requestId: number, prompt: string) {
    const request = { requestId, prompt, abort: new AbortController(), binding };
    outstanding = request;
    const current = () => !retired && outstanding === request && !request.abort.signal.aborted && binding === request.binding;
    const messageId = crypto.randomUUID();
    /** Presents the stored outcome of this send, never a Confirm and never another send; `fallback` when nothing stored can be read. */
    const readBack = async (fallback: AssistantAction) => {
      try {
        const stored = await history?.outcome(messageId);
        if (stored !== undefined && current()) { publish(assistantReducer(state, { type: 'settle', requestId, message: { ...stored, id: 'assistant-' + requestId } })); return; }
      } catch { /* the outcome stays unknown, as the fallback states */ }
      if (current()) publish(assistantReducer(state, fallback));
    };
    const complete = (message: string) => {
      if (!current()) return;
      publish(assistantReducer(state, { type: "settle", requestId, message: { id: 'assistant-' + requestId, role: 'assistant', text: message } }));
      void history?.local(message);
    };
    try {
      if (assistantSetupCommand(prompt) === 'model') {
        const parts = prompt.trim().split(' ');
        const preference = parts.length === 1 ? undefined : AssistantModelPreferenceSchema.safeParse({ slug: parts[1], effort: parts[2] });
        if (parts.length !== 1 && (parts.length !== 3 || preference?.success !== true)) {
          complete('Use ' + ASSISTANT_MODEL_COMMAND + ' or ' + ASSISTANT_MODEL_COMMAND + ' SLUG EFFORT.'); return;
        }
        if (client.assistantModelPreference === undefined) { complete(ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE); return; }
        const view = AssistantModelPreferenceViewSchema.parse(await client.assistantModelPreference(request.abort.signal));
        if (!current()) return;
        if (parts.length === 1) { request.binding.preferenceChanged?.(view, false); complete(preferenceText(view)); return; }
        if (preference?.success !== true) return;
        const commands = request.binding.commands;
        if (commands === undefined || commands.scope.actorId !== LOCAL_OPERATOR_ACTOR_ID || !Object.is(commands.scope.client, client)) {
          complete(ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE); return;
        }
        const command = AssistantModelPreferenceCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(),
          requestedBy: LOCAL_OPERATOR_ACTOR_ID, source: 'dashboard-assistant-model-preference', family: "assistant-model-preference", type: "set-assistant-model-preference",
          target: { profileId: view.profileId, epoch: view.epoch, expectedRevision: view.revision }, payload: preference.data });
        const outcome = await commands.executor.execute(command, { scope: commands.scope, publish: commands.feedback,
          readback: async () => {
            if (!current() || client.assistantModelPreference === undefined) return { state: "mismatch", evidence: 'authority-changed' };
            const actual = AssistantModelPreferenceViewSchema.parse(await client.assistantModelPreference(request.abort.signal));
            if (!current() || actual.profileId !== view.profileId || actual.epoch !== view.epoch) return { state: "mismatch", evidence: actual };
            return { state: actual.revision === view.revision + 1 && actual.preference.slug === preference.data.slug
              && actual.preference.effort === preference.data.effort ? "matched" : "mismatch", evidence: actual };
          } });
        if (!current()) return;
        if (outcome.kind === "uncertain") { publish(assistantReducer(state, { type: "uncertain", requestId })); return; }
        if (outcome.kind === "confirmed") { const actual = AssistantModelPreferenceViewSchema.parse(outcome.readback); request.binding.preferenceChanged?.(actual, true); complete(preferenceText(actual)); }
        else complete(outcome.feedback.text);
        return;
      }
      const verify = assistantSetupCommand(prompt) === 'verify';
      const envelope = await client.assistantRespond({ conversationId, expectedRevision: history?.revision() ?? 1, messageId,
        message: verify ? ASSISTANT_VERIFY_COMMAND : prompt, ...(verify || binding.subjectRef === undefined ? {} : { subjectRef: binding.subjectRef }) }, request.abort.signal);
      if (envelope.receipt !== undefined) history?.receipt(envelope.receipt);
      if (!current()) return;
      if (envelope.kind === 'delivery') {
        await readBack({ type: 'settle', requestId, message: { id: 'assistant-' + requestId, role: 'assistant', text: ASSISTANT_UNSAVED_REPLY } });
        return;
      }
      const result = envelope.result, presented = presentResult(result, requestId, prompt);
      const settled = assistantReducer(state, { type: "settle", requestId, ...presented });
      publish(verify ? { ...settled, verification: result.state === 'answered' ? { state: 'passed' }
        : { state: 'failed', code: result.state === 'refused' ? result.code : 'ASSISTANT_VERIFICATION_FAILED' } } : settled);
      if (verify) void history?.local(presented.message.text);
    } catch {
      if (current()) {
        if (assistantSetupCommand(prompt) === 'verify') publish({ ...assistantReducer(state, { type: 'settle', requestId,
          message: { id: 'assistant-' + requestId, role: 'assistant', text: ASSISTANT_FAILURES.ASSISTANT_VERIFICATION_FAILED, code: 'ASSISTANT_VERIFICATION_FAILED' } }),
          verification: { state: 'failed', code: 'ASSISTANT_VERIFICATION_FAILED' } });
        else await readBack({ type: "uncertain", requestId });
      }
    } finally {
      if (outstanding === request) {
        outstanding = undefined;
        if (assistantSetupCommand(prompt) === 'verify' && !request.abort.signal.aborted && binding === request.binding) {
          const settledState = state;
          try { await request.binding.refreshAccount?.(); }
          catch { if (binding === request.binding && state === settledState) publish({ ...state, messages: [...state.messages,
            { id: 'account-refresh-' + requestId, role: 'assistant', text: ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE }] }); }
        }
      }
    }
  }
  async function decide(decision: 'confirm' | 'cancel') {
    const turn = state.turn;
    if (retired || turn.state !== 'proposal' || turn.proposal.action === undefined || turn.disposition !== 'review'
      || state.draft !== turn.proposal.prompt || client.assistantDecide === undefined) return;
    const proposal = turn.proposal, identity = turn.proposal.action;
    if (identity === undefined) return;
    const request = { actionId: proposal.id, binding, abort: new AbortController() };
    pendingDecision = request;
    const current = () => !retired && pendingDecision === request && binding === request.binding;
    publish(assistantReducer(state, { type: 'action-state', id: proposal.id, disposition: 'confirming' }));
    const stale = () => { publish(assistantReducer(state, { type: 'action-state', id: proposal.id, disposition: 'stale' })); pendingDecision = undefined; };
    let reviewedDigest: string | undefined;
    if (decision === 'confirm') {
      // No digest means nothing was sent: the card cannot be confirmed as reviewed.
      if (proposal.issued === undefined) { stale(); return; }
      try { reviewedDigest = await assistantProposalDigest(proposal.issued); }
      catch { if (current()) stale(); return; }
      if (!current()) return;
    }
    try {
      const result = await client.assistantDecide(AssistantActionDecisionSchema.parse({ ...identity, decision, ...(reviewedDigest === undefined ? {} : { reviewedDigest }) }), request.abort.signal);
      if (!current()) return;
      const disposition = result.state === 'applied' ? 'confirmed' : result.state === 'cancelled' ? 'cancelled' : result.state === 'unknown' ? 'unknown' : 'stale';
      publish(assistantReducer(state, { type: 'action-state', id: proposal.id, disposition,
        message: { id: `action-${proposal.id}`, role: 'assistant', text: result.state === 'applied' ? 'Confirmed action accepted.'
          : result.state === 'cancelled' ? 'Action cancelled.' : result.state === 'unknown' ? 'Action outcome is unknown. Do not retry this action.' : ASSISTANT_FAILURES[result.code] } }));
      if (history !== undefined && result.state !== 'refused') await history.decided(proposal.id).then(found => { if (!found) history.unsaved(); }, () => { history.unsaved(); });
    } catch {
      if (current()) publish(assistantReducer(state, { type: 'action-state', id: proposal.id, disposition: 'unknown' }));
    } finally {
      if (pendingDecision === request) pendingDecision = undefined;
    }
  }
  return Object.freeze({
    snapshot: () => state,
    subscribe(listener: () => void) { if (retired) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    abort,
    retire() {
      if (retired) return;
      abort();
      const decision = pendingDecision;
      if (decision !== undefined) publish(assistantReducer(state, { type: 'action-state', id: decision.actionId, disposition: 'unknown' }));
      pendingDecision = undefined; retired = true;
      decision?.abort.abort(); listeners.clear();
    },
    bind(next: Binding) {
      if (retired) return;
      if (next.authority === binding.authority && next.subjectRef === binding.subjectRef && next.commands?.scope === binding.commands?.scope && next.commands?.executor === binding.commands?.executor
        && next.commands?.feedback === binding.commands?.feedback && next.refreshAccount === binding.refreshAccount && next.preferenceChanged === binding.preferenceChanged) return;
      binding = next; abort();
      if (state.turn.state === 'proposal') publish({ ...state, turn: { ...state.turn, disposition: state.turn.disposition === 'confirming' || state.turn.disposition === 'unknown' ? 'unknown' : 'stale' } });
      else publish(assistantReducer(state, { type: 'cancel' }));
    },
    action(action: AssistantAction) {
      if (retired) return;
      if ((action.type === 'edit' || action.type === 'new-chat') && state.turn.state === 'proposal' && state.turn.proposal.action !== undefined && state.turn.disposition === 'review') {
        void decide('cancel');
        publish(assistantReducer(state, action));
        return;
      }
      if (action.type === 'confirm') { void decide('confirm'); return; }
      if (action.type === 'cancel' && state.turn.state === 'proposal' && state.turn.proposal.action !== undefined) { void decide('cancel'); return; }
      if (state.turn.state === 'proposal' && (state.turn.disposition === 'confirming' || state.turn.disposition === 'unknown') && action.type !== 'new-chat') return;
      if (action.type === 'action-state' || action.type === 'reply' || action.type === 'settle' || action.type === 'fail' || action.type === 'uncertain') return;
      if (action.type === 'new-chat') conversationId = crypto.randomUUID();
      if (action.type === 'edit' || action.type === 'new-chat' || action.type === 'cancel') abort();
      const previous = state;
      publish(assistantReducer(state, action));
      if (state !== previous && state.turn.state === 'waiting' && (action.type === 'send' || action.type === 'retry' || action.type === 'verify')) void respond(state.turn.requestId, state.turn.prompt);
    },
  });
}

export function useAssistantController(client: AssistantQueries, authority: unknown, subjectRef?: string, shellMounted = true, chatId = "default", commands?: DashboardCommandBinding, options?: { history?: AssistantHistory; preferenceChanged?: (view: AssistantModelPreferenceView, saved: boolean) => void }) {
  const { history, preferenceChanged } = options ?? {};
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
  const bindingAuthority = useMemo(() => ({ authority, account, shellMounted, commandScope: commands?.scope, commandExecutor: commands?.executor, commandFeedback: commands?.feedback }), [authority, account, shellMounted, commands?.scope, commands?.executor, commands?.feedback]);
  const sessions = useMemo(() => ({ client, history, controllers: new Map<string, ReturnType<typeof createAssistantController>>() }), [client, history]);
  const controllers = sessions.controllers;
  const controller = useMemo(() => {
    let current = controllers.get(chatId);
    if (!current) { current = createAssistantController(sessions.client, { authority: undefined }, history === undefined || !history.has(chatId) ? undefined : { conversationId: chatId, read: () => history.read(chatId), retain: state => { history.retain(chatId, state); },
      revision: () => history.revision(chatId), receipt: receipt => { history.receipt(receipt); }, local: text => history.local(chatId, text), outcome: messageId => history.outcome(chatId, messageId),
      decided: actionId => history.decided(chatId, actionId), unsaved: () => { history.unsaved(); } }); controllers.set(chatId, current); }
    return current;
  }, [controllers, sessions, chatId, history]);
  useLayoutEffect(() => {
    for (const current of controllers.values()) current.bind({ authority: bindingAuthority, ...(subjectRef === undefined ? {} : { subjectRef }), commands, refreshAccount: accountPort.mode === 'live' ? accountPort.refresh : undefined, preferenceChanged });
  }, [controller, controllers, bindingAuthority, subjectRef, commands, accountPort, preferenceChanged]);
  useEffect(() => () => { if (controller.snapshot().turn.state === 'waiting') controller.action({ type: 'cancel' }); else controller.abort(); }, [controller]);
  useEffect(() => () => { for (const current of controllers.values()) current.abort(); }, [controllers]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const accountAvailable = accountPort.mode === 'live' && account.state === 'connected' && account.planUsage === 'enabled';
  const resource = accountPort.mode === 'live' ? accountPort.getResource?.() : undefined;
  const unverified = resource !== undefined && 'code' in resource && resource.code === 'CHATGPT_USAGE_UNAVAILABLE';
  const accountFailure = resource !== undefined && 'code' in resource ? ERROR_CATALOG[resource.code].text : undefined;
  return { state, canCompose: accountAvailable || unverified, unverified, authorityKey: bindingAuthority, forgetSession: (id: string) => { controllers.get(id)?.retire(); controllers.delete(id); }, launcherBottom, onAction: controller.action, revision: state.turn.state === 'proposal' ? state.turn.proposal.revision : '',
    accountAvailable,
    accountAction: (unverified ? 'preflight' : account.state === 'loading' ? undefined : account.state === 'connected' || account.state === 'unavailable' ? 'settings' : 'sign-in'),
    accountHeading: unverified ? "Verify assistant capability" : (account.state === 'connected' ? 'ChatGPT plan usage unavailable' : 'ChatGPT connection unavailable'),
    accountNotice: unverified ? ASSISTANT_FAILURES.ASSISTANT_MODEL_UNVERIFIED : accountFailure ?? (account.state === 'loading' ? 'Loading ChatGPT account…' : account.state === 'signing-in' ? 'Finish ChatGPT sign-in in Settings.' : account.state === 'connected' ? account.planUsage === 'limit-reached' ? ASSISTANT_FAILURES.ASSISTANT_USAGE_LIMIT : ASSISTANT_FAILURES.ASSISTANT_PLAN_DISABLED : ASSISTANT_FAILURES.ASSISTANT_ACCOUNT_EXPIRED), confirmRefusal: state.turn.state === 'proposal' && state.turn.proposal.action !== undefined && client.assistantDecide !== undefined ? undefined : ASSISTANT_CONFIRM_HOLD,
    statusText: 'Read and propose', footnote: 'Review the exact action before confirming. Workflow starts require a confirmed plan.' };
}
