// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act,createElement } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { afterEach,describe,it,vi } from 'vitest';
import { SettingsSaveFeedback } from '../../../../../src/dashboard/surfaces/settings/editor/settings-feedback.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
async function mount(element: ReturnType<typeof createElement>) { const host = document.createElement('div'); document.body.append(host); root = createRoot(host); await act(async () => root?.render(element)); return host; }
const button = (name: string) => { const found = [...document.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === name); assert(found, name); return found; };
const press = async (name: string) => act(async () => button(name).click());
describe('mounted frontend reliability contracts', () => {
  it('retains saved status, distinguishes restart-required and preserves uncertain retry', async () => {
    vi.useFakeTimers(); let retry = 0;
    const host = await mount(createElement(SettingsSaveFeedback, { save: { state: 'applied', replayed: false }, restartRequired: true, retry: () => retry++ }));
    await act(async () => vi.advanceTimersByTime(10000));
    assert.match(host.textContent ?? '', /Saved · Restart required/);
    await act(async () => root?.render(createElement(SettingsSaveFeedback, { save: { state: 'unconfirmed', message: 'Response unavailable' }, retry: () => retry++ })));
    assert(!host.textContent?.includes('Saved')); await press('Retry exact attempt'); assert.equal(retry, 1);
  });
});
