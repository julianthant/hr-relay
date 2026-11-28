// @vitest-environment jsdom
import { chatGptStatusFixture } from "../../../support/helpers/chatgpt-status-fixture.js";
import { createDashboardClient } from '../../../../src/dashboard/client/index.js';
import { ChatGptAccountStateSchema } from '../../../../src/models/dashboard/chatgpt-account.js';
import { ERROR_CATALOG } from '../../../../src/models/failures/error-catalog.js';
import { ASSISTANT_MODEL_COMMAND, ASSISTANT_DEFAULT_EFFORT, type AssistantM1Request } from '../../../../src/models/dashboard/assistant.js';
import { AssistantPanel as ShellAssistantPanel } from '../../../../src/dashboard/surfaces/shell/assistant-panel.js';
import { TooltipProvider } from '../../../../src/dashboard/ds/ui.js';
import { type AssistantFile } from '../../../../src/dashboard/surfaces/shell/assistant-panel-model.js';

import assert from 'node:assert/strict';
import { afterEach, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createAssistantHistory } from '../../../../src/dashboard/surfaces/assistant/assistant-history-model.js';
import { resultClient, type ScriptedReply } from '../../../support/helpers/dashboard/assistant-served-client.js';
import { assistantHistoryServer } from '../../../support/helpers/dashboard/assistant-history-server.js';
import { MeasurementFreeResizeObserver } from '../../../support/helpers/settings-storage-doctor-fixtures.js';
import { useAssistantController } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import { ChatGptAccountContext, createPreviewChatGptAccountPort, createServedChatGptAccountPort, type ChatGptAccountPort, type ChatGptAccountSnapshot } from '../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js';
import { type ComposerDraft, useComposer } from '../../../../src/dashboard/surfaces/shell/composer-model.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('isolates retained chats, cancels cross-chat replies and invalidates every chat on account or authority changes', async () => {
  const pending: { signal?: AbortSignal; settle: (value: ScriptedReply) => void }[] = [];
  const client = resultClient({ assistantRespond: (_request: unknown, signal?: AbortSignal) => new Promise<ScriptedReply>(settle => pending.push({ signal, settle })) });
  const listeners = new Set<() => void>();
  let snapshot: ChatGptAccountSnapshot = { state: 'connected', name: 'Synthetic', email: 'synthetic@example.com', planUsage: 'enabled' };
  const account: ChatGptAccountPort = { mode: 'live', getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    signIn: async () => {}, cancelSignIn: async () => {}, signOut: async () => undefined };
  const publishAccount = (next: ChatGptAccountSnapshot) => { snapshot = next; for (const listener of listeners) listener(); };
  const loseAccount = () => publishAccount({ state: 'unavailable', message: 'Synthetic account loss' });
  let current!: ReturnType<typeof useAssistantController>;
  function Harness({ chat, authority }: { chat: string; authority: number }) { current = useAssistantController(client, authority, undefined, false, chat); return null; }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  async function render(chat: string, authority = 1) { await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(Harness, { chat, authority }) }))); }
  await render('a');
  await act(async () => { current.onAction({ type: 'edit', value: '  Exact Unicode Ω\nrequest  ' }); current.onAction({ type: 'send' }); });
  assert.equal(current.state.turn.state, 'waiting');
  await render('b'); assert.equal(pending[0].signal?.aborted, true); assert.equal(current.state.draft, '');
  await act(async () => { pending[0].settle({ state: 'answered', text: 'Late A' }); });
  assert.equal(current.state.messages.length, 0);
  await act(async () => { current.onAction({ type: 'edit', value: 'B request' }); current.onAction({ type: 'send' }); });
  await act(async () => { pending[1].settle({ state: 'no-reply', reason: 'ASSISTANT_SUBJECT_REQUIRED' }); });
  assert.equal(current.state.messages.at(-1)?.text, 'Select one person before preparing a proposal.');
  await render('a'); assert.equal(current.state.draft, '  Exact Unicode Ω\nrequest  '); assert.equal(current.state.turn.state, 'unknown');
  assert.equal(current.state.messages.some(message => message.text === 'Late A'), false);
  await act(async () => { current.onAction({ type: 'new-chat' }); current.onAction({ type: 'edit', value: 'Fresh manual request' }); current.onAction({ type: 'send' }); });
  await render('a', 2); assert.equal(pending[2].signal?.aborted, true);
  await act(async () => { pending[2].settle({ state: 'answered', text: 'Stale authority' }); });
  assert.equal(current.state.messages.some(message => message.text === 'Stale authority'), false);
  assert.equal(current.state.turn.state, 'unknown');
  const unknownBeforeAccountChange = current.onAction, beforeAccountDispatch = pending.length, nextAccountDraft = current.state.draft;
  await act(async () => unknownBeforeAccountChange({ type: 'send' }));
  assert.equal(pending.length, beforeAccountDispatch);
  assert.equal(current.state.turn.state, 'unknown');
  await render('new-chat-after-authority-loss', 1);
  await act(async () => current.onAction({ type: 'edit', value: nextAccountDraft }));
  await act(async () => { current.onAction({ type: 'send' }); });
  await act(async () => { publishAccount({ state: 'signed-out' }); }); assert.equal(pending[3].signal?.aborted, true); assert.equal(current.accountAvailable, false);
  await act(async () => { pending[3].settle({ state: 'answered', text: 'Stale account' }); });
  assert.equal(current.state.messages.some(message => message.text === 'Stale account'), false);
  await act(async () => { publishAccount({ state: 'connected', name: 'Synthetic', email: 'synthetic@example.com', planUsage: 'enabled' }); });
  await render('unavailable-loss');
  await act(async () => { current.onAction({ type: 'edit', value: 'Unavailable loss' }); current.onAction({ type: 'send' }); });
  await act(async () => loseAccount()); assert.equal(pending[4].signal?.aborted, true); assert.equal(current.accountAvailable, false);
  await act(async () => { pending[4].settle({ state: 'answered', text: 'Stale account' }); });
  assert.equal(current.state.messages.some(message => message.text === 'Stale account'), false);
  await act(async () => current.forgetSession('b'));
  await render('b'); assert.equal(current.state.draft, ''); assert.equal(current.state.messages.length, 0);
});

it('clears only the submitted composer version on a valid reply and retains newer edits, files, failures and cancellation', async () => {
  const replies: { resolve: (value: ScriptedReply) => void; reject: (error: Error) => void }[] = [];
  const client = resultClient({ assistantRespond: () => new Promise<ScriptedReply>((resolve, reject) => replies.push({ resolve, reject })) });
  let controller!: ReturnType<typeof useAssistantController>, composer!: ReturnType<typeof useComposer>;
  function Harness({ chat, authority }: { chat: string; authority: number }) {
    controller = useAssistantController(client, authority, undefined, false, chat);
    composer = useComposer({ settlementKey: controller.state.messages.findLast(message => message.role === 'assistant')?.id,
      async onSend(value) { controller.onAction({ type: 'edit', value: value.text }); controller.onAction({ type: 'send' }); return false; } });
    return null;
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  async function render(chat = 'a', authority = 1) { await act(async () => root?.render(createElement(Harness, { key: chat, chat, authority }))); }
  await render();
  async function send(text: string) { await act(async () => composer.setText(text)); await act(async () => { await composer.send(); }); }
  const file = { id: 'file', name: 'Notes.txt', status: 'Attached' as const };
  await act(async () => composer.setFiles([file])); await send('Exact success');
  await act(async () => replies[0].resolve({ state: 'answered', text: 'Answer' }));
  assert.equal(composer.text, ''); assert.deepEqual(composer.files, []); assert.equal(controller.state.draft, 'Exact success');
  await send('Before edit'); await act(async () => composer.setText('Newer edit'));
  await act(async () => replies[1].resolve({ state: 'answered', text: 'Answer' })); assert.equal(composer.text, 'Newer edit');
  await send('Before files'); await act(async () => composer.setFiles([file]));
  await act(async () => replies[2].resolve({ state: 'answered', text: 'Answer' })); assert.equal(composer.text, 'Before files'); assert.equal(composer.files[0], file);
  await send('Edit then revert'); await act(async () => composer.setText('Changed')); await act(async () => composer.setText('Edit then revert'));
  await act(async () => replies[3].resolve({ state: 'answered', text: 'Answer' })); assert.equal(composer.text, 'Edit then revert');
  await send('Failed'); await act(async () => replies[4].reject(new Error('Synthetic transport failure'))); assert.equal(composer.text, 'Failed');
  assert.equal(controller.state.turn.state, 'failed');
  await act(async () => controller.onAction({ type: 'retry' })); assert.equal(replies.length, 6);
  await act(async () => controller.onAction({ type: 'cancel' }));
  assert.equal(controller.state.turn.state, 'unknown');
  const unknownBeforeCancel = controller.onAction, beforeCancelDispatch = replies.length, nextCancelFiles = composer.files;
  await act(async () => unknownBeforeCancel({ type: 'send' }));
  assert.equal(replies.length, beforeCancelDispatch);
  assert.equal(controller.state.turn.state, 'unknown');
  await render('new-chat-after-transport-uncertainty');
  await act(async () => composer.setFiles(nextCancelFiles));
  await send('Cancelled'); await act(async () => controller.onAction({ type: 'cancel' }));
  await act(async () => replies[6].resolve({ state: 'answered', text: 'Late' })); assert.equal(composer.text, 'Cancelled');
  assert.equal(controller.state.turn.state, 'unknown');
  const beforeAuthorityDispatch = replies.length, authorityFiles = composer.files;
  await act(async () => controller.onAction({ type: 'send' }));
  assert.equal(replies.length, beforeAuthorityDispatch);
  assert.equal(controller.state.turn.state, 'unknown');
  await render('authority-change-case');
  await act(async () => composer.setFiles(authorityFiles));
  await send('Old authority'); await render("authority-change-case", 2);
  await act(async () => replies[7].resolve({ state: 'answered', text: 'Late authority' })); assert.equal(composer.text, 'Old authority');
  assert.equal(controller.state.turn.state, 'unknown');
  const beforeTypedDispatch = replies.length, typedFiles = composer.files;
  await act(async () => controller.onAction({ type: 'send' }));
  assert.equal(replies.length, beforeTypedDispatch);
  assert.equal(controller.state.turn.state, 'unknown');
  await render('typed-authority-change-case');
  await act(async () => composer.setFiles(typedFiles));
  await send('Old chat'); await render("typed-authority-change-case", 2); await act(async () => composer.setText('Other chat draft'));
  await act(async () => replies[8].resolve({ state: 'answered', text: 'Late chat' })); assert.equal(composer.text, 'Other chat draft');
});

it('gives the automatic chat title only after the first reply settles, never racing the send', async () => {
  const { AssistantPanel } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel.js');
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const account = { ...preview, mode: 'live' as const };
  const reply = Promise.withResolvers<ScriptedReply>(), titles: string[] = [];
  const client = resultClient({ assistantRespond: () => reply.promise });
  let current!: ReturnType<typeof useAssistantController>;
  function Harness() {
    current = useAssistantController(client, 1, undefined, false);
    return createElement(AssistantPanel, { conversationPort: { initial: () => ({ id: 'chat', title: 'New chat', files: [] }) },
      served: current, title: 'New chat', onAutomaticTitle: title => { titles.push(title); } });
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(Harness) })));
  await act(async () => { current.onAction({ type: 'edit', value: 'Who ran today?' }); current.onAction({ type: 'send' }); });
  assert.deepEqual(titles, [], 'no rename while the send is in flight');
  await act(async () => { reply.resolve({ state: 'answered', text: 'Nobody yet.' }); await reply.promise; });
  await vi.waitFor(() => assert.deepEqual(titles, ['Who ran today?']));
});

function setupAccount() {
  let reads = 0;
  const unavailable = ChatGptAccountStateSchema.parse({ state: "unavailable", code: 'CHATGPT_USAGE_UNAVAILABLE',
    message: ERROR_CATALOG.CHATGPT_USAGE_UNAVAILABLE.text });
  const client = createDashboardClient({ baseUrl: 'http://relay.test', fetchImpl: async () => { reads++; return Response.json(chatGptStatusFixture(unavailable)); } });
  const port = createServedChatGptAccountPort(client);
  return { port, get reads() { return reads; } };
}
it('treats an unreadable usage meter as a working sign-in with no test gate', async () => {
  const account = setupAccount(); let calls = 0, current!: ReturnType<typeof useAssistantController>;
  const client = resultClient({ async assistantRespond(): Promise<ScriptedReply> { calls++; return { state: 'answered', text: 'Answered' }; } });
  function Harness() { current = useAssistantController(client, 'profile', undefined, false); return null; }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  try {
    await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account.port, children: createElement(Harness) })));
    await vi.waitFor(() => { assert.equal(current.canCompose, true); assert.equal(current.accountAvailable, true); });
    const resource = account.port.getResource(); assert.ok('code' in resource); assert.equal(resource.code, 'CHATGPT_USAGE_UNAVAILABLE');
    await act(async () => { current.onAction({ type: "edit", value: 'Who ran today?' }); current.onAction({ type: "send" }); });
    await vi.waitFor(() => assert.equal(calls, 1));
    assert.equal(account.reads, 2); // the stored account and its one guarded check
  } finally { account.port.dispose(); }
});
it('reads the model list again for each account the guarded check settles, including the same account', async () => {
  const connected: ChatGptAccountSnapshot = { state: 'connected', name: 'Synthetic', email: 'synthetic@example.com', planUsage: 'enabled' };
  let snapshot: ChatGptAccountSnapshot = connected, observed = false, reads = 0, current!: ReturnType<typeof useAssistantController>;
  const listeners = new Set<() => void>();
  const account: ChatGptAccountPort = { mode: 'live', getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    signIn: async () => {}, cancelSignIn: async () => {}, signOut: async () => undefined };
  const client = resultClient({ async assistantRespond(): Promise<ScriptedReply> { return { state: 'answered', text: 'Unused' }; },
    async assistantModels() { reads++; if (!observed) throw new Error('synthetic unobserved catalog'); return { models: [{ slug: 'synthetic-model', displayName: 'Synthetic model' }] }; } });
  function Harness() { current = useAssistantController(client, 'profile', undefined, false); return null; }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(Harness) })));
  assert.equal(reads, 1); assert.equal(current.models, undefined);
  observed = true;
  await act(async () => { snapshot = { ...connected }; for (const listener of listeners) listener(); });
  assert.equal(reads, 2); assert.deepEqual(current.models, [{ slug: 'synthetic-model', displayName: 'Synthetic model' }]);
});
function delayedAccount(nowMs: () => number) {
  type Status = ReturnType<typeof chatGptStatusFixture>;
  const checks: PromiseWithResolvers<Status>[] = [];
  let stored = chatGptStatusFixture({ state: 'expired' });
  const refused = async (): Promise<never> => { throw new Error('unexpected account command'); };
  const port = createServedChatGptAccountPort({ chatGptAccount: async () => stored, checkChatGptAccount: () => { const check = Promise.withResolvers<Status>(); checks.push(check); return check.promise; },
    startChatGptSignIn: refused, completeChatGptSignIn: refused, cancelChatGptSignIn: refused, signOutChatGpt: refused, testChatGptOcr: refused }, { nowMs });
  const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
  return { port, checks, settle, resolve: async (index: number, value: unknown) => { stored = chatGptStatusFixture(value); checks[index].resolve(stored); await settle(); } };
}
it('holds composing through the expiry check and shows only the accepted account model list', async () => {
  vi.useFakeTimers();
  let now = Date.parse('2026-10-12T12:59:59.000Z'), requests = 0, preferenceReads = 0, current!: ReturnType<typeof useAssistantController>;
  const account = delayedAccount(() => now), lists: PromiseWithResolvers<{ models: { slug: string; displayName: string }[] }>[] = [];
  const client = resultClient({ async assistantRespond(): Promise<ScriptedReply> { requests++; return { state: 'answered', text: 'Unexpected' }; },
    assistantModels: () => { const list = Promise.withResolvers<{ models: { slug: string; displayName: string }[] }>(); lists.push(list); return list.promise; },
    assistantModelPreference: async () => { preferenceReads++; throw new Error('unexpected preference read'); } });
  function Harness() { current = useAssistantController(client, 'profile', undefined, false); return null; }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const connected = (name: string, expiresAt: string) => ({ state: 'connected', name, email: 'synthetic@example.com', planUsage: 'enabled', expiresAt });
  try {
    await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account.port, children: createElement(Harness) })));
    await account.settle(); assert.equal(current.canCompose, false);
    await account.resolve(0, connected('First', '2026-10-12T13:00:00.000Z'));
    assert.equal(current.canCompose, true); assert.equal(lists.length, 1);
    lists[0].resolve({ models: [{ slug: 'first-model', displayName: 'First model' }] }); await account.settle();
    assert.deepEqual(current.models?.map(model => model.slug), ['first-model']);
    const openMenuPick = current.chooseModel;
    now += 1_000; await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    assert.equal(account.checks.length, 2);
    assert.equal(current.models === undefined, true);
    await act(async () => { await openMenuPick({ slug: 'first-model', effort: ASSISTANT_DEFAULT_EFFORT }); await current.chooseModel({ slug: 'first-model', effort: ASSISTANT_DEFAULT_EFFORT }); });
    assert.equal(preferenceReads, 0);
    assert.equal(current.canCompose, false); assert.equal(current.accountAvailable, false); assert.equal(current.accountAction, undefined);
    await act(async () => { current.onAction({ type: 'edit', value: 'Held request' }); current.onAction({ type: 'send' }); });
    assert.equal(requests, 0); assert.equal(current.state.draft, 'Held request'); assert.equal(current.state.turn.state, 'idle');
    await account.resolve(1, connected('Second', '2026-10-12T14:00:00.000Z'));
    assert.equal(current.canCompose, true); assert.equal(current.models === undefined, true); assert.equal(lists.length, 2);
    lists[1].resolve({ models: [{ slug: 'second-model', displayName: 'Second model' }] }); await account.settle();
    assert.deepEqual(current.models?.map(model => model.slug), ['second-model']);
  } finally { account.port.dispose(); vi.useRealTimers(); }
});
it('holds composing through a Retry check and offers Retry again when that check fails', async () => {
  vi.useFakeTimers();
  let current!: ReturnType<typeof useAssistantController>;
  const account = delayedAccount(() => Date.parse('2026-10-12T12:00:00.000Z'));
  const unread = { state: 'unavailable', code: 'CHATGPT_USAGE_UNAVAILABLE', message: ERROR_CATALOG.CHATGPT_USAGE_UNAVAILABLE.text };
  const client = resultClient({ async assistantRespond(): Promise<ScriptedReply> { return { state: 'answered', text: 'Unused' }; } });
  function Harness() { current = useAssistantController(client, 'profile', undefined, false); return null; }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  try {
    await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account.port, children: createElement(Harness) })));
    await account.settle(); await account.resolve(0, unread);
    assert.equal(current.canCompose, true);
    await act(async () => { current.accountRetry(); }); await account.settle();
    assert.equal(account.checks.length, 2); assert.equal(current.canCompose, false);
    await account.resolve(1, unread);
    assert.equal(current.canCompose, true);
    await act(async () => { current.accountRetry(); }); await account.settle();
    account.checks[2].reject(new Error('synthetic lost check')); await account.settle();
    assert.equal(current.canCompose, false); assert.equal(current.accountAction, 'retry');
  } finally { account.port.dispose(); vi.useRealTimers(); }
});
it('refuses setup attachments before send callbacks, file readers and registration through the existing composer', async () => {
  for (const text of [ASSISTANT_MODEL_COMMAND, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT]) {
    const account = setupAccount(); let requests = 0, sends = 0, registrations = 0, reads = 0, attachments = 0;
    let current!: ReturnType<typeof useAssistantController>;
    const file: AssistantFile = { id: 'fixture-file', name: 'fixture.txt', status: "Attached" };
    Object.defineProperty(file, 'workbook', { get() { reads++; throw new Error('unexpected-file-read'); } });
    let retained: ComposerDraft = { text, files: [file] };
    const draft = { read: () => retained, retain(value: ComposerDraft) { retained = value; } };
    const producer = { initial: () => ({ id: 'chat', title: 'New chat', files: [] }) };
    const client = resultClient({ async assistantRespond(): Promise<ScriptedReply> { requests++; return { state: 'answered', text: 'Unexpected' }; } });
    function Harness() {
      current = useAssistantController(client, 'profile', undefined, false);
      return createElement(ShellAssistantPanel, { conversationPort: producer, served: current, draft,
        async onSendMessage() { sends++; }, async onRegisterSpreadsheet() { registrations++; },
        async onAttachFile() { attachments++; return null; } });
    }
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
    try {
      await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account.port, children: createElement(Harness) })));
      await vi.waitFor(() => assert.equal(current.canCompose, true));
      await act(async () => current.onAction({ type: "edit", value: text }));
      const input = host.querySelector<HTMLInputElement>('input[type="file"]'); assert.ok(input);
      Object.defineProperty(input, 'files', { configurable: true, value: [new File(['fixture'], 'fixture.txt')] });
      await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await Promise.resolve(); });
      const send = host.querySelector<HTMLButtonElement>('button[type="submit"]'); assert.ok(send); assert.equal(send.disabled, false);
      await act(async () => { send.click(); await Promise.resolve(); });
      assert.equal(sends, 0); assert.equal(registrations, 0); assert.equal(requests, 0); assert.equal(reads, 0); assert.equal(attachments, 0);
      assert.ok(host.textContent?.includes('text only'));
    } finally { await act(async () => root?.unmount()); root = undefined; host.remove(); account.port.dispose(); }
  }
});

it('shows one retryable failure after a lost chat response', async () => {
  vi.stubGlobal('ResizeObserver', MeasurementFreeResizeObserver);
  let current!: ReturnType<typeof useAssistantController>, calls = 0;
  const client = resultClient({ async assistantRespond(): Promise<ScriptedReply> { calls++; throw Error('lost workflow proposal response'); } });
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const account = { ...preview, mode: 'live' as const }, producer = { initial: () => ({ id: 'chat', title: 'New chat', files: [] }) };
  function Harness() {
    current = useAssistantController(client, 'current', undefined, false);
    return createElement(ShellAssistantPanel, { conversationPort: producer, served: current });
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(TooltipProvider, { children: createElement(Harness) }) })));
  await act(async () => { current.onAction({ type: 'edit', value: 'start selected workflow' }); current.onAction({ type: 'send' }); });
  assert.equal(current.state.turn.state, 'failed');
  assert.match(document.body.textContent ?? '', /Reply unavailable\./u);
  assert.equal(document.body.textContent?.includes('lost workflow proposal response'), false);
  assert.equal(calls, 1);
  await act(async () => { [...document.querySelectorAll('button')].find(button => button.textContent === 'Retry')?.click(); });
  assert.equal(calls, 2);
});

it('offers no Retry for a recorded refusal the server marked not resendable, so a turn that may have started a run is never sent twice', async () => {
  vi.stubGlobal('ResizeObserver', MeasurementFreeResizeObserver);
  let current!: ReturnType<typeof useAssistantController>, calls = 0;
  const client = resultClient({ async assistantRespond(): Promise<ScriptedReply> { calls++; return { state: 'no-reply', reason: 'ASSISTANT_RESPONSE_FAILED', recorded: true }; } });
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const account = { ...preview, mode: 'live' as const }, producer = { initial: () => ({ id: 'chat', title: 'New chat', files: [] }) };
  function Harness() {
    current = useAssistantController(client, 'current', undefined, false);
    return createElement(ShellAssistantPanel, { conversationPort: producer, served: current });
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(TooltipProvider, { children: createElement(Harness) }) })));
  await act(async () => { current.onAction({ type: 'edit', value: 'check UCPath for 10000001' }); current.onAction({ type: 'send' }); });
  assert.match(document.body.textContent ?? '', /The assistant could not reply\./u);
  assert.equal([...document.querySelectorAll('button')].some(button => button.textContent === 'Retry'), false);
  assert.equal(calls, 1);
});

it('shows a refused reply as one failure notice with no button, so nothing resends it', async () => {
  vi.stubGlobal('ResizeObserver', MeasurementFreeResizeObserver);
  let current!: ReturnType<typeof useAssistantController>, calls = 0;
  const client = resultClient({ async assistantRespond(): Promise<ScriptedReply> { calls++; return { state: 'no-reply', reason: 'ASSISTANT_RESPONSE_FAILED' }; } });
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const account = { ...preview, mode: 'live' as const }, producer = { initial: () => ({ id: 'chat', title: 'New chat', files: [] }) };
  function Harness() {
    current = useAssistantController(client, 'current', undefined, false);
    return createElement(ShellAssistantPanel, { conversationPort: producer, served: current });
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(TooltipProvider, { children: createElement(Harness) }) })));
  await act(async () => { current.onAction({ type: 'edit', value: 'start selected workflow' }); current.onAction({ type: 'send' }); });
  assert.equal(current.state.turn.state, 'idle');
  assert.match(document.body.textContent ?? '', /The assistant could not reply\./u);
  assert.equal(document.querySelectorAll('.hub-assistant-line').length, 0);
  assert.ok(document.querySelector('.hub-transcript [role="alert"] button, .hub-transcript .failure-notice button') === null);
  assert.equal([...document.querySelectorAll('.hub-transcript button')].some(button => button.textContent === 'Retry' || button.textContent === 'Open Settings'), false);
  assert.equal(calls, 1);
  assert.equal((document.body.textContent?.match(/The assistant could not reply\./gu) ?? []).length, 1);
});

it.each([
  { name: 'a saved answer whose response is lost', reply: 'answer', lost: true, shown: 'Stored answer.' },
  { name: 'an answered delivery receipt', reply: 'answer', lost: false, shown: 'Stored answer.' },
] as const)('presents the stored outcome of $name with one send', async ({ lost, shown }) => {
  const server = assistantHistoryServer();
  const history = await createAssistantHistory(server.client, { getItem: () => null, removeItem() {} }, server.profileId, new AbortController().signal);
  const id = history.chats.read()[0].id;
  let sends = 0;
  const client = { ...server.client, async assistantRespond(input: AssistantM1Request) {
    sends++;
    const accepted = server.repository.accept({ conversationId: input.conversationId, expectedRevision: input.expectedRevision, messageId: input.messageId,
      text: input.message, modelText: input.message, subjectRef: null, attachments: [], proposalAnswer: null, now: server.now() });
    if (accepted.state !== 'accepted') assert.fail('the turn was not accepted');
    const usage = { state: 'measured', callCount: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2 } as const;
    const revision = server.repository.settle(accepted, { delivery: 'answered', usage,
      reply: { id: crypto.randomUUID(), kind: 'answer', parts: [{ kind: 'text', runs: [{ kind: 'plain', text: 'Stored answer.' }] }], modelText: 'Stored answer.' } }, server.now());
    assert.ok(revision !== undefined);
    if (lost) throw Error('synthetic lost response after the server saved the outcome');
    return { kind: 'delivery' as const, receipt: { conversationId: input.conversationId, messageId: input.messageId, ordinal: accepted.ordinal, revision, delivery: 'answered' as const },
      acceptedTurn: accepted.acceptedTurn, usage, history: { state: 'observed' as const } };
  } };
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const account = { ...preview, mode: 'live' as const };
  let current!: ReturnType<typeof useAssistantController>;
  function Harness() { current = useAssistantController(client, 'current-person', undefined, false, id, undefined, { history }); return null; }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(Harness) })));
  await act(async () => { current.onAction({ type: 'edit', value: 'Explain' }); current.onAction({ type: 'send' }); });
  await act(async () => { await vi.waitFor(() => { assert.equal(current.state.messages.at(-1)?.text, shown); }); });
  assert.equal(sends, 1);
  assert.equal(current.state.messages.some(message => message.text === 'The reply was not saved. Do not resend it; ask again as a new message.'), false);
  server.close();
});

it('shows a failed activity read as one notice, not "No activity today", and Retry reads again', async () => {
  const { AssistantServedActivity } = await import('../../../../src/dashboard/surfaces/shell/assistant-thread.js');
  let reads = 0;
  const read = async () => { reads++; if (reads === 1) throw Error('activity raw failure'); return { rows: [] } as never; };
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(AssistantServedActivity, { query: '', read })));
  assert.match(host.textContent ?? '', /Couldn't load activity\./u);
  assert.equal(host.textContent?.includes('No activity today'), false);
  assert.equal(host.textContent?.includes('activity raw failure'), false);
  await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === 'Retry')?.click(); });
  assert.equal(reads, 2); assert.match(host.textContent ?? '', /No activity today/u);
});
