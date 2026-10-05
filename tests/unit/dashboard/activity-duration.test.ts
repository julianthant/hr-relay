import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActivityDurations } from '../../../src/dashboard/surfaces/activity/activity-duration.js';
import { workflowDurationChart } from '../../../src/dashboard/surfaces/activity/activity-duration-model.js';
import { activitySample, ACTIVITY_SAMPLE_RANGE } from '../../../src/dashboard/surfaces/activity/activity-fixture.js';
import type { ActivityWorkflow } from '../../../src/dashboard/surfaces/activity/activity-view-model.js';

function workflow(id: string, totalSeconds: number | null, measured: number, unmeasured = 0): ActivityWorkflow {
  return { id, label: id, completed: measured + unmeasured, total: measured + unmeasured, failed: 0, outstanding: 0,
    successfulTiming: { totalSeconds, measured, unmeasured } };
}

describe('workflow duration comparisons', () => {
  it('orders averages by duration, uses a shared zero origin, and retains untimed workflows', () => {
    const rows = [workflow('short', 240, 2, 3), workflow('long', 900, 3), workflow('untimed', null, 0, 4)];
    const chart = workflowDurationChart(rows);
    assert.deepEqual(chart.rows.map(row => row.id), ['long', 'short', 'untimed']);
    assert.deepEqual(chart.rows.map(row => row.averageSeconds), [300, 120, null]);
    assert.equal(chart.ticks[0], 0);
    assert(chart.ticks.at(-1)! >= 300);
    assert.equal(chart.rows[0].widthPercent! / chart.rows[1].widthPercent!, 2.5);
    assert.equal(chart.rows[2].widthPercent, null);
    assert.deepEqual(rows.map(row => row.id), ['short', 'long', 'untimed']);
  });
  it('keeps a measured zero distinct from an absent measurement and handles long durations', () => {
    const chart = workflowDurationChart([workflow('zero', 0, 1), workflow('missing', null, 0, 1), workflow('long', 172800, 1)]);
    assert.equal(chart.rows.find(row => row.id === 'zero')!.widthPercent, 0);
    assert.equal(chart.rows.find(row => row.id === 'missing')!.widthPercent, null);
    assert(chart.ticks.at(-1)! >= 172800);
    assert.deepEqual(workflowDurationChart([]).rows, []);
  });
  it('renders readable exact averages and timing coverage without savings controls', () => {
    const data = activitySample(ACTIVITY_SAMPLE_RANGE, 'normal');
    assert.equal(data.state, 'loaded'); if (data.state !== 'loaded') return;
    const html = renderToStaticMarkup(createElement(ActivityDurations, { report: data.report }));
    for (const text of ['Average workflow time', '2m 18s', '2m 14s', '10 of 14 completed runs timed']) assert(html.includes(text));
    for (const retired of ['Time saved', '<input', 'Set manual time', 'Estimated total']) assert(!html.includes(retired));
  });
  it('renders missing timing and an empty period without fabricated averages or bars', () => {
    for (const scenario of ['incomplete', 'empty'] as const) {
      const data = activitySample(ACTIVITY_SAMPLE_RANGE, scenario);
      assert.equal(data.state, 'loaded'); if (data.state !== 'loaded') return;
      const html = renderToStaticMarkup(createElement(ActivityDurations, { report: data.report }));
      assert(html.includes(scenario === 'incomplete' ? 'Not timed' : 'No workflow activity in this period'));
      assert(!html.includes('class="activity-duration-bar"'));
    }
  });
  it('does not describe measured runs as untimed when their aggregate duration is unavailable', () => {
    const data = activitySample(ACTIVITY_SAMPLE_RANGE, 'normal');
    assert.equal(data.state, 'loaded'); if (data.state !== 'loaded') return;
    const html = renderToStaticMarkup(createElement(ActivityDurations, {
      report: { ...data.report, workflows: [workflow('Partial readback', null, 2)] },
    }));
    assert(html.includes('2 of 2 completed runs timed'));
    assert(html.includes('Unavailable'));
    assert(!html.includes('Not timed'));
    assert(!html.includes('class="activity-duration-bar"'));
  });
});
