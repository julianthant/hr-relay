import { default as assert_m0,default as assert_m1 } from 'node:assert/strict';
import { describe as describe_m0,describe as describe_m1,it as it_m0,it as it_m1 } from 'vitest';
import { successfulRunSeconds as successfulRunSeconds_m1,workflowDurationChart as workflowDurationChart_m0 } from '../../../../src/dashboard/surfaces/activity/activity-duration-model.js';
import type { ActivityWorkflow as ActivityWorkflow_m0 } from '../../../../src/dashboard/surfaces/activity/activity-view-model.js';


{


function workflow(id: string, totalSeconds: number | null, measured: number, unmeasured = 0): ActivityWorkflow_m0 {
  return { id, label: id, completed: measured + unmeasured, total: measured + unmeasured, failed: 0, outstanding: 0,
    successfulTiming: { totalSeconds, measured, unmeasured } };
}

describe_m0('workflow duration comparisons', () => {
  it_m0('orders averages by duration, uses a shared zero origin, and retains untimed workflows', () => {
    const rows = [workflow('short', 240, 2, 3), workflow('long', 900, 3), workflow('untimed', null, 0, 4)];
    const chart = workflowDurationChart_m0(rows);
    assert_m0.deepEqual(chart.rows.map(row => row.id), ['long', 'short', 'untimed']);
    assert_m0.deepEqual(chart.rows.map(row => row.averageSeconds), [300, 120, null]);
    assert_m0.equal(chart.ticks[0], 0);
    assert_m0(chart.ticks.at(-1)! >= 300);
    assert_m0.equal(chart.rows[0].widthPercent! / chart.rows[1].widthPercent!, 2.5);
    assert_m0.equal(chart.rows[2].widthPercent, null);
    assert_m0.deepEqual(rows.map(row => row.id), ['short', 'long', 'untimed']);
  });
  it_m0('keeps a measured zero distinct from an absent measurement and handles long durations', () => {
    const chart = workflowDurationChart_m0([workflow('zero', 0, 1), workflow('missing', null, 0, 1), workflow('long', 172800, 1)]);
    assert_m0.equal(chart.rows.find(row => row.id === 'zero')!.widthPercent, 0);
    assert_m0.equal(chart.rows.find(row => row.id === 'missing')!.widthPercent, null);
    assert_m0(chart.ticks.at(-1)! >= 172800);
    assert_m0.deepEqual(workflowDurationChart_m0([]).rows, []);
  });
});
}

{


describe_m1('Relay presentation models', () => {
  it_m1('averages measured successful durations without extrapolating missing runs', () => {
    const timing = { totalSeconds: 1680, measured: 14, unmeasured: 3 };
    assert_m1.equal(successfulRunSeconds_m1(timing), 120);
    assert_m1.equal(successfulRunSeconds_m1({ totalSeconds: 0, measured: 1, unmeasured: 0 }), 0);
    for (const missing of [{ totalSeconds: null, measured: 0, unmeasured: 3 }, { totalSeconds: 0, measured: 0, unmeasured: 0 },
      { totalSeconds: null, measured: 14, unmeasured: 3 }]) assert_m1.equal(successfulRunSeconds_m1(missing), null);
    for (const invalid of [{ ...timing, totalSeconds: -1 }, { ...timing, totalSeconds: Infinity },
      { ...timing, measured: 1.5 }, { ...timing, unmeasured: -1 }]) assert_m1.throws(() => successfulRunSeconds_m1(invalid), /ACTIVITY_TIMING_INVALID/u);
  });
});
}
