// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach,beforeEach,describe,it,vi } from 'vitest';
import { LogSample } from '../../../../../src/dashboard/surfaces/run-detail/logs/log-sample.js';
import { initialMockDraft,type MockRun } from '../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js';
import { mockQueueSurface } from '../../../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js';

const { useRunWiring, projectRunLogs } = vi.hoisted(() => ({ useRunWiring: vi.fn(), projectRunLogs: vi.fn() }));
vi.mock('../../../../../src/dashboard/state/client-context.js', () => ({ useDashboardClient: () => ({}), useDashboardCommandBinding: () => undefined }));
vi.mock('../../../../../src/dashboard/state/run-wiring-adapter.js', () => ({ projectRunLogs, useRunWiring }));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
  useRunWiring.mockReset();
  projectRunLogs.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe('compact run headers', () => {
  it('does not attach queue facts to an unrelated standalone log scenario', () => {
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
    const locationBefore = window.location.href;
    try {
      window.history.replaceState(null, '', '/?logPreview=separation');
      const unrelated = renderToStaticMarkup(createElement(LogSample, { source: 'mock', selection: { row, workflowLabel: 'Person lookup' } }));
      assert.doesNotMatch(unrelated, /aria-label="Run context"/);
      window.history.replaceState(null, '', '/?logPreview=selected');
      const selected = renderToStaticMarkup(createElement(LogSample, { source: 'mock', selection: { row, workflowLabel: 'Person lookup' } }));
      assert.doesNotMatch(selected, /aria-label="Run context"/); assert.match(selected, /aria-label="Selected run logs"/);
    } finally { window.history.replaceState(null, '', locationBefore); }
  });

  it('keeps selected served logs on the served reader when a preview is requested', () => {
    useRunWiring.mockReturnValue({ state: 'failed', error: 'served logs unavailable' });
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
    const locationBefore = window.location.href;
    try {
      window.history.replaceState(null, '', '/?logPreview=selected');
      const markup = renderToStaticMarkup(createElement(LogSample, { source: 'served', selection: { row, workflowLabel: 'Person lookup' } }));
      assert.match(markup, /served logs unavailable/);
      assert.equal(useRunWiring.mock.calls.length, 1);
    } finally { window.history.replaceState(null, '', locationBefore); }
  });

  it('mounts the retained UCPath table at its parked step without enabling unverified resolutions', () => {
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
    useRunWiring.mockReturnValue({ state: 'loaded', snapshot: { detail: { header: { title: 'Retained run' } }, unavailableEvidence: [] }, onUcpathDecision: vi.fn() });
    projectRunLogs.mockReturnValue({ steps: [{ id: 'parked-submit', time: '13:02:03', title: 'Write parked',
      entries: [{ kind: 'note', id: 'parked-note', time: '13:02:03', message: 'Uncertain' }] }], timeline: [],
      ucpathFindings: { stepId: 'parked-submit', attemptLabel: 'Attempt 1', presentation: { state: 'found', complete: true, authoritative: false,
        rows: [{ transactionNumber: 'T123456', person: 'Fixture, Jordan', employeeId: '10800000', transactionType: 'Terminatn',
          effectiveDate: '11/01/2026', submittedAt: '11/01/26 1:02:03.123456PM', detailVerified: true, match: 'exact' }] } } });
    const markup = renderToStaticMarkup(createElement(LogSample, { source: 'served', selection: { row, workflowLabel: 'Person lookup' } }));
    const container = document.createElement('div'); container.innerHTML = markup;
    const table = container.querySelector('[aria-label="UCPath found transactions"]'); assert.ok(table);
    assert.match(table.textContent ?? '', /T123456/); assert.match(table.textContent ?? '', /11\/01\/26 1:02:03\.123456PM/);
    assert.match(table.textContent ?? '', /authority unverified/);
    for (const label of ['Submitted', 'Not submitted']) {
      const button: HTMLButtonElement | undefined = [...table.querySelectorAll('button')].find(candidate => candidate.textContent === label);
      assert.ok(button?.disabled);
    }
    const check = [...table.querySelectorAll('button')].find(candidate => candidate.textContent === 'Check again');
    assert.ok(check); assert.equal(check.disabled, false);
  });
});
