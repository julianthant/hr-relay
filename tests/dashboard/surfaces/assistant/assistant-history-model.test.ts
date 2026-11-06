import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { afterEach, it } from 'vitest';
import { ASSISTANT_FAILURES, ASSISTANT_HISTORY_BODY_MAX_BYTES, type AssistantHistoryOperation } from '../../../../src/models/dashboard/assistant.js';
import { ASSISTANT_PROPOSAL_CAPTION, createAssistantHistory, importBatches } from '../../../../src/dashboard/surfaces/assistant/assistant-history-model.js';
import { assistantHistoryServer } from '../../../support/helpers/dashboard/assistant-history-server.js';

const servers: ReturnType<typeof assistantHistoryServer>[] = [];
afterEach(() => { for (const server of servers.splice(0)) server.close(); });
function world() {
  const server = assistantHistoryServer(); servers.push(server);
  const bytes = new Map<string, string>(), key = 'relay-assistant-history:' + server.profileId;
  const storage = { getItem: (name: string) => bytes.get(name) ?? null, removeItem(name: string) { bytes.delete(name); } };
  const open = () => createAssistantHistory(server.client, storage, server.profileId, new AbortController().signal);
  return { server, bytes, key, storage, open };
}
type OldMessage = { id: string; role: 'operator' | 'assistant'; text: string };
const transcript = (messages: OldMessage[], extra: { draft?: string; composer?: string; interrupted?: boolean; proposalExpired?: boolean } = {}) =>
  ({ draft: extra.draft ?? '', composer: extra.composer ?? '', messages, sequence: messages.length, interrupted: extra.interrupted ?? false, proposalExpired: extra.proposalExpired ?? false });
const oldChat = (id: string, title: string) => ({ id, title, minutes: 3, group: 'Today' as const });
const imports = (writes: readonly unknown[]) => writes.filter((write): write is Extract<AssistantHistoryOperation, { operation: 'import' }> =>
  typeof write === 'object' && write !== null && 'operation' in write && write.operation === 'import');

it('creates one chat for an empty profile and keeps rename, select, drafts and clear on the served rows', async () => {
  const w = world(), store = await w.open();
  const [first] = store.chats.read(); assert.ok(first); assert.equal(first.title, 'New chat'); assert.equal(store.blocked(), false);
  const second = await store.chats.create();
  await store.chats.rename(first.id, '  Useful chat  ');
  await store.chats.select?.(first.id);
  await assert.rejects(store.chats.rename(first.id, ' '), /HUB_CHAT_TITLE_INVALID/u);
  store.draft(first.id).retain('unsent composer');
  await new Promise(resolve => setTimeout(resolve, 0));
  const reopened = await w.open();
  assert.equal(reopened.chats.selectedId?.(), first.id);
  assert.deepEqual(reopened.chats.read().map(chat => [chat.id, chat.title]).sort(), [[first.id, 'Useful chat'], [second.id, 'New chat']].sort());
  assert.equal(reopened.draft(first.id).read(), 'unsent composer');
  await reopened.chats.remove(second.id);
  assert.equal(reopened.has(second.id), false);
  assert.equal(w.server.repository.conversation(second.id, w.server.now()), undefined);
  await reopened.chats.rename(first.id, 'Renamed elsewhere');
  await assert.rejects(store.chats.rename(first.id, 'Stale revision'), (error: unknown) => error instanceof Error && error.message === ASSISTANT_FAILURES.ASSISTANT_CONVERSATION_STALE);
});

it('restores served rows without a card or Confirm and states every turn delivery', async () => {
  const w = world(), id = (await w.open()).chats.read()[0]?.id; assert.ok(id);
  const history = w.server.repository, now = w.server.now();
  const send = (text: string) => {
    const messageId = randomUUID(), expectedRevision = history.conversation(id, now)?.revision ?? 0;
    assert.equal(history.accept({ conversationId: id, expectedRevision, messageId, text, modelText: text, subjectRef: null, now }).state, 'accepted');
    return messageId;
  };
  history.settle(id, send('Prepare a card'), { delivery: 'answered', reply: { id: randomUUID(), kind: 'proposal', actionId: randomUUID(), text: ASSISTANT_PROPOSAL_CAPTION, modelText: 'card' } }, now);
  history.settle(id, send('Refused one'), { delivery: 'refused', code: 'ASSISTANT_LIMIT' }, now);
  send('Lost one'); history.settleInterrupted(now);
  const state = (await w.open()).read(id);
  assert.ok(state); assert.equal(state.restored, true); assert.equal(state.turn.state, 'idle');
  assert.deepEqual(state.messages.map(message => message.text), ['Prepare a card', 'This proposal is no longer available. Ask again to review a new one.',
    'Refused one', ASSISTANT_FAILURES.ASSISTANT_LIMIT, 'Lost one', 'The reply was not saved. Do not resend it; ask again as a new message.']);
  assert.equal(JSON.stringify(state).includes('actionId'), false);
});

it('imports drafts and a selected chat that is not first, retries a lost select response and deletes the old key only after readback', async () => {
  const w = world(), first = randomUUID(), second = randomUUID();
  w.bytes.set(w.key, JSON.stringify({ format: 1, profileId: w.server.profileId, chats: [oldChat(first, 'First'), oldChat(second, 'Second')], selected: second,
    transcripts: { [first]: transcript([{ id: 'a', role: 'operator', text: 'Hello' }]), [second]: transcript([], { draft: 'panel draft', composer: 'hub draft' }) } }));
  let lose = true;
  w.server.fail(write => { const selected = typeof write === 'object' && write !== null && 'operation' in write && write.operation === 'select';
    if (selected && lose) { lose = false; return 'after'; } return undefined; });
  const failed = await w.open();
  assert.equal(failed.blocked(), true); assert.equal(failed.notice(), ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNSAVED); assert.ok(w.bytes.has(w.key));
  const before = w.server.writes.length;
  const store = await w.open();
  assert.equal(store.blocked(), false); assert.equal(w.bytes.has(w.key), false);
  assert.equal(w.server.writes.slice(before).some(write => typeof write === 'object' && write !== null && 'operation' in write && write.operation === 'select'), false);
  assert.equal(store.chats.selectedId?.(), second);
  assert.equal(store.draft(second).read(), 'hub draft'); assert.equal(store.read(second)?.draft, 'panel draft');
  assert.deepEqual(store.read(first)?.messages.map(message => message.text), ['Hello']);
});

it('imports a chat larger than one batch through a lost middle and a lost final response with the same identities', async () => {
  const w = world(), id = randomUUID();
  const messages: OldMessage[] = Array.from({ length: 200 }, (_, index) => ({ id: `m${String(index)}`, role: index % 2 === 0 ? 'operator' : 'assistant', text: 'Ω'.repeat(8000) }));
  const old = { format: 1, profileId: w.server.profileId, chats: [oldChat(id, 'Long')], transcripts: { [id]: transcript(messages, { interrupted: true }) } };
  const batches = importBatches(id, 'Long', old.transcripts[id]);
  assert.ok(batches.length >= 3);
  for (const batch of batches) assert.ok(new TextEncoder().encode(JSON.stringify(batch)).length <= ASSISTANT_HISTORY_BODY_MAX_BYTES);
  w.bytes.set(w.key, JSON.stringify(old));
  const lostStarts = [batches[1]?.start, batches.at(-1)?.start];
  w.server.fail(write => {
    const operation = imports([write])[0];
    if (operation !== undefined && operation.start === lostStarts[0]) { lostStarts.shift(); return 'after'; }
    return undefined;
  });
  assert.equal((await w.open()).blocked(), true); assert.ok(w.bytes.has(w.key));
  assert.equal((await w.open()).blocked(), true); assert.ok(w.bytes.has(w.key));
  const store = await w.open();
  assert.equal(store.blocked(), false); assert.equal(w.bytes.has(w.key), false);
  const served = w.server.repository.conversation(id, w.server.now()); assert.ok(served);
  assert.equal(served.messages.length, 200); assert.equal(served.importTotal, 200); assert.equal(served.importNotice, 'unknown');
  assert.deepEqual(served.messages.map(row => row.id), batches.flatMap(batch => batch.messages.map(message => message.messageId)));
  assert.equal(store.read(id)?.messages.at(-1)?.text, "The previous request's outcome is unknown. Do not retry it.");
});

it('keeps a full transcript within the limit with either closing notice', async () => {
  for (const [flag, text] of [['interrupted', "The previous request's outcome is unknown. Do not retry it."], ['proposalExpired', 'The previous proposal expired. Ask again to review a new one.']] as const) {
    const w = world(), id = randomUUID();
    const messages: OldMessage[] = Array.from({ length: 200 }, (_, index) => ({ id: `m${String(index)}`, role: 'assistant', text: `Row ${String(index)}` }));
    w.bytes.set(w.key, JSON.stringify({ format: 1, profileId: w.server.profileId, chats: [oldChat(id, 'Full')], transcripts: { [id]: transcript(messages, { [flag]: true }) } }));
    const store = await w.open(); assert.equal(store.blocked(), false);
    const restored = store.read(id)?.messages ?? [];
    assert.equal(restored.length, 201); assert.equal(restored.at(-1)?.text, text); assert.equal(restored.at(-2)?.text, 'Row 199');
  }
});

it('imports repeated restored-proposal identities as distinct rows and an exact retry changes nothing', async () => {
  const w = world(), id = randomUUID();
  const messages: OldMessage[] = [{ id: 'restored-proposal', role: 'assistant', text: 'Expired one' }, { id: 'q', role: 'operator', text: 'Again' },
    { id: 'restored-proposal', role: 'assistant', text: 'Expired two' }];
  const old = transcript(messages), [batch] = importBatches(id, 'Repeats', old); assert.ok(batch);
  assert.equal(new Set(batch.messages.map(message => message.messageId)).size, 3);
  assert.deepEqual(importBatches(id, 'Repeats', old), [batch]);
  w.bytes.set(w.key, JSON.stringify({ format: 1, profileId: w.server.profileId, chats: [oldChat(id, 'Repeats')], transcripts: { [id]: old } }));
  const store = await w.open(); assert.equal(store.blocked(), false);
  const revision = store.revision(id);
  assert.deepEqual(await w.server.client.assistantHistoryWrite(batch), { state: 'saved', conversationId: id, revision });
  assert.deepEqual(store.read(id)?.messages.map(message => message.text), ['Expired one', 'Again', 'Expired two']);
});

it('keeps unparseable, foreign or unsaved source bytes and disables sending', async () => {
  for (const raw of ['{broken', JSON.stringify({ format: 1, profileId: randomUUID(), chats: [], transcripts: {} })]) {
    const w = world(); w.bytes.set(w.key, raw);
    const store = await w.open();
    assert.equal(store.blocked(), true); assert.equal(store.notice(), ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNAVAILABLE);
    assert.equal(w.bytes.get(w.key), raw); assert.equal(w.server.writes.length, 0);
  }
  const w = world(), id = randomUUID();
  const raw = JSON.stringify({ format: 1, profileId: w.server.profileId, chats: [oldChat(id, 'Kept')], transcripts: {} });
  w.bytes.set(w.key, raw); w.server.fail(() => 'before');
  const store = await w.open();
  assert.equal(store.blocked(), true); assert.equal(store.notice(), ASSISTANT_FAILURES.ASSISTANT_HISTORY_UNSAVED); assert.equal(w.bytes.get(w.key), raw);
  store.draft(id).retain('ignored while blocked'); assert.equal(w.server.writes.length, 1);
});
