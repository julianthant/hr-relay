
import { expect } from '@playwright/test';
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from './helpers/bundle.js';
import { installTheme, PARITY_THEMES } from './helpers/capture.js';
import { startFixtureServer } from '../support/helpers/dashboard/fixture-bff.js';
import { FIXTURE_DAY } from './helpers/fixture-identity.js';
import { chooseSelect } from './helpers/select-choice.js';

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Relay rail, queue, Sessions bar and Settings shortcuts @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: 'working-tree' }, preflightScenario: "ready" });
    const errors: string[] = [], writes: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (request.method() !== 'GET') writes.push(new URL(request.url()).pathname); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const skip = page.getByRole('link', { name: 'Skip to content', exact: true });
      await skip.focus(); await skip.press('Enter');
      await expect(page.locator('#dashboard-main-region')).toBeFocused();
      const rail = page.getByRole('complementary', { name: 'Workspace', exact: true });
      const workflows = rail.getByRole('navigation', { name: 'Workflows', exact: true });
      await expect(rail.getByRole('heading', { name: 'Relay', exact: true })).toBeVisible();
      await expect(workflows.locator('button > svg')).toHaveCount(0);
      await expect(workflows.locator('h3 > svg')).toHaveCount(8);
      expect(await workflows.evaluate(node => getComputedStyle(node).paddingLeft)).toBe('8px');
      for (const group of await workflows.locator('.workflow-rail-group').all()) {
        const headingTextX = await group.locator('h3').evaluate(node => {
          const text = [...node.childNodes].find(child => child.nodeType === Node.TEXT_NODE && child.textContent?.trim());
          if (text === undefined) throw new Error('Workflow category text missing');
          const range = document.createRange(); range.selectNodeContents(text);
          return range.getBoundingClientRect().x;
        });
        const icon = (await group.locator('h3 > svg').boundingBox())!;
        for (const row of await group.getByRole('button').all()) {
          const label = (await row.locator('span').first().boundingBox())!;
          const card = (await row.boundingBox())!;
          expect(Math.abs(label.x - headingTextX)).toBeLessThanOrEqual(0.5);
          expect(icon.x - card.x).toBe(8);
          expect(card.x).toBe(8);
          expect(card.x + card.width).toBe((await workflows.boundingBox())!.width - 8);
        }
      }

      await expect(workflows.locator('.workflow-rail-running')).toHaveCount(await workflows.getByRole('button').count());
      await expect(workflows.getByText('Preview', { exact: true })).toHaveCount(0);
      const bell = rail.getByRole('button', { name: /^Notifications,/ }); await bell.click();
      await expect(rail.getByRole('heading', { name: 'Relay', exact: true })).toBeVisible();
      await expect(rail.getByText('History gap', { exact: true })).toHaveCount(0);
      await expect(rail.locator('.notification-row')).toHaveCount(13);
      await rail.getByRole('button', { name: 'Notification actions', exact: true }).click(); await page.getByRole('menuitem', { name: 'Mark all as read', exact: true }).click();
      await expect(bell).toHaveAccessibleName('Notifications, 0 unread'); await expect(page.getByRole('menu')).toHaveCount(0);

      await page.keyboard.press('Escape'); await expect(bell).toBeFocused();
      const queue = page.getByRole('region', { name: 'Queue', exact: true });
      await expect(queue.getByRole('group', { name: 'Frequent queue filters', exact: true })).toHaveCount(0);
      const status = page.getByRole('button', { name: 'Filter queue by status', exact: true }); await status.click();
      const statusMenu = page.getByRole('menu', { name: 'Filter queue by status', exact: true });
      await statusMenu.getByRole('menuitemcheckbox', { name: /^Needs you / }).click(); await statusMenu.getByRole('menuitemcheckbox', { name: /^Running / }).click();
      await expect(statusMenu.getByRole('menuitemcheckbox', { name: /^Needs you / })).toHaveAttribute('aria-checked', 'true');
      await expect(statusMenu.getByRole('menuitemcheckbox', { name: /^Running / })).toHaveAttribute('aria-checked', 'true');
      await page.keyboard.press('Escape'); await expect(page.locator('[data-demo-row-id]:not(tr)')).toHaveCount(7);
      await status.click(); await statusMenu.getByRole('menuitemcheckbox', { name: /^All / }).click(); await page.keyboard.press('Escape');
      const attention = page.getByRole('button', { name: 'Attention first', exact: true });
      await expect(attention).toHaveAttribute('aria-pressed', 'true');
      const sort = page.getByRole('combobox', { name: 'Sort the queue', exact: true });
      await sort.click(); await expect(page.getByRole('option', { name: 'Newest first', exact: true })).toBeVisible(); await expect(page.getByRole('option', { name: 'Attention first', exact: true })).toHaveCount(0); await page.keyboard.press('Escape'); await expect(sort).toHaveAttribute('aria-expanded', 'false');
      for (const mode of ['newest', 'oldest', 'longest']) {
        await chooseSelect(sort, mode); await expect(attention).toHaveAttribute('aria-pressed', 'false'); await expect(queue.locator('[data-queue-band]')).toHaveCount(0);
      }
      await attention.click(); await expect(queue.locator('[data-queue-band]')).toHaveCount(4);
      await attention.click(); await expect(queue.locator('[data-queue-band]')).toHaveCount(0);
      await attention.click();
      const sessions = page.locator('section[aria-label="Session Panel"]');
      const toggle = sessions.locator('.session-toggle');
      const priorOpen = await toggle.getAttribute('aria-expanded');
      await toggle.hover();
      const actionsGroup = sessions.getByRole('group', { name: 'Session actions', exact: true });
      await expect(actionsGroup).toHaveCSS('background-color', theme.attribute === 'dark' ? 'color(srgb 0.890196 0.894118 0.901961 / 0.04)' : 'rgb(235, 235, 235)');
      await expect(sessions.getByRole('button', { name: 'Add workers', exact: true })).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await page.emulateMedia({ reducedMotion: 'reduce' });
      expect(await actionsGroup.evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      const actions = (await sessions.locator('.session-bar-end').boundingBox())!;
      await page.mouse.click(actions.x + 1, actions.y + 1);
      await expect(toggle).toHaveAttribute('aria-expanded', priorOpen!);
      await sessions.getByRole('button', { name: 'Add workers', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Add workers', exact: true })).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', priorOpen!); await page.keyboard.press('Escape');
      await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', priorOpen === 'true' ? 'false' : 'true');
      await toggle.click(); await expect(toggle).toHaveAttribute('aria-expanded', priorOpen!);
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(sessions).toHaveCount(0);
      await expect(queue).toHaveCount(0); await expect(rail).toBeHidden();
      const settings = page.getByRole('region', { name: 'Settings', exact: true });
      const nav = settings.getByRole('navigation', { name: 'Settings sections', exact: true });
      expect((await nav.boundingBox())!.x).toBe(0); expect((await nav.boundingBox())!.width).toBe(312);
      await expect(nav.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
      const titleBox = (await nav.locator('.settings-nav-header').boundingBox())!;
      const searchBox = (await nav.locator('.settings-nav-search').boundingBox())!;
      const personalBox = (await nav.locator('.settings-nav-group > span').first().boundingBox())!;
      expect(searchBox.y - titleBox.y - titleBox.height).toBe(15);
      expect(personalBox.y - searchBox.y - searchBox.height).toBe(15);
      await expect(nav.getByRole('button', { name: /^Notifications,|^Search runs$/u })).toHaveCount(0);
      const choosePage = async (name: string) => { await nav.getByRole('link', { name: name === 'Storage checks' ? 'Storage' : name, exact: true }).click(); };
      await nav.getByRole('searchbox', { name: 'Search settings', exact: true }).fill('sheet');
      await expect(nav.getByRole('link')).toHaveCount(1);
      await expect(nav.getByRole('link', { name: 'Spreadsheets Data', exact: true })).toBeVisible();
      await nav.getByRole('searchbox', { name: 'Search settings', exact: true }).fill('');
      await choosePage('Keyboard');
      await expect(settings.locator('.shortcut-reference-row')).toHaveCount(6);
      await expect(settings.getByRole('combobox', { name: 'Number shortcuts' })).toHaveCount(0);
      await expect(settings.getByRole('button', { name: /^Add .* shortcut$/u })).toHaveCount(0);
      const searchShortcut = settings.locator('.shortcut-reference-row').filter({ hasText: 'Search runs' });
      await searchShortcut.getByRole('button', { name: 'Remove Search runs shortcut 1' }).click();
      await expect(searchShortcut).toContainText('Unassigned');
      await searchShortcut.getByRole('button', { name: 'Edit Search runs shortcut 1' }).click();
      await page.getByRole('dialog', { name: 'Edit shortcut' }).getByRole('textbox', { name: 'Shortcut keys' }).press('/');
      await page.getByRole('dialog', { name: 'Edit shortcut' }).getByRole('button', { name: 'Save shortcut' }).click();
      const keyBox = (await searchShortcut.locator('kbd').boundingBox())!;
      const editBox = (await searchShortcut.getByRole('button', { name: 'Edit Search runs shortcut 1' }).boundingBox())!;
      expect(Math.abs(keyBox.y + keyBox.height / 2 - editBox.y - editBox.height / 2)).toBeLessThan(1);
      await settings.getByRole('button', { name: 'Edit Start a run shortcut 1', exact: true }).click();
      const edit = page.getByRole('dialog', { name: 'Edit shortcut', exact: true }); await edit.getByRole('textbox', { name: 'Shortcut keys', exact: true }).press('q'); await edit.getByRole('button', { name: 'Save shortcut', exact: true }).click();
      await expect(settings.locator('.shortcut-reference-row').filter({ hasText: 'Start a run' }).locator('kbd')).toHaveText('q');
      await settings.getByRole('button', { name: 'Edit Next run shortcut 1', exact: true }).click(); await edit.getByRole('textbox', { name: 'Shortcut keys', exact: true }).press('q'); await edit.getByRole('button', { name: 'Save shortcut', exact: true }).click(); await expect(edit).toContainText('already assigned'); await edit.getByRole('button', { name: 'Cancel', exact: true }).click();

      await settings.getByRole('button', { name: 'Back to dashboard', exact: true }).click(); await page.getByRole('button', { name: 'Start run', exact: true }).focus(); await page.keyboard.press('q');
      await expect(page.getByRole('dialog', { name: 'Start run', exact: true })).toBeVisible(); await page.keyboard.press('Escape');
      const beforeNumberKeys = page.url();
      await page.keyboard.press('Control+2'); await page.keyboard.press('Meta+2');
      expect(page.url()).toBe(beforeNumberKeys);
      await expect(workflows.getByRole('button', { name: 'Person Lookup', exact: true })).toHaveAttribute('aria-current', 'page');
      await page.reload(); await page.getByRole('button', { name: 'Settings', exact: true }).click(); await choosePage('Keyboard');
      await settings.getByRole('button', { name: 'Reset all to defaults', exact: true }).click();
      await choosePage('General');
      const date = settings.getByRole('group', { name: 'Job end date', exact: true });
      await expect(date.locator('.ds-date-text-input')).toHaveCount(0); await expect(date.getByRole('spinbutton')).toHaveCount(3);
      await date.getByRole('button', { name: /^Choose job end date/u }).click(); await expect(page.locator('.ds-calendar')).toBeVisible(); await page.keyboard.press('Escape');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width); expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
