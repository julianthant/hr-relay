import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import {
  ASSISTANT_FAILURES, ASSISTANT_HISTORY_BODY_MAX_BYTES, AssistantModelPreferenceViewSchema, type AssistantConversationView, type AssistantFailureCode,
  type AssistantHistoryOperation, type AssistantHistoryResult, type AssistantHistoryView, type AssistantModelPreferenceView, type AssistantReceipt,
} from '../../../models/dashboard/assistant.js';
import { deriveStableUuid } from '../../../rules/identity/stable-uuid.js';
import type { AssistantQueries } from '../../client/index.js';
import type { HubChat, HubChatsPort } from '../shell/hub-shell-model.js';
import type { AssistantMessage, AssistantState } from './assistant-model.js';

/** The stored caption of a live card; restored history shows that the card is gone instead. */
export const ASSISTANT_PROPOSAL_CAPTION = 'Review this proposal. No action has been applied.';
const RESTORED_PROPOSAL = 'This proposal is no longer available. Ask again to review a new one.';
export const ASSISTANT_UNSAVED_REPLY = 'The reply was not saved. Do not resend it; ask again as a new message.';
const PENDING_REPLY = 'This request is still waiting for its reply.';
const IMPORT_NOTICES = { 'unknown': "The previous request's outcome is unknown. Do not retry it.", 'proposal-expired': 'The previous proposal expired. Ask again to review a new one.' } as const;
const IMPORT_NAMESPACE = 'relay-assistant-history-import';
const OLD_KEY = 'relay-assistant-history:';

// The old tab history, read once for its forward conversion.
const OldMessage = z.strictObject({ id: z.string().max(100), role: z.enum(['operator', 'assistant']), text: z.string().max(8000),
  code: z.enum(Object.keys(ASSISTANT_FAILURES) as [AssistantFailureCode, ...AssistantFailureCode[]]).optional(),
  sources: z.array(z.strictObject({ id: z.string().max(140), title: z.string().max(500), excerpt: z.string().max(4000), version: z.string().max(200) })).max(8).optional() });
const OldTranscript = z.strictObject({ draft: z.string().max(4000), composer: z.string().max(4000), messages: z.array(OldMessage).max(200),
  sequence: z.number().int().nonnegative(), interrupted: z.boolean(), proposalExpired: z.boolean() });
const OldData = z.strictObject({ format: z.literal(1), profileId: z.uuid(),
  chats: z.array(z.strictObject({ id: z.uuid(), title: z.string().min(1).max(200), minutes: z.number().nonnegative(), group: z.enum(['Today', 'Yesterday', 'Earlier']) })).max(20),
  selected: z.string().max(100).optional(), transcripts: z.record(z.string(), OldTranscript),
}).refine(value => new Set(value.chats.map(chat => chat.id)).size === value.chats.length
  && (value.selected === undefined || value.chats.some(chat => chat.id === value.selected))
  && Object.keys(value.transcripts).every(id => value.chats.some(chat => chat.id === id)));
type OldData = z.infer<typeof OldData>;
type Import = Extract<AssistantHistoryOperation, { operation: 'import' }>;

const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).length;
/** Retry-safe positional batches of one old chat, each within the history reader. */
export function importBatches(chatId: string, title: string, transcript: z.infer<typeof OldTranscript> | undefined): Import[] {
  const messages = (transcript?.messages ?? []).map((message, index) => ({ messageId: deriveStableUuid(IMPORT_NAMESPACE, `${chatId}:${String(index + 1)}:${message.id}`),
    role: message.role, text: message.text }));
  const base = { operation: 'import' as const, conversationId: chatId, title, draft: transcript?.draft ?? '', composer: transcript?.composer ?? '',
    notice: transcript?.interrupted ? 'unknown' as const : transcript?.proposalExpired ? 'proposal-expired' as const : null, total: messages.length };
  if (messages.length === 0) return [{ ...base, start: 1, messages: [] }];
  const batches: Import[] = [];
  let start = 1, batch: Import['messages'] = [];
  for (const message of messages) {
    if (batch.length > 0 && bytes({ ...base, start, messages: [...batch, message] }) > ASSISTANT_HISTORY_BODY_MAX_BYTES) {
      batches.push({ ...base, start, messages: batch }); start += batch.length; batch = [];
    }
    batch.push(message);
  }
  batches.push({ ...base, start, messages: batch });
  return batches;
}

function chatOf(summary: AssistantHistoryView['chats'][number], now: number): HubChat {
  const created = new Date(summary.createdAt), today = new Date(now); today.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - new Date(created).setHours(0, 0, 0, 0)) / 86_400_000);
  return { id: summary.id, title: summary.title, minutes: Math.max(0, Math.floor((now - created.getTime()) / 60_000)), group: days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : 'Earlier' };
}
/** Restored transcript from served rows: no card, no Confirm, and the delivery of every turn stated. */
export function restoredState(view: AssistantConversationView): AssistantState | undefined {
  const messages: AssistantMessage[] = [];
  const notice = () => { if (view.importNotice !== null) messages.push({ id: `${view.id}-import-notice`, role: 'assistant', text: IMPORT_NOTICES[view.importNotice] }); };
  if (view.importTotal === 0) notice();
  for (const row of view.messages) {
    if (row.kind === 'proposal' && row.text === ASSISTANT_PROPOSAL_CAPTION) messages.push({ id: row.id, role: 'assistant', text: RESTORED_PROPOSAL });
    else messages.push({ id: row.id, role: row.role, text: row.text });
    if (row.kind === 'turn' && row.delivery === 'refused' && row.code !== null) messages.push({ id: `${row.id}-refused`, role: 'assistant', text: ASSISTANT_FAILURES[row.code], code: row.code });
    if (row.kind === 'turn' && row.delivery === 'delivery-unknown') messages.push({ id: `${row.id}-unknown`, role: 'assistant', text: ASSISTANT_UNSAVED_REPLY });
    if (row.kind === 'turn' && row.delivery === 'sending') messages.push({ id: `${row.id}-sending`, role: 'assistant', text: PENDING_REPLY });
    if (row.ordinal === view.importTotal) notice();
  }
  if (messages.length === 0 && !view.draft) return undefined;
  return { draft: view.draft, messages, sequence: view.messages.length, restored: true, turn: { state: 'idle' } };
}

type Client = Required<Pick<AssistantQueries, 'assistantHistory' | 'assistantConversation' | 'assistantHistoryWrite'>>;
export async function createAssistantHistory(client: Client, storage: Pick<Storage, 'getItem' | 'removeItem'>, profileId: string, signal: AbortSignal) {
  const key = OLD_KEY + z.uuid().parse(profileId);
  let view: AssistantHistoryView = { chats: [], selectedId: null };
  const conversations = new Map<string, AssistantConversationView>();
  let notice = '', blocked = false;
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };
  const write = async (operation: AssistantHistoryOperation): Promise<Extract<AssistantHistoryResult, { state: 'saved' | 'cleared' }>> => {
    const result = await client.assistantHistoryWrite(operation, signal);
    if (result.state === 'refused') throw Error(ASSISTANT_FAILURES[result.code]);
    return result;
  };
  const reload = async () => {
    view = await client.assistantHistory(signal);
    const loaded = await Promise.all(view.chats.map(chat => client.assistantConversation(chat.id, signal)));
    conversations.clear(); for (const conversation of loaded) conversations.set(conversation.id, conversation);
    changed();
  };
  const refresh = async (id: string) => {
    const conversation = await client.assistantConversation(id, signal);
    conversations.set(id, conversation);
    view = { ...view, chats: view.chats.map(chat => chat.id === id ? { ...chat, title: conversation.title, revision: conversation.revision } : chat) };
    changed();
  };
  const revisionOf = (id: string) => conversations.get(id)?.revision ?? view.chats.find(chat => chat.id === id)?.revision;
  const requireRevision = (id: string) => revisionOf(id) ?? (() => { throw Error('HUB_CHAT_UNAVAILABLE'); })();

  async function convert(raw: string) {
    let old: OldData;
    try { old = OldData.parse(JSON.parse(raw)); if (old.profileId !== profileId) throw Error('ASSISTANT_HISTORY_INVALID'); }
    catch { notice = ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNAVAILABLE; blocked = true; return; }
    try {
      for (const chat of old.chats) for (const batch of importBatches(chat.id, chat.title, old.transcripts[chat.id])) await write(batch);
      const selected = old.selected ?? old.chats[0]?.id;
      await reload();
      if (selected !== undefined && view.selectedId !== selected) { await write({ operation: 'select', conversationId: selected, expectedRevision: requireRevision(selected) }); await reload(); }
      const complete = view.selectedId === (selected ?? null) && old.chats.every(chat => {
        const served = conversations.get(chat.id), transcript = old.transcripts[chat.id], expected = importBatches(chat.id, chat.title, transcript).flatMap(batch => batch.messages);
        return served !== undefined && served.title === chat.title && served.draft === (transcript?.draft ?? '') && served.composer === (transcript?.composer ?? '')
          && served.importTotal === expected.length && served.importNotice === importBatches(chat.id, chat.title, transcript)[0]?.notice
          && expected.every((message, index) => { const row = served.messages[index];
            return row !== undefined && row.id === message.messageId && row.ordinal === index + 1 && row.role === message.role && row.text === message.text; });
      });
      if (!complete) throw Error('ASSISTANT_HISTORY_UNSAVED');
      storage.removeItem(key);
    } catch { notice = ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNSAVED; blocked = true; }
  }

  const raw = storage.getItem(key);
  if (raw !== null) await convert(raw);
  if (!blocked) {
    await reload();
    if (view.chats.length === 0) { const id = crypto.randomUUID(); await write({ operation: 'create', conversationId: id, title: 'New chat' }); await reload(); }
  }
  const drafts = new Map<string, { inFlight: boolean; next?: { draft: string; composer: string } }>();
  function saveDraft(id: string, draft: string, composer: string) {
    const conversation = conversations.get(id);
    // A blocked conversion keeps the old key authoritative; the import must read back unchanged.
    if (blocked || conversation === undefined || conversation.draft === draft && conversation.composer === composer) return;
    conversations.set(id, { ...conversation, draft, composer });
    const entry = drafts.get(id) ?? { inFlight: false }; entry.next = { draft, composer }; drafts.set(id, entry);
    if (entry.inFlight) return;
    void (async () => {
      entry.inFlight = true;
      try {
        while (entry.next !== undefined) { const next = entry.next; entry.next = undefined; await write({ operation: 'draft', conversationId: id, ...next }); }
        if (notice === ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNSAVED && !blocked) { notice = ''; changed(); }
      } catch { notice = ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNSAVED; changed(); }
      finally { entry.inFlight = false; }
    })();
  }
  const chats: HubChatsPort = {
    source: 'local', read: () => view.chats.map(chat => chatOf(chat, Date.now())), selectedId: () => view.selectedId ?? view.chats[0]?.id,
    async select(id) { await write({ operation: 'select', conversationId: id, expectedRevision: requireRevision(id) }); await refresh(id); view = { ...view, selectedId: id }; changed(); },
    async create() {
      const id = crypto.randomUUID();
      await write({ operation: 'create', conversationId: id, title: 'New chat' });
      await reload();
      const created = view.chats.find(chat => chat.id === id);
      if (created === undefined) throw Error('HUB_CHAT_UNAVAILABLE');
      return chatOf(created, Date.now());
    },
    async rename(id, title) {
      if (!title.trim() || title.trim().length > 200) throw Error('HUB_CHAT_TITLE_INVALID');
      await write({ operation: 'rename', conversationId: id, expectedRevision: requireRevision(id), title: title.trim() }); await refresh(id);
    },
    async remove(id) { await write({ operation: 'clear', conversationId: id, expectedRevision: requireRevision(id) }); await reload(); },
  };
  return {
    profileId, chats, notice: () => notice, blocked: () => blocked,
    subscribe(this: void, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    has: (id: string) => conversations.has(id),
    read: (id: string) => { const conversation = conversations.get(id); return conversation === undefined ? undefined : restoredState(conversation); },
    revision: requireRevision,
    /** A send's receipt advances the cached revision; the served rows are re-read in the background. */
    receipt(receipt: AssistantReceipt) {
      const conversation = conversations.get(receipt.conversationId);
      if (conversation !== undefined && receipt.revision > conversation.revision) conversations.set(receipt.conversationId, { ...conversation, revision: receipt.revision });
      void refresh(receipt.conversationId).catch(() => { notice = ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNAVAILABLE; changed(); });
    },
    /** Re-reads one chat; true when it holds the decision caption for `actionId`. */
    async decided(id: string, actionId: string) { await refresh(id); return conversations.get(id)?.messages.some(row => row.kind === 'decision' && row.actionId === actionId) === true; },
    async local(id: string, text: string) {
      try { await write({ operation: 'local', conversationId: id, expectedRevision: requireRevision(id), messageId: crypto.randomUUID(), text }); await refresh(id); }
      catch { notice = ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNSAVED; changed(); }
    },
    retain(id: string, state: AssistantState) { saveDraft(id, state.draft, conversations.get(id)?.composer ?? ''); },
    draft(id: string) { return { read: () => conversations.get(id)?.composer ?? '', retain(text: string) { saveDraft(id, conversations.get(id)?.draft ?? '', text); } }; },
    unsaved() { notice = ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNSAVED; changed(); },
  };
}
export type AssistantHistory = Awaited<ReturnType<typeof createAssistantHistory>>;
const noSubscribe = () => () => {};
const noNotice = () => '';
export function useAssistantHistory(client: AssistantQueries, enabled: boolean, authority: unknown) {
  const [resource, setResource] = useState<{ authority: unknown; state: 'ready'; store: AssistantHistory; preference: AssistantModelPreferenceView['preference'] } | { authority: unknown; state: 'failed'; error: string }>();
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    void (async () => {
      try {
        if (client.assistantModelPreference === undefined || client.assistantHistory === undefined || client.assistantConversation === undefined || client.assistantHistoryWrite === undefined) throw Error('ASSISTANT_HISTORY_UNAVAILABLE');
        const view = AssistantModelPreferenceViewSchema.parse(await client.assistantModelPreference(abort.signal));
        const served = { assistantHistory: client.assistantHistory.bind(client), assistantConversation: client.assistantConversation.bind(client), assistantHistoryWrite: client.assistantHistoryWrite.bind(client) };
        const store = await createAssistantHistory(served, sessionStorage, view.profileId, abort.signal);
        if (!abort.signal.aborted) setResource({ authority, state: 'ready', store, preference: view.preference });
      } catch { if (!abort.signal.aborted) setResource({ authority, state: 'failed', error: ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNAVAILABLE }); }
    })();
    return () => abort.abort();
  }, [client, enabled, authority]);
  const preferenceChanged = useCallback((view: AssistantModelPreferenceView) => {
    setResource(prior => prior?.state === 'ready' && prior.authority === authority && prior.store.profileId === view.profileId ? { ...prior, preference: view.preference } : prior);
  }, [authority]);
  const current = resource?.authority === authority ? resource : undefined;
  const ready = current?.state === 'ready' ? current : undefined;
  const notice = useSyncExternalStore(ready?.store.subscribe ?? noSubscribe, ready?.store.notice ?? noNotice);
  return { preferenceChanged, store: enabled ? ready?.store : undefined, preference: enabled ? ready?.preference : undefined, pending: enabled && current === undefined,
    blocked: ready?.store.blocked() === true, notice: current?.state === 'failed' ? current.error : notice };
}
