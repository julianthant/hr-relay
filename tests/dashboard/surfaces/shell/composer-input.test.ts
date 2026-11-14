// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MOCK_SURFACES_FLAG } from '../../../../src/dashboard/app/mock-surfaces.js';
import { ComposerInput } from '../../../../src/dashboard/surfaces/shell/composer-input.js';
import { PersonPreferencesContext } from '../../../../src/dashboard/lib/person-preferences.js';
import { createPersonPreferences } from '../../../../src/dashboard/state/person-preferences-model.js';
import { NEUTRAL_PERSON_PREFERENCES } from '../../../../src/models/config/person-preferences.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

function render(props: Partial<Parameters<typeof ComposerInput>[0]> = {}) {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(createElement(ComposerInput, { onSend: async () => false, ...props }));
  return host;
}

describe('assistant composer approval control', () => {
  it('lets a served chat open the approval menu, which asks before every action', () => {
    const trigger = render({ preview: false, modelPreference: { slug: 'gpt-6.1-sol', effort: 'medium' } }).querySelector<HTMLButtonElement>('#hub-approval-trigger');
    expect(trigger?.getAttribute('aria-label')).toBe('Ask before every action');
    expect(trigger?.disabled).toBe(false);
  });
  it('never offers Full access, even under the retired mock flag: no settings page turns it on', async () => {
    Reflect.set(window, MOCK_SURFACES_FLAG, true);
    window.history.replaceState(null, '', '/?assistantFullAccess=1');
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(ComposerInput, { onSend: async () => false })));
      await act(async () => host.querySelector<HTMLButtonElement>('#hub-approval-trigger')!.click());
      expect([...document.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent)).toEqual(['Ask before every actionConfirm each proposed change.']);
    } finally {
      act(() => root.unmount());
      Reflect.deleteProperty(window, MOCK_SURFACES_FLAG);
      window.history.replaceState(null, '', '/');
    }
  });
});

describe('assistant composer send shortcut', () => {
  async function press(sendShortcut: 'enter' | 'mod-enter', init: KeyboardEventInit) {
    const sent: string[] = [];
    const port = createPersonPreferences('preview', { ...NEUTRAL_PERSON_PREFERENCES, sendShortcut });
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    try {
      await act(async () => root.render(createElement(PersonPreferencesContext.Provider, { value: port },
        createElement(ComposerInput, { initialText: 'Hello', onSend: async value => { sent.push(value.text); return true; } }))));
      const textarea = host.querySelector('textarea')!;
      const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init });
      await act(async () => { textarea.dispatchEvent(event); });
      return { sent, newLine: !event.defaultPrevented };
    } finally { act(() => root.unmount()); host.remove(); }
  }
  it('sends on Enter and keeps Shift+Enter as a new line by default', async () => {
    expect(await press('enter', {})).toEqual({ sent: ['Hello'], newLine: false });
    expect(await press('enter', { shiftKey: true })).toEqual({ sent: [], newLine: true });
  });
  it('does not send on Ctrl+Enter off macOS while Enter is the chosen key', async () => {
    expect(await press('enter', { ctrlKey: true })).toEqual({ sent: [], newLine: true });
  });
  it('sends on Ctrl+Enter off macOS when the person picked it, and plain Enter is a new line', async () => {
    expect(await press('mod-enter', {})).toEqual({ sent: [], newLine: true });
    expect(await press('mod-enter', { ctrlKey: true })).toEqual({ sent: ['Hello'], newLine: false });
  });
  it('never sends while an IME composition is open', async () => {
    expect(await press('enter', { isComposing: true })).toEqual({ sent: [], newLine: true });
  });
});
