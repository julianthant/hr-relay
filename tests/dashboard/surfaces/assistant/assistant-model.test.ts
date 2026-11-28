import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { assistantReducer } from '../../../../src/dashboard/surfaces/assistant/assistant-model.js';
import { assistantMockState } from '../../../support/fixtures/dashboard/assistant-proposal-sample.js';

describe('assistant turn', () => {
  it('keeps cancelled requests and ignores replies after cancellation, editing or supersession', () => {
    const waiting = assistantMockState('waiting');
    const reply = { type: 'settle' as const, requestId: 1, message: { id: 'late', role: 'assistant' as const, text: 'Late reply' } };
    for (const action of [{ type: 'cancel' as const }, { type: 'edit' as const, value: 'Changed' }]) {
      const cancelled = assistantReducer(waiting, action);
      assert.equal(cancelled.turn.state, 'cancelled');
      assert.equal(assistantReducer(cancelled, reply), cancelled);
      assert.equal(cancelled.messages, waiting.messages);
    }
    const next = assistantReducer(assistantReducer(waiting, { type: 'cancel' }), { type: 'send' });
    assert.equal(assistantReducer(next, reply), next);
  });
  it('retries only an unchanged failed request and rejects duplicate sends and stale failures', () => {
    const failed = assistantMockState('failed');
    const retry = assistantReducer(failed, { type: 'retry' });
    assert.equal(retry.turn.state, 'waiting');
    assert.equal(retry.messages.length, failed.messages.length);
    assert.equal(assistantReducer(retry, { type: 'send' }), retry);
    assert.equal(assistantReducer(retry, { type: 'fail', requestId: 1 }), retry);
    const edited = assistantReducer(failed, { type: 'edit', value: 'Changed' });
    assert.equal(assistantReducer(edited, { type: 'retry' }), edited);
  });
  it('does not turn a possibly effectful lost response into retry or resend authority', () => {
    const waiting = assistantMockState('waiting');
    const unknown = assistantReducer(waiting, { type: 'uncertain', requestId: waiting.sequence });
    assert.equal(unknown.turn.state, 'unknown');
    for (const type of ['retry', 'send', 'cancel'] as const) assert.equal(assistantReducer(unknown, { type }), unknown);
    assert.equal(assistantReducer(unknown, { type: 'uncertain', requestId: 99 }), unknown);
    const edited = assistantReducer(unknown, { type: 'edit', value: 'Changed' });
    assert.equal(assistantReducer(edited, { type: 'send' }), edited);
  });
  it('starts a new chat without reusing a pending request identity', () => {
    const waiting = assistantMockState('waiting');
    const empty = assistantReducer(waiting, { type: 'new-chat' });
    assert.deepEqual(empty, { draft: '', messages: [], sequence: 1, turn: { state: 'idle' } });
    const next = assistantReducer(assistantReducer(empty, { type: 'edit', value: 'New question' }), { type: 'send' });
    assert.equal(next.sequence, 2);
    const late = { type: 'settle' as const, requestId: 1, message: { id: 'late', role: 'assistant' as const, text: 'Old reply' } };
    assert.equal(assistantReducer(next, late), next);
    assert.equal(assistantReducer(empty, late), empty);
  });
});

describe('sent attachments', () => {
  it('keeps names on the committed operator message only', () => {
    const base = { draft: 'Review this', messages: [], sequence: 0, turn: { state: 'idle' } } as const;
    const sent = assistantReducer(base, { type: 'send', attachments: [{ id: 'f1', name: 'Notes.pdf' }] });
    assert.deepEqual(sent.messages[0]?.attachments, [{ id: 'f1', name: 'Notes.pdf' }]);
    assert.equal(assistantReducer({ ...base, draft: ' ' }, { type: 'send', attachments: [{ id: 'f1', name: 'Notes.pdf' }] }).messages.length, 0);
    assert.equal(assistantReducer(base, { type: 'send' }).messages[0]?.attachments, undefined);
  });
});
