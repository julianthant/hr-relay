import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { createAssistantHistory } from '../../../../src/dashboard/surfaces/assistant/assistant-history-model.js';
import { createAssistantController } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import type { AssistantState } from '../../../../src/dashboard/surfaces/assistant/assistant-model.js';
const profile = '00000000-0000-4000-8000-000000000001';
function fixture() {
  const bytes = new Map<string, string>(); let refuse = false;
  const storage = { getItem: (key: string) => bytes.get(key) ?? null, setItem(key: string, value: string) { if (refuse) throw Error('private browser error'); bytes.set(key, value); } };
  return { bytes, storage, refuse: () => { refuse = true; } };
}
const state = (): AssistantState => ({ draft: 'draft', messages: [{ id: 'one', role: 'operator', text: 'help permissions' }, { id: 'two', role: 'assistant', text: 'Recorded reply' }], sequence: 1, turn: { state: 'idle' } });
it('retains chat titles, selected chat, composer drafts and transcripts across a fresh store/controller', () => {
  const f = fixture(), store = createAssistantHistory(f.storage, profile), chat = store.chats.create();
  store.chats.rename(chat.id, 'Useful chat'); store.chats.select?.(chat.id);
  store.retain(chat.id, state()); store.draft(chat.id).retain('unsent text');
  const refreshed = createAssistantHistory(f.storage, profile);
  assert.equal(refreshed.chats.selectedId?.(), chat.id); assert.equal(refreshed.chats.read()[0].title, 'Useful chat');
  assert.equal(refreshed.draft(chat.id).read(), 'unsent text');
  const controller = createAssistantController({ assistantRespond: async () => { throw Error('unexpected request'); } }, { authority: 'current' }, { read: () => refreshed.read(chat.id), retain: next => refreshed.retain(chat.id, next) });
  assert.deepEqual(controller.snapshot().messages, state().messages); assert.equal(controller.snapshot().restored, true);
  const other = createAssistantHistory(f.storage, '00000000-0000-4000-8000-000000000002');
  assert.equal(other.read(other.chats.read()[0].id), undefined);
  refreshed.chats.remove(chat.id);
  assert.equal(createAssistantHistory(f.storage, profile).chats.read().some(value => value.id === chat.id), false);
});
it('restores pending effects as UNKNOWN and never restores confirmation authority or verification proof', () => {
  const f = fixture(), store = createAssistantHistory(f.storage, profile), id = store.chats.read()[0].id;
  store.retain(id, { ...state(), turn: { state: 'waiting', requestId: 1, prompt: 'change notifications' }, verification: { state: 'passed' } });
  const restored = createAssistantHistory(f.storage, profile).read(id);
  assert.equal(restored?.turn.state, 'unknown'); assert.equal(restored?.verification, undefined);
  store.retain(id, { ...state(), turn: { state: 'proposal', disposition: 'review', proposal: { id: 'action', action: { chatId: crypto.randomUUID(), actionId: crypto.randomUUID(), revision: 1 }, revision: '1', prompt: 'draft', workflow: { id: 'notification', label: 'Read', version: '1' }, subjects: [], values: [], mode: 'local-change', effects: [], stopBefore: [] } } });
  const snapshot = createAssistantHistory(f.storage, profile).read(id);
  assert.equal(snapshot?.turn.state, 'idle'); assert.match(snapshot?.messages.at(-1)?.text ?? '', /expired on refresh/u);
  assert.equal([...f.bytes.values()].some(value => value.includes('actionId')), false);
});
it('refuses corrupt or foreign stored data and visibly reports failed persistence without changing request semantics', () => {
  const f = fixture(), store = createAssistantHistory(f.storage, profile), id = store.chats.read()[0].id;
  f.refuse(); store.retain(id, state()); assert.match(store.notice(), /could not be saved/u); assert.deepEqual(store.read(id)?.messages, state().messages);
  const key = 'relay-assistant-history:' + profile;
  f.bytes.set(key, '{broken'); assert.throws(() => createAssistantHistory(f.storage, profile));
  f.bytes.set(key, JSON.stringify({ format: 1, profileId: crypto.randomUUID(), chats: [], transcripts: {} })); assert.throws(() => createAssistantHistory(f.storage, profile));
});
it('keeps the whole transcript when a message carries sent files, drops only the file names, and isolates chats', async () => {
  const f = fixture(), store = createAssistantHistory(f.storage, profile), first = store.chats.read()[0].id, second = store.chats.create().id;
  const open = (id: string) => createAssistantController({ assistantRespond: async () => ({ state: 'answered', text: 'Recorded reply' }) }, { authority: 'current' }, { read: () => store.read(id), retain: next => store.retain(id, next) });
  const controller = open(first);
  controller.action({ type: 'edit', value: 'Review this file' }); controller.action({ type: 'send', attachments: [{ id: 'f1', name: 'Notes.pdf' }] });
  await vi.waitFor(() => assert.equal(controller.snapshot().messages.at(-1)?.role, 'assistant'));
  assert.equal(store.notice(), '');
  const reloaded = createAssistantHistory(f.storage, profile).read(first);
  assert.deepEqual(reloaded?.messages.map(message => [message.role, message.text]), [['operator', 'Review this file'], ['assistant', 'Recorded reply']]);
  assert.equal(reloaded?.messages.some(message => 'attachments' in message), false);
  assert.equal(createAssistantHistory(f.storage, profile).read(second), undefined);
  const pending = open(second); let release: () => void = () => {};
  const held = createAssistantController({ assistantRespond: () => new Promise(resolve => { release = () => resolve({ state: 'answered', text: 'x' }); }) }, { authority: 'current' }, { read: () => store.read(second), retain: next => store.retain(second, next) });
  held.action({ type: 'edit', value: 'change something' }); held.action({ type: 'send', attachments: [{ id: 'f2', name: 'Other.csv' }] });
  assert.equal(store.notice(), '');
  assert.equal(createAssistantHistory(f.storage, profile).read(second)?.turn.state, 'unknown');
  assert.equal(pending.snapshot().turn.state === 'idle' || pending.snapshot().restored === true, true);
  release();
});
