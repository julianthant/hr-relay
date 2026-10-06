// @vitest-environment jsdom
import assert from 'node:assert/strict';
import { act } from 'react';
import { afterEach, describe, it, vi } from 'vitest';
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
    const { controller, host, render, commands } = await setup();
    await act(async () => controller().update('display.screenWidth', '1980'));
    assert.match(host.textContent ?? '', /Unsaved changes/);
    await act(async () => vi.advanceTimersByTimeAsync(701));
    assert.equal(commands.length, 1);
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
  });
  it('shows saved and restart-required when the mock readback retains the prior active revision', async () => {
    const { controller, host, ports, authority } = await setup();
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
    await act(async () => vi.advanceTimersByTimeAsync(10000));
    assert.match(host.textContent ?? '', /Saved · Restart required/);
  });
  it('retains uncertain drafts and retries the same command before reporting Saved', async () => {
    const { controller, host, ports, commands } = await setup();
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
  });
});
