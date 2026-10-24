import assert from 'node:assert/strict';
import { it, vi } from 'vitest';
import { createAssistantController, ASSISTANT_CONFIRM_HOLD } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import type { AssistantResult } from '../../../../src/models/dashboard/assistant.js';

function pending() {
  let settle: (result: AssistantResult) => void = () => { throw new Error('pending-uninitialized'); };
  const promise = new Promise<AssistantResult>(resolve => { settle = resolve; });
  return { promise, settle };
}
it('keeps monotonic identity across New Chat and ignores late replies after cancellation, edits and authority changes', async () => {
  for (const action of ['new-chat', 'cancel', 'edit', 'binding'] as const) {
    const reply = pending(); let signal: AbortSignal | undefined;
    const c = createAssistantController({ assistantRespond: async (_request, abort) => { signal = abort; return reply.promise; } }, { authority: 'a', subjectRef: 'one' });
    c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
    if (action === 'binding') c.bind({ authority: 'b', subjectRef: 'two' });
    else c.action(action === 'edit' ? { type: 'edit', value: 'Changed' } : { type: action });
    assert.equal(signal?.aborted, true);
    if (action !== 'new-chat') {
      assert.equal(c.snapshot().turn.state, 'unknown');
      const sequence = c.snapshot().sequence; c.action({ type: 'retry' }); c.action({ type: 'send' }); assert.equal(c.snapshot().sequence, sequence);
    }
    reply.settle({ state: 'answered', text: 'Late', citations: [] }); await reply.promise; await Promise.resolve();
    assert.equal(c.snapshot().messages.some(message => message.text === 'Late'), false);
    assert.equal(c.snapshot().sequence, 1);
    if (action === 'new-chat') assert.deepEqual(c.snapshot().messages, []);
    c.action({ type: 'new-chat' }); c.action({ type: 'edit', value: 'Next' }); c.action({ type: 'send' }); assert.equal(c.snapshot().sequence, 2);
    c.abort();
  }
});
it('settles actual answer/refusal/citation presentation and never interprets Confirm as a request', async () => {
  let calls = 0;
  const c = createAssistantController({ async assistantRespond() { calls++; return { state: 'answered', text: 'Explanation', citations: [{ path: 'docs/rebuild/example.md', revision: 'a'.repeat(40), startLine: 1, endLine: 1, quote: 'Exact source' }] }; } }, { authority: 'a' });
  c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'idle'));
  assert.equal(c.snapshot().messages.at(-1)?.sources?.[0].excerpt, 'Exact source');
  assert.equal(c.snapshot().messages.at(-1)?.sources?.[0].url, undefined);
  c.action({ type: 'confirm' }); assert.equal(calls, 1); assert.match(ASSISTANT_CONFIRM_HOLD, /before preparation/u);
});
it('does not retry an ambiguously lost response or let an edited draft redispatch it', async () => {
  let calls = 0;
  const c = createAssistantController({ async assistantRespond() { calls++; throw new Error('private transport reason'); } }, { authority: 'a' });
  c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'unknown'));
  c.action({ type: 'retry' }); c.action({ type: 'send' });
  assert.equal(calls, 1); assert.equal(c.snapshot().sequence, 1);
  c.action({ type: 'edit', value: 'Changed' }); c.action({ type: 'retry' }); c.action({ type: 'send' }); assert.equal(calls, 1);
  assert.equal(JSON.stringify(c.snapshot()).includes('private transport'), false);
  assert.equal(JSON.stringify(c.snapshot()).includes('actionId'), false);
});

it('refuses ambiguity without presenting candidates as operator selection', async () => {
  const c = createAssistantController({ async assistantRespond() { return { state: 'resolution-required', candidates: [{ subjectRef: 'candidate', displayName: 'Synthetic Candidate', employeeId: '10812345' }] }; } }, { authority: 'a' });
  c.action({ type: 'edit', value: 'Propose' }); c.action({ type: 'send' });
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'idle'));
  assert.equal(c.snapshot().messages.at(-1)?.text, 'Select an unambiguous subject before preparing a proposal.');
  assert.equal(JSON.stringify(c.snapshot()).includes('Synthetic Candidate'), false);
});

const actionProposal = { state: 'action-proposal', proposal: { chatId: '00000000-0000-4000-8000-000000000001',
  actionId: '00000000-0000-4000-8000-000000000002', revision: 1, expiresAt: '2099-01-01T00:00:00Z', label: 'Mark a notification read',
  targetLabel: 'Local notification', subject: 'none', effect: 'local-write' } } satisfies AssistantResult;
it('confirms the actual issued action identity once and keeps a lost response unknown without retry', async () => {
  for (const lost of [false, true]) {
    let calls = 0;
    const c = createAssistantController({ assistantRespond: async () => actionProposal,
      assistantDecide: async identity => { calls++; assert.deepEqual(identity, { chatId: actionProposal.proposal.chatId, actionId: actionProposal.proposal.actionId, revision: 1, decision: 'confirm' });
        if (lost) throw new Error('synthetic transport lost'); return { state: 'applied', actionId: identity.actionId }; } }, { authority: 'current' });
    c.action({ type: 'edit', value: 'mark notifications read' }); c.action({ type: 'send' }); await Promise.resolve(); await Promise.resolve();
    const initial = c.snapshot().turn; assert.equal(initial.state, 'proposal');
    if (initial.state === 'proposal') { assert.equal(initial.proposal.mode, 'local-change'); assert.deepEqual(initial.proposal.subjects, []); }
    c.action({ type: 'confirm' }); c.action({ type: 'confirm' }); await Promise.resolve(); await Promise.resolve();
    const settled = c.snapshot().turn; assert.equal(settled.state, 'proposal');
    if (settled.state === 'proposal') assert.equal(settled.disposition, lost ? 'unknown' : 'confirmed');
    c.action({ type: 'confirm' }); c.action({ type: 'retry' }); assert.equal(calls, 1);
  }
});
it('holds issued action confirmation after edits, selection changes or cancel without fabricating workflow subjects', async () => {
  for (const change of ['edit', 'selection', 'cancel'] as const) {
    let confirmations = 0, cancellations = 0;
    const c = createAssistantController({ assistantRespond: async () => actionProposal,
      assistantDecide: async input => { if (input.decision === 'confirm') confirmations++; else cancellations++; return { state: 'cancelled', actionId: input.actionId }; } }, { authority: 'one' });
    c.action({ type: 'edit', value: 'mark notifications read' }); c.action({ type: 'send' }); await Promise.resolve(); await Promise.resolve();
    if (change === 'edit') c.action({ type: 'edit', value: 'changed' });
    if (change === 'selection') c.bind({ authority: 'two', subjectRef: 'new-subject' });
    if (change === 'cancel') { c.action({ type: 'cancel' }); await Promise.resolve(); await Promise.resolve(); }
    c.action({ type: 'confirm' }); assert.equal(confirmations, 0);
    if (change === 'cancel') assert.equal(cancellations, 1);
  }
});

it('holds an issued automatic unknown card without Confirm, Retry, or another request', async () => {
  let requests = 0, decisions = 0;
  const action = { chatId: '00000000-0000-4000-8000-000000000001', actionId: '00000000-0000-4000-8000-000000000002', revision: 1,
    expiresAt: '2099-01-01T00:00:00Z', label: 'Mark 25 current notifications read', targetLabel: '25 current notifications', subject: 'none' as const, effect: 'local-write' as const };
  const c = createAssistantController({ async assistantRespond() { requests++; return { state: 'unknown', actionId: action.actionId, action }; },
    async assistantDecide() { decisions++; return { state: 'applied', actionId: action.actionId }; } }, { authority: 'current' });
  c.action({ type: 'edit', value: 'mark notifications read' }); c.action({ type: 'send' });
  await vi.waitFor(() => { const turn = c.snapshot().turn; assert.equal(turn.state, 'proposal'); if (turn.state === 'proposal') assert.equal(turn.disposition, 'unknown'); });
  c.action({ type: 'confirm' }); c.action({ type: 'retry' }); c.action({ type: 'send' }); c.action({ type: 'cancel' });
  assert.equal(requests, 1); assert.equal(decisions, 0);
  const turn = c.snapshot().turn; assert.equal(turn.state, 'proposal'); if (turn.state === 'proposal') assert.deepEqual(turn.proposal.action, { chatId: action.chatId, actionId: action.actionId, revision: action.revision });
});
