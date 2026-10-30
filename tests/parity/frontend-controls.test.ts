import { attachShellA11y } from "./helpers/shell-proof.js";

import { expect, test } from '@playwright/test';

import { ensureParityBundle, PARITY_DIST_DIR } from './helpers/bundle.js';
import { moveAssistantLauncherAboveFooter } from './helpers/app-driver.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';
import { startFixtureServer } from '../support/helpers/dashboard/fixture-bff.js';

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const captures = ['review-jump', 'workers', 'ocr-dates', 'idle'];
  test(`log jumps, dialog contrast, account and idle refresh @ ${theme.attribute}-${width}`, {
    annotation: captures.map(name => ({ type: 'required-a11y-evidence', description: `${name}-${theme.attribute}-${width}.a11y.yml` })),
  }, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' } });
    const errors: string[] = [], writes: { method: string; url: string }[] = [], catalogRequests: string[] = [];

    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() !== 'GET') writes.push({ method: request.method(), url: request.url() }); if (request.url().includes('/api/v1/ui-catalog')) catalogRequests.push(request.url()); });
    const captureSemanticEvidence = async (name: string) => { await attachShellA11y(page, info, `${name}-${theme.attribute}-${width}.a11y.yml`); };
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      for (const [seed, label] of [[5, 'Review'], [6, 'Resolve'], [4, 'View failure']] as const) {
        const run = `00000000-${String(seed).padStart(4, '0')}-4000-8000-${String(seed).padStart(12, '0')}`;
        await page.goto(`${server.baseUrl}/?day=2026-08-03&run=${run}&section=logs`);
        await page.getByRole("button", { name: "Close assistant", exact: true }).click();
        const panel = page.getByRole('region', { name: 'Selected run logs', exact: true }); await expect(panel).toBeVisible();
        const jump = panel.getByRole('button', { name: label, exact: true }).first(); await expect(jump).toBeVisible();
        const header = panel.locator('header').first(); const before = await header.boundingBox(); expect(before).not.toBeNull();
        await panel.getByRole('searchbox', { name: 'Search logs', exact: true }).fill('no matching action');
        await jump.click(); await expect(panel.getByRole('searchbox', { name: 'Search logs', exact: true })).toHaveValue('');
        await expect(header).toBeVisible(); expect(await page.evaluate(() => window.scrollY)).toBe(0);
        const after = await header.boundingBox(); expect(after?.y).toBeCloseTo(before!.y, 0);
        const logViewport = panel.getByRole('region', { name: 'Run logs', exact: true });
        await expect.poll(() => logViewport.evaluate(element => element.contains(document.activeElement))).toBe(true);
        await expect.poll(() => logViewport.evaluate(element => {
          const target = document.activeElement;
          if (!(target instanceof HTMLElement) || !element.contains(target)) return false;
          const bounds = target.getBoundingClientRect(), viewport = element.getBoundingClientRect();
          return target.getAttribute('role') === 'group' && !target.closest('.sr-only') && bounds.width > 100 && bounds.height > 20
            && bounds.top >= viewport.top && bounds.top < viewport.bottom && getComputedStyle(target).outlineStyle === 'solid';
        })).toBe(true);
        if (seed === 5) await captureSemanticEvidence('review-jump');
        await moveAssistantLauncherAboveFooter(page);
        const latest = panel.getByRole('button', { name: 'Go to latest action', exact: true });
        await latest.click();
        expect(await page.evaluate(() => window.scrollY)).toBe(0); await expect(header).toBeVisible();
        await expect.poll(() => logViewport.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1);
        await jump.click();
        await expect.poll(() => logViewport.evaluate(element => element.contains(document.activeElement))).toBe(true);
        await latest.focus(); await latest.press('Enter');
        expect(await page.evaluate(() => window.scrollY)).toBe(0); await expect(header).toBeVisible();
        await expect.poll(() => logViewport.evaluate(element => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThanOrEqual(1);
        await jump.click();

      }
      await page.getByRole('button', { name: 'Add workers', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Add workers', exact: true }); await expect(dialog).toBeVisible();
      const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true }), add = dialog.getByRole('button', { name: 'Add workers', exact: true });
      const appearance = await dialog.evaluate(element => {
        const footer = element.querySelector('footer')!, buttons = [...footer.querySelectorAll('button')];
        return { dialog: getComputedStyle(element).borderBottomLeftRadius, footer: getComputedStyle(footer).borderBottomLeftRadius,
          buttons: buttons.map(button => ({ fill: getComputedStyle(button).backgroundColor, border: getComputedStyle(button).borderColor })) };
      });
      expect(appearance.footer).toBe(appearance.dialog); expect(appearance.footer).not.toBe('0px');
      expect(appearance.buttons[0]?.fill).not.toBe(appearance.buttons[1]?.fill);
      await dialog.getByRole('combobox', { name: 'Workflow', exact: true }).click(); await expect(page.getByRole('listbox')).toBeVisible();
      await page.keyboard.press('Escape'); await expect(dialog).toBeVisible(); await expect(page.getByRole('listbox')).toHaveCount(0);
      await expect(add).toBeEnabled(); await captureSemanticEvidence('workers');
      await cancel.click();
      await page.goto(`${server.baseUrl}/?settings=general`);
      expect(writes).toEqual([]);
      const signInWrite = { method: 'POST', url: `${server.baseUrl}/api/v1/settings/chatgpt-account/sign-in` };
      await page.getByRole('button', { name: 'Connect ChatGPT', exact: true }).click();
      const account = page.getByRole('group', { name: 'ChatGPT account', exact: true }); await expect(account).toContainText('jordan.lee@example.com');
      expect(writes).toEqual([signInWrite]);
      await expect(account).not.toContainText('Using ChatGPT plan'); await expect(account).not.toContainText('Preview');
      await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.getByRole('link', { name: 'UI catalog', exact: true })).toHaveCount(0);
      await page.getByRole('searchbox', { name: 'Search settings', exact: true }).fill('UI catalog'); await expect(page.getByRole('link', { name: /UI catalog/ })).toHaveCount(0);
      await page.goto(`${server.baseUrl}/?settings=ui-catalog`); await expect(page.getByText('UI catalog removed', { exact: true })).toBeVisible(); expect(catalogRequests).toEqual([]);
      const oath = 'mock:oath-signature:sample:ocr';
      await page.goto(`${server.baseUrl}/?day=2026-08-03&view=${encodeURIComponent(JSON.stringify({ preview: 'ocr', mockRun: oath, records: oath }))}`);
      await expect(page.getByRole('textbox', { name: 'Employment date', exact: true })).toHaveValue('04/27/2026');
      await expect(page.getByRole('textbox', { name: 'Date signed', exact: true })).toHaveValue('04/23/2026');
      await expect(page.getByRole('img', { name: /Source page 1 of single-oath/ })).toBeVisible();

      await captureSemanticEvidence('ocr-dates');
      await page.clock.install();
      await page.goto(`${server.baseUrl}/?day=2026-08-03`); await page.getByRole('button', { name: 'Sessions', exact: true }).click();
      const idle = page.getByRole('article', { name: 'Worker 4 · Person Lookup', exact: true }); await expect(idle).toBeVisible();
      const ring = idle.getByRole('img', { name: /^Session refresh in/ }); await expect(ring).toBeVisible();
      await page.getByRole('button', { name: 'Sessions', exact: true }).click();
      await page.clock.fastForward(300_000); await page.clock.fastForward(1000);
      await page.getByRole('button', { name: 'Sessions', exact: true }).click();
      await expect(idle).not.toContainText('Idle sessions refreshed'); await expect(ring).toHaveAccessibleName(/^Session refresh in 4:5\d/);
      const date = page.getByRole('group', { name: 'Log date controls', exact: true });
      await expect(date.getByRole('spinbutton', { name: /month/ })).toHaveText('08'); await expect(date.getByRole('spinbutton', { name: /day/ })).toHaveText('03'); await expect(date.getByRole('spinbutton', { name: /year/ })).toHaveText('2026');

      await captureSemanticEvidence('idle');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(errors).toEqual([]); expect(writes).toEqual([signInWrite]);
    } finally { await server.close(); }
  });
}
