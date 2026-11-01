import { CommandResultSchema, StartCommandRequestSchema } from "../../src/rules/commands/commands.js";
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
        await expect(page.getByRole("button", { name: /not startable/u })).toHaveCount(0);
        await expect(page.getByTitle("A proving harness of separations — a step of that workflow, not a workflow of its own")).toHaveCount(0);

        await assertShellGeometry(page, `start-run-separations @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations picker").toEqual([]);



        await page.getByRole("dialog", { name: "Start a run" }).getByRole("button", { name: "Close" }).click();
        await page.getByRole("button", { name: "Add workers" }).click();
        const workerWorkflow = page.getByRole("dialog", { name: "Add workers" })
          .getByRole("combobox", { name: "Workflow" });
        await workerWorkflow.click();
        await expect(page.getByRole("option")).toHaveText(["Person Lookup", "I-9 Lookup", "Separations", "I-9 Check", "Onboarding", "Oath Signature", "Oath Upload", "Emergency Contact", "Work-Study", "Kronos Pay Rule", "OCR", "CRM Doc Download", "SharePoint Download", "OnBase", "Old Kronos Reports"]);
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
        await page.goto(`${servers.separationsStartServer.baseUrl}/?day=${FIXTURE_DAY}&start=1&view=${encodeURIComponent(JSON.stringify({ workflow: "separations", launchServed: "separations" }))}`);
        await assertThemeApplied(page, theme satisfies ParityTheme);

        await expect(page.getByRole("dialog", { name: "Start a run", exact: true })).toContainText("New work · Separations");

        await expect(page.getByRole("tablist", { name: "How to start this run" })).toHaveCount(0);
        const typedDocument = page.getByPlaceholder(
          "Enter Kuali IDs, semicolon-separated (e.g. 4502; 4510)",
        );
        await typedDocument.fill("4502");
        await expect(typedDocument).toHaveValue("4502");
        await assertShellGeometry(page, `separations-start-input @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations Start Run input").toEqual([]);



        await page.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(page.getByRole("checkbox", { name: "Customize steps" })).toBeVisible();



        await page.getByRole("checkbox", { name: "Customize steps" }).check();
        await page.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Workflow steps" })).toBeVisible();
        await expect(page.getByText("6 / 6 included", { exact: true })).toBeVisible();




        await page.getByRole("checkbox", { name: "Kronos timecard" }).uncheck();
        await expect(page.getByText("5 / 6 included", { exact: true })).toBeVisible();
        await page.getByRole("textbox", { name: "Last day worked", exact: true }).fill("06/30/2026");
        await page.getByRole("textbox", { name: "Separation date", exact: true }).fill("07/01/2026");
        await expect(page.getByRole("textbox", { name: "Separation date", exact: true })).toHaveValue("07/01/2026");
        expect(errors, "page errors while rendering the omitted separations step").toEqual([]);



        // Put it back, so the plan capture below photographs the same request
        // it always did: the drafts leave with the omission.
        await page.getByRole("checkbox", { name: "Kronos timecard" }).check();
        await expect(page.getByText("6 / 6 included", { exact: true })).toBeVisible();

        await page.getByRole("button", { name: "Preview plan", exact: true }).click();
        await expect(page.getByRole("heading", { name: "1 run ready to queue", exact: true })).toBeVisible();
        await expect(page.getByText("4502", { exact: true })).toBeVisible();
        await expect(page.getByText(/Julian Zaw/u)).toHaveCount(0);
        await assertShellGeometry(page, `separations-start-plan @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations Start Run plan").toEqual([]);



        const appliedResponse = page.waitForResponse(response => response.url().endsWith("/api/v1/commands") && response.request().method() === "POST");
        await page.getByRole("button", { name: "Start 1 run", exact: true }).click();
        const response = await appliedResponse;
        expect(response.ok()).toBe(true);
        const request = StartCommandRequestSchema.parse(response.request().postDataJSON());
        expect(request.target.workflowId).toBe("separations");
        const result = CommandResultSchema.parse(await response.json());
        expect(result.state).toBe("applied");
        await expect(page.getByRole("dialog", { name: "Start a run", exact: true })).toHaveCount(0);
        await expect(page.locator("#dashboard-run-start-door")).toBeFocused();
        await expect(page.getByText(/Julian Zaw/u)).toHaveCount(0);
        await assertShellGeometry(page, `separations-start-result @ ${viewport.name} ${theme.name}`);
        expect(errors, "page errors while rendering the separations Start Run result").toEqual([]);

      });
    }
  }
});
