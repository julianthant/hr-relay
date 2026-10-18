import { expect, test } from '@playwright/test';
import { startAssistantCoupledServer } from '../support/helpers/assistant-coupled-server.js';
import { attachShellA11y } from './helpers/shell-proof.js';

let server: Awaited<ReturnType<typeof startAssistantCoupledServer>>;
test.beforeAll(async () => { server = await startAssistantCoupledServer(); });
test.afterAll(async () => { if (server) await server.close(); });
test.use({ viewport: { width: 1440, height: 900 } });
test('coupled synthetic proposal preserves conversation, holds confirmation and clears Sessions and modal hitboxes', {
  annotation: [{ type: 'required-a11y-evidence', description: 'assistant-coupled.a11y.yml' }],
}, async ({ page }, info) => {
  const errors: string[] = [], requests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() !== 'GET' && new URL(request.url()).pathname.startsWith('/api/')) requests.push(new URL(request.url()).pathname); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(server.baseUrl);
  const launcher = page.getByRole('button', { name: 'Assistant', exact: true });
  await launcher.click();
  const panel = page.getByRole('dialog', { name: 'Relay assistant' });
  const composer = page.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toBeFocused(); await composer.fill('Propose a dry run for the selected synthetic subject'); await composer.press('Enter');
  await expect(panel.getByRole('region', { name: 'Proposed run details' })).toContainText('Avery Synthetic');
  await expect(panel.getByRole('button', { name: 'Confirm', exact: true })).toBeDisabled();
  await expect(panel).toContainText('before preparation. No run has started.');
  expect(requests).toEqual(['/api/v1/assistant/respond']);
  await page.keyboard.press('Escape'); await expect(panel).toHaveCount(0); await expect(launcher).toBeFocused();
  await launcher.click(); await expect(panel).toContainText('Avery Synthetic');
  await page.getByRole('button', { name: 'Close assistant' }).click();
  for (const width of [1440, 1920, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    for (const expanded of [false, true]) {
      const sessions = page.getByRole('button', { name: 'Sessions', exact: true });
      if (await sessions.getAttribute('aria-expanded') !== String(expanded)) await sessions.click();
      await expect.poll(async () => {
        const hit = await launcher.boundingBox(), panelBounds = await page.getByRole('region', { name: 'Session Panel', exact: true }).boundingBox();
        return hit !== null && panelBounds !== null && hit.y + hit.height <= panelBounds.y;
      }).toBe(true);
      const hit = await launcher.boundingBox(); expect(hit?.width).toBe(48); expect(hit?.height).toBe(48);
      const point = await launcher.evaluate(node => { const b = node.getBoundingClientRect(); return node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); });
      expect(point).toBe(true);
      const inset = await launcher.evaluate(node => getComputedStyle(node).bottom); expect(parseFloat(inset)).toBeGreaterThan(48);
    }
  }
  await page.getByRole('button', { name: 'Open proof modal' }).click();
  await expect(page.getByRole('dialog', { name: 'Synthetic modal' })).toBeVisible();
  const covered = await page.locator('button[aria-label="Assistant"]').evaluate(node => { const b = node.getBoundingClientRect(); return !node.contains(document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)); }); expect(covered).toBe(true);
  await page.keyboard.press('Escape'); await launcher.click();
  await page.getByRole('button', { name: 'New chat' }).click(); await expect(panel.getByRole('region', { name: 'Proposed run details' })).toHaveCount(0);
  await expect(composer).toHaveValue('');
  server.world.holdReply();
  await composer.fill('Explain while held'); await composer.press('Enter');
  const stop = panel.getByRole('button', { name: 'Stop reply', exact: true }); await expect(stop).toBeVisible(); await stop.focus(); await page.keyboard.press('Enter');
  await expect(panel.getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await expect(composer).toBeFocused(); server.world.releaseReply();
  await expect(panel).toContainText('Reply cancelled.');
  await page.getByRole('button', { name: 'New chat' }).click(); await expect(composer).toHaveValue('');
  await attachShellA11y(page, info, 'assistant-coupled.a11y.yml'); expect(errors).toEqual([]);
  expect(requests).toEqual(['/api/v1/assistant/respond', '/api/v1/assistant/respond']);
});
