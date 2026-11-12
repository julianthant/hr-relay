import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { installServedSurfaces } from "./helpers/app-driver.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./helpers/fixture-start.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { personLookupModule } from "../support/helpers/registered-workflows.js";
import { projectWorkflowStartSteps } from "../../src/backend/runs/queries/bootstrap.js";
import { WorkflowBootstrapPrimitiveSchema } from "../../src/models/dashboard/bootstrap.js";
import { startRunRerunServer } from "./helpers/run-rerun-server.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

// Writes review-row previews of the served Run dialog (light and dark) to RUN_DIALOG_PREVIEW_DIR; skipped when unset.
const out = process.env.RUN_DIALOG_PREVIEW_DIR;
test.skip(out === undefined, "set RUN_DIALOG_PREVIEW_DIR to capture previews");

async function shoot(page: Page, theme: string, name: string): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(out!, `${name}-${theme}.png`), animations: "disabled" });
}

const pdf = { name: "Scan_0412.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") };
// The picker fixture's Person Lookup start surface is hand-written; the real descriptor carries the typed Lookup mode.
const personLookup = personLookupModule.descriptor;
const lookupBootstrap = { ...FIXTURE_START_PICKER_BOOTSTRAP, workflows: FIXTURE_START_PICKER_BOOTSTRAP.workflows.map(entry => WorkflowBootstrapPrimitiveSchema.parse(entry)).map(flow => flow.id !== "person-lookup" ? flow
  : { ...flow, start: { ...flow.start, steps: projectWorkflowStartSteps(personLookup), inputRun: personLookup.surfaces.inputRun } }) };

for (const theme of ["light", "dark"]) test(`run dialog previews ${theme}`, async ({ page }) => {
  await mkdir(resolve(out!), { recursive: true });
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" },
    profile: { bootstrap: lookupBootstrap, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH } });
  try {
    await page.addInitScript(value => Reflect.set(window, "relayParityTheme", value), theme);
    await installServedSurfaces(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
    const picker = dialog.getByRole("navigation", { name: "Workflow", exact: true });
    await picker.getByRole("button", { name: "Person Lookup", exact: true }).click();
    await shoot(page, theme, "27-person-lookup-input");
    await dialog.getByRole("textbox", { name: /^Employee IDs/u }).fill("10000001");
    await shoot(page, theme, "27-person-lookup-filled");
    await picker.getByRole("button", { name: /^OnBase/u }).first().click();
    await shoot(page, theme, "28-onbase");
    // Emergency Contact starts through the mock run form in this fixture; OnBase is the served PDF dialog with the same reference rows.
    await dialog.locator('input[type="file"]').setInputFiles(pdf);
    await dialog.getByRole("button", { name: "Add spreadsheet", exact: true }).click();
    await shoot(page, theme, "39-picker-open");
    await page.getByRole("textbox", { name: "Find a spreadsheet" }).fill("sheet");
    await shoot(page, theme, "38-picker-search");
    await page.keyboard.press("Escape");
    await shoot(page, theme, "05-pdf-input-references");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await shoot(page, theme, "05b-pdf-options");
    await expect(dialog).toBeVisible();
  } finally { await page.close(); await server.close(); }
});

for (const theme of ["light", "dark"]) test(`run dialog rerun previews ${theme}`, async ({ page }) => {
  await mkdir(resolve(out!), { recursive: true });
  const server = await startRunRerunServer();
  try {
    await page.addInitScript(value => Reflect.set(window, "relayParityTheme", value), theme);
    await page.setViewportSize({ width: 1280, height: 720 });
    await gotoAppState(page, server.baseUrl, { day: server.day });
    await page.getByRole("button", { name: "Rerun", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Rerun", exact: true });
    await expect(dialog.getByRole("heading", { name: "Choose what to run again", exact: true })).toBeVisible();
    await shoot(page, theme, "06-rerun-steps");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm", exact: true }).click();
    await shoot(page, theme, "06-rerun-values");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await shoot(page, theme, "06b-rerun-options");
  } finally { await page.close(); await server.close(); }
});

for (const theme of ["light", "dark"]) test(`run dialog beside the assistant ${theme}`, async ({ page }) => {
  await mkdir(resolve(out!), { recursive: true });
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" },
    profile: { bootstrap: lookupBootstrap, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH } });
  try {
    await page.addInitScript(value => Reflect.set(window, "relayParityTheme", value), theme);
    await installServedSurfaces(page);
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
    await page.getByRole("button", { name: "Assistant", exact: true }).click();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
    await dialog.getByRole("navigation", { name: "Workflow", exact: true }).getByRole("button", { name: "Separations", exact: true }).click();
    await shoot(page, theme, "31-separations-assistant");
  } finally { await page.close(); await server.close(); }
});
