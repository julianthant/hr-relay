import assert from 'node:assert/strict';
import { describe,it } from 'vitest';
import { workflowDurationChart } from '../../../../src/dashboard/surfaces/activity/activity-duration-model.js';
import { successfulWorkflowTimings,type ActivityTimingRecord } from '../../../../src/dashboard/surfaces/activity/activity-timing-model.js';
const row = (id: string, status: ActivityTimingRecord['status'], seconds: number | null, parentRunId: string | null = null): ActivityTimingRecord => ({ id, workflowId: 'fixture-workflow', parentRunId, status, seconds });
describe('successful root-run timing contract', () => {
  it('excludes failures, unfinished work and delegated children, with explicit missing coverage', () => {
    const timings = successfulWorkflowTimings([row('a', 'completed', 0), row('b', 'completed', 120), row('c', 'completed', null), row('failure', 'failed', 9999), row('active', 'running', 60), row('waiting', 'waiting', null), row('child', 'completed', 800, 'a')]);
    assert.deepEqual(timings.get('fixture-workflow'), { totalSeconds: 120, measured: 2, unmeasured: 1 });
    const chart = workflowDurationChart([{ id: 'fixture-workflow', label: 'Fixture', total: 6, completed: 3, failed: 1, outstanding: 2, successfulTiming: timings.get('fixture-workflow')! }]);
    assert.equal(chart.rows[0].averageSeconds, 60);
  });
  it('rejects duplicate identities, negative/nonfinite times and contradictory coverage', () => {
    assert.throws(() => successfulWorkflowTimings([row('same', 'completed', 1), row('same', 'completed', 2)]), /ID_INVALID/);
    for (const seconds of [-1, NaN, Infinity]) assert.throws(() => successfulWorkflowTimings([row('invalid', 'completed', seconds)]), /RECORD_INVALID/);
    assert.throws(() => workflowDurationChart([{ id: 'fixture', label: 'Fixture', total: 1, completed: 1, failed: 0, outstanding: 0, successfulTiming: { totalSeconds: 10, measured: 2, unmeasured: 0 } }]), /COVERAGE_INVALID/);
  });
  it('keeps missing and empty periods distinct from measured zero', () => {
    assert.deepEqual([...successfulWorkflowTimings([])], []);
    assert.deepEqual(successfulWorkflowTimings([row('missing', 'completed', null)]).get('fixture-workflow'), { totalSeconds: null, measured: 0, unmeasured: 1 });
    assert.deepEqual(successfulWorkflowTimings([row('zero', 'completed', 0)]).get('fixture-workflow'), { totalSeconds: 0, measured: 1, unmeasured: 0 });
  });
});
