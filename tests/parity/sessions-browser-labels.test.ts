import { expect } from '@playwright/test';
import type { PreviewServer } from 'vite';
import { test } from './helpers/fixtures.js';
import { previewComponentFixture } from './helpers/component-fixtures.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';

let server: PreviewServer;
let baseUrl: string;
test.beforeAll(async () => {
  server = await previewComponentFixture('approved-controls');
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('session-label-server-address-invalid');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done()));
});

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`full system labels fit every browser state @ ${theme.attribute} ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 720 });
    await installTheme(page, theme);
    await page.goto(`${baseUrl}/?surface=sessions`);
    const panel = page.getByRole('region', { name: 'Session Panel', exact: true });
    await expect(panel.getByRole('article')).toHaveCount(6);
    for (const state of ['Not opened', 'Opening', 'In use', 'Ready', 'Closed', 'Unavailable']) {
      await expect(panel.getByText(state, { exact: true })).toHaveCount(2);
    }
    for (const list of await panel.getByRole('list').all()) {
      expect(await list.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length)).toBe(2);
      for (const label of await list.locator('.truncate').all()) {
        expect(await label.evaluate(node => node.scrollWidth <= node.clientWidth), await label.innerText()).toBe(true);
      }
    }
    await info.attach('unopened-system-labels', { body: await panel.getByRole('article').first().screenshot(), contentType: 'image/png' });
    await info.attach('unavailable-system-labels', { body: await panel.getByRole('article').last().screenshot(), contentType: 'image/png' });
  });
}
