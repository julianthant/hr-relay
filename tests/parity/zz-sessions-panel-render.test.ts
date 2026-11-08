import type { PreviewServer } from 'vite';
import { test } from './helpers/fixtures.js';
import { previewComponentFixture } from './helpers/component-fixtures.js';

const OUT = '/Users/julianhein/Projects/hr-relay/.work/next-20261101/sessions-panel-bar-cards';
let server: PreviewServer;
let baseUrl: string;
test.beforeAll(async () => {
  server = await previewComponentFixture('approved-controls');
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('address');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>(done => server.httpServer.close(() => done())); });

for (const theme of ['light', 'dark']) {
  test(`cards ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1300 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${baseUrl}/?surface=sessions-states&theme=${theme}`);
    await page.locator('[data-sessions-states] article').first().waitFor();
    await page.locator('[data-sessions-states]').screenshot({ path: `${OUT}/cards-${theme}.png` });
  });
  test(`bar ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1680, height: 400 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const panel = page.getByRole('region', { name: 'Session Panel', exact: true });
    const shot = (name: string) => panel.screenshot({ path: `${OUT}/bar-${theme}-${name}.png` });
    await page.goto(`${baseUrl}/?surface=sessions-bar&theme=${theme}`);
    await panel.waitFor();
    await shot('1-rest');
    const box = (await panel.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 20); await shot('2-hover-bar');
    await page.getByRole('button', { name: 'Add workers' }).hover(); await shot('3-hover-add');
    await page.mouse.move(box.x + box.width / 2, box.y + 20); await page.mouse.down(); await shot('4-pressed'); await page.mouse.up();
    await page.goto(`${baseUrl}/?surface=sessions-bar&theme=${theme}&open=1`); await panel.waitFor(); await shot('5-expanded');
    await page.goto(`${baseUrl}/?surface=sessions-bar&theme=${theme}`); await panel.waitFor();
    await page.evaluate(() => { document.documentElement.dataset.hub = ''; });
    await page.keyboard.press('Tab'); await shot('6-focus');
  });
}
