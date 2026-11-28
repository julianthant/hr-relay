// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PersonPreferencesContext } from '../../../../src/dashboard/lib/person-preferences.js';
import { createPersonPreferences } from '../../../../src/dashboard/state/person-preferences-model.js';
import { ComposerInput } from '../../../../src/dashboard/surfaces/shell/composer-input.js';
import { NEUTRAL_PERSON_PREFERENCES } from '../../../../src/models/config/person-preferences.js';
import { CommandExecutor, type CommandExecutionScope, type CommandOutcome } from '../../../../src/dashboard/app/commands/command-executor.js';
import { createAssistantController } from '../../../../src/dashboard/surfaces/assistant/assistant-controller-model.js';
import { publishAssistantModelChoice } from '../../../../src/dashboard/surfaces/shell/assistant-approval-model.js';
import { AssistantModelPreferenceViewSchema, type AssistantApprovalMode, type AssistantM1RespondEnvelope } from '../../../../src/models/dashboard/assistant.js';
import { AssistantModelPreferenceCommandRequestSchema, CommandResultSchema, type CommandResult } from '../../../../src/rules/commands/commands.js';
import { LOCAL_OPERATOR_ACTOR_ID } from '../../../../src/rules/identity/ids.js';

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
afterEach(async () => { await act(async () => { mounted?.unmount(); publishAssistantModelChoice(undefined); }); document.body.replaceChildren(); });

const servedPreference = { slug: 'gpt-6.1-sol', effort: 'medium' } as const;
async function mount(props: { preview: boolean; connected?: boolean; initialText?: string; onSend?: Parameters<typeof ComposerInput>[0]['onSend']; preferences?: ReturnType<typeof createPersonPreferences> }) {
  const host = document.createElement('div'); document.body.append(host); mounted = createRoot(host);
  const served = props.preview ? {} : props.connected === false ? {} : { modelPreference: servedPreference };
  await act(async () => mounted?.render(createElement(PersonPreferencesContext.Provider, { value: props.preferences }, createElement(ComposerInput, {
    preview: props.preview, initialText: props.initialText, onSend: props.onSend ?? (async () => true), ...served
  }))));
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
  it('sends the selected approval mode and returns to Ask when Full access is turned off', async () => {
    const sent: AssistantApprovalMode[] = [];
    const preferences = createPersonPreferences('preview', { ...NEUTRAL_PERSON_PREFERENCES, assistantFullAccess: true });
    const setFullAccess = (enabled: boolean) => act(async () => { await preferences.change({ 'preferences.assistantFullAccess': { set: enabled } }); });
    const host = await mount({ preview: false, preferences, initialText: 'Start a dry run', onSend: value => { sent.push(value.approvalMode); return Promise.resolve(false); } });
    const send = () => act(async () => {
      host.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    await send();
    const menu = await open(button(host, 'Ask before every action')!);
    const fullAccess = [...menu!.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent?.startsWith('Full access'));
    expect(fullAccess).toBeDefined();
    await act(async () => { fullAccess!.click(); });
    expect(button(host, 'Full access')?.classList.contains('hub-full-access')).toBe(true);
    await send();
    await setFullAccess(false);
    expect(button(host, 'Ask before every action')).not.toBeNull();
    await send();
    await setFullAccess(true);
    expect(button(host, 'Ask before every action')).not.toBeNull();
    expect(sent).toEqual(['ask', 'full-access', 'ask']);
  });
  it('shows the served model and effort as plain text while no model choices are served', async () => {
    const host = await mount({ preview: false });
    const text = host.querySelector<HTMLElement>('#hub-model-text')!;
    expect(text.textContent).toBe('GPT-6.1 Sol · Medium');
    expect(text.closest('button')).toBeNull();
    expect(host.querySelector('#hub-model-trigger')).toBeNull();
  });
  it('names the approval mode beside its glyph and the composer placeholder without an ellipsis', async () => {
    const host = await mount({ preview: false });
    expect(button(host, 'Ask before every action')!.textContent).toBe('Ask before every action');
    expect(host.querySelector('textarea')!.getAttribute('placeholder')).toBe('Ask Relay');
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
    expect(host.querySelector('#hub-model-text')!.textContent).toBe('Model unavailable');
    expect(button(host, 'Add files')!.disabled).toBe(false);
  });
});

/** A server holding one preference: the composer is mounted from what it serves and saves through the real controller and executor. */
function preferenceServer() {
  let view = AssistantModelPreferenceViewSchema.parse({ profileId: crypto.randomUUID(), epoch: 1, revision: 0, preference: servedPreference });
  const feedback: CommandOutcome[] = [];
  const held = { gate: undefined as Promise<void> | undefined, refuse: false, unreadable: false };
  const client = {
    async assistantRespond(): Promise<AssistantM1RespondEnvelope> { throw new Error('a pick sends no chat turn'); },
    async assistantModelPreference() { if (held.unreadable) throw new TypeError('Failed to fetch'); return view; },
    async executeCommand(input: unknown): Promise<CommandResult> {
      const command = AssistantModelPreferenceCommandRequestSchema.parse(input);
      await held.gate;
      if (held.refuse) return CommandResultSchema.parse({ state: 'rejected', commandId: command.commandId, code: 'capability-unavailable', message: 'assistant-preference-unavailable' });
      view = AssistantModelPreferenceViewSchema.parse({ ...view, revision: command.target.expectedRevision + 1, preference: command.payload });
      return CommandResultSchema.parse({ state: 'applied', commandId: command.commandId,
        affectedTargets: [{ family: 'assistant-model-preference', profileId: command.target.profileId, revision: view.revision }] });
    },
    async executeBulkCommand(): Promise<never> { throw new Error('unexpected-bulk'); },
  };
  /** One page load: read the preference, then show the composer on it. */
  async function load() {
    await act(async () => mounted?.unmount());
    document.body.replaceChildren();
    const host = document.createElement('div'); document.body.append(host); mounted = createRoot(host);
    const scope: CommandExecutionScope = { actorId: LOCAL_OPERATOR_ACTOR_ID, client, authority: {}, dayRequest: {} };
    const commands = { executor: new CommandExecutor(() => scope), scope, feedback: (value: CommandOutcome) => { feedback.push(value); } };
    const render = (preference: typeof view.preference) => mounted!.render(createElement(ComposerInput, { preview: false, onSend: async () => true, modelPreference: preference }));
    const controller = createAssistantController(client, { authority: 'selected', commands, preferenceChanged: next => render(next.preference) });
    await act(async () => {
      publishAssistantModelChoice({ preference: view.preference, models: [{ slug: 'gpt-6.1-sol' }, { slug: 'gpt-6.1-terra' }], choose: next => controller.choose(next) });
      render(view.preference);
    });
    return host;
  }
  return { load, feedback, held, get preference() { return view.preference; } };
}
const trigger = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('#hub-model-trigger')!;
async function choose(host: HTMLElement, label: string) {
  if (trigger(host).getAttribute('aria-expanded') !== 'true') await open(trigger(host));
  const item = [...document.querySelectorAll<HTMLElement>('[data-menu="model"] [role="menuitemradio"]')].find(row => row.textContent === label)!;
  await act(async () => { item.click(); });
}

describe('composer model menu', () => {
  it('lists the served models and efforts, saves both picks and shows them after a reload', async () => {
    const server = preferenceServer();
    let host = await server.load();
    expect(trigger(host).getAttribute('aria-label')).toBe('Model: GPT-6.1 Sol, Medium effort');
    const menu = await open(trigger(host));
    expect([...menu!.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent)).toEqual(['GPT-6.1 Sol', 'GPT-6.1 Terra', 'Light', 'Medium', 'High', 'xHigh', 'Max']);

    await choose(host, 'GPT-6.1 Terra');
    await vi.waitFor(() => expect(server.feedback).toHaveLength(1));
    await choose(host, 'High');
    await vi.waitFor(() => expect(server.feedback).toHaveLength(2));
    expect(server.preference).toEqual({ slug: 'gpt-6.1-terra', effort: 'high' });

    host = await server.load();
    expect(trigger(host).textContent).toBe('GPT-6.1 TerraHigh');
  });

  it('shows a pick at once and goes back when the save is refused', async () => {
    const server = preferenceServer(), gate = Promise.withResolvers<void>();
    server.held.gate = gate.promise; server.held.refuse = true;
    const host = await server.load();

    await choose(host, 'Max');
    expect(trigger(host).textContent).toBe('GPT-6.1 SolMax');

    await act(async () => { gate.resolve(); });
    await vi.waitFor(() => expect(trigger(host).textContent).toBe('GPT-6.1 SolMedium'));
    expect(server.feedback.map(outcome => outcome.kind)).toEqual(['refused']);
    expect(server.preference).toEqual(servedPreference);
  });

  it('goes back and reports the failure when the preference cannot be read before saving', async () => {
    const server = preferenceServer();
    const host = await server.load();
    server.held.unreadable = true;

    await choose(host, 'Max');

    await vi.waitFor(() => expect(server.feedback.map(outcome => outcome.kind)).toEqual(['failed']));
    expect(trigger(host).textContent).toBe('GPT-6.1 SolMedium');
    expect(server.preference).toEqual(servedPreference);
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
