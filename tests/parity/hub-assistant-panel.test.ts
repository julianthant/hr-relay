import { test, expect } from '@playwright/test';
import { z } from 'zod';
import { createServer as createHttpServer } from 'node:http';
import { resolve } from 'node:path';
import { preview, type PreviewServer } from 'vite';
import { attachShellA11y } from './helpers/shell-proof.js';
import { captureParityPair } from './helpers/capture.js';
import { FIXTURE_APP_VERSION, FIXTURE_DESCRIPTOR_HASH, FIXTURE_DAY } from './helpers/fixture-identity.js';

let server: PreviewServer;
let baseUrl: string;
const bff = createHttpServer((request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  if (request.method !== 'GET' || request.url !== '/api/v1/settings/chatgpt-account') { response.writeHead(404).end(); return; }
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ state: 'connected', name: 'Fixture Operator', email: 'operator@example.edu', expiresAt: '2099-10-19T00:00:00Z', planUsage: 'enabled' }));
});
test.beforeAll(async () => {
  await new Promise<void>(done => bff.listen(0, '127.0.0.1', done));
  const address = bff.address(); if (!address || typeof address === 'string') throw Error('assistant-fixture-address');
  server = await preview({ configFile: false, root: resolve('tests/parity/fixtures/hub-assistant'), logLevel: 'warn',
    build: { outDir: resolve('dist/parity-components/hub-assistant') },
    preview: { host: '127.0.0.1', port: 0, strictPort: true, proxy: { '/api': `http://127.0.0.1:${address.port}` } } });
  const http = server.httpServer.address(); if (!http || typeof http === 'string') throw Error('assistant-fixture-address');
  baseUrl = `http://127.0.0.1:${http.port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done()));
  await new Promise<void>((done, reject) => bff.close(error => error ? reject(error) : done()));
});
test.describe.configure({ mode: 'serial' });
test('assistant composer and workflow ports', { annotation: [{ type: 'required-a11y-evidence', description: 'hub-assistant.a11y.yml' }] }, async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseUrl);
  const textarea = page.getByRole('textbox', { name: 'Message Relay' });
  await expect(textarea).toBeEnabled();
  const send = page.getByRole('button', { name: 'Send message' });
  await expect(send).toBeDisabled();
  await textarea.fill('   '); await expect(send).toBeDisabled();
  await textarea.fill('Line one'); await textarea.press('Shift+Enter'); await expect(textarea).toHaveValue('Line one\n');
  for (const label of ['Add files', 'Ask only before submits', 'Model: GPT-6.1 Sol', 'Thinking effort: Medium', 'Voice input']) {
    const trigger = page.getByRole('button', { name: label, exact: true });
    const boxes = () => Promise.all(['.hub-composer', 'textarea', '.hub-transcript'].map(selector => page.locator(selector).boundingBox()));
    const before = await boxes();
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible();
    expect(await boxes()).toEqual(before);
    expect(await page.getByRole('menu').evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0.15s');
    if (label === 'Thinking effort: Medium') await expect.poll(async () => (await page.getByRole('menu').boundingBox())?.x).toBe((await trigger.boundingBox())!.x);
    const options = page.getByRole('menu').locator('[role^=menuitem]');
    await page.keyboard.press('End'); await expect(options.last()).toBeFocused();
    await page.keyboard.press('Home'); await expect(options.first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  await textarea.fill('Hello'); await textarea.press('Enter');
  await expect(page.getByText('Hello', { exact: true })).toBeVisible(); await expect(textarea).toHaveValue('');
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.locator('input[type=file]').setInputFiles({ name: 'People.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Separation date\nAlex Rivera,2026-10-19\nMorgan Vega,2026-10-20\nCasey Lin,\n') });
  await expect(page.getByText('People.csv', { exact: true })).toBeVisible();
  await textarea.fill('Run separations'); await textarea.press('Enter');
  await expect(page.getByRole('button', { name: 'Run 2 separations' })).toBeEnabled();
  await expect(page.getByText('Needs date', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Run 2 separations' }).click();
  await expect(page.getByRole('button', { name: 'Updated.csv Updated spreadsheet', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Results.csv Generated spreadsheet', exact: true })).toBeVisible();
  const request = z.object({ dryRun: z.literal(true), rows: z.array(z.object({ person: z.string() })) }).parse(JSON.parse((await page.locator('body').getAttribute('data-run'))!));
  expect(request.dryRun).toBe(true); expect(request.rows.map((row: { person: string }) => row.person)).toEqual(['Alex Rivera', 'Morgan Vega']);
  await attachShellA11y(page, info, 'hub-assistant.a11y.yml');
  expect(errors).toEqual([]);
});
test('assistant menu selection, popup and motion contracts', { annotation: [{ type: 'required-a11y-evidence', description: 'hub-assistant-controls.a11y.yml' }] }, async ({ page }, info) => {
  await page.goto(`${baseUrl}/?scene=done&theme=light&motion=off`);
  const trigger = page.getByRole('button', { name: 'Model: GPT-6.1 Sol', exact: true });
  await expect(trigger).toBeEnabled(); await trigger.focus(); await trigger.press('Space');
  await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Home'); await expect(page.getByRole('menuitemradio', { name: 'Default Recommended set of models', exact: true })).toBeFocused();
  await page.keyboard.press('g');
  await expect(page.getByRole('menuitemradio', { name: 'GPT-6.1 Sol', exact: true })).toBeFocused();
  await page.keyboard.press('End'); await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Model: GPT-5.6 Luna', exact: true })).toBeFocused();
  const effort = page.getByRole('button', { name: 'Thinking effort: Medium', exact: true });
  await effort.focus(); await effort.press('Space'); await expect(page.getByRole('menu')).toBeVisible();
  await page.keyboard.press('Home'); await expect(page.getByRole('menuitemradio', { name: 'Light', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitemradio', { name: 'Low', exact: true })).toBeFocused(); await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Thinking effort: Low', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Voice input', exact: true }).click();
  const menu = page.getByRole('menu'), anchor = await page.getByRole('button', { name: 'Voice input', exact: true }).boundingBox();
  expect(await menu.evaluate(element => getComputedStyle(element).transform)).toBe('none');
  await expect.poll(async () => { const box = await menu.boundingBox(); return box ? box.y + box.height : null; }).toBe(anchor!.y - 8);
  const box = await menu.boundingBox(); expect(box!.x + box!.width).toBeLessThanOrEqual(1272);
  expect(await menu.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('0s');
  await page.getByRole('menuitem', { name: /Use sample transcript/ }).click();
  await expect(page.getByRole('textbox', { name: 'Message Relay' })).toHaveValue('Check the current employment details for Alex Rivera.');
  await expect(page.getByRole('textbox', { name: 'Message Relay' })).toBeFocused();
  await page.getByRole('button', { name: 'View record', exact: true }).click();
  const dialog = page.getByRole('dialog'); await expect(dialog).toHaveAccessibleName('Work email saved');
  expect(await dialog.evaluate(element => getComputedStyle(element).borderColor)).toBe('rgb(222, 222, 222)');
  await page.keyboard.press('Escape'); await expect(page.getByRole('button', { name: 'View record', exact: true })).toBeFocused();
  await page.goto(`${baseUrl}/?scene=handoff`); await page.getByRole('button', { name: 'Open sign-in', exact: true }).click();
  await page.getByRole('button', { name: 'Simulate signed in', exact: true }).click(); await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.goto(`${baseUrl}/?scene=working`);
  await expect(page.locator('.hub-spinner')).toBeVisible();
  expect(await page.locator('.hub-spinner').evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await attachShellA11y(page, info, 'hub-assistant-controls.a11y.yml');
});
for (const scene of ['new', 'ask-read', 'ask-write', 'permission-changed', 'auto', 'working', 'cancelling', 'done', 'failed', 'handoff', 'destructive', 'delete-working', 'resolved', 'declined', 'conversation', 'typing', 'multiline', 'attachment', 'attach-menu', 'approval-menu', 'model-menu', 'effort-menu', 'voice-menu', 'record-popup', 'sign-in-popup']) {
  test(`assistant approved ${scene}`, { annotation: [{ type: 'required-a11y-evidence', description: `hub-assistant-${scene}.a11y.yml` }] }, async ({ page }, info) => {
    const state = scene === 'record-popup' ? 'done' : scene === 'sign-in-popup' ? 'handoff' : scene.endsWith('-menu') || ['typing', 'multiline', 'attachment'].includes(scene) ? 'ask-write' : scene;
    const text = scene === 'typing' ? 'Review these changes before I save.' : scene === 'multiline' ? 'Compare the current employment record.\nCheck the new work email.\nShow me the change before saving.' : scene === 'attachment' ? 'Review these notes.' : '';
    await page.goto(`${baseUrl}/?scene=${state}&text=${encodeURIComponent(text)}`);
    await expect(page.getByRole('textbox', { name: 'Message Relay' })).toBeEnabled();
    if (scene === 'attachment') await page.locator('input[type=file]').setInputFiles({ name: 'Review notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 fixture') });
    const menuLabels: Record<string, string> = { 'attach-menu': 'Add files', 'approval-menu': 'Ask only before submits', 'model-menu': 'Model: GPT-6.1 Sol', 'effort-menu': 'Thinking effort: Medium', 'voice-menu': 'Voice input' };
    if (menuLabels[scene]) {
      await page.getByRole('button', { name: menuLabels[scene], exact: true }).click();
      const menu = page.getByRole('menu'); await expect(menu).toBeVisible();
      await expect.poll(() => menu.getAttribute('data-starting-style')).toBeNull();
      await menu.evaluate(async element => { await Promise.all(element.getAnimations().map(animation => animation.finished)); });
      await page.keyboard.press('Home'); await expect(menu.locator('[role^=menuitem]').first()).toBeFocused();
      if (scene === 'model-menu' || scene === 'effort-menu' || scene === 'approval-menu') expect(await menu.locator('[data-slot=dropdown-menu-radio-item-indicator]').first().evaluate(element => getComputedStyle(element).position)).toBe('absolute');
    }
    if (scene.endsWith('-popup')) await page.getByRole('button', { name: scene === 'record-popup' ? 'View record' : 'Open sign-in', exact: true }).click();
    await attachShellA11y(page, info, `hub-assistant-${scene}.a11y.yml`);
    await captureParityPair(page, resolve('tests/parity/references'), { stateId: `hub-assistant-${scene}`, theme: 'graphite-warm', viewport: '1280x720', adapter: 'component-fixture', fixtureId: `hub-assistant-${scene}`, descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: 'default' });
  });
}

test('served local action uses the existing card and keeps lost confirmation non-retryable', async ({ page }, info) => {
  for (const lost of [false, true]) {
    await page.goto(`${baseUrl}?served=1&lost=${lost ? '1' : '0'}`);
    const input = page.getByRole('textbox', { name: 'Message Relay' });
    await expect(input).toBeEnabled(); await input.fill('mark notifications read');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const card = page.getByRole('article', { name: 'Proposed action details' });
    await card.getByRole('button', { name: "Effects and stop points", exact: true }).click();
    await expect(card).toContainText('Proposed action · Local change');
    await expect(card).toContainText('Local notification'); await expect(card).toContainText('None');
    await expect(card).not.toContainText('Dry run'); await expect(card).not.toContainText('Alex Rivera');
    const confirm = card.getByRole('button', { name: 'Confirm', exact: true }); await expect(confirm).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`served-action-${lost ? 'lost' : 'ready'}.png`) });
    await confirm.click();
    await expect(card).toContainText(lost ? 'Action outcome is unknown. Do not retry' : 'Action completed.');
    await expect(confirm).toBeDisabled();
    await expect(page.locator('body')).toHaveAttribute('data-decisions', '1');
    await page.screenshot({ path: info.outputPath(`served-action-${lost ? 'unknown' : 'complete'}.png`) });
  }
});

test('served automatic unknown and lost respond have no Retry or new Send', async ({ page }, info) => {
  for (const mode of ['autoUnknown', 'respondLost']) {
    await page.goto(`${baseUrl}?served=1&${mode}=1`);
    const input = page.getByRole('textbox', { name: 'Message Relay' }); await expect(input).toBeEnabled();
    await input.fill('mark notifications read'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(page.getByText(/Action outcome is unknown/).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Retry reply' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    if (mode === 'autoUnknown') {
      const card = page.getByRole('article', { name: 'Proposed action details' });
      await expect(card).toContainText('25 current notifications'); await expect(card.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
    } else await expect(page.getByRole('article', { name: 'Proposed action details' })).toHaveCount(0);
    await expect(page.locator('body')).not.toHaveAttribute('data-decisions');
    await page.screenshot({ path: info.outputPath(`automatic-${mode}.png`) });
  }
});
