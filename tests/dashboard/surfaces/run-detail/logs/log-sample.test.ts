// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach,beforeEach,describe,it,vi } from 'vitest';
import { LogSample } from '../../../../../src/dashboard/surfaces/run-detail/logs/log-sample.js';
import { initialMockDraft,type MockRun } from '../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js';
import { mockQueueSurface } from '../../../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js';
import { DryRunPreviewWireSchema } from '../../../../../src/models/dashboard/run-detail.js';

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

  it.each([true, false])('renders the served child retry in the log header with current availability (%s)', available => {
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
    useRunWiring.mockReturnValue({ state: 'loaded', snapshot: { detail: { header: { title: 'Failed lookup' }, childRetry: { label: 'Retry' } },
      logs: {}, unavailableEvidence: [] }, ...(available ? { onChildRetry: vi.fn() } : {}) });
    projectRunLogs.mockReturnValue({ steps: [], timeline: [] });
    const markup = renderToStaticMarkup(createElement(LogSample, { source: 'served', selection: { row, workflowLabel: 'Person lookup' } }));
    const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
    assert.match(header, /aria-label="Retry"/);
    assert.equal(/disabled=""/.test(header), !available);
  });

  it.each([true, false])('clicks the served child Retry only when it is enabled (%s)', available => {
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
    const effects: string[] = [];
    useRunWiring.mockReturnValue({ state: 'loaded', snapshot: { detail: { header: { title: 'Failed lookup' }, childRetry: { label: 'Retry' } },
      logs: {}, unavailableEvidence: [] }, ...(available ? { onChildRetry: () => effects.push('retry') } : {}) });
    projectRunLogs.mockReturnValue({ steps: [], timeline: [] });
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      act(() => root.render(createElement(LogSample, { source: 'served', selection: { row, workflowLabel: 'Person lookup' } })));
      const button = host.querySelector<HTMLButtonElement>('button[aria-label="Retry"]'); assert.ok(button);
      act(() => button.click());
      assert.deepEqual(effects, available ? ['retry'] : []);
    } finally { act(() => root.unmount()); host.remove(); }
  });

  it('shows the source page and revision when earlier review changes no longer apply', () => {
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
    useRunWiring.mockReturnValue({ state: 'loaded', snapshot: { detail: { header: { title: 'OCR' }, ocrReviewChanges: [{ sourcePage: 2, revision: 4 }] },
      logs: {}, unavailableEvidence: [] } });
    projectRunLogs.mockReturnValue({ steps: [], timeline: [] });
    const markup = renderToStaticMarkup(createElement(LogSample, { source: 'served', selection: { row, workflowLabel: 'OCR' } }));
    assert.match(markup, /Earlier review changes no longer apply/);
    assert.match(markup, /Page 2: OCR evidence changed in revision 4/);
  });

  it.each([
    { previewState: 'none', trailingStep: false },
    { previewState: 'pending', trailingStep: false },
    { previewState: 'available', trailingStep: false },
    { previewState: 'unavailable', trailingStep: false },
    { previewState: 'available', trailingStep: true },
    { previewState: 'unavailable', trailingStep: true },
  ] as const)('keeps UCPath findings and $previewState dry-run output at their own steps (trailing: $trailingStep)', ({ previewState, trailingStep }) => {
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
    const dryRunPreview = previewState === 'none' ? undefined : DryRunPreviewWireSchema.parse(previewState === 'available'
      ? { state: 'available', coverage: 'full', stages: [{ id: 'submit', label: 'Submit', state: 'exercised', detail: 'Submit was not clicked.', submitNotClicked: true }] }
      : previewState === 'unavailable' ? { state: 'unavailable', reason: 'preview-not-completed' } : { state: 'pending' });
    useRunWiring.mockReturnValue({ state: 'loaded', snapshot: { detail: { header: { title: 'Retained run' } },
      logs: { ...(dryRunPreview === undefined ? {} : { dryRunPreview }) }, unavailableEvidence: [] }, onUcpathDecision: vi.fn() });
    projectRunLogs.mockReturnValue({ steps: [{ id: 'parked-submit', time: '13:02:03', title: 'Write parked',
      entries: [{ kind: 'note', id: 'parked-note', time: '13:02:03', message: 'Uncertain' }] },
      ...(trailingStep ? [{ id: 'retained-tail', time: '13:02:04', title: 'Additional retained step',
        entries: [{ kind: 'note', id: 'tail-note', time: '13:02:04', message: 'Retained' }] }] : [])], timeline: [],
      ucpathFindings: { stepId: 'parked-submit', attemptLabel: 'Attempt 1', presentation: { state: 'found', complete: true, authoritative: false,
        rows: [{ transactionNumber: 'T123456', person: 'Fixture, Jordan', employeeId: '10800000', transactionType: 'Terminatn',
          effectiveDate: '11/01/2026', submittedAt: '11/01/26 1:02:03.123456PM', detailVerified: true, match: 'exact' }] } } });
    const markup = renderToStaticMarkup(createElement(LogSample, { source: 'served', selection: { row, workflowLabel: 'Person lookup' } }));
    const container = document.createElement('div'); container.innerHTML = markup;
    const table = container.querySelector('[aria-label="UCPath found transactions"]'); assert.ok(table);
    assert.equal(container.querySelectorAll('[aria-label="UCPath found transactions"]').length, 1);
    assert.match(table.textContent ?? '', /T123456/); assert.match(table.textContent ?? '', /11\/01\/26 1:02:03\.123456PM/);
    assert.match(table.textContent ?? '', /authority unverified/);
    for (const label of ['Submitted', 'Not submitted']) {
      const button: HTMLButtonElement | undefined = [...table.querySelectorAll('button')].find(candidate => candidate.textContent === label);
      assert.ok(button?.disabled);
    }
    const check = [...table.querySelectorAll('button')].find(candidate => candidate.textContent === 'Check again');
    assert.ok(check); assert.equal(check.disabled, false);
    assert.equal(container.querySelectorAll('[aria-label="Full dry-run preview"]').length, previewState === 'available' ? 1 : 0);
    if (previewState === 'available') assert.match(container.querySelector('[aria-label="Full dry-run preview"]')?.textContent ?? '', /Not clicked/);
    if (previewState === 'unavailable') assert.match(markup, /Dry-run preview unavailable/);
    else assert.doesNotMatch(markup, /Dry-run preview unavailable/);
    if (trailingStep) {
      const tail = markup.indexOf('Additional retained step'); assert.ok(tail > 0);
      assert.ok(markup.indexOf('aria-label="UCPath found transactions"') < tail);
      assert.ok(markup.indexOf(previewState === 'available' ? 'aria-label="Full dry-run preview"' : 'Dry-run preview unavailable') > tail);
    }
  });
});
