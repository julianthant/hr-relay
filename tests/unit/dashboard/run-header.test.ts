// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, it, vi } from 'vitest';
import { queueRunHeader, runHeaderAction } from '../../../src/dashboard/surfaces/run-detail/run-header-model.js';
import { LogPanel } from '../../../src/dashboard/surfaces/run-detail/log-panel.js';
import { LogSample } from '../../../src/dashboard/surfaces/run-detail/logs/log-sample.js';
import type { LogStep } from '../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js';
import { mockQueueSurface } from '../../../src/dashboard/surfaces/workflows/mocks/workflow-queue-model.js';
import { initialMockDraft, type MockRun } from '../../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js';

const steps: readonly LogStep[] = [{ id: 'review', title: 'Employee match', time: '09:10:00', entries: [{ id: 'match', kind: 'decision', time: '09:10:00', decision: { state: 'review', title: 'Review identity' } }] }];

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});
afterEach(() => vi.unstubAllGlobals());

describe('compact run headers', () => {
  it('keeps running and finished timing honest and exposes the selected attempt', () => {
    const draft = initialMockDraft('person-lookup');
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: { ...draft, method: 'typed', text: 'Jordan' }, approved: true, seeded: true };
    const row = mockQueueSurface(run, '2026-08-03');
    const context = queueRunHeader({ ...row, attempt: 3, status: 'running', endedAt: { state: 'absent', reason: 'Still running' } }, 'Person lookup', '2026-08-03T16:12:00.000Z');
    assert.match(context.displayId, /^PL\d{8}$/); assert.equal(context.attempt, 3); assert.equal(context.timing?.text, '2m 0s');
    assert.equal(queueRunHeader({ ...row, status: 'queued' }, 'Person lookup', row.updatedAt).timing, undefined);
    const missing = queueRunHeader({ ...row, status: 'done', endedAt: { state: 'absent', reason: 'No retained finish' } }, 'Person lookup', row.updatedAt);
    assert.equal(missing.timing?.text, 'duration unknown'); assert.equal(missing.timing?.title, 'No retained finish');
    assert.equal(queueRunHeader(row, 'Person lookup', '2026-08-04T16:12:00.000Z').timing?.text, queueRunHeader(row, 'Person lookup', row.updatedAt).timing?.text);
  });
  it('only offers navigation to visible unresolved decisions and failures', () => {
    assert.deepEqual(runHeaderAction(steps, []), { label: 'Review', stepId: 'review' });
    assert.equal(runHeaderAction([{ ...steps[0], entries: [{ kind: 'decision', id: 'match', time: '09:10:00', decision: { state: 'resolved', title: 'Reviewed' } }] }], []), undefined);
    assert.equal(runHeaderAction([], [{ id: 'missing', stepId: 'absent', label: 'Failed', state: 'failed', substeps: [] }]), undefined);
  });
  it('does not attach queue facts to an unrelated standalone log scenario', () => {
    const run: MockRun = { id: 'header-fixture', workflowId: 'person-lookup', title: 'Jordan', subject: 'Jordan', draft: initialMockDraft('person-lookup'), approved: true, seeded: true };
    const row = mockQueueSurface(run, '2026-08-03');
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
  it('clears a log search and focuses the decision without executing it', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host); const decision = vi.fn();
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    const scroll = vi.fn(); Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    try {
      await act(async () => root.render(createElement(LogPanel, { title: 'Jordan', steps, timeline: [], onDecision: decision,
        status: createElement('span', { 'data-review-badge': true }, 'Review'),
        context: { workflow: 'Person lookup', displayId: 'PL00000001', attempt: 2, reviewPending: true, timing: { text: '2m 0s' } } })));
      assert.equal(host.querySelector('[data-review-badge]'), null);
      const search = host.querySelector<HTMLInputElement>('input[aria-label="Search logs"]'); assert(search);
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'no match');
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert.match(host.textContent ?? '', /No matching actions/);
      const review = [...host.querySelectorAll('button')].find(button => button.textContent === 'Review'); assert(review);
      await act(async () => { review.click(); await new Promise(resolve => setTimeout(resolve, 40)); });
      assert.equal(document.activeElement?.textContent, 'Employee match'); assert.equal(scroll.mock.calls.length, 1); assert.equal(decision.mock.calls.length, 0);
      assert.equal(host.querySelector('[aria-label="Run context"]'), null);
      assert.equal(host.querySelector('h2')?.textContent, 'Jordan');
      assert.doesNotMatch(host.querySelector('header')?.textContent ?? '', /PL00000001|Attempt #|Elapsed/);
      await act(async () => root.render(createElement(LogPanel, { title: 'Jordan', steps, timeline: [], content: createElement('div', null, 'Editable records'),
        status: createElement('span', { 'data-review-badge': true }, 'Review'),
        context: { workflow: 'OCR', displayId: 'OCR00000001', attempt: 1, reviewPending: true } })));
      assert(host.querySelector('[data-review-badge]'));
      assert.equal([...host.querySelectorAll('button')].filter(button => button.textContent === 'Review').length, 0);
    } finally { await act(async () => root.unmount()); host.remove(); if (descriptor) Object.defineProperty(Element.prototype, 'scrollIntoView', descriptor); else Reflect.deleteProperty(Element.prototype, 'scrollIntoView'); }
  });
});
