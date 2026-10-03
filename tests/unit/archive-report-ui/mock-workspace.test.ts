// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { ArchiveBrowseState } from '../../../src/dashboard/app/archive-route-model.js';
import { DateInput, ToastProvider } from '../../../src/dashboard/ds/ui.js';
import { MockArchiveWorkspace } from '../../../src/dashboard/surfaces/archive-mock.js';
import { MOCK_ARCHIVE_RUNS, MOCK_ARCHIVE_WORKFLOWS, type MockArchiveFolder } from '../../../src/dashboard/surfaces/archive-mock-model.js';

class MeasurementFreeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
Reflect.set(globalThis, 'ResizeObserver', MeasurementFreeResizeObserver);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let dispose: (() => Promise<void>) | undefined;
afterEach(async () => { await dispose?.(); dispose = undefined; vi.unstubAllGlobals(); document.body.replaceChildren(); });
async function mount(initialSelection = '', initialFolder: MockArchiveFolder | null = null) {
 const fetch = vi.fn(() => { throw new Error('Unexpected mock Archive transport'); }); vi.stubGlobal('fetch', fetch);
 function Harness() {
  const [selection, onSelection] = useState(initialSelection);
  const [folder, setFolder] = useState(initialFolder);
  const [view, onView] = useState<'runs' | 'versions'>('runs');
  const [browse, onBrowse] = useState<ArchiveBrowseState>({ filters: {} });
  return createElement(ToastProvider, { children: createElement(MockArchiveWorkspace, { selection, folder, view, browse, onSelection, onView, onBrowse,
   onFolder: next => { setFolder(next); onSelection(''); onBrowse({ filters: {} }); },
  }) });
 }
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
 dispose = async () => { await act(async () => root.unmount()); };
 await act(async () => root.render(createElement(Harness)));
 return fetch;
}
function button(label: string) {
 const match = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label);
 expect(match, label).toBeDefined(); return match!;
}
async function click(element: HTMLElement) { await act(async () => element.click()); }

it('browses folders, full-page reports and retained files without a dashboard client', async () => {
 const fetch = await mount();
 expect(document.body.textContent).toContain('30 matching reports');
 await click(button('SeparationsWorkflow 1.124 runs'));
 expect(document.querySelector('table')?.textContent).toContain('Jordan Lee');
 await click(button('Open report for Drew Ellis'));
 expect(document.querySelector('article')?.textContent).toContain('UCPath confirmation was unavailable');
 expect(document.querySelector('[role="dialog"]')).toBeNull();
 expect(document.querySelector('article > dl')).toBeNull();
 for (const label of ['Dashboard version', 'Workflow version', 'Archived', 'Outcome', 'Retained files']) {
  expect([...document.querySelectorAll('article dt')].filter(item => item.textContent === label)).toHaveLength(1);
 }
 await click(button('Steps'));
 expect(document.querySelector('table')?.textContent).toContain('Not started');
 await click(button('Retained files3'));
 expect(document.querySelector('article')?.textContent).toContain('failure-48224.txt');
 await click(button('All runs'));
 expect(document.querySelector('table')?.textContent).toContain('Rowan Bell');
 expect(fetch).not.toHaveBeenCalled();
});
it('rejects a real or mismatched report identity without loading a different record', async () => {
 const fetch = await mount(MOCK_ARCHIVE_RUNS[0].id, { dashboardKey: '1.2', workflow: MOCK_ARCHIVE_WORKFLOWS[0].id });
 expect(document.querySelector('[role="alert"]')?.textContent).toContain('unavailable in the mock');
 expect(document.querySelector('article')).toBeNull();
 await click(button('View version history'));
 expect(document.body.textContent).toContain('30 matching reports');
 expect(fetch).not.toHaveBeenCalled();
});
it('reviews the original bump scopes locally and invalidates review when scope changes', async () => {
 const fetch = await mount();
 await click(button('Plan a bump'));
 await click(button('Review change'));
 expect(document.body.textContent).toContain('1.13');
 expect(document.body.textContent).toContain('1.14');
 expect(button('Apply reviewed change')).toBeDefined();
 await click(document.querySelector<HTMLInputElement>('input[type="radio"]:not(:checked)')!);
 expect(button('Review change')).toBeDefined();
 await click(button('Review change'));
 await click(button('Apply reviewed change'));
 expect(document.querySelector('[role="dialog"]')).toBeNull();
 expect(document.body.textContent).toContain('Mock bump reviewed');
 expect(document.body.textContent).toContain('Current · 1.4');
 expect(fetch).not.toHaveBeenCalled();
});
it('the shared date calendar changes its field, closes and respects its bounds', async () => {
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
 dispose = async () => { await act(async () => root.unmount()); };
 const changed = vi.fn();
 await act(async () => root.render(createElement(DateInput, { label: 'Completed from', value: '2026-09-23', min: '2026-09-22', max: '2026-09-25', onChange: changed })));
 await click(button('Choose completed from date'));
 const dates = [...document.querySelectorAll<HTMLElement>('.ds-hero-calendar [role="button"]')];
 const day = (label: string) => dates.find(item => item.getAttribute('aria-label')?.startsWith(label))!;
 expect(day('Monday, September 21, 2026').getAttribute('aria-disabled')).toBe('true');
 await click(day('Thursday, September 24, 2026'));
 expect(changed).toHaveBeenCalledWith('2026-09-24');
 expect(document.querySelector('[role="dialog"]')).toBeNull();
});
