// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MOCK_SURFACES_FLAG } from '../../../../src/dashboard/app/mock-surfaces.js';
import { ComposerInput } from '../../../../src/dashboard/surfaces/shell/composer-input.js';

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
