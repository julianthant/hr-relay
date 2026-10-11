import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe,it } from 'vitest';
import { ActivityDurations } from '../../../../src/dashboard/surfaces/activity/activity-duration.js';
import { ACTIVITY_SAMPLE_RANGE,activitySample } from '../../../../src/dashboard/surfaces/activity/activity-fixture.js';

describe('workflow duration comparisons', () => {
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
      report: { ...data.report, workflows: [{ id: 'Partial readback', label: 'Partial readback', completed: 2, total: 2, failed: 0, outstanding: 0, successfulTiming: { totalSeconds: null, measured: 2, unmeasured: 0 } }] },
    }));
    assert(html.includes('2 of 2 completed runs timed'));
    assert(html.includes('Unavailable'));
    assert(!html.includes('Not timed'));
    assert(!html.includes('class="activity-duration-bar"'));
  });
});
