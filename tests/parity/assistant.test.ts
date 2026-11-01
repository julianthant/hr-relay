import { expect } from '@playwright/test';
import { test } from "./helpers/fixtures.js";
import { resolve } from 'node:path';
import type { PreviewServer } from 'vite';
import { previewComponentFixture } from './helpers/component-fixtures.js';
import { attachShellA11y } from './helpers/shell-proof.js';
import { captureParityPair } from './helpers/capture.js';
import { FIXTURE_APP_VERSION, FIXTURE_DESCRIPTOR_HASH, FIXTURE_DAY } from './helpers/fixture-identity.js';

test.use({ viewport: { width: 1440, height: 900 } });

let server: PreviewServer;
let baseUrl: string;
test.beforeAll(async () => {
  server = await previewComponentFixture("assistant");
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('assistant-scene-address-invalid');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done()));
});

for (const scene of ['launcher-closed', 'proposal', 'dry-run', 'waiting', 'confirmed', 'failed', 'unavailable', 'stale', 'empty', 'long', 'empty-light', 'proposal-light']) {
  const evidence = `assistant-${scene}.a11y.yml`;
  test(`assistant ${scene}`, { annotation: [{ type: 'required-a11y-evidence', description: evidence }] }, async ({ page }, info) => {
    const errors: string[] = [], requests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() !== 'GET' || /\/api\/|\/events\b/.test(request.url())) requests.push(request.url()); });
    const theme = scene.endsWith('-light') ? 'light' : 'dark';
    const fixture = scene === 'confirmed' ? 'proposal' : scene.replace('-light', '');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${baseUrl}/?scene=${fixture}&theme=${theme}`);
    const panel = page.getByRole('dialog', { name: 'Relay assistant' });
    if (scene === 'launcher-closed') {
      await expect(panel).toHaveCount(0);
      const launcher = page.getByRole('button', { name: 'Assistant', exact: true });
      const bounds = await launcher.boundingBox();
      expect(bounds?.width).toBe(48); expect(bounds?.height).toBe(48);
      expect(await launcher.evaluate(node => getComputedStyle(node).borderRadius)).toBe('9999px');
    } else {
      await expect(panel).toBeVisible();
      await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();
      if (['proposal', 'dry-run', 'long', 'proposal-light', 'confirmed'].includes(scene)) {
        const details = panel.getByRole('region', { name: 'Proposed run details' });
        await expect(details).toContainText('Avery Sample DEMO-001');
        await expect(details).toContainText('Morgan Example DEMO-002');
        await expect(details).toContainText('UCPath and CRM');
        await details.getByRole('button', { name: 'Effects and stop points' }).click();
        await expect(details).toContainText('Any Save, Submit, or employee-record change.');
        await expect(details).toContainText('Any identity ambiguity; ask the operator to resolve it.');
        await expect(details).toContainText('demo-person-check');
        await details.getByRole('button', { name: 'Effects and stop points' }).click();
        await panel.getByRole('region', { name: 'Conversation' }).evaluate(node => { node.scrollTop = node.scrollHeight; });
        await expect(panel.locator('.assistant-speaker').last()).toBeInViewport({ ratio: 1 });
        await expect(panel.getByRole('button', { name: 'Source: Person Lookup · Read-only checks' }).last()).toBeInViewport();
        await expect(panel.getByText(scene === 'dry-run' ? 'Dry run' : 'Read only', { exact: true })).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
      }
      if (scene === 'confirmed') {
        await panel.getByRole('button', { name: 'Confirm', exact: true }).click();
        await expect(page.getByLabel('Mock callback count')).toHaveText('Mock confirmations: 1');
        await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
        await expect(panel.getByRole('status')).toContainText('No run was started.');
      }
      if (scene === 'long') await expect(panel.locator('.assistant-messages > li')).toHaveCount(21);
      if (scene === 'waiting') { await expect(panel.getByText('Preparing a proposal…')).toBeVisible(); await expect(panel.getByRole('button', { name: 'Stop reply' })).toBeEnabled(); }
      if (scene === 'failed') await expect(panel.getByRole('button', { name: 'Retry reply' })).toBeEnabled();
      if (scene === 'unavailable' || scene === 'stale') await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
      if (scene === 'unavailable') {
        await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
        await expect(panel.getByRole('alert')).toContainText('This mock cannot sign in.');
        await expect(panel.getByRole('button', { name: /sign in|connect/i })).toHaveCount(0);
      }
      if (scene === 'empty' || scene === 'empty-light') await expect(panel.getByText('How can I help you?')).toBeVisible();
    }
    await attachShellA11y(page, info, evidence);
    expect(errors).toEqual([]); expect(requests).toEqual([]);
    await captureParityPair(page, resolve('tests/parity/references'), { stateId: `assistant-${scene}`, theme: 'graphite-warm', viewport: '1440x900', adapter: 'component-fixture', fixtureId: `assistant-${scene}`, descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: 'default' });
  });
}

test('assistant keyboard, cancellation, retry, citations and exact one-time mock confirmation', async ({ page }) => {
  const outbound: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' || /\/api\/|\/events\b/.test(request.url())) outbound.push(request.url()); });
  await page.goto(`${baseUrl}/?open=false`);
  const launcher = page.getByRole('button', { name: 'Assistant', exact: true });
  await launcher.focus(); await page.keyboard.press('Enter');
  const panel = page.getByRole('dialog', { name: 'Relay assistant' });
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(message).toBeFocused();
  await page.keyboard.press('Tab'); await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(message).toBeFocused();
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0); await expect(launcher).toBeFocused();
  await page.keyboard.press('Enter'); await expect(message).toBeFocused();
  const transcript = panel.getByRole('region', { name: 'Conversation' });
  await transcript.getByRole('button', { name: 'Source: Person Lookup · Read-only checks' }).focus();
  await page.keyboard.press('Enter');
  await expect(transcript.getByText('Synthetic public guide · demo-context-7')).toBeVisible();
  const source = transcript.getByRole('link', { name: /example.org/ });
  await expect(source).toHaveAttribute('href', 'https://example.org/relay/person-lookup');
  await expect(source).toHaveAttribute('rel', 'noopener noreferrer');
  await message.fill('Changed request'); await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.getByText('Preparing a proposal…')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await panel.getByRole('button', { name: 'Confirm', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.getByLabel('Mock callback count')).toHaveText('Mock confirmations: 1');
  const recorded = await page.locator('main').getAttribute('data-last-mock-proposal');
  expect(recorded).not.toBeNull();
  expect(JSON.parse(recorded!)).toEqual({
    id: 'demo-plan-3', revision: 'demo-context-7', prompt: 'Changed request',
    workflow: { id: 'demo-person-check', label: 'Person Lookup', version: 'demo-v1' },
    subjects: [{ id: 'DEMO-001', name: 'Avery Sample' }, { id: 'DEMO-002', name: 'Morgan Example' }],
    values: [{ label: 'Systems', value: 'UCPath and CRM' }, { label: 'Match', value: 'Exact synthetic subject IDs' }],
    mode: 'read-only', effects: ['Read identity and employment status for these two subjects.', 'Show the comparison in Queue and Logs.'],
    stopBefore: ['Any Save, Submit, or employee-record change.', 'Any identity ambiguity; ask the operator to resolve it.'],
  });
  await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await expect(panel.getByRole('status')).toContainText('No run was started.');
  await page.keyboard.press('Escape'); await launcher.click();
  await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Mock callback count')).toHaveText('Mock confirmations: 1');

  await page.goto(`${baseUrl}/?scene=waiting`);
  await expect(message).toBeFocused();
  await page.keyboard.press('Escape'); await launcher.click();
  await expect(panel.getByText('Preparing a proposal…')).toBeVisible();
  await panel.getByRole('button', { name: 'Stop reply' }).focus(); await page.keyboard.press('Enter');
  await expect(panel.getByText(/Reply cancelled/)).toBeVisible();
  await expect(message).toBeFocused();
  await expect(message).not.toHaveValue('');
  await expect(page.getByLabel('Mock callback count')).toHaveText('Mock confirmations: 0');

  await page.goto(`${baseUrl}/?scene=failed`);
  await panel.getByRole('button', { name: 'Retry reply' }).focus(); await page.keyboard.press('Enter');
  await expect(message).toBeFocused();
  await panel.getByRole('button', { name: 'Stop reply' }).focus();
  await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await expect(message).toBeFocused();
  await panel.getByRole('button', { name: 'Cancel', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(panel.getByText('Proposal cancelled. No run was started.')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await expect(message).toBeFocused();
  expect(outbound).toEqual([]);
});

test('assistant keeps the reader focus when a reply arrives elsewhere in the panel', async ({ page }) => {
  await page.goto(`${baseUrl}/?scene=proposal`);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const transcript = page.getByRole('region', { name: 'Conversation' });
  await transcript.focus();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await expect(transcript).toBeFocused();
});

for (const width of [1440, 1920, 2560]) {
  for (const theme of ['dark', 'light']) {
    test(`assistant fits ${width} ${theme} with a scrollable long transcript`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : width === 1920 ? 1080 : 1440 });
      await page.goto(`${baseUrl}/?scene=long&theme=${theme}`);
      const panel = page.getByRole('dialog', { name: 'Relay assistant' });
      const bounds = await panel.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
      const transcript = panel.getByRole('region', { name: 'Conversation' });
      expect(await transcript.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
      await transcript.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown');
      await expect(transcript).toBeFocused();
      const details = panel.getByRole('region', { name: 'Proposed run details' });
      await details.getByRole('button', { name: 'Effects and stop points' }).click();
      await details.getByText('Any identity ambiguity; ask the operator to resolve it.').scrollIntoViewIfNeeded();
      await expect(details.getByText('Any identity ambiguity; ask the operator to resolve it.')).toBeInViewport();
      await panel.getByRole('button', { name: 'Confirm', exact: true }).scrollIntoViewIfNeeded();
      await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeInViewport();
    });
  }
}

test('assistant new chat, suggestions, Enter, Shift+Enter and IME preserve the mock contract', async ({ page }) => {
  await page.goto(`${baseUrl}/?scene=empty`);
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  const send = page.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await page.getByRole('button', { name: 'Check a person in Person Lookup (read-only)', exact: true }).click();
  await expect(message).toBeFocused();
  await expect(message).toHaveValue('Check a person in Person Lookup (read-only)');
  await expect(page.getByText('Preparing a proposal…')).toHaveCount(0);
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(message).toBeFocused(); await expect(message).toHaveValue('');
  await message.fill('First line'); await message.press('Shift+Enter'); await message.press('End'); await page.keyboard.type('Second line');
  await expect(message).toHaveValue('First line\nSecond line');
  await message.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true });
  await expect(page.getByText('Preparing a proposal…')).toHaveCount(0);
  await message.press('Enter');
  await expect(page.getByText('Preparing a proposal…')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await expect(page.locator('.assistant-messages > li')).toHaveCount(2);
  await expect(page.getByLabel('Mock callback count')).toHaveText('Mock confirmations: 0');
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await expect(page.getByText('How can I help you?')).toBeVisible(); await expect(send).toBeDisabled();
  await expect(page.locator('.assistant-messages > li')).toHaveCount(0);
});

test('assistant preserves the reading position on reply and jumps to the latest on request', async ({ page }) => {
  await page.goto(`${baseUrl}/?scene=long`);
  const transcript = page.getByRole('region', { name: 'Conversation' });
  const message = page.getByRole('textbox', { name: 'Message', exact: true });
  await message.fill('Another demo question'); await message.press('Enter');
  await transcript.focus(); await transcript.evaluate(node => { node.scrollTop = 0; });
  const latest = page.getByRole('button', { name: 'Jump to latest' });
  await expect(latest).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
  await expect(transcript).toBeFocused();
  expect(await transcript.evaluate(node => node.scrollTop)).toBe(0);
  await latest.click();
  await expect(message).toBeFocused(); await expect(latest).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Confirm', exact: true })).toBeInViewport();
});

test('assistant copies a reply and exposes clipboard refusal without losing focus', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto(`${baseUrl}/?scene=proposal`);
  const copy = page.getByRole('button', { name: 'Copy reply', exact: true }).last();
  await copy.click(); await expect(page.getByText('Copied', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('Here is the exact read-only proposal. Check the subjects and stop points before confirming.');
  await page.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.reject(new Error('denied')) }); });
  await copy.focus(); await page.keyboard.press('Enter');
  await expect(page.getByText('Could not copy. Select the reply text.')).toBeVisible(); await expect(copy).toBeFocused();
  await expect(page.getByLabel('Mock callback count')).toHaveText('Mock confirmations: 0');
});
