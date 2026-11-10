import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_THEMES, PARITY_VIEWPORTS, assertThemeApplied, installTheme, type ParityTheme } from "./helpers/capture.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

import { assertShellGeometry } from "./helpers/geometry.js";
import { failOnPageErrors, registerReferenceServers } from "./helpers/reference-harness.js";
import { registerReferenceScenes } from "./helpers/reference-scenes.js";
import { ANCHORS,SCENES } from "./helpers/reference-start-scenes.js";
const servers = registerReferenceServers(["server","startPickerServer","separationsStartServer"]);
registerReferenceScenes(SCENES, () => servers.server, ANCHORS);


/** Served Separations preserves omission facts through planning, then returns focus to Start after application. */
const SEPARATIONS_START_VIEWPORTS = PARITY_VIEWPORTS;




/** The served picker fixture shares the complete frontend catalog with Add workers. */
test.describe("start-run picker hierarchy", () => {
  for (const viewport of PARITY_VIEWPORTS) {
    for (const theme of PARITY_THEMES) {
      test(`${theme.name} @ ${viewport.name}`, async ({ page }) => {
        const errors = failOnPageErrors(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await installTheme(page, theme satisfies ParityTheme);
        await gotoAppState(page, servers.startPickerServer.baseUrl, { day: FIXTURE_DAY, start: true });
        await assertThemeApplied(page, theme satisfies ParityTheme);
        await page.waitForTimeout(120);

        const picker = page.getByRole("navigation", { name: "Workflow" });
        await expect(picker.getByRole("button", { name: "Separations", exact: true })).toBeVisible();
        await expect(picker.getByRole("button", { name: "Person Lookup", exact: true })).toBeVisible();
        await expect(picker.getByRole("button", { name: "I-9 Lookup", exact: true })).toHaveCount(0);
        await expect(picker.getByRole("button", { name: "SharePoint Download", exact: true })).toHaveCount(0);
        await expect(page.getByRole("button", { name: /not startable/u })).toHaveCount(0);
        await expect(page.getByTitle("A proving harness of separations — a step of that workflow, not a workflow of its own")).toHaveCount(0);

        await assertShellGeometry(page, `start-run-separations @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations picker").toEqual([]);



        await page.getByRole("dialog", { name: "Start run" }).getByRole("button", { name: "Close" }).click();
        await page.getByRole("button", { name: "Add workers" }).click();
        const workerWorkflow = page.getByRole("dialog", { name: "Add workers" })
          .getByRole("combobox", { name: "Workflow" });
        await workerWorkflow.click();
        await expect(page.getByRole("option")).toHaveText(["Person Lookup", "I-9 Lookup", "Separations", "I-9 Check", "Onboarding", "Emergency Contact", "Oath Signature", "Oath Upload", "Work-Study", "Kronos Pay Rule", "CRM Document Download", "OCR", "OnBase", "Old Kronos Reports"]);
      });
    }
  }
});


test.describe("separations start-run continuity", () => {
  for (const viewport of SEPARATIONS_START_VIEWPORTS) {
    for (const theme of PARITY_THEMES) {
      test(`${theme.name} @ ${viewport.name}`, async ({ page }) => {
        const errors = failOnPageErrors(page);
        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await installTheme(page, theme satisfies ParityTheme);
        await gotoAppState(page, servers.separationsStartServer.baseUrl, { day: FIXTURE_DAY });
        await assertThemeApplied(page, theme satisfies ParityTheme);

        await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Separations", exact: true }).click();
        await page.getByRole("button", { name: "Start run", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
        await expect(dialog).toContainText("Separations");
        await expect(page.getByRole("tablist", { name: "How to start this run" })).toHaveCount(0);
        const typedDocument = dialog.getByRole("textbox", { name: "Kuali ID", exact: true });
        await typedDocument.fill("4502");
        await expect(typedDocument).toHaveValue("4502");
        await assertShellGeometry(page, `separations-start-input @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations Start Run input").toEqual([]);

        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        const customize = dialog.getByRole("switch", { name: "Customize steps", exact: true });
        await expect(customize).toBeVisible();
        await customize.check();
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        const steps = dialog.getByRole("region", { name: "Steps", exact: true }).last();
        const total = await steps.locator(".ds-run-row").count();
        expect(total).toBeGreaterThan(0);
        await expect(dialog).toContainText(`${total} of ${total} steps`);

        const optional = steps.getByRole("switch", { name: /^Include / }).and(steps.locator(":enabled")).first();
        await optional.uncheck();
        await expect(dialog).toContainText(`${total - 1} of ${total} steps`);
        expect(errors, "page errors while rendering the omitted separations step").toEqual([]);

        // Put it back so the start request carries every step.
        await optional.check();
        await expect(dialog).toContainText(`${total} of ${total} steps`);
        await assertShellGeometry(page, `separations-start-plan @ ${viewport.name} ${theme.name}`);

        await dialog.getByRole("button", { name: /^Start (dry|live) run$/u }).click();
        await expect(page.getByText("Run started", { exact: true }).last()).toBeVisible();
        await expect(page.getByRole("dialog", { name: "Start run", exact: true })).toHaveCount(0);
        await expect(page.locator("#dashboard-run-start-door")).toBeFocused();
        await assertShellGeometry(page, `separations-start-result @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations Start Run result").toEqual([]);
      });
    }
  }
});
