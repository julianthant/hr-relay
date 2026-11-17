// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { PersonPreferencesContext } from '../../../../src/dashboard/lib/person-preferences.js';
import { createPersonPreferences } from '../../../../src/dashboard/state/person-preferences-model.js';
import { ComposerInput } from '../../../../src/dashboard/surfaces/shell/composer-input.js';
import { NEUTRAL_PERSON_PREFERENCES } from '../../../../src/models/config/person-preferences.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

/** Presses one key in a composer holding "Hello" with the caret after "He"; `native` means the textarea keeps its own handling. */
async function press(sendShortcut: 'enter' | 'mod-enter', init: KeyboardEventInit) {
  const sent: string[] = [];
  const port = createPersonPreferences('preview', { ...NEUTRAL_PERSON_PREFERENCES, sendShortcut });
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(PersonPreferencesContext.Provider, { value: port },
      createElement(ComposerInput, { initialText: 'Hello', onSend: async value => { sent.push(value.text); return true; } }))));
    const textarea = host.querySelector('textarea')!;
    textarea.setSelectionRange(2, 2);
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
    await act(async () => { textarea.dispatchEvent(event); });
    return { sent, native: !event.defaultPrevented, text: textarea.value, caret: textarea.selectionStart };
  } finally { act(() => root.unmount()); host.remove(); }
}

describe('assistant composer send shortcut', () => {
  it('with Enter chosen, Enter sends and Shift+Enter keeps the native new line', async () => {
    expect(await press('enter', {})).toMatchObject({ sent: ['Hello'], native: false });
    expect(await press('enter', { shiftKey: true })).toMatchObject({ sent: [], native: true });
  });

  it('with Enter chosen, Command-Enter and Ctrl-Enter add a new line at the caret', async () => {
    expect(await press('enter', { metaKey: true })).toEqual({ sent: [], native: false, text: 'He\nllo', caret: 3 });
    expect(await press('enter', { ctrlKey: true })).toEqual({ sent: [], native: false, text: 'He\nllo', caret: 3 });
  });

  it('with Command-Enter chosen, Command-Enter and Ctrl-Enter send and plain Enter keeps the native new line', async () => {
    expect(await press('mod-enter', { metaKey: true })).toMatchObject({ sent: ['Hello'], native: false });
    expect(await press('mod-enter', { ctrlKey: true })).toMatchObject({ sent: ['Hello'], native: false });
    expect(await press('mod-enter', {})).toMatchObject({ sent: [], native: true, text: 'Hello' });
  });

  it('never sends while an IME composition is open', async () => {
    expect(await press('enter', { isComposing: true })).toMatchObject({ sent: [], native: true });
    expect(await press('mod-enter', { metaKey: true, isComposing: true })).toMatchObject({ sent: [], native: true });
  });
});
