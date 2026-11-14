// @vitest-environment jsdom
import { ASSISTANT_UNKNOWN_NOTICE } from '../../../../src/dashboard/surfaces/assistant/assistant-model.js';
import { chatGptStatusFixture } from "../../../support/helpers/chatgpt-status-fixture.js";
import { createDashboardClient } from '../../../../src/dashboard/client/index.js';
import { ChatGptAccountStateSchema } from '../../../../src/models/dashboard/chatgpt-account.js';
import { ERROR_CATALOG } from '../../../../src/models/failures/error-catalog.js';
import { ASSISTANT_MODEL_COMMAND, ASSISTANT_DEFAULT_EFFORT, type AssistantRequest, type AssistantResult, type AssistantActionResult } from '../../../../src/models/dashboard/assistant.js';
import { AssistantPanel as ShellAssistantPanel } from '../../../../src/dashboard/surfaces/shell/assistant-panel.js';
import { TooltipProvider } from '../../../../src/dashboard/ds/ui.js';
import { createAssistantMockProducer as createSetupAssistantProducer, type AssistantFile } from '../../../../src/dashboard/surfaces/shell/assistant-panel-model.js';

import assert from 'node:assert/strict';
import { afterEach, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ASSISTANT_PROPOSAL_CAPTION, createAssistantHistory } from '../../../../src/dashboard/surfaces/assistant/assistant-history-model.js';
import { ASSISTANT_PAUSE_PROPOSAL, ASSISTANT_START_PROPOSAL } from '../../../support/fixtures/dashboard/assistant-start.js';
import { resultClient } from '../../../support/helpers/dashboard/assistant-served-client.js';
import { assistantHistoryServer } from '../../../support/helpers/dashboard/assistant-history-server.js';
import { MeasurementFreeResizeObserver } from '../../../support/helpers/settings-storage-doctor-fixtures.js';
import { assistantProposalDigest, useAssistantController } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import { ChatGptAccountContext, createPreviewChatGptAccountPort, createServedChatGptAccountPort, type ChatGptAccountPort, type ChatGptAccountSnapshot } from '../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js';
import { type ComposerDraft, useComposer } from '../../../../src/dashboard/surfaces/shell/composer-model.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('isolates retained chats, cancels cross-chat replies and invalidates every chat on account or authority changes', async () => {
  const pending: { signal?: AbortSignal; settle: (value: AssistantResult) => void }[] = [];
  const client = resultClient({ assistantRespond: (_request: unknown, signal?: AbortSignal) => new Promise<AssistantResult>(settle => pending.push({ signal, settle })) });
  const listeners = new Set<() => void>();
  let snapshot: ChatGptAccountSnapshot = { state: 'connected', name: 'Synthetic', email: 'synthetic@example.com', planUsage: 'enabled' };
  const account: ChatGptAccountPort = { mode: 'live', getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    signIn: async () => {}, cancelSignIn: async () => {} };
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
  await act(async () => { pending[1].settle({ state: 'refused', code: 'ASSISTANT_SUBJECT_REQUIRED', message: 'Synthetic refusal' }); });
  assert.equal(current.state.messages.at(-1)?.text, 'Select an unambiguous subject before preparing a proposal.');
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
  const replies: { resolve: (value: AssistantResult) => void; reject: (error: Error) => void }[] = [];
  const client = resultClient({ assistantRespond: () => new Promise<AssistantResult>((resolve, reject) => replies.push({ resolve, reject })) });
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
  assert.equal(controller.state.turn.state, 'unknown');
  const unknownBeforeCancel = controller.onAction, beforeCancelDispatch = replies.length, nextCancelFiles = composer.files;
  await act(async () => unknownBeforeCancel({ type: 'send' }));
  assert.equal(replies.length, beforeCancelDispatch);
  assert.equal(controller.state.turn.state, 'unknown');
  await render('new-chat-after-transport-uncertainty');
  await act(async () => composer.setFiles(nextCancelFiles));
  await send('Cancelled'); await act(async () => controller.onAction({ type: 'cancel' }));
  await act(async () => replies[5].resolve({ state: 'answered', text: 'Late' })); assert.equal(composer.text, 'Cancelled');
  assert.equal(controller.state.turn.state, 'unknown');
  const beforeAuthorityDispatch = replies.length, authorityFiles = composer.files;
  await act(async () => controller.onAction({ type: 'send' }));
  assert.equal(replies.length, beforeAuthorityDispatch);
  assert.equal(controller.state.turn.state, 'unknown');
  await render('authority-change-case');
  await act(async () => composer.setFiles(authorityFiles));
  await send('Old authority'); await render("authority-change-case", 2);
  await act(async () => replies[6].resolve({ state: 'answered', text: 'Late authority' })); assert.equal(composer.text, 'Old authority');
  assert.equal(controller.state.turn.state, 'unknown');
  const beforeTypedDispatch = replies.length, typedFiles = composer.files;
  await act(async () => controller.onAction({ type: 'send' }));
  assert.equal(replies.length, beforeTypedDispatch);
  assert.equal(controller.state.turn.state, 'unknown');
  await render('typed-authority-change-case');
  await act(async () => composer.setFiles(typedFiles));
  await send('Old chat'); await render("typed-authority-change-case", 2); await act(async () => composer.setText('Other chat draft'));
  await act(async () => replies[7].resolve({ state: 'answered', text: 'Late chat' })); assert.equal(composer.text, 'Other chat draft');
});

it('gives the automatic chat title only after the first reply settles, never racing the send', async () => {
  const { AssistantPanel } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel.js');
  const { createAssistantMockProducer } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel-model.js');
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const account = { ...preview, mode: 'live' as const };
  const reply = Promise.withResolvers<AssistantResult>(), titles: string[] = [];
  const client = resultClient({ assistantRespond: () => reply.promise });
  let current!: ReturnType<typeof useAssistantController>;
  function Harness() {
    current = useAssistantController(client, 1, undefined, false);
    return createElement(AssistantPanel, { producer: createAssistantMockProducer(), accountClient: { chatGptAccount: async () => chatGptStatusFixture({ state: 'signed-out' as const }) },
      served: current, title: 'New chat', onAutomaticTitle: title => { titles.push(title); } });
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(Harness) })));
  await act(async () => { current.onAction({ type: 'edit', value: 'Who ran today?' }); current.onAction({ type: 'send' }); });
  assert.deepEqual(titles, [], 'no rename while the send is in flight');
  await act(async () => { reply.resolve({ state: 'answered', text: 'Nobody yet.' }); await reply.promise; });
  await vi.waitFor(() => assert.deepEqual(titles, ['Who ran today?']));
});

it.each(['run-action', 'workflow'] as const)('renders the existing served %s card with truthful local facts and confirms only its server identity', async kind => {
  const { AssistantPanel } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel.js');
  const { createAssistantMockProducer } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel-model.js');
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const account = { ...preview, mode: 'live' as const };
  let current!: ReturnType<typeof useAssistantController>, confirmations = 0;
  const proposal = kind === 'workflow' ? ASSISTANT_START_PROPOSAL : ASSISTANT_PAUSE_PROPOSAL;
  const identity = { chatId: proposal.chatId, actionId: proposal.actionId, revision: proposal.revision };
  const client = resultClient({ async assistantRespond(): Promise<AssistantResult> { return { state: 'action-proposal', proposal }; },
    async assistantDecide(input: { chatId: string; actionId: string; revision: number; decision: 'confirm' | 'cancel'; reviewedDigest?: string }) {
      const { reviewedDigest, ...decision } = input;
      assert.deepEqual(decision, { ...identity, decision: 'confirm' });
      assert.equal(reviewedDigest, await assistantProposalDigest(proposal)); confirmations++;
      return { state: 'applied' as const, actionId: input.actionId };
    } });
  const producer = createAssistantMockProducer();
  function Harness() {
    current = useAssistantController(client, 1, undefined, false);
    return createElement(AssistantPanel, { producer, accountClient: { chatGptAccount: async () => chatGptStatusFixture({ state: 'signed-out' as const }) }, served: current, title: 'New chat' });
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(Harness) })));
  await act(async () => { current.onAction({ type: 'edit', value: 'mark notifications read' }); current.onAction({ type: 'send' }); });
  const card = host.querySelector('article[aria-label^="Proposed "]'); assert.ok(card);
  assert.ok(card.textContent?.includes(proposal.label));
  assert.equal([...host.querySelectorAll('button')].some(button => button.textContent === 'Test assistant'), false);
  assert.match(host.textContent ?? '', /Review this proposal. No action has been applied/u);
  assert.doesNotMatch(host.textContent ?? '', /start selected workflow|Model, effort and voice controls are unavailable/u);
  assert.doesNotMatch(current.footnote, /Workflow execution requires dashboard Run/u);
  if (kind === 'workflow') {
    for (const fact of ['Sample, Avery', '10101010', 'Read only']) assert.ok(card.textContent?.includes(fact));
    for (const hidden of ['Headed', 'Captures', 'Effects and stop points']) assert.equal(card.textContent?.includes(hidden), false);
    assert.match(current.footnote, /Workflow starts require a confirmed plan/u);
  } else assert.match(card.textContent ?? '', /Local change/u);
  assert.equal(card.textContent?.includes('Dry run'), false); assert.equal(card.textContent?.includes('Alex Rivera'), false);
  const confirm = [...card.querySelectorAll('button')].find(button => button.textContent === 'Confirm'); assert.ok(confirm); assert.equal(confirm.disabled, false);
  assert.equal(confirmations, 0);
  await act(async () => { confirm.click(); confirm.click(); });
  await vi.waitFor(() => assert.equal(confirmations, 1));
  await act(async () => { await vi.waitFor(() => assert.match(host.textContent ?? '', kind === 'workflow' ? /Started/u : /Done/u)); });
  assert.equal(host.querySelector('article[aria-label^="Proposed "]'), null);
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
  const client = resultClient({ async assistantRespond(): Promise<AssistantResult> { calls++; return { state: 'answered', text: 'Answered' }; } });
  function Harness() { current = useAssistantController(client, 'profile', undefined, false); return null; }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  try {
    await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account.port, children: createElement(Harness) })));
    await vi.waitFor(() => { assert.equal(current.canCompose, true); assert.equal(current.accountAvailable, true); });
    const resource = account.port.getResource(); assert.ok('code' in resource); assert.equal(resource.code, 'CHATGPT_USAGE_UNAVAILABLE');
    await act(async () => { current.onAction({ type: "edit", value: 'Who ran today?' }); current.onAction({ type: "send" }); });
    await vi.waitFor(() => assert.equal(calls, 1));
    assert.equal(account.reads, 1);
  } finally { account.port.dispose(); }
});
it('refuses setup attachments before send callbacks, file readers and registration through the existing composer', async () => {
  for (const text of [ASSISTANT_MODEL_COMMAND, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT]) {
    const account = setupAccount(); let requests = 0, sends = 0, registrations = 0, reads = 0, attachments = 0;
    let current!: ReturnType<typeof useAssistantController>;
    const file: AssistantFile = { id: 'fixture-file', name: 'fixture.txt', status: "Attached" };
    Object.defineProperty(file, 'workbook', { get() { reads++; throw new Error('unexpected-file-read'); } });
    let retained: ComposerDraft = { text, files: [file] };
    const draft = { read: () => retained, retain(value: ComposerDraft) { retained = value; } };
    const producer = createSetupAssistantProducer();
    const client = resultClient({ async assistantRespond(): Promise<AssistantResult> { requests++; return { state: 'answered', text: 'Unexpected' }; } });
    function Harness() {
      current = useAssistantController(client, 'profile', undefined, false);
      return createElement(ShellAssistantPanel, { producer, served: current, draft,
        accountClient: { async chatGptAccount() { return chatGptStatusFixture(ChatGptAccountStateSchema.parse({ state: "signed-out" })); } },
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

it.each([
  { decision: 'confirm', fail: false }, { decision: 'confirm', fail: true },
  { decision: 'cancel', fail: false }, { decision: 'cancel', fail: true },
] as const)('retires a deleted retained chat before deferred $decision settles (failure=$fail)', async ({ decision, fail }) => {
  const server = assistantHistoryServer();
  const history = await createAssistantHistory(server.client, { getItem: () => null, removeItem() {} }, server.profileId, new AbortController().signal);
  const oldId = history.chats.read()[0].id, replacementId = (await history.chats.create()).id;
  const held = Promise.withResolvers<AssistantActionResult>();
  let decisions = 0, requests = 0, signal: AbortSignal | undefined;
  const action = { chatId: crypto.randomUUID(), actionId: crypto.randomUUID(), revision: 1 };
  const client = resultClient({ async assistantRespond(): Promise<AssistantResult> { requests++; return { state: 'action-proposal', proposal: { ...ASSISTANT_PAUSE_PROPOSAL, ...action } }; },
    assistantDecide(_input: unknown, abort?: AbortSignal) { decisions++; signal = abort; return held.promise; } });
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const account = { ...preview, mode: 'live' as const };
  let current!: ReturnType<typeof useAssistantController>;
  function Harness({ id }: { id: string }) { current = useAssistantController(client, 'current-person', undefined, false, id, undefined, { history }); return null; }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  async function render(id: string) { await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(Harness, { id }) }))); }
  await render(oldId);
  await act(async () => { current.onAction({ type: 'edit', value: 'mark notifications read' }); current.onAction({ type: 'send' }); });
  const forgottenAction = current.onAction;
  await act(async () => current.onAction({ type: decision }));
  assert.equal(decisions, 1);
  const retain = vi.spyOn(history, 'retain');
  await act(async () => {
    current.forgetSession(oldId);
    const retired = retain.mock.calls.at(-1)?.[1];
    assert.equal(retired?.turn.state, 'proposal');
    if (retired?.turn.state !== 'proposal') throw Error('pending decision must remain represented');
    assert.equal(retired.turn.disposition, 'unknown');
    assert.equal(signal?.aborted, true);
    await history.chats.remove(oldId);
  });
  await render(replacementId);
  const replacement = current.state, retained = server.writes.length;
  retain.mockClear();
  await act(async () => {
    if (fail) held.reject(Error('lost deferred decision response'));
    else held.resolve({ state: decision === 'confirm' ? 'applied' : 'cancelled', actionId: action.actionId });
    await held.promise.catch(() => {});
    await Promise.resolve();
  });
  assert.equal(signal?.aborted, true);
  assert.equal(retain.mock.calls.length, 0);
  assert.equal(current.state === replacement, true);
  assert.equal(server.writes.length, retained);
  assert.equal(history.has(oldId), false); assert.equal(history.read(oldId), undefined);
  await act(async () => {
    for (const type of ['confirm', 'cancel', 'retry', 'new-chat', 'send'] as const) forgottenAction({ type });
    forgottenAction({ type: 'edit', value: 'do not revive the forgotten controller' });
  });
  assert.equal(decisions, 1); assert.equal(requests, 1);
  assert.equal(retain.mock.calls.length, 0); assert.equal(current.state === replacement, true);
  retain.mockRestore(); server.close();
});

it('shows the one unknown line after a lost response without replay', async () => {
  vi.stubGlobal('ResizeObserver', MeasurementFreeResizeObserver);
  let current!: ReturnType<typeof useAssistantController>, calls = 0;
  const client = resultClient({ async assistantRespond(): Promise<AssistantResult> { calls++; throw Error('lost workflow proposal response'); } });
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const account = { ...preview, mode: 'live' as const }, producer = createSetupAssistantProducer();
  function Harness() {
    current = useAssistantController(client, 'current', undefined, false);
    return createElement(ShellAssistantPanel, { producer, served: current, accountClient: { async chatGptAccount() { return chatGptStatusFixture({ state: 'signed-out' as const }); } } });
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(TooltipProvider, { children: createElement(Harness) }) })));
  await act(async () => { current.onAction({ type: 'edit', value: 'start selected workflow' }); current.onAction({ type: 'send' }); });
  assert.equal(current.state.turn.state, 'unknown');
  assert.deepEqual([...document.querySelectorAll('[role="alert"]')].map(node => node.textContent), [ASSISTANT_UNKNOWN_NOTICE]);
  await act(async () => { current.onAction({ type: 'retry' }); current.onAction({ type: 'send' }); current.onAction({ type: 'confirm' }); });
  assert.equal(calls, 1);
});

it('disables Cancel and Confirm once a refused decision leaves the issued card stale', async () => {
  const { AssistantPanel } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel.js');
  const { createAssistantMockProducer } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel-model.js');
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  let current!: ReturnType<typeof useAssistantController>, decisions = 0;
  const proposal = ASSISTANT_PAUSE_PROPOSAL;
  const client = resultClient({ async assistantRespond(): Promise<AssistantResult> { return { state: 'action-proposal', proposal }; },
    async assistantDecide() { decisions++; return { state: 'refused' as const, code: 'ASSISTANT_UNAVAILABLE' as const }; } });
  function Harness() {
    current = useAssistantController(client, 1, undefined, false);
    return createElement(AssistantPanel, { producer: createAssistantMockProducer(), accountClient: { chatGptAccount: async () => chatGptStatusFixture({ state: 'signed-out' as const }) }, served: current, title: 'New chat' });
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: { ...preview, mode: 'live' as const }, children: createElement(Harness) })));
  await act(async () => { current.onAction({ type: 'edit', value: 'mark notifications read' }); current.onAction({ type: 'send' }); });
  const button = (name: string) => [...host.querySelectorAll('article[aria-label^="Proposed "] button')].find(item => item.textContent === name) as HTMLButtonElement;
  assert.equal(button('Cancel').disabled, false); assert.equal(button('Confirm').disabled, false);
  await act(async () => { button('Confirm').click(); });
  assert.equal(decisions, 1); assert.equal((current.state.turn as { disposition?: string }).disposition, 'stale');
  assert.equal(button('Cancel').disabled, true); assert.equal(button('Confirm').disabled, true);
  await act(async () => { button('Cancel').click(); button('Confirm').click(); });
  assert.equal(decisions, 1);
});

it.each([
  { name: 'a saved answer whose response is lost', reply: 'answer', lost: true, shown: 'Stored answer.' },
  { name: 'an answered delivery receipt', reply: 'answer', lost: false, shown: 'Stored answer.' },
  { name: 'a saved proposal whose response is lost', reply: 'proposal', lost: true, shown: 'This proposal is no longer available. Ask again to review a new one.' },
] as const)('presents the stored outcome of $name with one send and no restored Confirm', async ({ reply, lost, shown }) => {
  const server = assistantHistoryServer();
  const history = await createAssistantHistory(server.client, { getItem: () => null, removeItem() {} }, server.profileId, new AbortController().signal);
  const id = history.chats.read()[0].id;
  let sends = 0;
  const client = { ...server.client, async assistantRespond(input: AssistantRequest) {
    sends++;
    const accepted = server.repository.accept({ conversationId: input.conversationId, expectedRevision: input.expectedRevision, messageId: input.messageId,
      text: input.message, modelText: input.message, subjectRef: null, attachments: [], now: server.now() });
    assert.equal(accepted.state, 'accepted');
    const revision = server.repository.settle(input.conversationId, input.messageId, { delivery: 'answered', reply: reply === 'answer'
      ? { id: crypto.randomUUID(), kind: 'answer', text: 'Stored answer.', modelText: 'Stored answer.' }
      : { id: crypto.randomUUID(), kind: 'proposal', actionId: crypto.randomUUID(), text: ASSISTANT_PROPOSAL_CAPTION, modelText: 'I prepared a confirmation card.' } }, server.now());
    assert.ok(revision !== undefined);
    if (lost) throw Error('synthetic lost response after the server saved the outcome');
    return { kind: 'delivery' as const, receipt: { conversationId: input.conversationId, messageId: input.messageId, ordinal: accepted.ordinal, revision, delivery: 'answered' as const } };
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
  assert.notEqual(current.state.turn.state, 'proposal', 'readback never restores a Confirm');
  assert.equal(current.state.messages.some(message => message.text === 'The reply was not saved. Do not resend it; ask again as a new message.'), false);
  server.close();
});
