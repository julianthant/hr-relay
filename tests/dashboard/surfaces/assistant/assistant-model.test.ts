import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { assistantConfirmRefusal, assistantReducer } from '../../../../src/dashboard/surfaces/assistant/assistant-model.js';
import { ASSISTANT_MOCK_PROMPT, ASSISTANT_MOCK_REVISION, assistantMockProposal, assistantMockState } from '../../../../src/dashboard/surfaces/assistant/assistant-mock-model.js';

describe('assistant mock proposal', () => {
  it('shows exact subjects, values, read-only mode, effects and stop points', () => {
    const proposal = assistantMockProposal();
    assert.deepEqual(proposal.subjects, [{ id: 'DEMO-001', name: 'Avery Sample' }, { id: 'DEMO-002', name: 'Morgan Example' }]);
    assert.equal(proposal.workflow.id, 'person-lookup');
    assert.equal(proposal.mode, 'read-only');
    assert.equal(proposal.values[0].value, 'UCPath and CRM');
    assert.equal(proposal.effects.length, 2);
    assert.match(proposal.stopBefore.join(' '), /Save, Submit.*identity ambiguity/);
    assert.equal(assistantConfirmRefusal(assistantMockState(), ASSISTANT_MOCK_REVISION, true), undefined);
  });
  it('invalidates on any edit, including an edit reverted to the original prompt', () => {
    const edited = assistantReducer(assistantMockState(), { type: 'edit', value: 'A different subject' });
    const reverted = assistantReducer(edited, { type: 'edit', value: ASSISTANT_MOCK_PROMPT });
    assert.match(assistantConfirmRefusal(reverted, ASSISTANT_MOCK_REVISION, true) ?? '', /Request edited/);
  });
  it('refuses stale authority, unavailable accounts, cancelled and confirmed proposals', () => {
    assert.match(assistantConfirmRefusal(assistantMockState(), 'other', true) ?? '', /out of date/);
    assert.match(assistantConfirmRefusal(assistantMockState(), ASSISTANT_MOCK_REVISION, false) ?? '', /account unavailable/);
    for (const type of ['cancel', 'confirm'] as const) {
      const result = assistantReducer(assistantMockState(), { type });
      assert.ok(assistantConfirmRefusal(result, ASSISTANT_MOCK_REVISION, true));
    }
  });
  it('keeps cancelled requests and ignores replies after cancellation, editing or supersession', () => {
    const waiting = assistantMockState('waiting');
    const reply = { type: 'reply' as const, requestId: 1, proposal: assistantMockProposal(), message: { id: 'late', role: 'assistant' as const, text: 'Late reply' } };
    for (const action of [{ type: 'cancel' as const }, { type: 'edit' as const, value: 'Changed' }]) {
      const cancelled = assistantReducer(waiting, action);
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
});
