import { installFrozenMonotonic, installServedSurfaces } from "./helpers/app-driver.js";

import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./helpers/fixture-start.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440, 1920]) test(`one workflow catalog supplies every current selector @ ${theme.attribute}-${width}`, async ({ page }) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: { bootstrap: FIXTURE_START_PICKER_BOOTSTRAP, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH } });
  try {
    await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 }); await installFrozenMonotonic(page); await installServedSurfaces(page); await installTheme(page, theme);
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    await page.goto(`${server.baseUrl}/?fixture=workflow-catalog&day=${FIXTURE_DAY}&sessionsPreview=empty`);
    const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
    await expect(rail.getByRole("button")).toHaveCount(14);
    const labels = await rail.getByRole("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")));
    expect(labels).toHaveLength(14);
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    const run = page.getByRole("dialog", { name: "Start run", exact: true });
    const picker = run.getByRole("navigation", { name: "Workflow", exact: true });
    const parentOnly = ["I-9 Lookup"];
    expect(await picker.getByRole("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")))).toEqual(labels.filter(label => !parentOnly.includes(label!)));
    await expect(picker.getByRole("button", { name: "OCR", exact: true })).toBeDisabled();
    await expect(picker.getByRole("button", { name: "OCR", exact: true })).toHaveAttribute("aria-description", /no standalone launch input/u);
    await expect(picker.getByRole("button", { name: "Onboarding", exact: true })).toBeEnabled();
    await expect(picker.getByRole("button", { name: "Onboarding", exact: true })).not.toHaveAttribute("aria-description", /declares no typed-input surface/u);
    for (const label of parentOnly) {
      const choice = picker.getByRole("button", { name: label, exact: true });
      await expect(choice).toHaveCount(0);
    }

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
    await page.getByRole("button", { name: /^Sessions\b/ }).click();
    await page.goto(`${server.baseUrl}/?fixture=workflow-catalog&settings=explorer&day=${FIXTURE_DAY}`);
    await page.getByRole("combobox", { name: "Explorer workflow", exact: true }).click();
    await expect(page.getByRole("option")).toHaveCount(labels.length);
    expect(await page.getByRole("option").allTextContents()).toEqual(labels);
    await page.keyboard.press("Escape");
    expect(errors).toEqual([]); expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await page.close(); await server.close(); }
});
