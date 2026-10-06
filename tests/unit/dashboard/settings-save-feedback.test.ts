// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act } from 'react';
import { afterEach, describe, it, vi } from 'vitest';
import { settingInput } from '../../../src/dashboard/surfaces/settings/editor/settings-draft-model.js';
import { mountSettingsHarness, syntheticSettingsAuthority } from './helpers/settings-harness.js';

const cleanups: (() => void)[] = [];
afterEach(() => { vi.useRealTimers(); for (const close of cleanups.splice(0).reverse()) close(); });
async function setup() {
  const authority = syntheticSettingsAuthority(); cleanups.push(authority.close);
  const mounted = await mountSettingsHarness(authority); cleanups.push(mounted.close);
  vi.useFakeTimers();
  return { ...mounted, authority };
}
describe('confirmed Settings feedback through the current editor', () => {
  it('retains Saved after confirmed active readback, time and section navigation', async () => {
    const { controller, host, render, commands, notices } = await setup();
    await act(async () => controller().update('display.screenWidth', '1980'));
    assert.match(host.textContent ?? '', /Unsaved changes/);
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
    const { controller, host, ports, commands, notices } = await setup();
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
    const { controller, authority, ports, notices } = await setup();
    await act(async () => controller().protectedEditor.update('ucpathPassword', 'secret-toast-sentinel'));
    assert.equal(authority.protectedApply({ timekeeperName: { set: 'Other operator' } }).state, 'applied');
    await act(async () => controller().protectedEditor.submit());
    assert.equal(controller().protectedEditor.save.state, 'conflict');
    assert.deepEqual(notices, []);
    ports.read = () => { throw new Error('synthetic-readback-unavailable'); };
    await act(async () => controller().protectedEditor.submit());
    assert.equal(controller().protectedEditor.save.state, 'unconfirmed');
    assert.deepEqual(notices, []);
  });

  it('names atomic route saves with their visible system label', async () => {
    const { controller, notices } = await setup();
    const leaf = controller().leaves.find(candidate => candidate.path === 'urls.crm.prod');
    assert(leaf && typeof leaf.effectiveValue === 'object' && !Array.isArray(leaf.effectiveValue));
    const raw = settingInput(leaf); assert.notEqual(typeof raw, 'string');
    if (typeof raw === 'string') throw new Error('route-fixture-invalid');
    await act(async () => controller().update(leaf.path, { ...raw, entry: 'https://crm.example.test/private-route-sentinel' }));
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.equal(controller().save.state, 'applied');
    assert.deepEqual(notices, [{ title: 'Saved CRM routes' }]);
    assert.doesNotMatch(JSON.stringify(notices), /private-route-sentinel/);
  });

});
