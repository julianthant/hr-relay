import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { AssistantModelPreferenceViewSchema, ASSISTANT_FAILURES, type AssistantFailureCode, type AssistantModelPreferenceView } from '../../../models/dashboard/assistant.js';
import type { AssistantQueries } from '../../client/index.js';
import type { HubChat, HubChatsPort } from '../shell/hub-shell-model.js';
import type { AssistantState } from './assistant-model.js';

const Message = z.strictObject({ id: z.string().max(100), role: z.enum(['operator', 'assistant']), text: z.string().max(8000),
  code: z.enum(Object.keys(ASSISTANT_FAILURES) as [AssistantFailureCode, ...AssistantFailureCode[]]).optional(),
  sources: z.array(z.strictObject({ id: z.string().max(140), title: z.string().max(500), excerpt: z.string().max(4000), version: z.string().max(200) })).max(8).optional() });
const Transcript = z.strictObject({ draft: z.string().max(4000), composer: z.string().max(4000), messages: z.array(Message).max(200),
  sequence: z.number().int().nonnegative(), interrupted: z.boolean(), proposalExpired: z.boolean() });
const Data = z.strictObject({ format: z.literal(1), profileId: z.uuid(),
  chats: z.array(z.strictObject({ id: z.string().min(1).max(100), title: z.string().min(1).max(200), minutes: z.number().nonnegative(), group: z.enum(['Today', 'Yesterday', 'Earlier']) })).max(20),
  selected: z.string().max(100).optional(), transcripts: z.record(z.string(), Transcript),
}).refine(value => new Set(value.chats.map(chat => chat.id)).size === value.chats.length
  && (value.selected === undefined || value.chats.some(chat => chat.id === value.selected))
  && Object.keys(value.transcripts).every(id => value.chats.some(chat => chat.id === id)));
const NOTICE = ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNSAVED;
const emptyTranscript = (): z.infer<typeof Transcript> => ({ draft: '', composer: '', messages: [], sequence: 0, interrupted: false, proposalExpired: false });

export function createAssistantHistory(storage: Pick<Storage, 'getItem' | 'setItem'>, profileId: string) {
  const key = 'relay-assistant-history:' + z.uuid().parse(profileId);
  const raw = storage.getItem(key);
  if (raw !== null && raw.length > 2_000_000) throw Error('ASSISTANT_HISTORY_INVALID');
  let data = raw === null ? Data.parse({ format: 1, profileId, chats: [{ id: crypto.randomUUID(), title: 'New chat', minutes: 0, group: 'Today' }], transcripts: {} }) : Data.parse(JSON.parse(raw));
  if (data.profileId !== profileId) throw Error('ASSISTANT_HISTORY_INVALID');
  let notice = '';
  const listeners = new Set<() => void>();
  function save(next: unknown) {
    const parsed = Data.safeParse(next);
    const bytes = parsed.success ? JSON.stringify(parsed.data) : '';
    if (!parsed.success || bytes.length > 2_000_000) { notice = NOTICE; for (const listener of listeners) listener(); return false; }
    data = parsed.data;
    try { storage.setItem(key, bytes); notice = ''; }
    catch { notice = NOTICE; }
    for (const listener of listeners) listener();
    return true;
  }
  const requireChat = (id: string) => { if (!data.chats.some(chat => chat.id === id)) throw Error('HUB_CHAT_UNAVAILABLE'); };
  const chats: HubChatsPort = {
    source: 'local', read: () => data.chats, selectedId: () => data.selected ?? data.chats[0]?.id,
    async select(id) { requireChat(id); save({ ...data, selected: id }); },
    async create() {
      if (data.chats.length >= 20) throw Error('Delete an old chat before starting another. This tab retains up to 20 chats.');
      const chat: HubChat = { id: crypto.randomUUID(), title: 'New chat', minutes: 0, group: 'Today' };
      if (!save({ ...data, chats: [chat, ...data.chats], selected: chat.id })) throw Error(NOTICE);
      return chat;
    },
    async rename(id, title) { requireChat(id); if (!title.trim() || title.trim().length > 200) throw Error('HUB_CHAT_TITLE_INVALID'); save({ ...data, chats: data.chats.map(chat => chat.id === id ? { ...chat, title: title.trim() } : chat) }); },
    async remove(id) {
      requireChat(id); const transcripts = { ...data.transcripts }; delete transcripts[id];
      const remaining = data.chats.filter(chat => chat.id !== id);
      save({ ...data, chats: remaining, transcripts, selected: data.selected === id ? remaining[0]?.id : data.selected });
    },
  };
  return {
    profileId, chats, subscribe(this: void, listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }, notice: () => notice,
    read(id: string): AssistantState | undefined {
      requireChat(id); const saved = data.transcripts[id]; if (saved === undefined || saved.sequence === 0 && saved.messages.length === 0 && !saved.draft && !saved.composer) return undefined;
      return { draft: saved.draft, messages: saved.proposalExpired ? [...saved.messages, { id: 'restored-proposal', role: 'assistant', text: 'The previous proposal expired on refresh. Request a new proposal to review.' }] : saved.messages,
        sequence: saved.sequence, restored: true, turn: saved.interrupted ? { state: 'unknown', requestId: saved.sequence, prompt: saved.draft } : { state: 'idle' } };
    },
    retain(id: string, state: AssistantState) {
      requireChat(id); const turn = state.turn;
      save({ ...data, transcripts: { ...data.transcripts, [id]: { draft: state.draft, composer: data.transcripts[id]?.composer ?? '', messages: state.messages.map(({ attachments: _sent, ...message }) => message), // shortcut: sent-file names are not retained until history carries attachments (gate 50)
        sequence: state.sequence, interrupted: turn.state === 'waiting' || turn.state === 'unknown' || turn.state === 'proposal' && (turn.disposition === 'confirming' || turn.disposition === 'unknown'),
        proposalExpired: turn.state === 'proposal' && turn.disposition === 'review' } } });
    },
    draft(id: string) { return { read: () => data.transcripts[id]?.composer ?? '', retain(text: string) {
      requireChat(id); save({ ...data, transcripts: { ...data.transcripts, [id]: { ...(data.transcripts[id] ?? emptyTranscript()), composer: text } } });
    } }; },
  };
}
export type AssistantHistory = ReturnType<typeof createAssistantHistory>;
const noSubscribe = () => () => {};
const noNotice = () => '';
export function useAssistantHistory(client: AssistantQueries, enabled: boolean, authority: unknown) {
  const [resource, setResource] = useState<{ authority: unknown; state: 'ready'; store: AssistantHistory; preference: AssistantModelPreferenceView['preference'] } | { authority: unknown; state: 'failed'; error: string }>();
  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    void (async () => {
      try {
        if (client.assistantModelPreference === undefined) throw Error('ASSISTANT_HISTORY_UNAVAILABLE');
        const view = AssistantModelPreferenceViewSchema.parse(await client.assistantModelPreference(abort.signal));
        if (!abort.signal.aborted) setResource({ authority, state: 'ready', store: createAssistantHistory(sessionStorage, view.profileId), preference: view.preference });
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
  return { preferenceChanged, store: enabled ? ready?.store : undefined, preference: enabled ? ready?.preference : undefined, pending: enabled && current === undefined, notice: current?.state === 'failed' ? current.error : notice };
}
