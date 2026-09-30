import { CommandRequestSchema } from "../../src/domain/commands.js";
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

for (const outcome of ["done", "failed"] as const) test(`Archive footer transfers ${outcome} run to the saved report through the production command service`, async ({ page }) => {
  const { startQueueAuthorityServer } = await import('./helpers/queue-authority-server.js');
  const server = await startQueueAuthorityServer();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoAppState(page, server.baseUrl, { day: server.day });
    await dismissWorkflowWindow(page);
    const runId = outcome === "done" ? server.runIds.doneRun : server.runIds.failedRun;
    const row = page.locator(`[data-demo-row-id='${runId}']`).first();
    const response = page.waitForResponse(reply => reply.url().endsWith('/api/v1/commands') && reply.request().method() === 'POST');
    await row.getByRole('button', { name: 'Archive', exact: true }).click();
    const reply = await response;
    expect(reply.request().postDataJSON()).toMatchObject({ family: 'run', type: 'archive', target: { runId } });
    const result: unknown = await reply.json();
    expect(result, JSON.stringify(result)).toMatchObject({ state: 'applied' });
    await expect(page.getByRole('region', { name: 'Notifications', exact: true }).getByText('Run archived', { exact: true })).toBeVisible();
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

for (const responseKind of ["refused", "lost"] as const) test(`Archive toast reports ${responseKind} response without claiming success`, async ({ page }) => {
  const { startQueueAuthorityServer } = await import('./helpers/queue-authority-server.js');
  const server = await startQueueAuthorityServer();
  try {
    await gotoAppState(page, server.baseUrl, { day: server.day });
    await dismissWorkflowWindow(page);
    const requests: unknown[] = [];
    await page.route('**/api/v1/commands', async route => {
      const request = CommandRequestSchema.parse(route.request().postDataJSON());
      requests.push(request);
      if (responseKind === 'refused') {
        await route.fulfill({ status: 422, json: { state: 'rejected', commandId: request.commandId,
          code: 'invalid-state', message: 'Only a terminal run can be archived; cancel it first.' } });
      } else {
        const response = await route.fetch();
        if (requests.length === 1) await route.abort('failed');
        else await route.fulfill({ response });
      }
    });
    const runId = server.runIds.failedRun;
    const row = page.locator(`[data-demo-row-id='${runId}']`).first();
    await row.getByRole('button', { name: 'Archive', exact: true }).click();
    const toasts = page.getByRole('region', { name: 'Notifications', exact: true });
    await expect(toasts.getByRole('alert')).toContainText(responseKind === 'refused' ? 'Could not archive run' : 'Archive result unknown');
    await expect(toasts.getByText('Run archived', { exact: true })).toHaveCount(0);
    const recovery = page.getByRole('region', { name: 'Commands awaiting recovery' });
    if (responseKind === 'refused') {
      await expect(row).toBeVisible();
      await expect(recovery).toHaveCount(0);
      await toasts.getByRole('button', { name: 'Could not archive run', exact: true }).click();
      await expect(toasts.getByRole('alert')).toContainText('Only a terminal run can be archived; cancel it first.');
    } else {
      await expect(recovery).toBeVisible();
      await expect(row).toHaveCount(0);
      await recovery.getByRole('button', { name: 'Review Archive (1 run)', exact: true }).click();
      await page.getByRole('dialog', { name: 'Recover previous Archive', exact: true }).getByRole('button', { name: 'Resend original request', exact: true }).click();
      await expect(recovery).toHaveCount(0);
      await expect(toasts.getByText('Run archived', { exact: true })).toBeVisible();
      expect(requests).toHaveLength(2);
      expect(requests[1]).toEqual(requests[0]);
    }
  } finally { await server.close(); }
});
