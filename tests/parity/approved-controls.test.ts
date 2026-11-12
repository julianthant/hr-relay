import { expect } from '@playwright/test';
import { test } from "./helpers/fixtures.js";
import type { PreviewServer } from 'vite';
import { previewComponentFixture } from './helpers/component-fixtures.js';
let server: PreviewServer; let baseUrl: string;
test.beforeAll(async () => {
  server = await previewComponentFixture("approved-controls");
  const address = server.httpServer.address(); if (!address || typeof address === 'string') throw new Error('controls-server-address-invalid');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  if (server) await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done()));
});
for (const state of ['queue', 'export-pending', 'export-refused']) {
  test(`approved controls ${state}`, async ({ page }) => {
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
    }
    if (surface !== 'queue') await expect(page.locator('body')).toHaveAttribute('data-action-calls', '1');
    expect(errors).toEqual([]); expect(mutations).toEqual([]);
  });
}
