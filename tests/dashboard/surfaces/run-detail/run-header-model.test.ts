// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { afterEach,beforeEach,describe,it,vi } from 'vitest';
import type { LogStep } from '../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js';
import { runHeaderAction } from '../../../../src/dashboard/surfaces/run-detail/run-header-model.js';

const steps: readonly LogStep[] = [{ id: 'review', title: 'Employee match', time: '09:10:00', entries: [{ id: 'match', kind: 'decision', time: '09:10:00', decision: { state: 'review', title: 'Review identity' } }] }];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});
afterEach(() => vi.unstubAllGlobals());

describe('compact run headers', () => {
  it('only offers navigation to visible unresolved decisions and failures', () => {
    assert.deepEqual(runHeaderAction(steps, []), { label: 'Review', stepId: 'review', entryId: 'match' });
    assert.equal(runHeaderAction([{ ...steps[0], entries: [{ kind: 'decision', id: 'match', time: '09:10:00', decision: { state: 'resolved', title: 'Reviewed' } }] }], []), undefined);
    assert.equal(runHeaderAction([], [{ id: 'missing', stepId: 'absent', label: 'Failed', state: 'failed', substeps: [] }]), undefined);
    for (const [state, label] of [['parked', 'Resolve'], ['held', 'Resolve'], ['unconfirmed', 'Resolve'], ['failed', 'View failure']] as const) {
      assert.deepEqual(runHeaderAction([{ ...steps[0], entries: [
        { kind: 'decision', id: 'resolved', time: '09:09:00', decision: { state: 'resolved', title: 'Earlier decision' } },
        { kind: 'decision', id: 'target', time: '09:10:00', decision: { state, title: 'Current decision' } },
      ] }], []), { label, stepId: 'review', entryId: 'target' });
    }
    assert.deepEqual(runHeaderAction([{ ...steps[0], entries: [{ kind: 'note', id: 'error', time: '09:10:00', message: 'Browser unavailable', tone: 'danger' }] }],
      [{ id: 'failed', stepId: 'review', label: 'Failed', state: 'failed', substeps: [] }]), { label: 'View failure', stepId: 'review' });
  });
});
