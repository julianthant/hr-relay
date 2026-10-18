// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach,beforeEach,describe,it,vi } from 'vitest';
import { LogSample } from '../../../../../src/dashboard/surfaces/run-detail/logs/log-sample.js';
import { initialMockDraft,type MockRun } from '../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js';
import { mockQueueSurface } from '../../../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});
afterEach(() => vi.unstubAllGlobals());

describe('compact run headers', () => {
  it('does not attach queue facts to an unrelated standalone log scenario', () => {
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
    const locationBefore = window.location.href;
    try {
      window.history.replaceState(null, '', '/?logPreview=separation');
      const unrelated = renderToStaticMarkup(createElement(LogSample, { selection: { row, workflowLabel: 'Person lookup' } }));
      assert.doesNotMatch(unrelated, /aria-label="Run context"/);
      window.history.replaceState(null, '', '/?logPreview=selected');
      const selected = renderToStaticMarkup(createElement(LogSample, { selection: { row, workflowLabel: 'Person lookup' } }));
      assert.doesNotMatch(selected, /aria-label="Run context"/); assert.match(selected, /aria-label="Selected run logs"/);
    } finally { window.history.replaceState(null, '', locationBefore); }
  });
});
