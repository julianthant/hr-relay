// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act } from 'react';
import { formatErrorCatalogFailure, createErrorCatalogFailure } from '../../../../../src/models/failures/error-catalog.js';
import { afterEach,describe,it,vi } from 'vitest';
import { mountSettingsHarness,syntheticSettingsAuthority } from '../../../../support/helpers/dashboard/settings-harness.js';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); for (const close of cleanups.splice(0).reverse()) await close(); });
async function setup() {
  const authority = await syntheticSettingsAuthority(); cleanups.push(authority.close);
  const mounted = await mountSettingsHarness(authority); cleanups.push(mounted.close);
  vi.useFakeTimers();
  return { ...mounted, authority };
}
function inputNamed(host: HTMLElement, name: string): HTMLInputElement {
  const input = [...host.querySelectorAll("input")].find(candidate => candidate.name === name);
  assert(input, `Missing ${name} input`);
  return input;
}
const FAILURE = { tone: 'danger', title: "Settings weren't saved", description: 'The previous value is back.', key: 'settings-save' } as const;
describe('confirmed Settings feedback through the current editor', () => {
  it("toasts a failure and reverts when the ordinary envelope cannot be composed before dispatch", async () => {
    const h = await setup();
    await act(async () => h.controller().update("actor.label", "Synthetic operator"));
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("invalid-envelope" as ReturnType<typeof crypto.randomUUID>);
    try { await act(async () => h.controller().submit()); } finally { uuid.mockRestore(); }
    assert.deepEqual(h.problems, [FAILURE]); assert.equal(h.commands.length, 0); assert.equal(h.controller().dirtyCount, 0);
  });
  it("uses the catalog refusal when protected envelope composition fails before dispatch", async () => {
    const h = await setup();
    await act(async () => h.controller().protectedEditor.update("ucpathUserId", "Synthetic operator"));
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("invalid-envelope" as ReturnType<typeof crypto.randomUUID>);
    try { await act(async () => h.controller().protectedEditor.submit()); } finally { uuid.mockRestore(); }
    const save = h.controller().protectedEditor.save; assert.equal(save.state, "refused");
    if (save.state !== "refused") throw new Error("expected refusal");
    assert.equal(save.code, "PROTECTED_SETTINGS_DRAFT_INVALID");
    assert.equal(save.message, formatErrorCatalogFailure(createErrorCatalogFailure("PROTECTED_SETTINGS_DRAFT_INVALID", {})).text);
    assert.equal(h.commands.length, 0); assert.equal(h.controller().protectedEditor.dirtyCount, 1);
  });
  it('waits until ordinary typing stops and saves the final value once', async () => {
    const { controller, commands, notices } = await setup();
    await act(async () => controller().update('actor.label', 'First'));
    await act(async () => vi.advanceTimersByTimeAsync(600));
    await act(async () => controller().update('actor.label', 'Final'));
    await act(async () => vi.advanceTimersByTimeAsync(699));
    assert.equal(commands.length, 0); assert.deepEqual(notices, []);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    assert.equal(commands.length, 1);
    assert.deepEqual(notices, [{ key: 'settings-save', title: 'Saved Operator label' }]);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    assert.equal(commands.length, 1); assert.equal(notices.length, 1);
  });
  it('flushes a valid ordinary edit on focus loss without waiting or saving it twice', async () => {
    const { controller, host, commands, notices, render } = await setup();
    await render('performance');
    const input = inputNamed(host, 'timeouts.taskMs');
    await act(async () => input.focus());
    await act(async () => controller().update('timeouts.taskMs', '210'));
    assert.equal(commands.length, 0); assert.deepEqual(notices, []);
    await act(async () => input.blur());
    assert.equal(commands.length, 1); assert.deepEqual(notices, [{ key: 'settings-save', title: 'Saved Task' }]);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    assert.equal(commands.length, 1); assert.equal(notices.length, 1);
  });
  it('keeps invalid edits local when focus leaves the input', async () => {
    const { controller, host, commands, notices, problems, render } = await setup();
    await render('performance');
    const input = inputNamed(host, 'timeouts.taskMs');
    await act(async () => input.focus());
    await act(async () => controller().update('timeouts.taskMs', '0'));
    await act(async () => input.blur());
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    assert.equal(commands.length, 0); assert.deepEqual(notices, []); assert.deepEqual(problems, []);
    assert.equal(controller().dirtyCount, 1);
    assert.match(host.textContent ?? '', /Enter a positive duration/);
    assert.doesNotMatch(host.textContent ?? '', /Unsaved changes/);
  });
  it('keeps a segmented date together until focus leaves the field', async () => {
    const { controller, host, commands, notices } = await setup();
    const field = host.querySelector<HTMLElement>('[data-settings-path^="annualDates."]');
    assert(field);
    const segments = field.querySelectorAll<HTMLElement>('[role="spinbutton"]');
    assert.equal(segments.length, 3);
    await act(async () => segments[0].focus());
    await act(async () => controller().update(field.dataset.settingsPath!, '08/31/2027'));
    await act(async () => segments[1].focus());
    assert.equal(commands.length, 0); assert.deepEqual(notices, []);
    await act(async () => segments[1].blur());
    assert.equal(commands.length, 1); assert.equal(notices.length, 1);
  });
  it('waits until focus leaves the credential field before reporting the login change refusal', async () => {
    const { controller, host, commands, notices, problems, render } = await setup();
    await render('credentials');
    const input = inputNamed(host, 'ucpathUserId');
    await act(async () => input.focus());
    await act(async () => controller().protectedEditor.update('ucpathUserId', 'private-blur-sentinel'));
    const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Remove UCPath username"]');
    assert(remove);
    await act(async () => remove.focus());
    assert.equal(commands.length, 0); assert.deepEqual(notices, []); assert.deepEqual(problems, []);
    await act(async () => input.focus());
    await act(async () => input.blur());
    assert.equal(commands.length, 1); assert.deepEqual(notices, []);
    assert.equal(controller().protectedEditor.save.state, 'refused');
    assert.equal(controller().protectedEditor.dirtyCount, 1);
    assert.deepEqual(problems, [{ tone: 'danger', title: "Credentials weren't saved", description: 'Your draft is retained. Review the save details before retrying.' }]);
    assert.doesNotMatch(JSON.stringify(problems), /private-blur-sentinel/);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    assert.equal(commands.length, 1); assert.equal(problems.length, 1);
  });
  it('notifies a refused save once without exposing the draft or raw server message', async () => {
    const { controller, commands, notices, problems, ports, render } = await setup();
    ports.response = () => new Response(JSON.stringify({ state: 'error', code: 'OPERATOR_MUTATION_ORIGIN_REFUSED', message: 'raw-server-sentinel', retryable: false }), { status: 403 });
    await act(async () => controller().update('actor.label', 'private-draft-sentinel'));
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.equal(commands.length, 1); assert.deepEqual(notices, []); assert.equal(controller().dirtyCount, 0);
    assert.deepEqual(problems, [FAILURE]);
    assert.doesNotMatch(JSON.stringify(problems), /private-draft-sentinel|raw-server-sentinel/);
    await render('performance');
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    assert.equal(problems.length, 1); assert.equal(commands.length, 1);
  });
  it('toasts Saved once after confirmed active readback, time and section navigation', async () => {
    const { controller, host, render, commands, notices } = await setup();
    await act(async () => controller().update('display.screenWidth', '1980'));
    assert.doesNotMatch(host.textContent ?? '', /Unsaved changes/);
    assert.equal(controller().dirtyCount, 2);
    assert.deepEqual(notices, []);
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.equal(commands.length, 1);
    assert.deepEqual(notices, [{ key: 'settings-save', title: 'Saved settings' }]);
    assert.equal(controller().dirtyCount, 0);
    assert.doesNotMatch(host.textContent ?? '', /Saving|Saved|Restart required/);
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    await render('performance');
    const current = controller().editor;
    assert.equal(current.state, 'loaded');
    if (current.state !== 'loaded') throw new Error('settings-not-loaded');
    assert.equal(current.document.runtimeStatus.state, 'current');
    assert.equal(current.document.revision, 2);
    assert.equal(notices.length, 1, 'navigation and elapsed time do not repeat the toast');
  });
  it('shows saved and restart-required when the mock readback retains the prior active revision', async () => {
    const { controller, host, ports, authority, notices } = await setup();
    const before = authority.read();
    assert.equal(before.runtimeStatus.state, 'current');
    if (before.runtimeStatus.state !== 'current') throw new Error('settings-active-fixture-invalid');
    const active = before.runtimeStatus.identity;
    const oldValues = new Map(before.sections.flatMap(section => section.leaves.map(leaf => [leaf.path, leaf.activeValue])));
    ports.read = () => {
      const saved = authority.read();
      if (saved.runtimeStatus.state !== 'current') throw new Error('settings-saved-fixture-invalid');
      return { ...saved, activeConfigFingerprint: before.activeConfigFingerprint,
        runtimeStatus: { state: 'restart-required', active, persisted: saved.runtimeStatus.identity },
        sections: saved.sections.map(section => ({ ...section, leaves: section.leaves.map(leaf => ({ ...leaf, activeValue: oldValues.get(leaf.path) })) })) };
    };
    await act(async () => controller().update('display.screenWidth', '1980'));
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.deepEqual(notices, [{ key: 'settings-save', title: 'Saved settings', description: 'Restart required to use these changes.' }]);
    assert.match(host.textContent ?? '', /Restart required/);
    assert.doesNotMatch(host.textContent ?? '', /Saved(?! settings apply after Relay restarts)|Saving/, 'no inline saved row');
  });
  it('reverts an unknown outcome with a failure toast and never retries it', async () => {
    const { controller, host, ports, commands, notices, problems } = await setup();
    ports.execute = () => { throw new Error('synthetic-response-lost'); };
    await act(async () => controller().update('display.screenWidth', '1980'));
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.equal(commands.length, 1); assert.equal(controller().dirtyCount, 0); assert.equal(controller().locked, false);
    assert.deepEqual(notices, []); assert.deepEqual(problems, [FAILURE]);
    assert.doesNotMatch(host.textContent ?? '', /Retry|Saving/);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    assert.equal(commands.length, 1);
  });
  it('keeps the last of two quick edits made while the first save is in flight', async () => {
    const { controller, ports, authority, commands, notices } = await setup();
    let release: (() => void) | undefined;
    ports.execute = request => new Promise(resolve => { release = () => resolve(authority.execute(request)); });
    await act(async () => controller().update('actor.label', 'First'));
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.equal(commands.length, 1); assert.equal(controller().locked, false);
    await act(async () => controller().update('actor.label', 'Second'));
    await act(async () => controller().update('actor.label', 'Third'));
    assert.deepEqual(controller().draft['actor.label'], { kind: 'set', raw: 'Third' });
    ports.execute = request => authority.execute(request);
    await act(async () => release?.());
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.equal(commands.length, 2);
    assert.equal(authority.read().sections.flatMap(section => section.leaves).find(leaf => leaf.path === 'actor.label')?.effectiveValue, 'Third');
    assert.equal(notices.length, 2); assert.equal(controller().dirtyCount, 0);
  });
  it('names a confirmed typed field without repeating its value or notifying on refresh', async () => {
    const { controller, notices, render } = await setup();
    const label = 'Operator label';
    await act(async () => controller().update('actor.label', 'Private operator sentinel'));
    assert.deepEqual(notices, []);
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.deepEqual(notices, [{ key: 'settings-save', title: `Saved ${label}` }]);
    assert.doesNotMatch(JSON.stringify(notices), /Private operator sentinel/);
    await act(async () => controller().reload());
    await render('routes');
    assert.equal(notices.length, 1);
  });
  it('withholds success when the acknowledgement and field readback disagree', async () => {
    const { controller, ports, authority, notices, problems } = await setup();
    let reads = 0;
    ports.read = () => {
      reads += 1;
      const document = authority.read();
      return { ...document, sections: document.sections.map(section => ({ ...section,
        leaves: section.leaves.map(leaf => leaf.path === 'actor.label' ? { ...leaf, settingsValue: 'Other operator', effectiveValue: 'Other operator', activeValue: 'Other operator' } : leaf) })) };
    };
    await act(async () => controller().update('actor.label', 'Intended operator'));
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.equal(controller().dirtyCount, 0);
    assert.deepEqual(notices, []); assert.deepEqual(problems, [FAILURE]);
    // The failed save re-reads the backend; the page unlocks only once that fresh read is held.
    for (let flush = 0; flush < 20 && controller().locked; flush++) await act(async () => vi.advanceTimersByTimeAsync(0));
    assert.equal(reads, 2, 'one readback for the save and one fresh read after the failure');
    assert.equal(controller().locked, false);
    const editor = controller().editor;
    assert.equal(editor.state, 'loaded');
    if (editor.state !== 'loaded') throw new Error('expected a loaded editor');
    assert.equal(editor.document.sections.flatMap(section => section.leaves).find(leaf => leaf.path === 'actor.label')?.settingsValue, 'Other operator');
    assert.deepEqual(notices, []);
  });
  it('confirms a protected typed field without disclosing its value', async () => {
    const { controller, notices, commands, render } = await setup();
    const state = controller().editor;
    if (state.state !== 'loaded' || state.document.protectedSettings.state !== 'available') throw new Error('protected-fixture-unavailable');
    const name = 'sharepointOnboardingRosterUrl';
    const label = state.document.protectedSettings.rows.find(row => row.name === name)?.label;
    assert.ok(label);
    await act(async () => controller().protectedEditor.update(name, ''));
    await act(async () => vi.advanceTimersByTimeAsync(1201));
    assert.deepEqual(notices, []); assert.equal(commands.length, 0);
    await act(async () => controller().protectedEditor.update(name, 'https://roster.example.test/secret-toast-sentinel'));
    assert.deepEqual(notices, []);
    await act(async () => vi.advanceTimersByTimeAsync(1201));
    assert.equal(controller().protectedEditor.save.state, 'applied');
    assert.deepEqual(notices, [{ key: 'settings-save', title: `Saved ${label}` }]);
    assert.doesNotMatch(JSON.stringify(notices), /secret-toast-sentinel/);
    await render('credentials');
    assert.equal(notices.length, 1);
    await act(async () => controller().protectedEditor.update(name, 'https://roster.example.test/private-roster-sentinel'));
    await act(async () => vi.advanceTimersByTimeAsync(1201));
    assert.deepEqual(notices[1], { key: 'settings-save', title: `Saved ${label}` });
    assert.doesNotMatch(JSON.stringify(notices), /private-roster-sentinel/);
  });
  it('withholds a protected toast on conflict and ends an unreadable save with one failure toast', async () => {
    const { controller, authority, ports, notices, problems } = await setup();
    await act(async () => controller().protectedEditor.update('sharepointOnboardingRosterUrl', 'https://roster.example.test/local'));
    assert.equal(authority.protectedApply({ sharepointOnboardingRosterUrl: { set: 'https://roster.example.test/other' } }).state, 'applied');
    await act(async () => controller().protectedEditor.submit());
    assert.equal(controller().protectedEditor.save.state, 'conflict');
    assert.deepEqual(notices, []);
    assert.equal(problems[0]?.title, 'Credentials changed');
    ports.read = () => { throw new Error('synthetic-readback-unavailable'); };
    await act(async () => controller().protectedEditor.submit());
    assert.equal(controller().protectedEditor.save.state, 'unconfirmed');
    assert.deepEqual(notices, []);
    assert.equal(problems.length, 1, 'an unconfirmed save is read back, not shown');
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    assert.deepEqual(problems.slice(1).map(problem => problem.title), ["Credentials weren't saved"]);
    assert.equal(controller().protectedEditor.save.state, 'idle');
    assert.equal(controller().protectedEditor.locked, false, 'the control works again without a reload');
  });

});
