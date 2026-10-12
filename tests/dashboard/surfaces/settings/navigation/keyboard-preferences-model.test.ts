import assert from 'node:assert/strict';
import { describe,it } from 'vitest';
import { DEFAULT_SHORTCUT_PREFERENCES,shortcutActionForEvent,shortcutChord,validateShortcutPreferences } from '../../../../../src/dashboard/surfaces/settings/navigation/keyboard-preferences-model.js';

describe('Relay presentation models', () => {
  it('uses customized bindings and rejects collisions and reserved number shortcuts', () => {
    const preferences = validateShortcutPreferences({ ...DEFAULT_SHORTCUT_PREFERENCES, bindings: { ...DEFAULT_SHORTCUT_PREFERENCES.bindings, start: ['Meta+Shift+r'] } });
    const event = { key: 'R', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true };
    assert.deepEqual(validateShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, menu: ['m'] } }), preferences);
    assert.equal(shortcutChord(event), 'Meta+Shift+r');
    assert.equal(shortcutActionForEvent(event, preferences), 'start');
    assert.equal(shortcutActionForEvent({ ...event, metaKey: false, shiftKey: false, key: 'r' }, preferences), undefined);
    assert.throws(() => validateShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, attention: ['j'] } }), /already assigned/);
    assert.throws(() => validateShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, attention: ['Meta+1'] } }), /reserved/);
    assert.throws(() => validateShortcutPreferences({ ...preferences, bindings: { ...preferences.bindings, attention: ['Escape'] } }), /reserved/);
  });
});
