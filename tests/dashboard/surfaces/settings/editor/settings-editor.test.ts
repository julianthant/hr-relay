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
describe('confirmed Settings feedback through the current editor', () => {
  for (const family of ["ordinary", "protected"] as const) it(`uses the catalog refusal when ${family} envelope composition fails before dispatch`, async () => {
    const h = await setup();
    const control = () => family === "ordinary" ? h.controller() : h.controller().protectedEditor;
    await act(async () => {
      if (family === "ordinary") h.controller().update("actor.label", "Synthetic operator");
      else h.controller().protectedEditor.update("ucpathUserId", "Synthetic operator");
    });
    const uuid = vi.spyOn(crypto, "randomUUID").mockReturnValue("invalid-envelope" as ReturnType<typeof crypto.randomUUID>);
    try { await act(async () => control().submit()); } finally { uuid.mockRestore(); }
    const save = control().save; assert.equal(save.state, "refused");
    if (save.state !== "refused") throw new Error("expected refusal");
    const code = family === "ordinary" ? "SETTINGS_DRAFT_INVALID" : "PROTECTED_SETTINGS_DRAFT_INVALID";
    assert.equal(save.code, code);
    assert.equal(save.message, formatErrorCatalogFailure(createErrorCatalogFailure(code, {})).text);
    assert.equal(h.commands.length, 0); assert.equal(control().dirtyCount, 1);
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
    assert.deepEqual(notices, [{ title: 'Saved Operator label' }]);
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
    assert.equal(commands.length, 1); assert.deepEqual(notices, [{ title: 'Saved Task' }]);
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
  it('does not flush credentials between controls in one field, then saves on leaving it', async () => {
    const { controller, host, commands, notices, render } = await setup();
    await render('credentials');
    const input = inputNamed(host, 'ucpathUserId');
    await act(async () => input.focus());
    await act(async () => controller().protectedEditor.update('ucpathUserId', 'private-blur-sentinel'));
    const remove = host.querySelector<HTMLButtonElement>('button[aria-label="Remove UCPath username"]');
    assert(remove);
    await act(async () => remove.focus());
    assert.equal(commands.length, 0); assert.deepEqual(notices, []);
    await act(async () => input.focus());
    await act(async () => input.blur());
    assert.equal(commands.length, 1); assert.deepEqual(notices, [{ title: 'Saved UCPath username' }]);
    assert.doesNotMatch(JSON.stringify(notices), /private-blur-sentinel/);
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    assert.equal(commands.length, 1); assert.equal(notices.length, 1);
  });
  it('notifies a refused save once without exposing the draft or raw server message', async () => {
    const { controller, commands, notices, problems, ports, render } = await setup();
    ports.response = () => new Response(JSON.stringify({ state: 'error', code: 'OPERATOR_MUTATION_ORIGIN_REFUSED', message: 'raw-server-sentinel', retryable: false }), { status: 403 });
    await act(async () => controller().update('actor.label', 'private-draft-sentinel'));
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.equal(controller().save.state, 'refused');
    assert.equal(commands.length, 1); assert.deepEqual(notices, []);
    assert.deepEqual(problems, [{ tone: 'danger', title: "Settings weren't saved", description: 'Your draft is retained. Review the save details before retrying.' }]);
    assert.doesNotMatch(JSON.stringify(problems), /private-draft-sentinel|raw-server-sentinel/);
    await render('performance');
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    assert.equal(problems.length, 1); assert.equal(commands.length, 1);
  });
  it('retains Saved after confirmed active readback, time and section navigation', async () => {
    const { controller, host, render, commands, notices } = await setup();
    await act(async () => controller().update('display.screenWidth', '1980'));
    assert.doesNotMatch(host.textContent ?? '', /Unsaved changes/);
    assert.equal(controller().dirtyCount, 2);
    assert.deepEqual(notices, []);
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.equal(commands.length, 1);
    assert.deepEqual(notices, [{ title: 'Saved settings' }]);
    assert.equal(controller().save.state, 'applied');
    assert.equal(controller().dirtyCount, 0);
    assert.match(host.textContent ?? '', /Saved/);
    assert.doesNotMatch(host.textContent ?? '', /Restart required/);
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    await render('performance');
    assert.match(host.textContent ?? '', /Saved/);
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
    assert.equal(controller().save.state, 'applied');
    assert.match(host.textContent ?? '', /Saved · Restart required/);
    assert.deepEqual(notices, [{ title: 'Saved settings', description: 'Restart required to use these changes.' }]);
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    assert.match(host.textContent ?? '', /Saved · Restart required/);
  });
  it('retains uncertain drafts and retries the same command before reporting Saved', async () => {
    const { controller, host, ports, commands, notices, problems } = await setup();
    ports.execute = () => { throw new Error('synthetic-response-lost'); };
    await act(async () => controller().update('display.screenWidth', '1980'));
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.equal(controller().save.state, 'unconfirmed');
    assert(controller().locked); assert(controller().dirtyCount > 0);
    assert.match(host.textContent ?? '', /Retry exact attempt/);
    assert.doesNotMatch(host.textContent ?? '', /Saved · Restart required/);
    await act(async () => controller().retry());
    assert.equal(commands.length, 2); assert.deepEqual(commands[1], commands[0]);
    assert.equal(controller().save.state, 'unconfirmed');
    assert.deepEqual(notices, []);
    assert.equal(problems.length, 2);
    assert(problems.every(problem => problem.tone === 'warning' && problem.title === 'Settings save unconfirmed'));
  });
  it('names a confirmed typed field without repeating its value or notifying on refresh', async () => {
    const { controller, notices, render } = await setup();
    const label = 'Operator label';
    await act(async () => controller().update('actor.label', 'Private operator sentinel'));
    assert.deepEqual(notices, []);
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.deepEqual(notices, [{ title: `Saved ${label}` }]);
    assert.doesNotMatch(JSON.stringify(notices), /Private operator sentinel/);
    await act(async () => controller().reload());
    await render('routes');
    assert.equal(notices.length, 1);
  });
  it('notifies once after a lost acknowledgement resolves through the exact replay', async () => {
    const { controller, ports, authority, notices, commands } = await setup();
    let loseResponse = true;
    ports.execute = request => {
      const result = authority.execute(request);
      if (loseResponse) { loseResponse = false; throw new Error('synthetic-response-lost'); }
      return result;
    };
    const label = 'Operator label';
    await act(async () => controller().update('actor.label', 'Retry sentinel'));
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.equal(controller().save.state, 'unconfirmed');
    assert.deepEqual(notices, []);
    await act(async () => controller().retry());
    assert.deepEqual(commands[1], commands[0]);
    assert.deepEqual(controller().save, { state: 'applied', replayed: true });
    assert.deepEqual(notices, [{ title: `Already saved ${label}` }]);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    assert.equal(notices.length, 1);
  });
  it('withholds success when the acknowledgement and field readback disagree', async () => {
    const { controller, ports, authority, notices } = await setup();
    ports.read = () => {
      const document = authority.read();
      return { ...document, sections: document.sections.map(section => ({ ...section,
        leaves: section.leaves.map(leaf => leaf.path === 'actor.label' ? { ...leaf, settingsValue: 'Other operator', effectiveValue: 'Other operator' } : leaf) })) };
    };
    await act(async () => controller().update('actor.label', 'Intended operator'));
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.equal(controller().save.state, 'unconfirmed');
    assert(controller().locked); assert.equal(controller().dirtyCount, 1);
    assert.deepEqual(notices, []);
  });
  it('confirms a protected typed field without disclosing its value', async () => {
    const { controller, notices, commands, render } = await setup();
    const state = controller().editor;
    if (state.state !== 'loaded' || state.document.protectedSettings.state !== 'available') throw new Error('protected-fixture-unavailable');
    const label = state.document.protectedSettings.rows.find(row => row.name === 'ucpathPassword')!.label;
    await act(async () => controller().protectedEditor.update('ucpathPassword', ''));
    await act(async () => vi.advanceTimersByTimeAsync(1201));
    assert.deepEqual(notices, []); assert.equal(commands.length, 0);
    await act(async () => controller().protectedEditor.update('ucpathPassword', 'secret-toast-sentinel'));
    assert.deepEqual(notices, []);
    await act(async () => vi.advanceTimersByTimeAsync(1201));
    assert.equal(controller().protectedEditor.save.state, 'applied');
    assert.deepEqual(notices, [{ title: `Saved ${label}` }]);
    assert.doesNotMatch(JSON.stringify(notices), /secret-toast-sentinel/);
    await render('credentials');
    assert.equal(notices.length, 1);
    await act(async () => controller().protectedEditor.update('ucpathUserId', 'private-username-sentinel'));
    await act(async () => vi.advanceTimersByTimeAsync(1201));
    assert.deepEqual(notices[1], { title: 'Saved UCPath username' });
    assert.doesNotMatch(JSON.stringify(notices), /private-username-sentinel/);
  });
  it('withholds a protected toast on conflict and readback failure', async () => {
    const { controller, authority, ports, notices, problems } = await setup();
    await act(async () => controller().protectedEditor.update('ucpathPassword', 'secret-toast-sentinel'));
    assert.equal(authority.protectedApply({ timekeeperName: { set: 'Other operator' } }).state, 'applied');
    await act(async () => controller().protectedEditor.submit());
    assert.equal(controller().protectedEditor.save.state, 'conflict');
    assert.deepEqual(notices, []);
    assert.equal(problems[0]?.title, 'Credentials changed');
    ports.read = () => { throw new Error('synthetic-readback-unavailable'); };
    await act(async () => controller().protectedEditor.submit());
    assert.equal(controller().protectedEditor.save.state, 'unconfirmed');
    assert.deepEqual(notices, []);
    assert.equal(problems[1]?.title, 'Credentials save unconfirmed');
  });

});
