import { expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { test } from "./helpers/fixtures.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./helpers/fixture-start.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { attachShellA11y } from "./helpers/shell-proof.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const evidence = `dashboard-e2e-${theme.attribute}-${width}.a11y.yml`;
  test(`product workflow previews retain the shell through clicks and reloads ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence }],
  }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: {
      bootstrap: FIXTURE_START_PICKER_BOOTSTRAP, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH,
    } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 });
      await installTheme(page, theme);
      await page.addInitScript(() => Reflect.set(window, "relayParityProductWorkflows", true));
      await page.goto(`${server.baseUrl}/?fixture=product-workflows&day=${FIXTURE_DAY}`);
      const assistant = page.getByRole("button", { name: "Assistant", exact: true });
      await expect(assistant).toHaveAttribute("aria-expanded", "false");
      await expect(page.locator("#hub-shell-assistant")).toBeHidden();
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      const queue = page.getByRole("region", { name: "Queue", exact: true });
      for (const label of ["I-9 Lookup", "SharePoint Download"]) {
        await rail.getByRole("button", { name: label, exact: true }).click();
        for (const reload of [false, true]) {
          if (reload) await page.reload();
          await expect(rail).toBeVisible();
          await expect(queue).toBeVisible();
          await expect(queue.locator("[data-demo-row-id]")).toHaveCount(1);
          await expect(queue.locator("[data-demo-row-id]")).toContainText("OnBase");
          await expect(page.getByRole("button", { name: "Sessions", exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "Start a run", exact: true })).toBeVisible();
          await expect(page.getByText("Page unavailable", { exact: true })).toHaveCount(0);
          expect(errors).toEqual([]);
        }
      }
      await assistant.click();
      await expect(page.locator("#hub-shell-assistant")).toBeVisible();
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
      await expect(page.locator("#hub-shell-assistant")).toBeHidden();
      await expect(assistant).toBeFocused();
      await attachShellA11y(page, info, evidence);
    } finally { await page.close(); await server.close(); }
  });
}

for (const theme of PARITY_THEMES) for (const state of ["ready", "active"] as const) {
  const evidence = `run-history-${state}-${theme.attribute}.a11y.yml`;
  test(`run history confirms finished deletion and refuses active runs ${state} ${theme.attribute}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence }],
  }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, runHistory: state, profile: { bootstrap: FIXTURE_START_PICKER_BOOTSTRAP, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH } });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?fixture=run-history&settings=storage`);
      const clear = page.getByRole("button", { name: "Clear run history", exact: true });
      if (state === "ready") {
        await expect(clear).toBeEnabled(); await clear.click();
        const confirmation = page.getByRole("dialog", { name: "Clear run history?", exact: true });
        await expect(confirmation).toContainText("Spreadsheets, settings, credentials, your account and write-safety records are kept.");
        await confirmation.getByRole("button", { name: "Clear run history", exact: true }).click();
        await expect(confirmation).toHaveCount(0);
        await expect(page.getByText("3 finished runs cleared.", { exact: true })).toBeVisible();
        await expect(page.getByText("No finished runs to clear.", { exact: true })).toBeVisible();
        await expect(clear).toBeDisabled();
        expect(await (await page.request.get(`${server.baseUrl}/api/v1/storage/run-history`)).json()).toEqual({ state: "available", finishedRuns: 0, activeRuns: 0 });
      } else {
        await expect(clear).toBeDisabled();
        await expect(page.getByText("Finish or cancel all active runs before clearing run history.", { exact: true })).toBeVisible();
        const commandId = randomUUID();
        const result = await page.request.post(`${server.baseUrl}/api/v1/storage/run-history/clear`, { data: { commandId, target: { profileId: "00000000-0000-4000-8000-000000000001", epoch: 1 } } });
        expect(await result.json()).toEqual({ state: "refused", commandId, reason: "active-runs" });
        expect(await (await page.request.get(`${server.baseUrl}/api/v1/storage/run-history`)).json()).toEqual({ state: "available", finishedRuns: 3, activeRuns: 1 });
      }
      expect(errors).toEqual([]);
      await attachShellA11y(page, info, evidence);
    } finally { await page.close(); await server.close(); }
  });
}
