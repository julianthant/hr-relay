
import { expect, type Locator, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { gotoAppState } from "./helpers/app-driver.js";

import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { startSetupPreflightServer } from "./helpers/fixture-setup-preflight.js";
import { dismissWorkflowWindow, failOnPageErrors } from "./helpers/reference-harness.js";
import { chooseSelect } from "./helpers/select-choice.js";

async function geometry(setup: Locator) {
  return {
    summary: await setup.getByRole("group", { name: "Readiness summary", exact: true }).boundingBox(),
    workflow: await setup.locator(".workflow-operations-card").first().boundingBox(),
    runtime: await setup.getByRole("group", { name: "Runtime", exact: true }).boundingBox(),
    scope: await setup.getByRole("combobox").boundingBox(),
    button: await setup.getByRole("button", { name: /^(Run checks again|Run preflight)$/u }).boundingBox(),
  };
}

async function holdRefresh(page: Page) {
  const command = Promise.withResolvers<void>();
  const readback = Promise.withResolvers<void>();
  const commandStarted = Promise.withResolvers<void>();
  const readbackStarted = Promise.withResolvers<void>();
  await page.route("**/api/v1/preflight/rerun", async route => {
    commandStarted.resolve();
    await command.promise;
    await route.continue();
  });
  await page.route(/\/api\/v1\/preflight(?:\?|$)/u, async route => {
    readbackStarted.resolve();
    await readback.promise;
    await route.continue();
  });
  return { command, readback, commandStarted, readbackStarted,
    async close() { command.resolve(); readback.resolve(); await page.unrouteAll({ behavior: "wait" }); },
  };
}

test.beforeAll(() => { });
for (const scene of ["healthy", "secret-missing"] as const) for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`Preflight refresh preserves cards through command and readback ${scene} ${theme.name} ${String(width)}`, async ({ page }, info) => {
    const server = await startSetupPreflightServer(scene);
    let held: Awaited<ReturnType<typeof holdRefresh>> | undefined;
    try {
      const errors = failOnPageErrors(page);
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 });
      await page.clock.setFixedTime(new Date(server.now));
      await installTheme(page, theme);
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "preflight" });
      await dismissWorkflowWindow(page);
      const setup = page.getByRole("region", { name: "Preflight", exact: true });
      if (scene === "secret-missing") await chooseSelect(setup.getByRole("combobox"), server.scope);
      const summary = setup.getByRole("group", { name: "Readiness summary", exact: true });
      await expect(summary).toContainText(scene === "healthy" ? "Ready to run" : "attention");
      const disclosure = setup.locator(".workflow-operations-card").first().getByRole("button").first();
      await expect(disclosure).toHaveAttribute("aria-expanded", "true");
      await disclosure.click();
      await expect(disclosure).toHaveAttribute("aria-expanded", "false");
      const rows = setup.locator(".diagnostic-check-entry");
      const rowText = await rows.allTextContents();
      const timestamp = await setup.locator("time").getAttribute("datetime");
      await setup.evaluate(element => { Reflect.set(window, "preflightRefreshNodes", [...element.querySelectorAll(".diagnostic-summary, .workflow-operations-card, .diagnostic-check-entry")]); });
      const before = await geometry(setup);
      held = await holdRefresh(page);
      const run = setup.getByRole("button", { name: /^(Run checks again|Run preflight)$/u });
      await run.click();
      await held.commandStarted.promise;
      await expect(run).toBeDisabled();
      expect(await geometry(setup)).toEqual(before);
      await expect(run).toHaveText("Run preflight");
      await expect(run).toHaveAttribute("aria-busy", "true");
      await expect(summary).toContainText("Checking readiness");
      await expect(summary).not.toContainText("Ready to run");
      await expect(setup.getByText("Previous result", { exact: true })).toHaveCount(0);
      await expect(setup.getByRole("status", { name: /Loading/u })).toHaveCount(0);
      expect(await rows.allTextContents()).toEqual(rowText);
      await expect(setup.locator("time")).toHaveAttribute("datetime", timestamp ?? "");
      await expect(disclosure).toHaveAttribute("aria-expanded", "false");
      expect(await setup.evaluate(element => {
        const retained = Reflect.get(window, "preflightRefreshNodes") as Element[];
        return [...element.querySelectorAll(".diagnostic-summary, .workflow-operations-card, .diagnostic-check-entry")].every((node, index) => node === retained[index]);
      })).toBe(true);

      held.command.resolve();
      await held.readbackStarted.promise;
      await expect(run).toBeDisabled();
      await expect(summary).toContainText("Checking readiness");
      expect(await geometry(setup)).toEqual(before);
      held.readback.resolve();
      await expect(run).toBeEnabled();
      await expect(run).not.toHaveAttribute("aria-busy", "true");
      await expect(summary).toContainText(scene === "healthy" ? "Ready to run" : "attention");
      expect(await geometry(setup)).toEqual(before);
      expect(await rows.allTextContents()).toEqual(rowText);
      expect(server.requests.some(request => request.method === "POST" && request.path === "/api/v1/preflight/rerun" && request.status === 200)).toBe(true);
      expect(errors).toEqual([]);
      await info.attach("refresh-geometry.json", { body: JSON.stringify({ before, after: await geometry(setup), provenance: server.provenance(), requests: server.requests }), contentType: "application/json" });
    } finally { await held?.close(); await server.close(); }
  });
}

for (const theme of PARITY_THEMES) test(`Preflight refresh retains its existing expired warning ${theme.name}`, async ({ page }) => {
  const server = await startSetupPreflightServer("stale");
  let held: Awaited<ReturnType<typeof holdRefresh>> | undefined;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(new Date(server.now));
    await installTheme(page, theme);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, settings: "preflight" });
    await dismissWorkflowWindow(page);
    const setup = page.getByRole("region", { name: "Preflight", exact: true });
    await expect(setup).toContainText("Previous check");
    await expect(setup.locator(".workflow-operations-card").first()).toBeVisible();
    const before = await geometry(setup);
    const notice = await setup.getByRole("status").filter({hasText:"Previous result"}).textContent();
    held = await holdRefresh(page);
    await setup.getByRole("button", { name: /^(Run checks again|Run preflight)$/u }).click();
    await held.commandStarted.promise;
    await expect(setup.getByRole("group", { name: "Readiness summary", exact: true })).toContainText("Checking readiness");
    expect(await geometry(setup)).toEqual(before);
    expect(await setup.getByRole("status").filter({hasText:"Previous result"}).textContent()).toBe(notice);
    await expect(setup).not.toContainText("Ready to run");
    held.command.resolve(); await held.readbackStarted.promise;
    expect(await geometry(setup)).toEqual(before);
    held.readback.resolve();
    await expect(setup.getByRole("button", { name: "Run preflight", exact: true })).toBeEnabled();
    await expect(setup).toContainText("Ready to run");
    await expect(setup.getByText("Previous result", { exact: true })).toHaveCount(0);
  } finally { await held?.close(); await server.close(); }
});
