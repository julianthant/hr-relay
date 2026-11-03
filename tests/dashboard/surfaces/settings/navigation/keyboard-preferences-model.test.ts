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

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
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
it.each(["custom", "malformed"])('never adopts or rewrites origin-wide keyboard preferences: %s', async kind => {
  const raw = kind === "custom" ? JSON.stringify({ ...DEFAULT_SHORTCUT_PREFERENCES, numberMode: "workflows" }) : "not-json";
  window.localStorage.setItem(storageKey, raw); window.localStorage.setItem(currentKey, raw);
  const reads = vi.spyOn(Storage.prototype, "getItem"); const writes = vi.spyOn(Storage.prototype, "setItem");
  assert.deepEqual(await readStoredPreferences(), DEFAULT_SHORTCUT_PREFERENCES);
  assert.equal(reads.mock.calls.length, 0); assert.equal(writes.mock.calls.length, 0);
});
