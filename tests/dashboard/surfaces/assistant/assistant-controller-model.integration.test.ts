// @vitest-environment jsdom
import { chatGptStatusFixture } from "../../../support/helpers/chatgpt-status-fixture.js";
import { createDashboardClient } from '../../../../src/dashboard/client/index.js';
import { ChatGptAccountStateSchema } from '../../../../src/models/dashboard/chatgpt-account.js';
import { ERROR_CATALOG } from '../../../../src/models/failures/error-catalog.js';
import { ASSISTANT_VERIFY_COMMAND, ASSISTANT_MODEL_COMMAND, ASSISTANT_DEFAULT_EFFORT, type AssistantResult, type AssistantActionResult } from '../../../../src/models/dashboard/assistant.js';
import { AssistantPanel as ShellAssistantPanel } from '../../../../src/dashboard/surfaces/shell/assistant-panel.js';
import { TooltipProvider } from '../../../../src/dashboard/ds/ui.js';
import { createAssistantMockProducer as createSetupAssistantProducer, type AssistantFile } from '../../../../src/dashboard/surfaces/shell/assistant-panel-model.js';

import assert from 'node:assert/strict';
import { afterEach, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createAssistantHistory } from '../../../../src/dashboard/surfaces/assistant/assistant-history-model.js';
import { ASSISTANT_START_PROPOSAL } from '../../../support/fixtures/dashboard/assistant-start.js';
import { MeasurementFreeResizeObserver } from '../../../support/helpers/settings-storage-doctor-fixtures.js';
import { useAssistantController } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import { ChatGptAccountContext, createPreviewChatGptAccountPort, createServedChatGptAccountPort, type ChatGptAccountPort, type ChatGptAccountSnapshot } from '../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js';
import { type ComposerDraft, useComposer } from '../../../../src/dashboard/surfaces/shell/composer-model.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); vi.unstubAllGlobals(); document.body.replaceChildren(); });
it('isolates retained chats, cancels cross-chat replies and invalidates every chat on account or authority changes', async () => {
  const pending: { signal?: AbortSignal; settle: (value: AssistantResult) => void }[] = [];
  const client = { assistantRespond: (_request: unknown, signal?: AbortSignal) => new Promise<AssistantResult>(settle => pending.push({ signal, settle })) };
  const listeners = new Set<() => void>();
  let snapshot: ChatGptAccountSnapshot = { state: 'connected', name: 'Synthetic', email: 'synthetic@example.com', planUsage: 'enabled' };
  const account: ChatGptAccountPort = { mode: 'live', getSnapshot: () => snapshot, subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    signIn: async () => {}, cancelSignIn: async () => {} };
  const loseAccount = () => { snapshot = { state: 'unavailable', message: 'Synthetic account loss' }; for (const listener of listeners) listener(); };
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
  await act(async () => loseAccount()); assert.equal(pending[3].signal?.aborted, true); assert.equal(current.accountAvailable, false);
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
  const accountClient = { chatGptAccount: async () => chatGptStatusFixture({ state: 'signed-out' as const }) };
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
  for (const prefix of ['Model:', 'Ask before every action', 'Voice input']) {
    const control = [...host.querySelectorAll('button')].find(button => button.getAttribute('aria-label')?.startsWith(prefix)); assert.ok(control); assert.equal(control.disabled, true);
  }
  await act(async () => current.onAction({ type: 'cancel' }));
  assert.match(host.textContent ?? '', /Not started/u);
  await act(async () => { current.onAction({ type: 'send' }); });
  assert.match(host.textContent ?? '', /Verified explanation/u);
  assert.doesNotMatch(host.textContent ?? '', /docs\/example.md|Source:/u);
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

it.each(['notification', 'workflow'] as const)('renders the existing served %s card with truthful local facts and confirms only its server identity', async kind => {
  const { AssistantPanel } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel.js');
  const { createAssistantMockProducer } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel-model.js');
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const account = { ...preview, mode: 'live' as const };
  let current!: ReturnType<typeof useAssistantController>, confirmations = 0;
  const identity = { chatId: '00000000-0000-4000-8000-000000000001', actionId: '00000000-0000-4000-8000-000000000002', revision: 1 };
  const proposal = kind === 'workflow' ? ASSISTANT_START_PROPOSAL : { ...identity,
    expiresAt: '2099-01-01T00:00:00Z', label: 'Mark a notification read', targetLabel: 'Local notification', subject: 'none' as const, effect: 'local-write' as const };
  const client = { async assistantRespond(): Promise<AssistantResult> { return { state: 'action-proposal', proposal }; },
    async assistantDecide(input: { chatId: string; actionId: string; revision: number; decision: 'confirm' | 'cancel' }) {
      assert.deepEqual(input, { ...identity, decision: 'confirm' }); confirmations++;
      return { state: 'applied' as const, actionId: input.actionId };
    } };
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
    for (const fact of ['Avery Sample', '10101010', 'Read only']) assert.ok(card.textContent?.includes(fact));
    for (const hidden of ['Headed', 'Captures', 'Effects and stop points']) assert.equal(card.textContent?.includes(hidden), false);
    assert.match(current.footnote, /Workflow starts require a confirmed plan/u);
  } else { assert.match(card.textContent ?? '', /Local change/u); assert.match(card.textContent ?? '', /Local notification/u); }
  assert.equal(card.textContent?.includes('Dry run'), false); assert.equal(card.textContent?.includes('Alex Rivera'), false);
  const confirm = [...card.querySelectorAll('button')].find(button => button.textContent === 'Confirm'); assert.ok(confirm); assert.equal(confirm.disabled, false);
  assert.equal(confirmations, 0);
  await act(async () => { confirm.click(); confirm.click(); });
  assert.equal(confirmations, 1); assert.match(host.textContent ?? '', kind === 'workflow' ? /Started/u : /Done/u);
  assert.equal(host.querySelector('article[aria-label^="Proposed "]'), null);
});

function setupAccount() {
  let verified = false, reads = 0;
  const unavailable = ChatGptAccountStateSchema.parse({ state: "unavailable", code: 'CHATGPT_USAGE_UNAVAILABLE',
    message: ERROR_CATALOG.CHATGPT_USAGE_UNAVAILABLE.text });
  const signedIn = ChatGptAccountStateSchema.parse({ state: "connected", name: 'Fixture Operator', email: 'operator@example.test',
    expiresAt: new Date(Date.now() + 60000).toISOString(), planUsage: "enabled" });
  const client = createDashboardClient({ baseUrl: 'http://relay.test', fetchImpl: async () => {
    reads++; return Response.json(chatGptStatusFixture(verified ? signedIn : unavailable));
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
  const rows = new Map<string, string>();
  const history = createAssistantHistory({ getItem: key => rows.get(key) ?? null, setItem: (key, value) => { rows.set(key, value); } }, crypto.randomUUID());
  const oldId = history.chats.read()[0].id, replacementId = (await history.chats.create()).id;
  const held = Promise.withResolvers<AssistantActionResult>();
  let decisions = 0, requests = 0, signal: AbortSignal | undefined;
  const action = { chatId: crypto.randomUUID(), actionId: crypto.randomUUID(), revision: 1 };
  const client = { async assistantRespond(): Promise<AssistantResult> { requests++; return { state: 'action-proposal', proposal: { ...action,
    expiresAt: '2099-01-01T00:00:00Z', label: 'Mark current notifications read', targetLabel: 'Current notifications', subject: 'none', effect: 'local-write' } }; },
    assistantDecide(_input: unknown, abort?: AbortSignal) { decisions++; signal = abort; return held.promise; } };
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
  assert.equal(history.read(oldId)?.turn.state, 'unknown');
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
  const replacement = current.state, retained = [...rows.values()];
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
  assert.deepEqual([...rows.values()], retained);
  assert.throws(() => history.read(oldId), /HUB_CHAT_UNAVAILABLE/u);
  await act(async () => {
    for (const type of ['confirm', 'cancel', 'retry', 'new-chat', 'send'] as const) forgottenAction({ type });
    forgottenAction({ type: 'edit', value: 'do not revive the forgotten controller' });
  });
  assert.equal(decisions, 1); assert.equal(requests, 1);
  assert.equal(retain.mock.calls.length, 0); assert.equal(current.state === replacement, true);
  retain.mockRestore();
});

it('shows run and notification reconciliation guidance after a lost response in the shell panel without replay', async () => {
  vi.stubGlobal('ResizeObserver', MeasurementFreeResizeObserver);
  let current!: ReturnType<typeof useAssistantController>, calls = 0;
  const client = { async assistantRespond(): Promise<AssistantResult> { calls++; throw Error('lost workflow proposal response'); } };
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  const account = { ...preview, mode: 'live' as const }, producer = createSetupAssistantProducer();
  function Harness() {
    current = useAssistantController(client, 'current', undefined, false);
    return createElement(ShellAssistantPanel, { producer, served: current, accountClient: { async chatGptAccount() { return chatGptStatusFixture({ state: 'signed-out' as const }); } } })
  }
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(ChatGptAccountContext.Provider, { value: account, children: createElement(TooltipProvider, { children: createElement(Harness) }) })));
  await act(async () => { current.onAction({ type: 'edit', value: 'start selected workflow' }); current.onAction({ type: 'send' }); });
  assert.equal(current.state.turn.state, 'unknown');
  const notice = [...document.querySelectorAll('[role="alert"]')].find(node => node.textContent?.includes('Check the current run or notification state'));
  assert.ok(notice); assert.match(notice.textContent ?? '', /Do not retry this request/u);
  await act(async () => { current.onAction({ type: 'retry' }); current.onAction({ type: 'send' }); current.onAction({ type: 'confirm' }); });
  assert.equal(calls, 1);
});

it('disables Cancel and Confirm once a refused decision leaves the issued card stale', async () => {
  const { AssistantPanel } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel.js');
  const { createAssistantMockProducer } = await import('../../../../src/dashboard/surfaces/shell/assistant-panel-model.js');
  const preview = createPreviewChatGptAccountPort(); await preview.signIn({ usePlan: true });
  let current!: ReturnType<typeof useAssistantController>, decisions = 0;
  const proposal = { chatId: '00000000-0000-4000-8000-000000000001', actionId: '00000000-0000-4000-8000-000000000002', revision: 1,
    expiresAt: '2099-01-01T00:00:00Z', label: 'Mark a notification read', targetLabel: 'Local notification', subject: 'none' as const, effect: 'local-write' as const };
  const client = { async assistantRespond(): Promise<AssistantResult> { return { state: 'action-proposal', proposal }; },
    async assistantDecide() { decisions++; return { state: 'refused' as const, code: 'ASSISTANT_VERIFICATION_FAILED' as const }; } };
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
