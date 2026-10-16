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
let server: PreviewServer; let output: string; let baseUrl: string;
test.beforeAll(async () => {
  output = await mkdtemp(join(tmpdir(), 'relay-approved-controls-'));
  const root = resolve('tests/parity/fixtures/approved-controls');
  await build({ configFile: false, root, plugins: [react(), tailwindcss()], logLevel: 'warn', build: { outDir: output, emptyOutDir: true } });
  server = await preview({ configFile: false, root, logLevel: 'warn', build: { outDir: output }, preview: { host: '127.0.0.1', port: 0, strictPort: true } });
  const address = server.httpServer.address(); if (!address || typeof address === 'string') throw new Error('controls-server-address-invalid');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done()));
  if (output) await rm(output, { recursive: true, force: true });
});
for (const state of ['queue', 'export-pending', 'export-refused', 'save-pending', 'save-refused', 'save-conflict', 'save-uncertain', 'save-mismatch', 'save-confirmed']) {
  const evidence = `approved-controls-${state}.a11y.yml`;
  test(`approved controls ${state}`, { annotation: [{ type: 'required-a11y-evidence', description: evidence }] }, async ({ page }, info) => {
    const errors: string[] = [], mutations: string[] = [];
    page.on('pageerror', error => errors.push(error.message)); page.on('request', request => { if (request.method() !== 'GET') mutations.push(request.method()); });
    const [surface, mode] = state.split('-');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${baseUrl}/?surface=${surface}&mode=${mode ?? ''}`);
    if (surface === 'queue') {
      const queue = page.getByRole('region', { name: 'Queue', exact: true });
      await expect(queue.locator('[data-demo-row-id]')).toHaveCount(8);
      for (const label of ['Active', 'Inactive', 'CRM only', 'Multiple matches', 'Not found', 'Undetermined', 'Found', 'Not found in UCPath']) await expect(queue.getByText(label, { exact: true })).toBeVisible();
    } else if (surface === 'export') {
      const button = page.getByRole('button', { name: 'Export CSV', exact: true }); await button.click();
      if (mode === 'pending') { await expect(button).toBeDisabled(); await expect(button).toHaveAttribute('aria-busy', 'true'); }
      else { await expect(page.getByRole('alert')).toContainText('CSV export unavailable'); await expect(button).toBeEnabled(); }
    } else {
      const cell = page.getByRole('textbox', { name: 'A2', exact: true }); await cell.fill('Draft kept');
      const button = page.getByRole('button', { name: 'Save', exact: true }); await button.click();
      if (mode === 'pending') { await expect(button).toBeDisabled(); await expect(page.getByRole('status')).toContainText('Saving…'); }
      else if (mode === 'confirmed') await expect(page.getByRole('status')).toHaveText('Saved · version 7');
      else await expect(page.getByText(mode === 'conflict' ? 'Save version conflict' : mode === 'refused' ? 'Save refused' : 'Save uncertain', { exact: true })).toBeVisible();
      await expect(cell).toHaveValue('Draft kept'); await expect(page.getByRole('button', { name: 'Export copy', exact: true })).toBeEnabled();
      if (mode !== 'confirmed') await expect(page.getByText(/Saved · version/)).toHaveCount(0);
    }
    if (surface !== 'queue') await expect(page.locator('body')).toHaveAttribute('data-action-calls', '1');
    await attachShellA11y(page, info, evidence);
    expect(errors).toEqual([]); expect(mutations).toEqual([]);
    await captureParityPair(page, resolve('tests/parity/references'), { stateId: `approved-controls-${state}`, theme: 'graphite-warm', viewport: '1280x720', adapter: 'component-fixture', fixtureId: `approved-controls-${state}`, descriptorHash: FIXTURE_DESCRIPTOR_HASH, appVersion: FIXTURE_APP_VERSION, capturedAt: FIXTURE_DAY, variant: 'default' }, { fullPage: surface === 'queue' });
  });
}
