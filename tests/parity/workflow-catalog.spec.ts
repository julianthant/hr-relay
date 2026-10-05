import { expect, test } from "@playwright/test";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./helpers/fixture-start.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440, 1920]) test(`one workflow catalog supplies every current selector @ ${theme.attribute}-${width}`, async ({ page }, info) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: { bootstrap: FIXTURE_START_PICKER_BOOTSTRAP, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH } });
  try {
    await page.setViewportSize({ width, height: width === 1024 ? 720 : 900 }); await installTheme(page, theme);
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&sessionsPreview=empty`);
    const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
    await expect(rail.getByRole("button")).toHaveCount(15);
    const labels = await rail.getByRole("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")));
    expect(labels).toHaveLength(15);
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    const run = page.getByRole("dialog", { name: "Start a run", exact: true });
    const picker = run.getByRole("navigation", { name: "Workflow", exact: true });
    expect(await picker.getByRole("button").evaluateAll(buttons => buttons.map(button => button.getAttribute("aria-label")))).toEqual(labels);
    for (const label of ["OCR", "I-9 Lookup"]) {
      const choice = picker.getByRole("button", { name: label, exact: true });
      await expect(choice).toBeDisabled(); await expect(choice).toHaveAttribute("aria-description", "Started by a parent workflow.");
    }
    await info.attach(`catalog-run-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
    await page.keyboard.press("Escape");
    for (const label of labels) {
      await page.getByRole("button", { name: "Add workers", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Add workers", exact: true });
      await dialog.getByRole("combobox").click();
      await expect(page.getByRole("option")).toHaveCount(labels.length);
      expect(await page.getByRole("option").allTextContents()).toEqual(labels);
      await page.getByRole("option", { name: label!, exact: true }).click();
      await dialog.getByRole("spinbutton", { name: "Workers", exact: true }).fill("2");
      await info.attach(`catalog-workers-${label}-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
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
    await page.goto(`${server.baseUrl}/?settings=archive&day=${FIXTURE_DAY}`);
    await page.getByRole("combobox", { name: "Archived workflow", exact: true }).click();
    await expect(page.getByRole("option")).toHaveCount(labels.length + 1);
    const archiveLabels = await page.getByRole("option").allTextContents();
    expect(archiveLabels.slice(1, 16)).toEqual(labels);
    await info.attach(`catalog-archive-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
    expect(errors).toEqual([]); expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await page.close(); await server.close(); }
});
