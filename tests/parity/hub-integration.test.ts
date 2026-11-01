import { expect, type Page } from '@playwright/test';
import { test } from './helpers/matrix-fixtures.js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { attachShellA11y } from './helpers/shell-proof.js';
import { startFixtureServer } from '../support/helpers/dashboard/fixture-bff.js';
import { harness, disposeHttpRouteHarness } from '../support/helpers/backend/http-route-harness.js';

const evidence = resolve('.work/HUB-WIRE-1-R2');
const menuLabels = ['Add files', 'Ask only before submits', 'Model: GPT-6.1 Sol', 'Thinking effort: Medium', 'Voice input'];
async function rectangles(page: Page) {
  return Promise.all(['.hub-composer', '#hub-panel-assistant textarea', '#hub-panel-assistant .hub-transcript'].map(selector => page.locator(selector).boundingBox()));
}
for (const engine of ['chromium', 'webkit'] as const) for (const width of [1440, 1920, 2560]) for (const theme of ['light', 'dark']) {
  const name = `hub-integration-${engine}-${width}-${theme}`;
  test(`HUB integration matrix ${engine} ${width} ${theme}`, { annotation: [{ type: 'required-a11y-evidence', description: `${name}.a11y.yml` }] }, async ({ browserFor }, info) => {
    ensureParityBundle(); mkdirSync(evidence, { recursive: true });
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
    const h = await harness();
    const browser = await browserFor(engine), page = await browser.newPage({ viewport: { width, height: width === 1440 ? 900 : width === 1920 ? 1080 : 1440 } });
    const errors: string[] = [], writes: string[] = [], metrics: object[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (request.method() !== 'GET') writes.push(new URL(request.url()).pathname); });
    try {
      await page.addInitScript(value => { localStorage.setItem('rebuild-demo.theme', value); localStorage.setItem('relay.animations', 'on'); }, theme);
      await page.route('**/api/v1/settings/chatgpt-account', route => route.fulfill({ json: { state: 'connected', name: 'Fixture Operator', email: 'operator@example.edu', expiresAt: '2099-10-19T00:00:00Z', planUsage: 'enabled' } }));
      await page.route('**/api/v1/workbooks**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        const response = await h.app.request(`http://localhost${path}`, { method: request.method(), headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json' }, ...(request.postData() ? { body: request.postData()! } : {}) });
        await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
      });
      await page.goto(`${server.baseUrl}/?fixture=hub-integration`);
      const panel = page.locator('#hub-panel-assistant'), field = panel.getByRole('textbox', { name: 'Message Relay', exact: true });
      await expect(field).toBeEnabled(); await expect(panel).toHaveCount(1);
      await expect(page.locator('#hub-shell-assistant > header')).toHaveCount(0);
      const capture = async (state: string) => { await panel.screenshot({ path: resolve(evidence, `${name}-${state}.png`), animations: 'disabled' }); };
      await capture('mounted');
      for (const label of menuLabels) {
        const trigger = panel.getByRole('button', { name: label, exact: true });
        const before = await rectangles(page);
        await page.evaluate(() => {
          const scope = window as unknown as { hubShifts: number[]; hubObserver?: PerformanceObserver };
          scope.hubShifts = [];
          if (PerformanceObserver.supportedEntryTypes.includes('layout-shift')) {
            scope.hubObserver = new PerformanceObserver(list => { for (const entry of list.getEntries()) scope.hubShifts.push(Number(Reflect.get(entry, 'value'))); });
            scope.hubObserver.observe({ type: 'layout-shift' });
          }
        });
        await trigger.click(); const menu = page.getByRole('menu'); await expect(menu).toBeVisible();
        await expect(menu).toHaveCSS('background-color', theme === 'light' ? 'rgb(255, 255, 255)' : 'rgb(34, 34, 34)');
        await expect(menu).toHaveCSS('transform', 'none');
        const after = await rectangles(page); expect(after).toEqual(before);
        const items = menu.locator('[role^=menuitem]');
        await items.first().hover();
        const hover = await items.first().evaluate(node => ({ fill: getComputedStyle(node).backgroundColor, ink: getComputedStyle(node).color }));
        expect(hover.fill).toBe(theme === 'light' ? 'rgb(235, 235, 235)' : 'rgb(50, 50, 50)');
        await page.mouse.move(0, 0); await page.keyboard.press('Home'); await expect(items.first()).toBeFocused();
        const focus = await items.first().evaluate(node => ({ fill: getComputedStyle(node).backgroundColor, ink: getComputedStyle(node).color }));
        expect(focus.fill).toBe(theme === 'light' ? 'rgb(148, 148, 148)' : 'rgb(176, 176, 176)');
        await page.keyboard.press('End'); await expect(items.last()).toBeFocused();
        await page.keyboard.press('Home'); await expect(items.first()).toBeFocused();
        await page.keyboard.press('ArrowDown'); await expect(items.nth(label === 'Voice input' ? 0 : 1)).toBeFocused();
        const menuBox = (await menu.boundingBox())!, triggerBox = (await trigger.boundingBox())!;
        expect(Math.abs(triggerBox.y - menuBox.y - menuBox.height - 8)).toBeLessThanOrEqual(0.5);
        expect(menuBox.x).toBeGreaterThanOrEqual(8); expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width - 8);
        await menu.screenshot({ path: resolve(evidence, `${name}-${label.split(':')[0].replaceAll(' ', '-')}.png`), animations: 'disabled' });
        const shifts = await page.evaluate(() => {
          const scope = window as unknown as { hubShifts: number[]; hubObserver?: PerformanceObserver };
          scope.hubObserver?.disconnect(); return PerformanceObserver.supportedEntryTypes.includes('layout-shift') ? scope.hubShifts.reduce((sum, value) => sum + value, 0) : null;
        });
        if (engine === 'chromium') expect(shifts).toBe(0);
        metrics.push({ label, before, after, hover, focus, shifts });
        await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
      }
      await field.fill('Two lines'); await field.press('Shift+Enter'); await expect(field).toHaveValue('Two lines\n');
      await field.fill(Array(20).fill('Line').join('\n')); await expect.poll(async () => (await field.boundingBox())!.height).toBe(120);
      await field.fill(''); await expect.poll(async () => (await field.boundingBox())!.height).toBe(50);
      await expect(panel.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
      const modelTrigger = panel.getByRole('button', { name: 'Model: GPT-6.1 Sol', exact: true });
      await modelTrigger.focus(); await modelTrigger.press('Space'); await expect(page.getByRole('menu')).toHaveCSS('transform', 'none');
      await page.keyboard.press('Home'); await expect(page.getByRole('menuitemradio', { name: 'Default Recommended set of models', exact: true })).toBeFocused();
      await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitemradio', { name: 'GPT-6.1 Sol', exact: true })).toBeFocused(); await page.keyboard.press('Space');
      await expect(modelTrigger).toBeFocused(); await modelTrigger.press('Space'); await expect(page.getByRole('menu')).toHaveCSS('transform', 'none');
      await page.keyboard.press('Home'); await page.keyboard.press('g');
      await expect(page.getByRole('menuitemradio', { name: 'GPT-6.1 Sol', exact: true })).toBeFocused();
      await page.keyboard.press('End'); await page.keyboard.press('Enter');
      const luna = panel.getByRole('button', { name: 'Model: GPT-5.6 Luna', exact: true }); await expect(luna).toBeFocused();
      await luna.press('Space'); await expect(page.getByRole('menu')).toHaveCSS('transform', 'none');
      await page.keyboard.press('Home'); await expect(page.getByRole('menuitemradio', { name: 'Default Recommended set of models', exact: true })).toBeFocused();
      await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitemradio', { name: 'GPT-6.1 Sol', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
      await expect(modelTrigger).toBeFocused();
      const effortTrigger = panel.getByRole('button', { name: 'Thinking effort: Medium', exact: true });
      await effortTrigger.focus(); await effortTrigger.press('Space'); await expect(page.getByRole('menu')).toHaveCSS('transform', 'none');
      await page.keyboard.press('Home'); await expect(page.getByRole('menuitemradio', { name: 'Light', exact: true })).toBeFocused();
      await page.keyboard.press('ArrowDown'); await expect(page.getByRole('menuitemradio', { name: 'Low', exact: true })).toBeFocused(); await page.keyboard.press('Space');
      const low = panel.getByRole('button', { name: 'Thinking effort: Low', exact: true }); await expect(low).toBeFocused();
      await low.press('Space'); await expect(page.getByRole('menu')).toHaveCSS('transform', 'none'); await page.keyboard.press('m'); await expect(page.getByRole('menuitemradio', { name: 'Medium', exact: true })).toBeFocused();
      await page.keyboard.press('Enter'); await expect(effortTrigger).toBeFocused();
      await panel.getByRole('button', { name: 'Chat files', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'No files yet', exact: true })).toBeVisible();
      await page.locator('.hub-chat-files').screenshot({ path: resolve(evidence, `${name}-files-empty.png`), animations: 'disabled' });
      await expect(panel.getByRole('button', { name: 'Chat files', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await panel.getByRole('button', { name: 'Chat files', exact: true }).click(); await expect(page.locator('.hub-chat-files')).toHaveCount(0);
      await panel.getByRole('button', { name: 'Chat files', exact: true }).click();
      await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
      await expect(field).toBeFocused();
      await panel.getByRole('button', { name: 'New chat', exact: true }).click();
      await field.fill('Keep this draft');
      await panel.getByRole('button', { name: 'Chat files', exact: true }).click();
      await page.getByRole('button', { name: 'Back to chat', exact: true }).click(); await expect(field).toHaveValue('Keep this draft');
      await panel.getByRole('button', { name: 'Chat files', exact: true }).click();
      await field.fill('run separations'); await field.press('Enter');
      await expect(panel.getByRole('alert')).toHaveText('Attach a spreadsheet before starting this workflow.');
      await expect(page.locator('.hub-chat-files')).toHaveCount(0);
      await panel.locator('input[type=file]').setInputFiles({ name: 'People.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Separation date,Kuali ID\nAlex Rivera,2026-10-19,2230001\nMorgan Vega,2026-10-20,2230002\nCasey Lin,,2230003\n') });
      await expect(panel.getByRole('button', { name: 'Remove attachment People.csv', exact: true })).toBeVisible();
      await field.fill('run separations'); await field.press('Enter');
      await expect(panel.getByRole('button', { name: 'Run 2 separations', exact: true })).toBeEnabled();
      await expect(panel.getByText('Needs date', { exact: true })).toBeVisible(); await capture('review');
      await panel.getByRole('button', { name: 'Run 2 separations', exact: true }).click();
      await expect(panel.getByRole('button', { name: 'Results.csv Generated spreadsheet', exact: true })).toBeVisible();
      await capture('complete');
      await panel.getByRole('button', { name: 'People.csv Updated spreadsheet', exact: true }).click();
      const preview = page.getByRole('dialog', { name: 'People.csv', exact: true });
      await expect(preview.getByRole('table')).toContainText('Sample dry run complete');
      await preview.screenshot({ path: resolve(evidence, `${name}-updated-preview.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      await expect(page.locator('.hub-chat-file')).toHaveCount(3);
      const updatedDownload = page.waitForEvent('download');
      await page.locator('.hub-chat-file').filter({ hasText: 'Updated spreadsheet' }).getByRole('button', { name: 'Download People.csv', exact: true }).click();
      const updatedFile = await updatedDownload; expect(updatedFile.suggestedFilename()).toBe('People.csv');
      const updatedCsv = readFileSync(await updatedFile.path(), 'utf8');
      expect(updatedCsv).toContain('Sample dry run complete'); expect(updatedCsv).toContain('Casey Lin,,2230003,');
      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download Results.csv', exact: true }).click();
      expect((await download).suggestedFilename()).toBe('Results.csv');
      await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
      await panel.getByRole('button', { name: 'Chat files', exact: true }).click();
      await field.fill('send me the updated one'); await field.press('Enter');
      await expect(panel.getByText('Your updated spreadsheet is ready below.', { exact: true })).toBeVisible();
      await expect(page.locator('.hub-chat-files')).toHaveCount(0);
      await panel.getByRole('button', { name: 'Add files', exact: true }).click();
      await page.getByRole('menuitem', { name: /^From Chat files/u }).click();
      await page.getByRole('button', { name: 'Attach People.csv', exact: true }).first().click();
      await expect(panel.getByRole('button', { name: 'Remove attachment People.csv', exact: true })).toBeVisible();
      await expect(page.locator('.hub-assistant-menu')).toBeHidden();
      await field.fill('Review this original file');
      await expect(field).toHaveValue('Review this original file');
      await expect(panel.getByRole('button', { name: 'Send message', exact: true })).toBeEnabled();
      await field.press('Enter');
      await expect(panel.getByText('Review this original file', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.getByRole('link', { name: 'Spreadsheets', exact: true }).click();
      const library = page.getByRole('table', { name: 'Registered spreadsheets', exact: true });
      await expect(library.locator('tbody tr')).toHaveCount(2);
      await expect(library).toContainText('Updated'); await expect(library).toContainText('Generated');
      await page.locator('.hub-sheets-library').screenshot({ path: resolve(evidence, `${name}-library.png`), animations: 'disabled' });
      await page.getByRole('button', { name: 'Back to dashboard', exact: true }).click();
      await expect(panel.getByText('Review this original file', { exact: true })).toBeVisible();
      for (const mode of ['off', 'reduce']) {
        await page.evaluate(value => { document.documentElement.dataset.motion = value; }, mode === 'off' ? 'off' : 'on');
        await page.emulateMedia({ reducedMotion: mode === 'reduce' ? 'reduce' : 'no-preference' });
        const trigger = panel.getByRole('button', { name: 'Model: GPT-6.1 Sol', exact: true }); await trigger.click();
        await expect(page.getByRole('menu')).toHaveCSS('transition-duration', '0s');
        await page.keyboard.press('Escape'); await expect(trigger).toBeFocused();
      }
      await attachShellA11y(page, info, `${name}.a11y.yml`);
      expect(errors).toEqual([]); expect(writes).toHaveLength(3);
      expect(writes.every(path => /^\/api\/v1\/workbooks(?:\/[^/]+\/save)?$/u.test(path))).toBe(true);
      writeFileSync(resolve(evidence, `${name}.json`), JSON.stringify({ engine, width, theme, metrics, errors, writes }, null, 2));
    } finally { await page.context().close(); await server.close(); await disposeHttpRouteHarness(); }
  });
}

for (const engine of ['chromium', 'webkit'] as const) for (const width of [1440, 1920, 2560]) for (const theme of ['light', 'dark']) for (const finding of ['draft', 'ordinary title', 'workflow title'] as const) {
  const name = `hub-r2-${engine}-${width}-${theme}-${finding.replaceAll(' ', '-')}`;
  test(`HUB R2 ${finding} survives mounted chat transitions ${engine} ${width} ${theme}`, { annotation: [{ type: 'required-a11y-evidence', description: `${name}.a11y.yml` }] }, async ({ browserFor }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
    const h = await harness();
    const browser = await browserFor(engine), page = await browser.newPage({ viewport: { width, height: width === 1440 ? 900 : width === 1920 ? 1080 : 1440 } });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    try {
      await page.addInitScript(value => localStorage.setItem('rebuild-demo.theme', value), theme);
      await page.route('**/api/v1/settings/chatgpt-account', route => route.fulfill({ json: { state: 'connected', name: 'Fixture Operator', email: 'operator@example.edu', expiresAt: '2099-10-19T00:00:00Z', planUsage: 'enabled' } }));
      await page.route('**/api/v1/workbooks**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        const response = await h.app.request(`http://localhost${path}`, { method: request.method(), headers: { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json' }, ...(request.postData() ? { body: request.postData()! } : {}) });
        await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() });
      });
      await page.goto(`${server.baseUrl}/?fixture=hub-r2`);
      const panel = page.locator('#hub-panel-assistant'), field = panel.getByRole('textbox', { name: 'Message Relay', exact: true });
      await expect(field).toBeEnabled();
      await panel.getByRole('button', { name: 'New chat', exact: true }).click();
      await panel.locator('.hub-chat-title').click();
      const rename = page.getByRole('dialog', { name: 'Rename chat', exact: true });
      await rename.getByRole('textbox', { name: 'Chat title', exact: true }).fill('Retained operator title');
      await rename.getByRole('button', { name: 'Save', exact: true }).click();
      if (finding === 'draft') {
        await field.fill('  Keep A exactly\nSecond line ✨  ');
        await panel.locator('input[type=file]').setInputFiles({ name: 'A.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic A') });
        await expect(panel.getByRole('button', { name: 'Remove attachment A.txt', exact: true })).toBeVisible();
        await panel.getByRole('button', { name: 'Close assistant', exact: true }).click();
        await page.getByRole('button', { name: 'Assistant', exact: true }).click();
        await expect(field).toHaveValue('  Keep A exactly\nSecond line ✨  ');
        await panel.getByRole('button', { name: 'New chat', exact: true }).click();
        await expect(field).toHaveValue('');
        await expect(panel.getByRole('button', { name: /^Remove attachment/ })).toHaveCount(0);
        await field.fill('B stays separate');
        await panel.locator('input[type=file]').setInputFiles({ name: 'B.txt', mimeType: 'text/plain', buffer: Buffer.from('Synthetic B') });
        await expect(panel.getByRole('button', { name: 'Remove attachment B.txt', exact: true })).toBeVisible();
        await panel.getByRole('button', { name: 'Chats', exact: true }).click();
        await page.getByRole('button', { name: /^Retained operator title / }).click();
        await expect(field).toHaveValue('  Keep A exactly\nSecond line ✨  ');
        await expect(panel.getByRole('button', { name: 'Remove attachment A.txt', exact: true })).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Remove attachment B.txt', exact: true })).toHaveCount(0);
        await panel.getByRole('button', { name: 'Chat files', exact: true }).click();
        await page.getByRole('button', { name: 'Back to chat', exact: true }).click();
        await expect(field).toHaveValue('  Keep A exactly\nSecond line ✨  ');
        await panel.getByRole('button', { name: 'Chats', exact: true }).click();
        await page.getByRole('button', { name: 'Delete chat Retained operator title', exact: true }).click();
        await page.getByRole('dialog', { name: 'Delete chat?', exact: true }).getByRole('button', { name: 'Cancel', exact: true }).click();
        await page.getByRole('button', { name: /^Retained operator title / }).click();
        await expect(field).toHaveValue('  Keep A exactly\nSecond line ✨  ');
        await panel.getByRole('button', { name: 'Chats', exact: true }).click();
        await page.getByRole('button', { name: 'Delete chat Retained operator title', exact: true }).click();
        await page.getByRole('dialog', { name: 'Delete chat?', exact: true }).getByRole('button', { name: 'Delete', exact: true }).click();
        await expect(page.getByRole('button', { name: /^Retained operator title / })).toHaveCount(0);
        await page.getByRole('button', { name: /^New chat .*Current/ }).click();
        await expect(field).toHaveValue('B stays separate');
        await expect(panel.getByRole('button', { name: 'Remove attachment B.txt', exact: true })).toBeVisible();
        await field.press('Enter');
        await expect(field).toHaveValue('');
        await expect(panel.getByRole('button', { name: /^Remove attachment/ })).toHaveCount(0);
      } else {
        const text = finding === 'workflow title' ? 'run separations' : 'A different first message';
        if (finding === 'workflow title') {
          await panel.locator('input[type=file]').setInputFiles({ name: 'People.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Separation date,Kuali ID\nAlex Rivera,2026-10-19,2230001\n') });
          await expect(panel.getByRole('button', { name: 'Remove attachment People.csv', exact: true })).toBeVisible();
        }
        await field.fill(text); await field.press('Enter');
        await expect(panel.getByRole('log', { name: 'Assistant conversation', exact: true }).getByText(text, { exact: true })).toBeVisible();
        await expect(panel.locator('header .hub-chat-title')).toHaveText('Retained operator title');
        await panel.getByRole('button', { name: 'New chat', exact: true }).click();
        await field.fill('Untouched automatic title'); await field.press('Enter');
        await expect(panel.locator('header .hub-chat-title')).toHaveText('Untouched automatic title');
        await expect(panel.getByRole('log', { name: 'Assistant conversation', exact: true }).getByText('Untouched automatic title', { exact: true })).toBeVisible();
      }
      await attachShellA11y(page, info, `${name}.a11y.yml`);
      mkdirSync(evidence, { recursive: true });
      await panel.screenshot({ path: resolve(evidence, `${name}.png`), animations: 'disabled' });
      expect(errors).toEqual([]);
    } finally { await page.context().close(); await server.close(); await disposeHttpRouteHarness(); }
  });
}

test('HUB served product uses typed answers and refusals without sample execution or policy authority', { annotation: [{ type: 'required-a11y-evidence', description: 'hub-served.a11y.yml' }] }, async ({ page }, info) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
  const writes: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() !== 'GET') writes.push(new URL(request.url()).pathname); });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/v1/settings/chatgpt-account', route => route.fulfill({ json: { state: 'connected', name: 'Fixture Operator', email: 'operator@example.edu', expiresAt: '2099-10-19T00:00:00Z', planUsage: 'enabled' } }));
    let reply = 0;
    await page.route('**/api/v1/assistant/respond', route => {
      const index = reply++;
      return route.fulfill({ json: index === 0 ? { state: 'answered', text: 'Verified explanation', citations: [{ path: 'docs/example.md', revision: 'a'.repeat(40), startLine: 1, endLine: 2, quote: 'Verified source quote' }] } : index === 1 ? { state: 'refused', code: 'ASSISTANT_PROPOSAL_REFUSED', message: 'Synthetic refusal' } : { state: 'proposal', proposal: {
        workflowId: 'person-lookup', subject: { subjectRef: 'synthetic', displayName: 'Synthetic Person' }, intent: 'dry-run', descriptorVersion: 2,
        descriptorFingerprint: 'd'.repeat(64), configSnapshotId: 'config', configFingerprint: 'c'.repeat(64), inputFingerprint: 'i'.repeat(64), optionsFingerprint: 'o'.repeat(64),
        expiresAt: '2099-10-22T00:00:00Z', stopBefore: { nodeId: 'commit', phase: 'commit', afterPrepareTaskId: 'prepare', commitTaskId: 'submit' },
        effects: { workflowExecuted: false, transactionCommitted: false }, confirmation: 'required-in-run',
      } } });
    });
    await page.goto(`${server.baseUrl}/?fixture=hub-served`);
    const panel = page.locator('#hub-panel-assistant'), field = panel.getByRole('textbox', { name: 'Message Relay', exact: true });
    await expect(panel).toHaveAttribute('data-source', 'served'); await expect(page.getByRole('button', { name: 'Assistant', exact: true })).toHaveCount(1);
    await expect(field).toBeEnabled(); await field.fill('Explain this workflow'); await field.press('Enter');
    await expect(panel).toContainText('Verified explanation'); await expect(field).toHaveValue(''); await panel.getByRole('button', { name: 'Source: docs/example.md:1-2' }).click(); await expect(panel).toContainText('Verified source quote');
    for (const label of menuLabels.slice(1)) await expect(panel.getByRole('button', { name: label, exact: true })).toBeDisabled();
    await field.fill('Run separations'); await field.press('Enter');
    await expect(panel).toContainText('The current planner refused this proposal. Review it in Run.'); await expect(field).toHaveValue('');
    mkdirSync(evidence, { recursive: true });
    await panel.screenshot({ path: resolve(evidence, 'hub-served-answer-refusal.png'), animations: 'disabled' });
    await expect(panel).not.toContainText('Sample run'); await expect(panel).not.toContainText('Alex Rivera');
    await field.fill('Propose a dry run'); await field.press('Enter');
    const proposal = panel.getByRole('article', { name: 'Proposed run details' }); await expect(proposal).toContainText('Synthetic Person');
    await expect(proposal.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
    await proposal.getByRole('button', { name: 'Effects and stop points' }).click(); await expect(proposal).toContainText('commit: submit (after prepare)');
    await expect(proposal).toContainText('Confirmation is unavailable'); await expect(field).toHaveValue('');
    expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(writes).toEqual(['/api/v1/assistant/respond', '/api/v1/assistant/respond', '/api/v1/assistant/respond']); expect(errors).toEqual([]);
    await panel.screenshot({ path: resolve(evidence, 'hub-served-proposal.png'), animations: 'disabled' });
    await info.attach('hub-served.png', { body: readFileSync(resolve(evidence, 'hub-served-proposal.png')), contentType: 'image/png' });
    await attachShellA11y(page, info, 'hub-served.a11y.yml');
  } finally { await server.close(); }
});
