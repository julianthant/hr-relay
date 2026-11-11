// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement, type ComponentProps } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach,beforeEach,describe,it,vi } from 'vitest';
import { TooltipProvider } from '../../../../../src/dashboard/ds/ui.js';
import { LogSample } from '../../../../../src/dashboard/surfaces/run-detail/logs/log-sample.js';
import { initialMockDraft,type MockRun } from '../../../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js';
import { mockQueueSurface } from '../../../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js';
import { QueueSurfaceWireSchema } from "../../../../../src/models/dashboard/projection.js";
import { queueParentFixture } from "../../../../support/helpers/dashboard/queue-parent-fixture.js";
import { DryRunPreviewWireSchema } from '../../../../../src/models/dashboard/run-detail.js';

const { useRunWiring, projectRunLogs } = vi.hoisted(() => ({ useRunWiring: vi.fn(), projectRunLogs: vi.fn() }));
vi.mock('../../../../../src/dashboard/state/client-context.js', () => ({ useDashboardClient: () => ({}), useDashboardCommandBinding: () => undefined }));
vi.mock('../../../../../src/dashboard/state/run-wiring-adapter.js', () => ({ projectRunLogs, useRunWiring }));
vi.mock('../../../../../src/dashboard/surfaces/run-detail/review/review.js', () => ({ RunReview: () => null }));

const sample = (props: ComponentProps<typeof LogSample>) => createElement(TooltipProvider, null, createElement(LogSample, props));

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
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
      const unrelated = renderToStaticMarkup(sample({ source: 'mock', selection: { row, workflowLabel: 'Person lookup' } }));
      assert.doesNotMatch(unrelated, /aria-label="Run context"/);
      window.history.replaceState(null, '', '/?logPreview=selected');
      const selected = renderToStaticMarkup(sample({ source: 'mock', selection: { row, workflowLabel: 'Person lookup' } }));
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
      const markup = renderToStaticMarkup(sample({ source: 'served', selection: { row, workflowLabel: 'Person lookup' } }));
      assert.match(markup, /served logs unavailable/);
      assert.equal(useRunWiring.mock.calls.length, 1);
    } finally { window.history.replaceState(null, '', locationBefore); }
  });

  it.each([true, false])('renders the served child retry in the log header with current availability (%s)', available => {
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
    useRunWiring.mockReturnValue({ state: 'loaded', snapshot: { detail: { header: { title: 'Failed lookup' }, availableSections: ['logs'], childRetry: { label: 'Retry' } },
      logs: {}, unavailableEvidence: [] }, ...(available ? { onChildRetry: vi.fn() } : {}) });
    projectRunLogs.mockReturnValue({ steps: [], timeline: [] });
    const markup = renderToStaticMarkup(sample({ source: 'served', selection: { row, workflowLabel: 'Person lookup' } }));
    const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
    assert.match(header, /aria-label="Retry"/);
    assert.equal(/disabled=""/.test(header), !available);
  });

  it.each([true, false])('clicks the served child Retry only when it is enabled (%s)', available => {
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = QueueSurfaceWireSchema.parse({ ...mockQueueSurface(run, '2026-08-03T16:10:00.000Z'),
      parent: queueParentFixture('00000000-0000-4000-8000-000000000901'),
      actions: [{ key: 'retry', label: 'Retry', kind: 'command', command: 'retry', expectedVersion: 1,
        intent: 'neutral', icon: 'retry', placement: ['banner'] }] });
    const onAction = vi.fn();
    const effects: string[] = [];
    const snapshot = { detail: { header: { title: 'Failed lookup' }, availableSections: ['logs'], childRetry: { label: 'Retry' } }, logs: {}, unavailableEvidence: [] };
    useRunWiring.mockReturnValue({ state: 'loaded', snapshot, ...(available ? { onChildRetry: () => effects.push('retry') } : {}) });
    projectRunLogs.mockReturnValue({ steps: [], timeline: [] });
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      act(() => root.render(sample({ source: 'served', selection: { row, workflowLabel: 'Person lookup' }, onAction })));
      const button = host.querySelector<HTMLButtonElement>('button[aria-label="Retry"]'); assert.ok(button);
      assert.equal(host.querySelectorAll('button[aria-label="Retry"]').length, 1);
      act(() => button.click());
      assert.deepEqual(effects, available ? ['retry'] : []);
      useRunWiring.mockReturnValue({ state: 'loaded', snapshot, onChildRetry: () => effects.push('updated') });
      act(() => root.render(sample({ source: 'served', selection: { row, workflowLabel: 'Person lookup' }, onAction })));
      const refreshed = host.querySelector<HTMLButtonElement>('button[aria-label="Retry"]'); assert.ok(refreshed);
      act(() => refreshed.click());
      assert.deepEqual(effects, available ? ['retry', 'updated'] : ['updated']);
      assert.equal(onAction.mock.calls.length, 0);
    } finally { act(() => root.unmount()); host.remove(); }
  });

  it.each([true, false])('renders one root batch Retry in its own header and uses its separate callback (%s)', available => {
    const run: MockRun = { id: 'batch-header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = QueueSurfaceWireSchema.parse({ ...mockQueueSurface(run, '2026-08-03T16:10:00.000Z'), status: 'failed', parent: null,
      session: { state: 'present', itemScope: 'session', sessionId: '00000000-0000-4000-8000-000000000902', origin: { kind: 'start-plan', startPlanId: '00000000-0000-4000-8000-000000000903', actorId: 'local-operator' },
        presentation: { layout: 'batch', groupInQueue: true, version: 1, startedAt: '2026-08-03T16:10:00.000Z' } },
      actions: [{ key: 'retry-batch-member', label: 'Retry', kind: 'command', command: 'retry', expectedVersion: 1, intent: 'neutral', icon: 'retry', placement: ['banner'] }] });
    const onAction = vi.fn(), onBatchMemberRetry = vi.fn();
    useRunWiring.mockReturnValue({ state: 'loaded', snapshot: { detail: { header: { title: 'Failed batch person' }, availableSections: ['logs'] },
      logs: {}, unavailableEvidence: [] }, ...(available ? { onBatchMemberRetry } : {}) });
    projectRunLogs.mockReturnValue({ steps: [], timeline: [] });
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    try {
      act(() => root.render(sample({ source: 'served', selection: { row, workflowLabel: 'Person lookup' }, onAction })));
      const buttons = host.querySelectorAll<HTMLButtonElement>('header button[aria-label="Retry"]'); assert.equal(buttons.length, 1);
      assert.equal(buttons[0].disabled, !available); act(() => buttons[0].click());
      assert.equal(onBatchMemberRetry.mock.calls.length, Number(available)); assert.equal(onAction.mock.calls.length, 0);
    } finally { act(() => root.unmount()); host.remove(); }
  });

  it('shows the served name in the logs header and keeps it on a fresh render', () => {
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = QueueSurfaceWireSchema.parse({ ...mockQueueSurface(run, '2026-08-03T16:10:00.000Z'), title: 'Jordan',
      displayName: { state: 'present', value: 'April contacts' } });
    const snapshot = { detail: { header: { title: 'April contacts' }, availableSections: ['logs'] }, logs: {}, unavailableEvidence: [] };
    useRunWiring.mockReturnValue({ state: 'loaded', snapshot });
    projectRunLogs.mockReturnValue({ steps: [], timeline: [] });
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const draw = () => sample({ source: 'served', selection: { row, workflowLabel: 'Person lookup' } });
    try {
      act(() => root.render(draw()));
      assert.equal(host.querySelector('h2')?.textContent, 'April contacts');
      act(() => root.unmount());
      const reloaded = createRoot(host);
      act(() => reloaded.render(draw()));
      assert.equal(host.querySelector('h2')?.textContent, 'April contacts');
      useRunWiring.mockReturnValue({ state: 'loading' });
      act(() => reloaded.render(draw()));
      assert.equal(host.querySelector('h2')?.textContent, 'April contacts');
      act(() => reloaded.unmount());
    } finally { host.remove(); }
  });

  it('shows the source page and revision when earlier review changes no longer apply', () => {
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
    useRunWiring.mockReturnValue({ state: 'loaded', snapshot: { detail: { header: { title: 'OCR' }, availableSections: ['logs'], ocrReviewChanges: [{ sourcePage: 2, revision: 4 }] },
      logs: {}, unavailableEvidence: [] } });
    projectRunLogs.mockReturnValue({ steps: [], timeline: [] });
    const markup = renderToStaticMarkup(sample({ source: 'served', selection: { row, workflowLabel: 'OCR' } }));
    assert.match(markup, /Earlier review changes no longer apply/);
    assert.match(markup, /Review the new values/);
  });

  it('opens Review records as a dialog over the Logs panel and closes back to Logs', () => {
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = mockQueueSurface(run, '2026-08-03T16:10:00.000Z');
    useRunWiring.mockReturnValue({ state: 'loaded', snapshot: { detail: { header: { title: 'Native OCR' }, availableSections: ['logs', 'review'], ocrRecordCount: 2 }, logs: {}, unavailableEvidence: [] } });
    projectRunLogs.mockReturnValue({ steps: [], timeline: [] });
    const onReview = vi.fn(), onLogs = vi.fn();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const sample = (open?: boolean) => createElement(TooltipProvider, null, createElement(LogSample, { source: 'served', selection: { row, workflowLabel: 'OCR' }, reviewOpen: open, onReview, onLogs }));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const records = () => host.querySelector<HTMLButtonElement>('button[aria-label="Records 2"]');
    try {
      act(() => root.render(sample()));
      assert.equal(document.querySelector('[role="dialog"]'), null);
      act(() => records()!.click()); assert.equal(onReview.mock.calls.length, 1);
      act(() => root.render(sample(true)));
      const dialog = document.querySelector('[role="dialog"]'); assert.ok(dialog);
      assert.match(dialog.textContent ?? '', /Review records/);
      assert.ok(records(), 'the Logs panel stays behind the dialog');
      act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
      assert.equal(onLogs.mock.calls.length, 1);
    } finally { act(() => root.unmount()); host.remove(); }
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
    useRunWiring.mockReturnValue({ state: 'loaded', snapshot: { detail: { header: { title: 'Retained run' }, availableSections: ['logs'] },
      logs: { ...(dryRunPreview === undefined ? {} : { dryRunPreview }) }, unavailableEvidence: [] }, onUcpathDecision: vi.fn() });
    projectRunLogs.mockReturnValue({ steps: [{ id: 'parked-submit', time: '13:02:03', title: 'Write parked',
      entries: [{ kind: 'note', id: 'parked-note', time: '13:02:03', message: 'Uncertain' }] },
      ...(trailingStep ? [{ id: 'retained-tail', time: '13:02:04', title: 'Additional retained step',
        entries: [{ kind: 'note', id: 'tail-note', time: '13:02:04', message: 'Retained' }] }] : [])], timeline: [],
      ucpathFindings: { stepId: 'parked-submit', attemptLabel: 'Attempt 1', presentation: { state: 'found', complete: true, authoritative: false,
        rows: [{ transactionNumber: 'T123456', person: 'Fixture, Jordan', employeeId: '10800000', transactionType: 'Terminatn',
          effectiveDate: '11/01/2026', submittedAt: '11/01/26 1:02:03.123456PM', detailVerified: true, match: 'exact' }] } } });
    const markup = renderToStaticMarkup(sample({ source: 'served', selection: { row, workflowLabel: 'Person lookup' } }));
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
