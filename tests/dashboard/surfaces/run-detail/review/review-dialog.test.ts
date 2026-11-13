// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, it, vi } from 'vitest';
import { TooltipProvider } from '../../../../../src/dashboard/ds/ui.js';
import { RecordReview } from '../../../../../src/dashboard/surfaces/run-detail/review/review.js';
import { ReviewDialog } from '../../../../../src/dashboard/surfaces/run-detail/review/review-dialog.js';
import type { RecordReviewProps } from '../../../../../src/dashboard/surfaces/run-detail/review/review-record-model.js';

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
});
afterEach(() => vi.unstubAllGlobals());

const props: RecordReviewProps = { runId: 'run', subject: 'Scan.pdf', readOnly: false, discarded: false, selectedCount: 1, onApprove: () => {}, onDiscard: () => {},
  cards: [{ name: 'Jordan Lee', pages: [{ page: 1, imageUrl: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }],
    record: { id: 'r1', page: 1, kind: 'oath', selected: true, warnings: [], fields: [{ key: 'firstName', label: 'First name', value: 'Jordan' }] } }] };

it('full screen hides the record column, the first Escape leaves it and the second closes the dialog', () => {
  const onOpenChange = vi.fn();
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const escape = () => act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  try {
    act(() => root.render(createElement(TooltipProvider, null, createElement(ReviewDialog, { open: true, onOpenChange, subject: 'Scan.pdf', children: createElement(RecordReview, props) }))));
    assert.equal(document.querySelector('button[aria-label="Add record"]'), null);
    act(() => document.querySelector<HTMLButtonElement>('button[aria-label="Full screen"]')!.click());
    assert.ok(document.querySelector('[data-review-fullscreen] button[aria-label="Exit full screen"]'));
    assert.equal(document.querySelector('[aria-label="Record review cards"]')!.classList.contains('hidden'), true);
    escape();
    assert.equal(onOpenChange.mock.calls.length, 0);
    assert.equal(document.querySelector('[data-review-fullscreen]'), null);
    escape();
    assert.deepEqual(onOpenChange.mock.calls[0], [false]);
  } finally { act(() => root.unmount()); host.remove(); }
});
