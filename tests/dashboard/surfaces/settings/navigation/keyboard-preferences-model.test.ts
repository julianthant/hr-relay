// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { afterEach,describe,it,vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { ZodError } from 'zod';
import { DEFAULT_SHORTCUT_PREFERENCES,shortcutActionForEvent,shortcutChord,validateShortcutPreferences } from '../../../../../src/dashboard/surfaces/settings/navigation/keyboard-preferences-model.js';

describe('Relay presentation models', () => {
  it('uses customized bindings and rejects collisions and reserved number shortcuts', () => {
    const preferences = validateShortcutPreferences({ ...DEFAULT_SHORTCUT_PREFERENCES, bindings: { ...DEFAULT_SHORTCUT_PREFERENCES.bindings, start: ['Meta+Shift+r'] } });
    const event = { key: 'R', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true };
    assert.deepEqual(validateShortcutPreferences(preferences), preferences);
    assert.equal(shortcutChord(event), 'Meta+Shift+r');
    assert.equal(shortcutActionForEvent(event, preferences), 'start');
    assert.equal(shortcutActionForEvent({ ...event, metaKey: false, shiftKey: false, key: 'r' }, preferences), undefined);
    assert.throws(() => validateShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, attention: ['j'] } }), /already assigned/);
    assert.throws(() => validateShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, attention: ['Meta+1'] } }), /reserved/);
    assert.throws(() => validateShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, attention: ['Escape'] } }), /reserved/);
  });
  it('rejects retired menu bindings instead of silently stripping them', () => {
    assert.throws(() => validateShortcutPreferences({ ...DEFAULT_SHORTCUT_PREFERENCES, bindings: { ...DEFAULT_SHORTCUT_PREFERENCES.bindings, menu: ['m'] } }), error => {
      assert.ok(error instanceof ZodError);
      assert.deepEqual(error.issues, [{ code: 'unrecognized_keys', keys: ['menu'], path: ['bindings'], message: 'Unrecognized key: "menu"' }]);
      return true;
    });
  });
});

const storageKey = 'hr-gpt-shortcuts-v1';
const currentKey = 'hr-gpt-shortcuts-v2';
afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });
async function readStoredPreferences() {
  vi.resetModules();
  const model = await import('../../../../../src/dashboard/surfaces/settings/navigation/keyboard-preferences-model.js');
  const container = document.createElement('div');
  const root = createRoot(container);
  function Reader() { return createElement('output', null, JSON.stringify(model.useShortcutPreferences())); }
  try { await act(async () => root.render(createElement(Reader))); return JSON.parse(container.textContent ?? '') as unknown; }
  finally { await act(async () => root.unmount()); }
}
it.each([true, false])('converts stored shortcuts once and preserves custom bindings (menu: %s)', async menu => {
  const preferences = { numberMode: 'workflows', bindings: { ...DEFAULT_SHORTCUT_PREFERENCES.bindings, start: ['Meta+Shift+r'], search: ['s'] } };
  window.localStorage.setItem(storageKey, JSON.stringify({ ...preferences, bindings: { ...preferences.bindings, ...(menu ? { menu: ['m'] } : {}) } }));
  window.localStorage.setItem('unrelated', 'keep');
  assert.deepEqual(await readStoredPreferences(), preferences);
  assert.equal(window.localStorage.getItem(storageKey), null);
  assert.deepEqual(JSON.parse(window.localStorage.getItem(currentKey) ?? ''), preferences);
  assert.equal(window.localStorage.getItem('unrelated'), 'keep');
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  assert.deepEqual(await readStoredPreferences(), preferences);
  assert.equal(writes.mock.calls.length, 0);
});
it.each(['unknown', 'malformed'])('refuses %s stored bindings without rewriting their source', async kind => {
  const bindings = { ...DEFAULT_SHORTCUT_PREFERENCES.bindings, menu: ['m'], ...(kind === 'unknown' ? { other: ['o'] } : { start: [12] }) };
  const raw = JSON.stringify({ ...DEFAULT_SHORTCUT_PREFERENCES, bindings });
  window.localStorage.setItem(storageKey, raw);
  await assert.rejects(readStoredPreferences(), ZodError);
  assert.equal(window.localStorage.getItem(storageKey), raw);
  assert.equal(window.localStorage.getItem(currentKey), null);
});
it('uses strict current storage authority even when a valid retired value remains', async () => {
  const old = JSON.stringify(DEFAULT_SHORTCUT_PREFERENCES);
  const current = JSON.stringify({ ...DEFAULT_SHORTCUT_PREFERENCES, bindings: { ...DEFAULT_SHORTCUT_PREFERENCES.bindings, menu: ['m'] } });
  window.localStorage.setItem(storageKey, old); window.localStorage.setItem(currentKey, current);
  await assert.rejects(readStoredPreferences(), ZodError);
  assert.equal(window.localStorage.getItem(storageKey), old); assert.equal(window.localStorage.getItem(currentKey), current);
});
it('retains the old source when storing its converted value fails', async () => {
  const raw = JSON.stringify({ ...DEFAULT_SHORTCUT_PREFERENCES, bindings: { ...DEFAULT_SHORTCUT_PREFERENCES.bindings, menu: ['m'] } });
  window.localStorage.setItem(storageKey, raw);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage write refused'); });
  await assert.rejects(readStoredPreferences(), /storage write refused/);
  assert.equal(window.localStorage.getItem(storageKey), raw); assert.equal(window.localStorage.getItem(currentKey), null);
});
