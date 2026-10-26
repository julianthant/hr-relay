// @vitest-environment jsdom
import { createDashboardClient } from '../../../../src/dashboard/client/index.js';
import { ChatGptAccountStateSchema } from '../../../../src/models/dashboard/chatgpt-account.js';
import { ERROR_CATALOG } from '../../../../src/models/failures/error-catalog.js';
import { ASSISTANT_VERIFY_COMMAND, ASSISTANT_MODEL_COMMAND, ASSISTANT_DEFAULT_EFFORT, type AssistantResult } from '../../../../src/models/dashboard/assistant.js';
import { AssistantPanel as ShellAssistantPanel } from '../../../../src/dashboard/surfaces/shell/assistant-panel.js';
import { createAssistantMockProducer as createSetupAssistantProducer, type AssistantFile } from '../../../../src/dashboard/surfaces/shell/assistant-panel-model.js';

import assert from 'node:assert/strict';
import { afterEach, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAssistantController } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import { ChatGptAccountContext, createPreviewChatGptAccountPort, createServedChatGptAccountPort } from '../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js';
import { type ComposerDraft, useComposer } from '../../../../src/dashboard/surfaces/shell/composer-model.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); });
it('isolates retained chats, cancels cross-chat replies and invalidates every chat on account or authority changes', async () => {
  const pending: { signal?: AbortSignal; settle: (value: AssistantResult) => void }[] = [];
  const client = { assistantRespond: (_request: unknown, signal?: AbortSignal) => new Promise<AssistantResult>(settle => pending.push({ signal, settle })) };
  const preview = createPreviewChatGptAccountPort();
  const account = { ...preview, mode: 'live' as const };
  await account.signIn({ usePlan: true });
  let current!: ReturnType<typeof useAssistantController>;
  function Harness({ chat, authority }: { chat: string; authority: number }) { current = useAssistantController(client, authority, undefined, false, chat); return null; }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  async function render(chat: string, authority = 1) { await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(Harness, { chat, authority }) }))); }
  await render('a');
  await act(async () => { current.onAction({ type: 'edit', value: '  Exact Unicode Ω\nrequest  ' }); current.onAction({ type: 'send' }); });
  assert.equal(current.state.turn.state, 'waiting');
  await render('b'); assert.equal(pending[0].signal?.aborted, true); assert.equal(current.state.draft, '');
  await act(async () => { pending[0].settle({ state: 'answered', text: 'Late A', citations: [] }); });
  assert.equal(current.state.messages.length, 0);
  await act(async () => { current.onAction({ type: 'edit', value: 'B request' }); current.onAction({ type: 'send' }); });
  await act(async () => { pending[1].settle({ state: 'refused', code: 'ASSISTANT_SUBJECT_REQUIRED', message: 'Synthetic refusal' }); });
  assert.equal(current.state.messages.at(-1)?.text, 'Select an unambiguous subject before preparing a proposal.');
  await render('a'); assert.equal(current.state.draft, '  Exact Unicode Ω\nrequest  '); assert.equal(current.state.turn.state, 'unknown');
  assert.equal(current.state.messages.some(message => message.text === 'Late A'), false);
  await act(async () => { current.onAction({ type: 'new-chat' }); current.onAction({ type: 'edit', value: 'Fresh manual request' }); current.onAction({ type: 'send' }); });
  await render('a', 2); assert.equal(pending[2].signal?.aborted, true);
  await act(async () => { pending[2].settle({ state: 'answered', text: 'Stale authority', citations: [] }); });
  assert.equal(current.state.messages.some(message => message.text === 'Stale authority'), false);
  assert.equal(current.state.turn.state, 'unknown');
  const unknownBeforeAccountChange = current.onAction, beforeAccountDispatch = pending.length, nextAccountDraft = current.state.draft;
  await act(async () => unknownBeforeAccountChange({ type: 'send' }));
  assert.equal(pending.length, beforeAccountDispatch);
  assert.equal(current.state.turn.state, 'unknown');
  await render('new-chat-after-authority-loss', 1);
  await act(async () => current.onAction({ type: 'edit', value: nextAccountDraft }));
  await act(async () => { current.onAction({ type: 'send' }); });
  await act(async () => { await account.signOut(); }); assert.equal(pending[3].signal?.aborted, true); assert.equal(current.accountAvailable, false);
  await act(async () => { pending[3].settle({ state: 'answered', text: 'Stale account', citations: [] }); });
  assert.equal(current.state.messages.some(message => message.text === 'Stale account'), false);
  await act(async () => current.forgetSession('b'));
  await render('b'); assert.equal(current.state.draft, ''); assert.equal(current.state.messages.length, 0);
});

it('renders served proposal facts and citations in HUB and keeps confirmation and policy controls unavailable', async () => {
  const { AssistantPanel } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel.js');
  const { createAssistantMockProducer } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel-model.js');
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const account = { ...preview, mode: 'live' as const };
  let calls = 0, current!: ReturnType<typeof useAssistantController>;
  const client = { async assistantRespond(): Promise<AssistantResult> { if (calls++ > 0) return { state: 'answered', text: 'Verified explanation', citations: [{ path: 'docs/example.md', revision: 'a'.repeat(40), startLine: 1, endLine: 2, quote: 'Verified source quote' }] }; return { state: 'proposal', proposal: {
    workflowId: 'person-lookup', subject: { subjectRef: 'synthetic', displayName: 'Synthetic Person' }, intent: 'dry-run', descriptorVersion: 2,
    descriptorFingerprint: 'descriptor', configSnapshotId: 'config', configFingerprint: 'configuration', inputFingerprint: 'input', optionsFingerprint: 'options',
    expiresAt: '2026-10-22T00:00:00Z', stopBefore: { nodeId: 'commit', phase: 'commit', afterPrepareTaskId: 'prepare', commitTaskId: 'submit' },
    effects: { workflowExecuted: false, transactionCommitted: false }, confirmation: 'required-in-run',
  } }; } };
  const producer = createAssistantMockProducer();
  const accountClient = { chatGptAccount: async () => ({ state: 'signed-out' as const }) };
  function Harness() {
    current = useAssistantController(client, 1, undefined, false);
    return createElement(AssistantPanel, { producer, accountClient, served: current, title: 'New chat' });
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(Harness) })));
  assert.equal(host.querySelector('[data-source="served"]') !== null, true);
  assert.equal(host.textContent?.includes('Alex Rivera'), false);
  await act(async () => { current.onAction({ type: 'edit', value: 'Propose' }); current.onAction({ type: 'send' }); });
  assert.match(host.textContent ?? '', /Synthetic Person/u);
  assert.match(host.textContent ?? '', /Confirmation is unavailable/u);
  const confirm = [...host.querySelectorAll('button')].find(button => button.textContent === 'Confirm'); assert.ok(confirm); assert.equal(confirm.disabled, true);
  await act(async () => { confirm.click(); current.onAction({ type: 'confirm' }); }); assert.equal(calls, 1);
  for (const prefix of ['Model:', 'Thinking effort:', 'Ask only before submits', 'Voice input']) {
    const control = [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label')?.startsWith(prefix)); assert.ok(control); assert.equal(control.disabled, true);
  }
  await act(async () => current.onAction({ type: 'cancel' }));
  assert.match(host.textContent ?? '', /Proposal cancelled/u);
  await act(async () => { current.onAction({ type: 'send' }); });
  assert.match(host.textContent ?? '', /Verified explanation/u);
  assert.match(host.textContent ?? '', /docs\/example.md:1-2/u);
  const source = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('Source:')); assert.ok(source);
  await act(async () => source.click()); assert.match(host.textContent ?? '', /Verified source quote/u);
});


it('clears only the submitted composer version on a valid reply and retains newer edits, files, failures and cancellation', async () => {
  const replies: { resolve: (value: AssistantResult) => void; reject: (error: Error) => void }[] = [];
  const client = { assistantRespond: () => new Promise<AssistantResult>((resolve, reject) => replies.push({ resolve, reject })) };
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
  await act(async () => replies[0].resolve({ state: 'answered', text: 'Answer', citations: [] }));
  assert.equal(composer.text, ''); assert.deepEqual(composer.files, []); assert.equal(controller.state.draft, 'Exact success');
  await send('Before edit'); await act(async () => composer.setText('Newer edit'));
  await act(async () => replies[1].resolve({ state: 'answered', text: 'Answer', citations: [] })); assert.equal(composer.text, 'Newer edit');
  await send('Before files'); await act(async () => composer.setFiles([file]));
  await act(async () => replies[2].resolve({ state: 'answered', text: 'Answer', citations: [] })); assert.equal(composer.text, 'Before files'); assert.equal(composer.files[0], file);
  await send('Edit then revert'); await act(async () => composer.setText('Changed')); await act(async () => composer.setText('Edit then revert'));
  await act(async () => replies[3].resolve({ state: 'answered', text: 'Answer', citations: [] })); assert.equal(composer.text, 'Edit then revert');
  await send('Failed'); await act(async () => replies[4].reject(new Error('Synthetic transport failure'))); assert.equal(composer.text, 'Failed');
  assert.equal(controller.state.turn.state, 'unknown');
  const unknownBeforeCancel = controller.onAction, beforeCancelDispatch = replies.length, nextCancelFiles = composer.files;
  await act(async () => unknownBeforeCancel({ type: 'send' }));
  assert.equal(replies.length, beforeCancelDispatch);
  assert.equal(controller.state.turn.state, 'unknown');
  await render('new-chat-after-transport-uncertainty');
  await act(async () => composer.setFiles(nextCancelFiles));
  await send('Cancelled'); await act(async () => controller.onAction({ type: 'cancel' }));
  await act(async () => replies[5].resolve({ state: 'answered', text: 'Late', citations: [] })); assert.equal(composer.text, 'Cancelled');
  assert.equal(controller.state.turn.state, 'unknown');
  const beforeAuthorityDispatch = replies.length, authorityFiles = composer.files;
  await act(async () => controller.onAction({ type: 'send' }));
  assert.equal(replies.length, beforeAuthorityDispatch);
  assert.equal(controller.state.turn.state, 'unknown');
  await render('authority-change-case');
  await act(async () => composer.setFiles(authorityFiles));
  await send('Old authority'); await render("authority-change-case", 2);
  await act(async () => replies[6].resolve({ state: 'answered', text: 'Late authority', citations: [] })); assert.equal(composer.text, 'Old authority');
  assert.equal(controller.state.turn.state, 'unknown');
  const beforeTypedDispatch = replies.length, typedFiles = composer.files;
  await act(async () => controller.onAction({ type: 'send' }));
  assert.equal(replies.length, beforeTypedDispatch);
  assert.equal(controller.state.turn.state, 'unknown');
  await render('typed-authority-change-case');
  await act(async () => composer.setFiles(typedFiles));
  await send('Old chat'); await render("typed-authority-change-case", 2); await act(async () => composer.setText('Other chat draft'));
  await act(async () => replies[7].resolve({ state: 'answered', text: 'Late chat', citations: [] })); assert.equal(composer.text, 'Other chat draft');
});

it('renders the existing served action card with truthful local facts and confirms only its server identity', async () => {
  const { AssistantPanel } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel.js');
  const { createAssistantMockProducer } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel-model.js');
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const account = { ...preview, mode: 'live' as const };
  let current!: ReturnType<typeof useAssistantController>, confirmations = 0;
  const identity = { chatId: '00000000-0000-4000-8000-000000000001', actionId: '00000000-0000-4000-8000-000000000002', revision: 1 };
  const actionLabel = 'Mark a notification read';
  const client = { async assistantRespond(): Promise<AssistantResult> { return { state: 'action-proposal', proposal: { ...identity,
    expiresAt: '2099-01-01T00:00:00Z', label: actionLabel, targetLabel: 'Local notification', subject: 'none', effect: 'local-write' } }; },
    async assistantDecide(input: { chatId: string; actionId: string; revision: number; decision: 'confirm' | 'cancel' }) {
      assert.deepEqual(input, { ...identity, decision: 'confirm' }); confirmations++;
      return { state: 'applied' as const, actionId: input.actionId };
    } };
  const producer = createAssistantMockProducer();
  function Harness() {
    current = useAssistantController(client, 1, undefined, false);
    return createElement(AssistantPanel, { producer, accountClient: { chatGptAccount: async () => ({ state: 'signed-out' as const }) }, served: current, title: 'New chat' });
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(Harness) })));
  await act(async () => { current.onAction({ type: 'edit', value: 'mark notifications read' }); current.onAction({ type: 'send' }); });
  const card = host.querySelector('[aria-label="Proposed action details"]'); assert.ok(card);
  const cardLabel = card.getAttribute('aria-label'); assert.ok(cardLabel !== null);
  assert.equal(cardLabel, "Proposed action details");
  assert.ok(card.textContent?.includes(actionLabel));
  assert.match(host.textContent ?? '', /Model, effort, permission-mode and voice controls are unavailable/u);
  assert.match(host.textContent ?? '', /Review and confirm issued local actions/u);
  assert.match(card.textContent ?? '', /SubjectNone/u); assert.match(card.textContent ?? '', /Local notification/u);
  assert.equal(card.textContent?.includes('Dry run'), false); assert.equal(card.textContent?.includes('Alex Rivera'), false);
  const confirm = [...card.querySelectorAll('button')].find(button => button.textContent === 'Confirm'); assert.ok(confirm); assert.equal(confirm.disabled, false);
  await act(async () => { confirm.click(); confirm.click(); });
  assert.equal(confirmations, 1); assert.match(host.textContent ?? '', /Action completed/u);
  assert.equal(confirm.disabled, true);
});

function setupAccount() {
  let verified = false, reads = 0;
  const unavailable = ChatGptAccountStateSchema.parse({ state: "unavailable", code: 'CHATGPT_USAGE_UNAVAILABLE',
    message: ERROR_CATALOG.CHATGPT_USAGE_UNAVAILABLE.text });
  const signedIn = ChatGptAccountStateSchema.parse({ state: "connected", name: 'Fixture Operator', email: 'operator@example.test',
    expiresAt: new Date(Date.now() + 60000).toISOString(), planUsage: "enabled" });
  const client = createDashboardClient({ baseUrl: 'http://relay.test', fetchImpl: async () => {
    reads++; return Response.json(verified ? signedIn : unavailable);
  } });
  const port = createServedChatGptAccountPort(client);
  return { port, verify: () => { verified = true; }, get reads() { return reads; } };
}
it('opens only the composer for the actual unverified account resource, then refreshes once after explicit verification', async () => {
  const account = setupAccount(); let calls = 0, current!: ReturnType<typeof useAssistantController>;
  const client = { async assistantRespond(): Promise<AssistantResult> { calls++; account.verify(); return { state: 'answered', text: 'Verified', citations: [] }; } };
  function Harness() { current = useAssistantController(client, 'profile', undefined, false); return null; }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  try {
    await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account.port, children: createElement(Harness) })));
    await vi.waitFor(() => { assert.equal(current.canCompose, true); assert.equal(current.accountAvailable, false); });
    assert.equal(account.reads, 1); assert.equal(calls, 0);
    const resource = account.port.getResource(); assert.ok('code' in resource); assert.equal(resource.code, 'CHATGPT_USAGE_UNAVAILABLE');
    assert.equal(current.accountNotice, ERROR_CATALOG.ASSISTANT_MODEL_UNVERIFIED.text);
    await act(async () => { current.onAction({ type: "edit", value: ASSISTANT_VERIFY_COMMAND }); current.onAction({ type: "send" }); });
    await vi.waitFor(() => assert.equal(current.accountAvailable, true));
    assert.equal(current.canCompose, true); assert.equal(account.reads, 2); assert.equal(calls, 1);
    await act(async () => { await Promise.resolve(); }); assert.equal(account.reads, 2);
  } finally { account.port.dispose(); }
});
it('refuses setup attachments before send callbacks, file readers and registration through the existing composer', async () => {
  for (const text of [ASSISTANT_VERIFY_COMMAND, ASSISTANT_MODEL_COMMAND, ASSISTANT_MODEL_COMMAND + ' fixture-selected ' + ASSISTANT_DEFAULT_EFFORT]) {
    const account = setupAccount(); let requests = 0, sends = 0, registrations = 0, reads = 0, attachments = 0;
    let current!: ReturnType<typeof useAssistantController>;
    const file: AssistantFile = { id: 'fixture-file', name: 'fixture.txt', status: "Attached" };
    Object.defineProperty(file, 'workbook', { get() { reads++; throw new Error('unexpected-file-read'); } });
    let retained: ComposerDraft = { text, files: [file] };
    const draft = { read: () => retained, retain(value: ComposerDraft) { retained = value; } };
    const producer = createSetupAssistantProducer();
    const client = { async assistantRespond(): Promise<AssistantResult> { requests++; return { state: 'answered', text: 'Unexpected', citations: [] }; } };
    function Harness() {
      current = useAssistantController(client, 'profile', undefined, false);
      return createElement(ShellAssistantPanel, { producer, served: current, draft,
        accountClient: { async chatGptAccount() { return ChatGptAccountStateSchema.parse({ state: "signed-out" }); } },
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
