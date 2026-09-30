import { expect, test } from "@playwright/test";
import { registerReferenceServers, dismissWorkflowWindow } from "./helpers/reference-harness.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";

const servers = registerReferenceServers(["seeded"]);
for (const theme of PARITY_THEMES) {
  test(`terminal run archive menu — ${theme.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await installTheme(page, theme);
    await gotoAppState(page, servers.seeded.baseUrl, { day: servers.seeded.day });
    await dismissWorkflowWindow(page);
    const row = page.locator('[data-demo-row-id]').filter({ has: page.getByRole('button', { name: 'Archive', exact: true }) }).first();
    await expect(row).toBeVisible();
    await expect(row.getByRole('button', { name: 'Permanently delete', exact: true })).toHaveCount(0);
    await row.dblclick();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Archive', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Permanently delete', exact: true })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    const highlighted = menu.locator('[data-highlighted]');
    await expect(highlighted).toHaveCount(1);
    await expect(highlighted).toHaveCSS('background-color', 'rgb(24, 90, 188)');
    await page.screenshot({ path: test.info().outputPath(`menu-${theme.name}.png`) });
    await page.keyboard.press('Escape');
    await row.click({ button: 'right' }); await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await row.focus(); await page.keyboard.press('Shift+F10'); await expect(menu).toBeVisible();
  });
}

test("Archive footer transfers to the saved report through the production command service", async ({ page }) => {
  const { startQueueAuthorityServer } = await import('./helpers/queue-authority-server.js');
  const server = await startQueueAuthorityServer();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAppState(page, server.baseUrl, { day: server.day });
    await dismissWorkflowWindow(page);
    const runId = server.runIds.doneRun;
    const row = page.locator(`[data-demo-row-id='${runId}']`).first();
    const response = page.waitForResponse(reply => reply.url().endsWith('/api/v1/commands') && reply.request().method() === 'POST');
    await row.getByRole('button', { name: 'Archive', exact: true }).click();
    const reply = await response;
    expect(reply.request().postDataJSON()).toMatchObject({ family: 'run', type: 'archive', target: { runId } });
    expect(await reply.json()).toMatchObject({ state: 'applied' });
    await expect(row).toHaveCount(0);
    expect(server.authority().authority.deletedRuns.get(runId)).toBeUndefined();
    expect(server.authority().authority.runs.get(runId)).toBeUndefined();
    await page.getByRole('banner').getByRole('button', { name: 'Archive', exact: true }).click();
    await page.getByRole('region', { name: 'Version not recorded archives' }).getByRole('button', { name: 'person-lookup Workflow version not recorded 1 run', exact: true }).click();
    await expect(page.getByRole('table', { name: 'person-lookup saved runs' })).toBeVisible();
    await page.getByRole('table', { name: 'person-lookup saved runs' }).getByRole('button').first().click();
    await expect(page.getByRole('article', { name: 'Saved archive report' })).toBeVisible();
  } finally { await server.close(); }
});
