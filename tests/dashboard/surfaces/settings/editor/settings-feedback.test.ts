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
describe('mounted frontend reliability contracts', () => {
  it('shows nothing while a save is in flight', async () => {
    const host = await mount(createElement(SettingsSaveFeedback, { save: { state: 'saving' } }));
    assert.equal(host.textContent, '');
  });
  it('shows nothing for a refused save: its model toasts it once, with no button', async () => {
    const host = await mount(createElement(SettingsSaveFeedback, { save: { state: 'refused', message: 'Check the draft values. Nothing was sent.' } }));
    assert.equal(host.textContent, '');
    assert.equal(host.querySelector('button'), null);
  });
  it('retains saved status, distinguishes restart-required and shows nothing for an unconfirmed save', async () => {
    vi.useFakeTimers();
    const host = await mount(createElement(SettingsSaveFeedback, { save: { state: 'applied', replayed: false }, restartRequired: true }));
    await act(async () => vi.advanceTimersByTime(10000));
    assert.match(host.textContent ?? '', /Saved · Restart required/);
    await act(async () => root?.render(createElement(SettingsSaveFeedback, { save: { state: 'unconfirmed', message: 'Response unavailable' } })));
    assert.equal(host.textContent, '', 'its model reads the save back; nothing is shown inline');
    assert.equal(host.querySelector('button'), null);
  });
});
