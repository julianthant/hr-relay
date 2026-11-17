// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
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

let mounted: Root | undefined;
afterEach(async () => { await act(async () => mounted?.unmount()); document.body.replaceChildren(); });

const servedPreference = { slug: 'gpt-6.1-sol', effort: 'medium' } as const;
async function mount(props: { preview: boolean; connected?: boolean }) {
  const host = document.createElement('div'); document.body.append(host); mounted = createRoot(host);
  const served = props.preview ? {} : props.connected === false ? {} : { modelPreference: servedPreference, models: [{ slug: 'gpt-6.1-sol' }], onModelChoice() {} };
  await act(async () => mounted?.render(createElement(ComposerInput, { preview: props.preview, onSend: async () => true, ...served } as Parameters<typeof ComposerInput>[0])));
  return host;
}
const button = (host: HTMLElement, name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`);
async function open(trigger: HTMLButtonElement) {
  await act(async () => { trigger.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); trigger.click(); });
  return document.querySelector<HTMLElement>('[data-menu]');
}

describe('served composer menus', () => {
  it('opens the approval menu with the one choice Ask before every action and no Full access', async () => {
    const host = await mount({ preview: false });
    const trigger = button(host, 'Ask before every action')!;
    expect(trigger.disabled).toBe(false);
    const menu = await open(trigger);
    expect(menu?.getAttribute('data-menu')).toBe('approval');
    expect([...menu!.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent)).toEqual(['Ask before every actionConfirm each proposed change.']);
    expect(menu!.textContent).not.toContain('Full access');
  });
  it('has no Voice button by role or name', async () => {
    const host = await mount({ preview: false });
    expect(host.querySelector('#hub-voice-trigger')).toBeNull();
    expect([...host.querySelectorAll('button')].some(item => /voice/i.test(item.getAttribute('aria-label') ?? item.textContent ?? ''))).toBe(false);
  });
  it('opens the Add files menu without a heading', async () => {
    const host = await mount({ preview: false });
    const menu = await open(button(host, 'Add files')!);
    expect(menu?.getAttribute('data-menu')).toBe('attach');
    expect(menu!.textContent).not.toContain('Add to this chat');
    expect(menu!.textContent).toContain('Attach file');
  });
  it('keeps every menu button off but Add files when ChatGPT is not connected', async () => {
    const host = await mount({ preview: false, connected: false });
    expect(button(host, 'Ask before every action')!.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('#hub-model-trigger')!.disabled).toBe(true);
    expect(button(host, 'Add files')!.disabled).toBe(false);
  });
});

describe('mock composer menus', () => {
  it('keeps the Voice menu and the Add to this chat heading', async () => {
    const host = await mount({ preview: true });
    expect(button(host, 'Voice input')).not.toBeNull();
    const menu = await open(button(host, 'Add files')!);
    expect(menu!.textContent).toContain('Add to this chat');
  });
});
