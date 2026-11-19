// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { PersonPreferencesContext } from '../../../../../src/dashboard/lib/person-preferences.js';
import { createPersonPreferences } from '../../../../../src/dashboard/state/person-preferences-model.js';
import { KeyboardSection } from '../../../../../src/dashboard/surfaces/settings/navigation/settings-keyboard.js';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

it('shows Send shortcut from the person preference and saves the pick through it', async () => {
  const port = createPersonPreferences('preview');
  const saved: string[] = [];
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(PersonPreferencesContext.Provider, { value: port },
      createElement(KeyboardSection, { onSaved: notice => { saved.push(notice.title); } }))));
    const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-label="Send shortcut"]');
    expect(trigger()?.closest('.ds-result-row')?.textContent).toContain('Choose which keys send a message in the assistant.');
    expect(trigger()?.dataset.value).toBe('enter');
    await act(async () => trigger()!.click());
    expect([...document.querySelectorAll<HTMLElement>('[role="option"]')].map(option => [option.dataset.value, option.textContent])).toEqual([['enter', 'Enter'], ['mod-enter', '⌘Enter']]);
    await act(async () => document.querySelector<HTMLElement>('[role="option"][data-value="mod-enter"]')!.click());
    expect(port.snapshot().value.sendShortcut).toBe('mod-enter');
    expect(trigger()?.dataset.value).toBe('mod-enter');
    expect(saved).toEqual(['Saved Send shortcut']);
  } finally { act(() => root.unmount()); host.remove(); }
});
