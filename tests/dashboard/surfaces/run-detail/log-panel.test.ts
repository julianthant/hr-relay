import { vi } from "vitest";
// @vitest-environment jsdom
import assert_m0 from 'node:assert/strict';
import { readFileSync as readFileSync_m1 } from "node:fs";
import { resolve as resolve_m1 } from "node:path";
import { act as act_m0,createElement as createElement_m0 } from 'react';
import { createRoot as createRoot_m0 } from 'react-dom/client';
import { afterEach as afterEach_m0,beforeEach as beforeEach_m0,describe as describe_m0,describe as describe_m1,expect as expect_m1,it as it_m0,it as it_m1 } from 'vitest';
import { LogPanel as LogPanel_m0 } from '../../../../src/dashboard/surfaces/run-detail/log-panel.js';
import type { LogStep as LogStep_m0 } from '../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js';


{


const steps: readonly LogStep_m0[] = [{ id: 'review', title: 'Employee match', time: '09:10:00', entries: [{ id: 'match', kind: 'decision', time: '09:10:00', decision: { state: 'review', title: 'Review identity' } }] }];

const _beforeEachFixture0 = () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
};
const _afterEachFixture1 = () => vi.unstubAllGlobals();

describe_m0('compact run headers', () => {
beforeEach_m0(_beforeEachFixture0);
afterEach_m0(_afterEachFixture1);

  it_m0('clears a log search and focuses the decision without executing it', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot_m0(host); const decision = vi.fn();
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView');
    const scroll = vi.fn(); Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: scroll });
    try {
      const hiddenHeadingSteps = [{ ...steps[0], header: false, entries: [{ kind: 'note' as const, id: 'before-match', time: '09:09:00', message: 'Identity read finished.' }, ...steps[0].entries] }];
      await act_m0(async () => root.render(createElement_m0(LogPanel_m0, { title: 'Jordan', steps: hiddenHeadingSteps, timeline: [], onDecision: decision,
        status: createElement_m0('span', { 'data-review-badge': true }, 'Review'),
        context: { workflow: 'Person lookup', displayId: 'PL00000001', attempt: 2, reviewPending: true, timing: { text: '2m 0s' } } })));
      assert_m0.equal(host.querySelector('[data-review-badge]'), null);
      const search = host.querySelector<HTMLInputElement>('input[aria-label="Search logs"]'); assert_m0(search);
      await act_m0(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'no match');
        search.dispatchEvent(new Event('input', { bubbles: true }));
      });
      assert_m0.match(host.textContent ?? '', /No matching actions/);
      const review = [...host.querySelectorAll('button')].find(button => button.textContent === 'Review'); assert_m0(review);
      await act_m0(async () => { review.click(); await new Promise(resolve => setTimeout(resolve, 40)); });
      assert_m0.equal(document.activeElement?.getAttribute('role'), 'group');
      assert_m0.equal(document.activeElement?.getAttribute('aria-label'), 'Review identity');
      assert_m0.equal(document.activeElement?.closest('.sr-only'), null);
      assert_m0.equal(scroll.mock.calls.length, 0); assert_m0.equal(decision.mock.calls.length, 0);
      assert_m0.equal(host.querySelector('[aria-label="Run context"]'), null);
      assert_m0.equal(host.querySelector('h2')?.textContent, 'Jordan');
      assert_m0.doesNotMatch(host.querySelector('header')?.textContent ?? '', /PL00000001|Attempt #|Elapsed/);
      await act_m0(async () => root.render(createElement_m0(LogPanel_m0, { title: 'Jordan', steps, timeline: [], content: createElement_m0('div', null, 'Editable records'),
        status: createElement_m0('span', { 'data-review-badge': true }, 'Review'),
        context: { workflow: 'OCR', displayId: 'OCR00000001', attempt: 1, reviewPending: true } })));
      assert_m0(host.querySelector('[data-review-badge]'));
      assert_m0.equal([...host.querySelectorAll('button')].filter(button => button.textContent === 'Review').length, 0);
    } finally { await act_m0(async () => root.unmount()); host.remove(); if (descriptor) Object.defineProperty(Element.prototype, 'scrollIntoView', descriptor); else Reflect.deleteProperty(Element.prototype, 'scrollIntoView'); }
  });
});
}

{


const SOURCE = resolve_m1(import.meta.dirname, "../../../../src/dashboard/surfaces/run-detail/log-panel.tsx");

function code(): string {
  return readFileSync_m1(SOURCE, "utf8")
    .replace(/\/\*[\s\S]*?\*\//gu, "")
    .replace(/^[ \t]*\/\/.*$/gmu, "");
}

describe_m1("the detail region's breakpoints", () => {
  it_m1("keys on the COLUMN, never on the window", () => {
    const viewportQueries = [...code().matchAll(/(?<!@)\bmin-\[(\d+)px\]:(\S*)/gu)]
      .map((match) => `min-[${String(match[1])}px]:${String(match[2])}`);
    expect_m1(viewportQueries).toEqual([]);
  });
});
}
