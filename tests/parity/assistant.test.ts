import { expect, test } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { build, preview, type PreviewServer } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { attachShellA11y } from './helpers/shell-proof.js';
import { captureParityPair } from './helpers/capture.js';
import { FIXTURE_APP_VERSION, FIXTURE_DESCRIPTOR_HASH, FIXTURE_DAY } from './helpers/fixture-identity.js';

let server: PreviewServer;
let output: string;
let baseUrl: string;
test.beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), 'relay-assistant-'));
  const root = resolve('tests/parity/fixtures/assistant');
  await build({ configFile: false, root, plugins: [react(), tailwindcss()], logLevel: 'warn', build: { outDir: output, emptyOutDir: true } });
  server = await preview({ configFile: false, root, logLevel: 'warn', build: { outDir: output }, preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('assistant-scene-address-invalid');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done()));
  if (output) await rm(output, { recursive: true, force: true });
});

for (const scene of ['proposal', 'dry-run', 'waiting', 'failed', 'unavailable', 'stale', 'empty', 'long']) {
  const evidence = `assistant-${scene}.a11y.yml`;
  test(`assistant ${scene}`, { annotation: [{ type: 'required-a11y-evidence', description: evidence }] }, async ({ page }, info) => {
    const errors: string[] = [], requests: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() !== 'GET' || /\/api\/|\/events\b/.test(request.url())) requests.push(request.url()); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${baseUrl}/?scene=${scene}`);
    const panel = page.getByRole('dialog', { name: 'Relay assistant' });
    await expect(panel).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeFocused();
    if (['proposal', 'dry-run', 'long'].includes(scene)) {
      await expect(panel.getByRole('button', { name: 'Source: Person Lookup · Read-only checks' }).last()).toBeInViewport();
      const details = panel.getByRole('region', { name: 'Proposed run details' });
      await expect(details).toContainText('Avery Sample DEMO-001');
      await expect(details).toContainText('Morgan Example DEMO-002');
      await expect(details).toContainText('UCPath and CRM');
      await expect(details).toContainText('Any Save, Submit, or employee-record change.');
      await expect(details).toContainText('Any identity ambiguity; ask the operator to resolve it.');
      await expect(panel.getByText(scene === 'dry-run' ? 'Dry run' : 'Read only', { exact: true })).toBeVisible();
      await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeEnabled();
    }
    if (scene === 'long') await expect(panel.locator('.assistant-messages > li')).toHaveCount(21);
    if (scene === 'waiting') { await expect(panel.getByText('Preparing a proposal…')).toBeVisible(); await expect(panel.getByRole('button', { name: 'Cancel reply' })).toBeEnabled(); }
    if (scene === 'failed') await expect(panel.getByRole('button', { name: 'Retry reply' })).toBeEnabled();
    if (scene === 'unavailable' || scene === 'stale') await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
    if (scene === 'unavailable') {
      await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeDisabled();
      await expect(panel.getByRole('alert')).toContainText('This mock cannot sign in.');
      await expect(panel.getByRole('button', { name: /sign in|connect/i })).toHaveCount(0);
    }
    if (scene === 'empty') await expect(panel.getByText('What would you like to do?')).toBeVisible();
    await attachShellA11y(page, info, evidence);
    expect(errors).toEqual([]); expect(requests).toEqual([]);
    await captureParityPair(page, resolve('tests/parity/references'), { stateId: `assistant-${scene}`, theme: 'graphite-warm', viewport: '1280x720', adapter: 'component-fixture', fixtureId: `assistant-${scene}`, descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: 'default' });
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
  await panel.getByRole('button', { name: 'Cancel reply' }).focus(); await page.keyboard.press('Enter');
  await expect(panel.getByText(/Reply cancelled/)).toBeVisible();
  await expect(message).toBeFocused();
  await expect(message).not.toHaveValue('');
  await expect(page.getByLabel('Mock callback count')).toHaveText('Mock confirmations: 0');

  await page.goto(`${baseUrl}/?scene=failed`);
  await panel.getByRole('button', { name: 'Retry reply' }).focus(); await page.keyboard.press('Enter');
  await expect(message).toBeFocused();
  await panel.getByRole('button', { name: 'Cancel reply' }).focus();
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

for (const width of [1280, 1920, 2560]) {
  for (const theme of ['dark', 'light']) {
    test(`assistant fits ${width} ${theme} with a scrollable long transcript`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1280 ? 720 : width === 1920 ? 1080 : 1440 });
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
      await details.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await expect(details.getByText('Any identity ambiguity; ask the operator to resolve it.')).toBeInViewport();
      await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeInViewport();
    });
  }
}
