import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';
import type { PreviewServer } from 'vite';
import { test } from './helpers/fixtures.js';
import { previewComponentFixture } from './helpers/component-fixtures.js';

const renderDir = process.env.SESSIONS_BAR_RENDER_DIR;
const themes = [
  { name: 'light', hover: 'color(srgb 0.105882 0.105882 0.105882 / 0.04)' },
  { name: 'dark', hover: 'color(srgb 0.890196 0.894118 0.901961 / 0.04)' },
] as const;

let server: PreviewServer;
let baseUrl: string;
test.beforeAll(async () => {
  if (renderDir) mkdirSync(renderDir, { recursive: true });
  server = await previewComponentFixture('approved-controls');
  const address = server.httpServer.address();
  if (!address || typeof address === 'string') throw new Error('sessions-bar-server-address-invalid');
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => {
  await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done()));
});

async function painted(page: Page, x: number, y: number) {
  return page.evaluate(({ x, y }) => {
    for (const node of document.elementsFromPoint(x, y)) {
      const color = getComputedStyle(node).backgroundColor;
      if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
    }
    return 'none';
  }, { x, y });
}

async function save(panel: Locator, name: string) {
  if (!renderDir) return;
  await panel.screenshot({ path: join(renderDir, `${name}.png`) });
}

for (const theme of themes) {
  test(`sessions bar tint covers the icon group @ ${theme.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${baseUrl}/?surface=sessions-bar&theme=${theme.name}`);
    const panel = page.getByRole('region', { name: 'Session Panel', exact: true });
    const bar = panel.getByRole('group', { name: 'Session actions', exact: true });
    const toggle = panel.getByRole('button', { name: /^Sessions\b/ });
    const add = panel.getByRole('button', { name: 'Add workers', exact: true });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.getByRole('button', { name: 'Log out', exact: true })).toBeVisible();
    await expect(bar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await save(panel, `${theme.name}-rest`);

    await toggle.hover();
    await expect(bar).toHaveCSS('background-color', theme.hover);
    await expect(add).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    const box = (await bar.boundingBox())!;
    const y = box.y + box.height / 2;
    const addBox = (await add.boundingBox())!;
    expect(await painted(page, box.x + 8, y)).toBe(theme.hover);
    expect(await painted(page, addBox.x + addBox.width / 2, addBox.y + addBox.height / 2)).toBe(theme.hover);
    expect(await painted(page, box.x + box.width - 4, y)).toBe(theme.hover);
    expect(await bar.evaluate(node => getComputedStyle(node).transitionDuration)).toBe('0s');
    await save(panel, `${theme.name}-hover`);

    await page.mouse.down();
    await expect(bar).toHaveCSS('background-color', theme.hover);
    await save(panel, `${theme.name}-pressed`);
    await page.mouse.up();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await page.mouse.move(0, 0);
    await page.keyboard.press('Tab');
    await toggle.focus();
    const focus = await toggle.evaluate(node => ({
      active: document.activeElement === node,
      visible: node.matches(':focus-visible'),
      bar: getComputedStyle(node.parentElement!).backgroundColor,
      outline: getComputedStyle(node).outlineStyle,
      filled: getComputedStyle(node).backgroundColor !== 'rgba(0, 0, 0, 0)',
    }));
    expect(focus, JSON.stringify(focus)).toEqual({ active: true, visible: true, bar: 'rgba(0, 0, 0, 0)', outline: 'none', filled: true });
    await save(panel, `${theme.name}-focus`);

    await add.hover();
    const iconBox = (await add.boundingBox())!;
    expect(iconBox.width).toBe(24);
    expect(iconBox.height).toBe(24);
    await expect(add).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(bar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await panel.getByRole('button', { name: 'Settings', exact: true }).click();
    await panel.getByRole('button', { name: 'Log out', exact: true }).click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await page.goto(`${baseUrl}/?surface=sessions-bar&theme=${theme.name}&open=1`);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByRole('article')).toHaveCount(4);
    await expect(bar).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await save(panel, `${theme.name}-expanded`);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
}
