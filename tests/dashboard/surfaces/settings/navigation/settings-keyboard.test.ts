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
    expect(trigger()?.dataset.value).toBe('enter');
    await act(async () => trigger()!.click());
    expect([...document.querySelectorAll<HTMLElement>('[role="option"]')].map(option => [option.dataset.value, option.textContent])).toEqual([['enter', 'Enter'], ['mod-enter', '⌘Enter']]);
    await act(async () => document.querySelector<HTMLElement>('[role="option"][data-value="mod-enter"]')!.click());
    expect(port.snapshot().value.sendShortcut).toBe('mod-enter');
    expect(trigger()?.dataset.value).toBe('mod-enter');
    expect(saved).toEqual(['Saved Send shortcut']);
  } finally { act(() => root.unmount()); host.remove(); }
});

async function mountKeyboard(saved: string[]) {
  const port = createPersonPreferences('preview');
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  await act(async () => root.render(createElement(PersonPreferencesContext.Provider, { value: port },
    createElement(KeyboardSection, { onSaved: notice => { saved.push(notice.title); } }))));
  return { port, host, done: () => { act(() => root.unmount()); host.remove(); } };
}
const byLabel = (host: HTMLElement, label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

it('Reset all to defaults restores every shortcut and says so', async () => {
  const saved: string[] = [];
  const { port, host, done } = await mountKeyboard(saved);
  try {
    await act(async () => byLabel(host, 'Remove Search runs shortcut 1').click());
    expect(port.snapshot().value.shortcuts.bindings.search).toEqual([]);
    await act(async () => [...host.querySelectorAll('button')].find(button => button.textContent === 'Reset all to defaults')!.click());
    expect(port.snapshot().value.shortcuts.bindings.search).toEqual(['/']);
    expect(saved.at(-1)).toBe('Shortcuts reset to defaults');
  } finally { done(); }
});

it('shows a duplicate shortcut as one plain sentence', async () => {
  const { host, done } = await mountKeyboard([]);
  try {
    await act(async () => byLabel(host, 'Edit Search runs shortcut 1').click());
    const keys = document.querySelector<HTMLInputElement>('input[name="shortcutKeys"]')!;
    await act(async () => { keys.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true })); });
    await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === 'Save')!.click());
    const text = document.querySelector('[role="dialog"]')?.textContent ?? '';
    expect(text).toContain('This shortcut is already assigned to another action.');
    expect(text).not.toContain('{');
  } finally { done(); }
});
