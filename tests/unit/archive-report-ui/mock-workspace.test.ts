// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { DateInput } from '../../../src/dashboard/ds/ui.js';

class MeasurementFreeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
Reflect.set(globalThis, 'ResizeObserver', MeasurementFreeResizeObserver);
Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let dispose: (() => Promise<void>) | undefined;
const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
afterEach(async () => { await dispose?.(); dispose = undefined; vi.unstubAllGlobals(); if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor); else Reflect.deleteProperty(navigator, 'clipboard'); document.body.replaceChildren(); });
function button(label: string) {
 const match = [...document.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label);
 expect(match, label).toBeDefined(); return match!;
}
async function click(element: HTMLElement) { await act(async () => element.click()); }

it('the shared date calendar changes its field, closes and respects its bounds', async () => {
 const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
 dispose = async () => { await act(async () => root.unmount()); };
 const changed = vi.fn();
 await act(async () => root.render(createElement(DateInput, { label: 'Completed from', value: '2026-09-23', min: '2026-09-22', max: '2026-09-25', onChange: changed })));
 await click(button('Choose completed from date'));
 const dates = [...document.querySelectorAll<HTMLElement>('.ds-calendar [role="button"]')];
 const day = (label: string) => dates.find(item => item.getAttribute('aria-label')?.startsWith(label))!;
 expect(day('Monday, September 21, 2026').getAttribute('aria-disabled')).toBe('true');
 await click(day('Thursday, September 24, 2026'));
 expect(changed).toHaveBeenCalledWith('2026-09-24');
 expect(document.querySelector('[role="dialog"]')).toBeNull();
});
