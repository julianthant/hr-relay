// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ComposerInput } from '../../../../src/dashboard/surfaces/shell/composer-input.js';

let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); });

const servedPreference = { slug: 'gpt-6.1-sol', effort: 'medium' } as const;
async function mount(props: { preview: boolean; connected?: boolean }) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const served = props.preview ? {} : props.connected === false ? {} : { modelPreference: servedPreference, models: [{ slug: 'gpt-6.1-sol' }], onModelChoice() {} };
  await act(async () => root?.render(createElement(ComposerInput, { preview: props.preview, onSend: async () => true, ...served } as Parameters<typeof ComposerInput>[0])));
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
