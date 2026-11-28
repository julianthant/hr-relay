import type { DashboardCommandBinding } from '../../app/dashboard-app-model.js';
import { commandAttemptView } from '../../app/commands/command-outcome.js';
import { AssistantModelPreferenceCommandRequestSchema, CommandRequestSchema } from '../../../rules/commands/commands.js';
import { LOCAL_OPERATOR_ACTOR_ID } from '../../../rules/identity/ids.js';
import { systemClock } from '../../../rules/time/clock.js';
import { ChatGptAccountContext, useChatGptAccount } from '../settings/general/chatgpt-account-model.js';
import { useContext, useEffect, useLayoutEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { AssistantQueries } from '../../client/index.js';
import type { AssistantM1RespondEnvelope, AssistantReceipt, AssistantStageResult } from '../../../models/dashboard/assistant.js';
import { ASSISTANT_EFFORT_LABELS, AssistantModelPreferenceSchema, assistantModelLabel, type AssistantModelPreference } from "../../../models/config/assistant-model-preference.js";
import { ASSISTANT_FAILURES, ASSISTANT_MODEL_COMMAND, AssistantModelPreferenceViewSchema, type AssistantModelCatalog, type AssistantModelPreferenceView } from '../../../models/dashboard/assistant.js';
import { assistantSetupCommand, assistantReducer, type AssistantAction, type AssistantMessage, type AssistantState, type AssistantTurn } from './assistant-model.js';
import { replyText, type SessionStop } from './assistant-reply-parts-model.js';
import { composeCommandRequest } from '../../app/commands/command-dispatch.js';
import { ASSISTANT_UNSAVED_REPLY, type AssistantHistory } from './assistant-history-model.js';
import { ERROR_CATALOG, createErrorCatalogFailure, formatErrorCatalogFailure } from '../../../models/failures/error-catalog.js';
import type { useToasts } from "../../ds/ui.js";

type Binding = Readonly<{ authority: unknown; subjectRef?: string;
  commands?: Pick<DashboardCommandBinding, 'executor' | 'scope' | 'feedback'>;
  toast?: ReturnType<typeof useToasts>["toast"];
  preferenceChanged?: (view: AssistantModelPreferenceView, saved: boolean) => void;
}>;
const ACCOUNT_NOT_CONNECTED = 'Connect ChatGPT to use the assistant.';
const ACCOUNT_READ_FAILED = 'Relay could not check your ChatGPT account.';
const emptyState = (): AssistantState => ({ draft: '', messages: [], sequence: 0, turn: { state: 'idle' } });

type AssistantM1Result = Extract<AssistantM1RespondEnvelope, { kind: 'result' }>['result'];
/** A served reply keeps its parts; no reply is one refusal line. */
export function presentResult(result: AssistantM1Result, requestId: number): AssistantMessage {
  const id = `assistant-${requestId}`;
  return result.state === 'answered' ? { id, role: 'assistant', text: replyText(result.reply.parts), parts: result.reply.parts }
    : { id, role: 'assistant', text: ASSISTANT_FAILURES[result.reason], code: result.reason };
}

/** One served chat: its id, the cached revision a send expects, and where receipts and local outcomes go. */
export interface AssistantControllerHistory {
  readonly conversationId: string;
  read(): AssistantState | undefined;
  retain(state: AssistantState): void;
  revision(): number;
  receipt(receipt: AssistantReceipt): void;
  local(text: string): Promise<void>;
  /** Re-reads the chat's rows and session views. */
  refresh(): Promise<void>;
  /** The stored outcome of one sent turn, read back from the server. */
  outcome(messageId: string): Promise<AssistantMessage | undefined>;
  unsaved(): void;
}
export function createAssistantController(client: AssistantQueries, initialBinding: Binding, history?: AssistantControllerHistory) {
  let state = history?.read() ?? emptyState(), binding = initialBinding;
  let outstanding: { requestId: number; prompt: string; abort: AbortController; binding: Binding } | undefined;
  let retired = false;
  let conversationId = history?.conversationId ?? crypto.randomUUID();
  const listeners = new Set<() => void>();
  function publish(next: AssistantState) { if (retired) return; state = next; history?.retain(state); for (const listener of listeners) listener(); }
  function abort() {
    if (outstanding !== undefined) publish(assistantReducer(state, { type: 'uncertain', requestId: outstanding.requestId }));
    outstanding?.abort.abort(); outstanding = undefined;
  }
  /** Session chips carry the served status and Stop; a failed re-read keeps the last views. */
  async function refreshSessions() {
    if (history === undefined) return;
    try { await history.refresh(); } catch { return; }
    const restored = history.read();
    if (restored !== undefined) publish({ ...state, sessions: restored.sessions ?? [] });
  }
  const preferenceText = (view: AssistantModelPreferenceView) => `Assistant model: ${assistantModelLabel(view.preference.slug)} (${ASSISTANT_EFFORT_LABELS[view.preference.effort]}).`;
  /** Saves a model and effort through the shared executor; the same path for the chat command and the pickers. */
  async function savePreference(preference: AssistantModelPreference, owner: Binding, signal: AbortSignal, current: () => boolean):
    Promise<{ kind: "saved"; view: AssistantModelPreferenceView } | { kind: "uncertain" } | { kind: "refused"; text: string }> {
    if (client.assistantModelPreference === undefined) return { kind: "refused", text: ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE };
    const view = AssistantModelPreferenceViewSchema.parse(await client.assistantModelPreference(signal));
    const commands = owner.commands;
    if (!current() || commands === undefined || commands.scope.actorId !== LOCAL_OPERATOR_ACTOR_ID || !Object.is(commands.scope.client, client)) {
      return { kind: "refused", text: ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE };
    }
    const command = AssistantModelPreferenceCommandRequestSchema.parse({ commandId: crypto.randomUUID(), requestedAt: systemClock.now().toISOString(),
      requestedBy: LOCAL_OPERATOR_ACTOR_ID, source: 'dashboard-assistant-model-preference', family: "assistant-model-preference", type: "set-assistant-model-preference",
      target: { profileId: view.profileId, epoch: view.epoch, expectedRevision: view.revision }, payload: preference });
    const outcome = await commands.executor.execute(command, { scope: commands.scope, publish: commands.feedback,
      readback: async () => {
        if (!current() || client.assistantModelPreference === undefined) return { state: "mismatch", evidence: 'authority-changed' };
        const actual = AssistantModelPreferenceViewSchema.parse(await client.assistantModelPreference(signal));
        if (!current() || actual.profileId !== view.profileId || actual.epoch !== view.epoch) return { state: "mismatch", evidence: actual };
        return { state: actual.revision === view.revision + 1 && actual.preference.slug === preference.slug
          && actual.preference.effort === preference.effort ? "matched" : "mismatch", evidence: actual };
      } });
    if (commandAttemptView(outcome).view === "unknown") return { kind: "uncertain" };
    if (outcome.kind !== "confirmed") return { kind: "refused", text: outcome.feedback.text };
    const actual = AssistantModelPreferenceViewSchema.parse(outcome.readback);
    if (current()) owner.preferenceChanged?.(actual, true);
    return { kind: "saved", view: actual };
  }
  async function respond({ requestId, prompt, staged, messageId = crypto.randomUUID(), approvalMode = 'ask' }: Exclude<AssistantTurn, { state: 'idle' }>) {
    const request = { requestId, prompt, abort: new AbortController(), binding };
    outstanding = request;
    const current = () => !retired && outstanding === request && !request.abort.signal.aborted && binding === request.binding;
    const notifyEdit = (message: AssistantMessage) => {
      const edit = message.parts?.find(part => part.kind === "text" && part.editId !== undefined);
      if (edit?.kind === "text" && edit.editId !== undefined) request.binding.toast?.({ tone: "success", title: "Edit applied", key: edit.editId });
      if (message.code === "ASSISTANT_VALUE_NEEDS_SOURCE") request.binding.toast?.({ tone: "danger", title: "Value needs a source" });
    };
    /** Presents the stored outcome of this send, never a Confirm and never another send; `fallback` when nothing stored can be read. */
    const readBack = async (fallback: AssistantAction) => {
      try {
        const stored = await history?.outcome(messageId);
        if (stored !== undefined && current()) {
          publish(assistantReducer(state, { type: 'settle', requestId, message: { ...stored, id: 'assistant-' + requestId } }));
          notifyEdit(stored);
          if (stored.parts?.some(part => part.kind === 'session') === true) await refreshSessions();
          return;
        }
      } catch { /* the outcome stays unknown, as the fallback states */ }
      if (current()) publish(assistantReducer(state, fallback));
    };
    /** Stores the local line first, so its revision is cached before anything (the automatic title) reacts to the published reply. */
    const complete = async (message: string) => {
      if (!current()) return;
      try { await history?.local(message); } catch { /* the line still shows; local() already flags it unsaved */ }
      if (!current()) return;
      publish(assistantReducer(state, { type: "settle", requestId, message: { id: 'assistant-' + requestId, role: 'assistant', text: message } }));
    };
    try {
      if (assistantSetupCommand(prompt) === 'model') {
        const parts = prompt.trim().split(' ');
        const preference = parts.length === 1 ? undefined : AssistantModelPreferenceSchema.safeParse({ slug: parts[1], effort: parts[2] });
        if (parts.length !== 1 && (parts.length !== 3 || preference?.success !== true)) {
          await complete('Use ' + ASSISTANT_MODEL_COMMAND + ' or ' + ASSISTANT_MODEL_COMMAND + ' SLUG EFFORT.'); return;
        }
        if (parts.length === 1) {
          if (client.assistantModelPreference === undefined) { await complete(ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE); return; }
          const view = AssistantModelPreferenceViewSchema.parse(await client.assistantModelPreference(request.abort.signal));
          if (!current()) return;
          request.binding.preferenceChanged?.(view, false); await complete(preferenceText(view)); return;
        }
        if (preference?.success !== true) return;
        const saved = await savePreference(preference.data, request.binding, request.abort.signal, current);
        if (!current()) return;
        if (saved.kind === "uncertain") { publish(assistantReducer(state, { type: "uncertain", requestId })); return; }
        await complete(saved.kind === "saved" ? preferenceText(saved.view) : saved.text);
        return;
      }
      const envelope = await client.assistantRespond({ conversationId, expectedRevision: history?.revision() ?? 1, messageId, approvalMode,
        message: prompt, ...(binding.subjectRef === undefined ? {} : { subjectRef: binding.subjectRef }), ...(staged?.length ? { attachments: [...staged] } : {}) }, request.abort.signal);
      if (envelope.receipt !== undefined) history?.receipt(envelope.receipt);
      if (!current()) return;
      if (envelope.kind === 'delivery') {
        await readBack({ type: 'settle', requestId, message: { id: 'assistant-' + requestId, role: 'assistant', text: ASSISTANT_UNSAVED_REPLY } });
        return;
      }
      const message = presentResult(envelope.result, requestId);
      notifyEdit(message);
      publish(assistantReducer(state, { type: "settle", requestId, message }));
      if (message.parts?.some(part => part.kind === 'session') === true) void refreshSessions();
    } catch {
      if (current()) {
        // Recover the served result by message ID before offering to resend that same accepted message.
        await readBack(assistantSetupCommand(prompt) === undefined ? { type: "fail", requestId } : { type: "uncertain", requestId });
      }
    } finally {
      if (outstanding === request) outstanding = undefined;
    }
  }
  return Object.freeze({
    snapshot: () => state,
    subscribe(listener: () => void) { if (retired) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    abort,
    retire() {
      if (retired) return;
      abort();
      retired = true; listeners.clear();
    },
    /** A session chip's Stop: the run's own served Cancel through the command executor, then a re-read of the chip. */
    async stop(stop: SessionStop) {
      if (retired || binding.commands === undefined) return;
      // The chip's cached Cancel may be a revision behind (queued to running); take the run's current Stop, or none when it no longer offers one.
      await refreshSessions();
      const commands = binding.commands, fresh = state.sessions?.find(session => session.runId === stop.runId)?.stop ?? null;
      if (retired || commands === undefined || fresh === null) return;
      const composed = composeCommandRequest(fresh.descriptor, { runId: fresh.runId, expectedVersion: fresh.descriptor.expectedVersion },
        { actorId: commands.scope.actorId, source: 'queue' });
      if (composed.state === 'refused') {
        commands.feedback({ kind: 'failed', commandId: '', cause: composed.reason, feedback: formatErrorCatalogFailure(createErrorCatalogFailure('COMMAND_REFUSED', {})) });
        return;
      }
      const before = state.sessions?.find(session => session.runId === stop.runId);
      const outcome = await commands.executor.execute(CommandRequestSchema.parse(composed.request), { scope: commands.scope, publish: commands.feedback,
        // The chip re-read proves the Cancel: the served row moved on or no longer offers Stop.
        readback: async (_request, reply) => {
          await refreshSessions();
          const after = state.sessions?.find(session => session.runId === stop.runId);
          const applied = "state" in reply && (reply.state === "applied" || reply.state === "already-applied");
          return { state: applied && (after === undefined || after.stop === null || after.rowRevision !== before?.rowRevision) ? "matched" : "mismatch", evidence: after ?? null };
        } });
      // A conflict or refusal leaves the chip showing what the run is doing now.
      if (outcome.kind !== 'confirmed') await refreshSessions();
    },
    /** Stages one picked file under this chat so a later send can name it; nothing reaches the model before then. */
    async stage(file: Readonly<{ name: string; mediaType: string; bytes: Uint8Array }>): Promise<AssistantStageResult> {
      if (client.assistantStageAttachment === undefined) throw new Error(ASSISTANT_FAILURES.ASSISTANT_UNAVAILABLE);
      return client.assistantStageAttachment(conversationId, file);
    },
    /** A picker choice: saved without a chat turn; command feedback reports a refusal, an unknown result or a failed read before dispatch. */
    async choose(preference: AssistantModelPreference) {
      if (retired) return;
      const owner = binding, signal = new AbortController().signal;
      const current = () => !retired && binding === owner;
      try { await savePreference(preference, owner, signal, current); }
      catch (cause) {
        if (current()) owner.commands?.feedback({ kind: 'failed', commandId: '', cause,
          feedback: formatErrorCatalogFailure(createErrorCatalogFailure('COMMAND_DISPATCH_FAILED', {})) });
      }
    },
    bind(next: Binding) {
      if (retired) return;
      if (next.authority === binding.authority && next.subjectRef === binding.subjectRef && next.commands?.scope === binding.commands?.scope && next.commands?.executor === binding.commands?.executor
        && next.commands?.feedback === binding.commands?.feedback && next.toast === binding.toast && next.preferenceChanged === binding.preferenceChanged) return;
      binding = next; abort();
      publish(assistantReducer(state, { type: 'cancel' }));
    },
    action(action: AssistantAction) {
      if (retired) return;
      if (action.type === 'settle' || action.type === 'fail' || action.type === 'uncertain') return;
      if (action.type === 'new-chat') conversationId = crypto.randomUUID();
      if (action.type === 'edit' || action.type === 'new-chat' || action.type === 'cancel') abort();
      const previous = state;
      publish(assistantReducer(state, action.type === 'send' ? { ...action, messageId: action.messageId ?? crypto.randomUUID() } : action));
      if (state !== previous && state.turn.state === 'waiting' && (action.type === 'send' || action.type === 'retry')) void respond(state.turn);
    },
  });
}

export function useAssistantController(client: AssistantQueries, authority: unknown, subjectRef?: string, shellMounted = true, chatId = "default", commands?: DashboardCommandBinding, options?: { history?: AssistantHistory; preferenceChanged?: (view: AssistantModelPreferenceView, saved: boolean) => void; readModels?: boolean; toast?: Binding["toast"] }) {
  const { history, preferenceChanged, readModels = true, toast } = options ?? {};
  const accountPort = useContext(ChatGptAccountContext);
  const account = useChatGptAccount(accountPort);
  const readChecking = () => accountPort.getChecking?.() ?? false;
  const checking = useSyncExternalStore(accountPort.subscribe, readChecking, readChecking);
  const bindingAuthority = useMemo(() => ({ authority, account, shellMounted, commandScope: commands?.scope, commandExecutor: commands?.executor, commandFeedback: commands?.feedback }), [authority, account, shellMounted, commands?.scope, commands?.executor, commands?.feedback]);
  const sessions = useMemo(() => ({ client, history, controllers: new Map<string, ReturnType<typeof createAssistantController>>() }), [client, history]);
  const controllers = sessions.controllers;
  const controller = useMemo(() => {
    let current = controllers.get(chatId);
    if (!current) { current = createAssistantController(sessions.client, { authority: undefined }, history === undefined || !history.has(chatId) ? undefined : { conversationId: chatId, read: () => history.read(chatId), retain: state => { history.retain(chatId, state); },
      revision: () => history.revision(chatId), receipt: receipt => { history.receipt(receipt); }, local: text => history.local(chatId, text), outcome: messageId => history.outcome(chatId, messageId),
      refresh: () => history.refresh(chatId), unsaved: () => { history.unsaved(); } }); controllers.set(chatId, current); }
    return current;
  }, [controllers, sessions, chatId, history]);
  useLayoutEffect(() => {
    for (const current of controllers.values()) current.bind({ authority: bindingAuthority, ...(subjectRef === undefined ? {} : { subjectRef }), commands, preferenceChanged, toast });
  }, [controller, controllers, bindingAuthority, subjectRef, commands, accountPort, preferenceChanged, toast]);
  useEffect(() => () => { if (controller.snapshot().turn.state === 'waiting') controller.action({ type: 'cancel' }); else controller.abort(); }, [controller]);
  useEffect(() => () => { for (const current of controllers.values()) current.abort(); }, [controllers]);
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot);
  const resource = accountPort.mode === 'live' ? accountPort.getResource?.() : undefined;
  // An unreadable usage meter is not a sign-in failure; a turn that gets no reply is the failure signal.
  const usageUnread = resource !== undefined && 'code' in resource && resource.code === 'CHATGPT_USAGE_UNAVAILABLE';
  const accountAvailable = accountPort.mode === 'live' && !checking && (account.state === 'connected' && account.planUsage === 'enabled' || usageUnread);
  const accountFailure = resource !== undefined && 'code' in resource ? resource.code === 'CHATGPT_AUTH_UNAVAILABLE' ? ACCOUNT_READ_FAILED : ERROR_CATALOG[resource.code].text : undefined;
  const accountReadFailed = account.state === 'unavailable' && accountPort.refresh !== undefined;
  const [catalog, setCatalog] = useState<{ account: typeof account; models: AssistantModelCatalog['models'] }>();
  // A list belongs to the account snapshot it was read for and is withdrawn while a check runs; the next account shows none until its own is read.
  const models = !checking && catalog?.account === account ? catalog.models : undefined;
  useEffect(() => {
    const client = sessions.client;
    if (!readModels || !accountAvailable || client.assistantModels === undefined) return;
    const request = new AbortController();
    client.assistantModels(request.signal).then(({ models }) => { if (!request.signal.aborted) setCatalog({ account, models }); }, () => { if (!request.signal.aborted) setCatalog(undefined); });
    return () => request.abort();
  }, [readModels, accountAvailable, account, sessions.client]);
  const onAction = (action: AssistantAction) => {
    if (!readChecking() || action.type !== 'send' && action.type !== 'retry') controller.action(action);
  };
  return { state, canCompose: accountAvailable, models, chooseModel: (preference: AssistantModelPreference) => readChecking() ? Promise.resolve() : controller.choose(preference), authorityKey: bindingAuthority, forgetSession: (id: string) => { controllers.get(id)?.retire(); controllers.delete(id); }, onAction, stageAttachment: controller.stage, stop: controller.stop,
    accountAvailable,
    accountAction: (checking || account.state === 'loading' ? undefined : accountReadFailed ? 'retry' : account.state === 'connected' || account.state === 'unavailable' || account.state === 'signing-in' ? 'settings' : 'sign-in'),
    accountRetry: () => { void accountPort.refresh?.(); },
    accountHeading: account.state === 'connected' ? 'ChatGPT plan usage unavailable' : 'ChatGPT connection unavailable',
    accountNotice: accountFailure ?? (account.state === 'loading' ? 'Loading ChatGPT account…' : account.state === 'signing-in' ? 'Finish signing in to ChatGPT in your browser.' : account.state === 'connected' ? account.planUsage === 'limit-reached' ? ASSISTANT_FAILURES.ASSISTANT_USAGE_LIMIT : ASSISTANT_FAILURES.ASSISTANT_PLAN_DISABLED : account.state === 'signed-out' ? ACCOUNT_NOT_CONNECTED : account.state === 'unavailable' ? ACCOUNT_READ_FAILED : ASSISTANT_FAILURES.ASSISTANT_ACCOUNT_EXPIRED) };
}
