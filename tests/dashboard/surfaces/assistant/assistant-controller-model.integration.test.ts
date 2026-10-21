// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { afterEach, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useAssistantController } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import { ChatGptAccountContext, createPreviewChatGptAccountPort } from '../../../../src/dashboard/surfaces/settings/general/chatgpt-account-model.js';
import { useComposer } from '../../../../src/dashboard/surfaces/shell/composer-model.js';
import type { AssistantResult } from '../../../../src/models/dashboard/assistant.js';
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
  await render('a'); assert.equal(current.state.draft, '  Exact Unicode Ω\nrequest  '); assert.equal(current.state.turn.state, 'cancelled');
  assert.equal(current.state.messages.some(message => message.text === 'Late A'), false);
  await act(async () => { current.onAction({ type: 'send' }); });
  await render('a', 2); assert.equal(pending[2].signal?.aborted, true);
  await act(async () => { pending[2].settle({ state: 'answered', text: 'Stale authority', citations: [] }); });
  assert.equal(current.state.messages.some(message => message.text === 'Stale authority'), false);
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
  await send('Cancelled'); await act(async () => controller.onAction({ type: 'cancel' }));
  await act(async () => replies[5].resolve({ state: 'answered', text: 'Late', citations: [] })); assert.equal(composer.text, 'Cancelled');
  await send('Old authority'); await render('a', 2);
  await act(async () => replies[6].resolve({ state: 'answered', text: 'Late authority', citations: [] })); assert.equal(composer.text, 'Old authority');
  await send('Old chat'); await render('b', 2); await act(async () => composer.setText('Other chat draft'));
  await act(async () => replies[7].resolve({ state: 'answered', text: 'Late chat', citations: [] })); assert.equal(composer.text, 'Other chat draft');
});
