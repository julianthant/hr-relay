import { installFrozenMonotonic } from "./helpers/app-driver.js";

import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./helpers/fixture-start.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { attachShellA11y } from "./helpers/shell-proof.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440, 1920]) test(`one workflow catalog supplies every current selector @ ${theme.attribute}-${width}`, { annotation: [{ type: "required-a11y-evidence", description: `catalog-run-${theme.attribute}-${width}.a11y.yml` }] }, async ({ page }, info) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: { bootstrap: FIXTURE_START_PICKER_BOOTSTRAP, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH } });
  try {
    await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 }); await installFrozenMonotonic(page); await installTheme(page, theme);
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&sessionsPreview=empty`);
    await page.getByRole("button", { name: "Close assistant", exact: true }).click();
    const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
    await expect(rail.getByRole("button")).toHaveCount(15);
    const labels = await rail.getByRole("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")));
    expect(labels).toHaveLength(15);
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    const run = page.getByRole("dialog", { name: "Start a run", exact: true });
    const picker = run.getByRole("navigation", { name: "Workflow", exact: true });
    expect(await picker.getByRole("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")))).toEqual(labels);
    await expect(picker.getByRole("button", { name: "OCR", exact: true })).toBeEnabled();
    for (const label of ["SharePoint Download", "I-9 Lookup"]) {
      const choice = picker.getByRole("button", { name: label, exact: true });
      await expect(choice).toBeDisabled(); await expect(choice).toHaveAttribute("aria-description", "Started by a parent workflow.");
    }

    await attachShellA11y(page, info, `catalog-run-${theme.attribute}-${width}.a11y.yml`);
    await page.keyboard.press("Escape");
    for (const label of labels) {
      await page.getByRole("button", { name: "Add workers", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add workers", exact: true });
      await dialog.getByRole("combobox").click();
      await expect(page.getByRole("option")).toHaveCount(labels.length);
      expect(await page.getByRole("option").allTextContents()).toEqual(labels);
      await page.getByRole("option", { name: label!, exact: true }).click();
      await dialog.getByRole("spinbutton", { name: "Workers", exact: true }).fill("2");

      await dialog.getByRole("button", { name: "Add workers", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      await expect(page.getByRole("article", { name: new RegExp(`^Worker \\d+ · ${label?.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`, "u") })).toHaveCount(2);
    }
    await page.getByRole("button", { name: "Sessions", exact: true }).click();
    await page.goto(`${server.baseUrl}/?settings=explorer&day=${FIXTURE_DAY}`);
    await page.getByRole("combobox", { name: "Explorer workflow", exact: true }).click();
    await expect(page.getByRole("option")).toHaveCount(labels.length);
    expect(await page.getByRole("option").allTextContents()).toEqual(labels);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]); expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await page.close(); await server.close(); }
});
