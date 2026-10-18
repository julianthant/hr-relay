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
    reply.settle({ state: 'answered', text: 'Late', citations: [] }); await reply.promise; await Promise.resolve();
    assert.equal(c.snapshot().messages.some(message => message.text === 'Late'), false);
    assert.equal(c.snapshot().sequence, 1);
    if (action === 'new-chat') assert.deepEqual(c.snapshot().messages, []);
    c.action({ type: 'edit', value: 'Next' }); c.action({ type: 'send' }); assert.equal(c.snapshot().sequence, 2);
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
it('retry uses a fresh identity and a stale failed request cannot retry an edited draft', async () => {
  let calls = 0;
  const c = createAssistantController({ async assistantRespond() { calls++; throw new Error('private transport reason'); } }, { authority: 'a' });
  c.action({ type: 'edit', value: 'Explain' }); c.action({ type: 'send' });
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'failed'));
  c.action({ type: 'retry' }); await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'failed'));
  assert.equal(calls, 2); assert.equal(c.snapshot().sequence, 2);
  c.action({ type: 'edit', value: 'Changed' }); c.action({ type: 'retry' }); assert.equal(calls, 2);
  assert.equal(JSON.stringify(c.snapshot()).includes('private transport'), false);
});

it('refuses ambiguity without presenting candidates as operator selection', async () => {
  const c = createAssistantController({ async assistantRespond() { return { state: 'resolution-required', candidates: [{ subjectRef: 'candidate', displayName: 'Synthetic Candidate', employeeId: '10812345' }] }; } }, { authority: 'a' });
  c.action({ type: 'edit', value: 'Propose' }); c.action({ type: 'send' });
  await vi.waitFor(() => assert.equal(c.snapshot().turn.state, 'idle'));
  assert.equal(c.snapshot().messages.at(-1)?.text, 'Select an unambiguous subject before preparing a proposal.');
  assert.equal(JSON.stringify(c.snapshot()).includes('Synthetic Candidate'), false);
});
