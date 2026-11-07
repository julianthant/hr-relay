import { attachPresentationReference } from "./helpers/presentation-reference.js";

import { chooseSelect } from "./helpers/select-choice.js";
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

for (const theme of PARITY_THEMES) for (const width of [1280]) {
  const evidence = `explorer-preview-${theme.attribute}-${width}.a11y.yml`;
  test(`complete Explorer layout and source return @ ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence }],
  }, async ({ page }) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: 720 });
      await installTheme(page, theme);
      const requests: string[] = [];
      page.on("request", (request) => { if (request.method() !== "GET" || /\/api\/v1\/(?:explorer|runs\/)/u.test(new URL(request.url()).pathname)) requests.push(`${request.method()} ${request.url()}`); });
      await page.goto(`${server.baseUrl}/?explore=fixture-ui-explorer`);
      const surface = page.getByRole("region", { name: "Workflow explorer preview", exact: true });
      await expect(surface).toBeVisible();
      await expect(surface.getByRole("list", { name: "Workflow steps" }).getByRole("listitem")).toHaveCount(22);
      await expect(surface).toContainText("Browse workflows, their steps and field sources.");
      await expect(surface).not.toContainText("Fictional preview data");
      const workflows = surface.getByRole("combobox", { name: "Explorer workflow", exact: true });
      await expect(workflows).toHaveAttribute("data-value", "fixture-separations");
      await workflows.click();
      await expect(page.locator('[data-slot="select-content"][data-open]').getByRole("option")).toHaveText(["Person Lookup", "I-9 Lookup", "Separations", "I-9 Check", "Onboarding", "Oath Signature", "Oath Upload", "Emergency Contact", "Work-Study", "Kronos Pay Rule", "OCR", "CRM Doc Download", "SharePoint Download", "OnBase", "Old Kronos Reports"]);
      await attachPresentationReference(page, test.info(), "explorer-workflow-menu.png");
      await page.keyboard.press("Escape");
      await expect(surface.getByRole("complementary", { name: "Workflow browser" })).toHaveCount(0);
      expect(await surface.locator('[data-step-number="1"] > span').evaluate((node) => node.getBoundingClientRect().width)).toBe(28);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(surface.getByRole("button", { name: "Back to dashboard" })).toHaveCount(0);
      for (const name of ["Expand all", "Collapse all", "Version registry", "Show action legend"]) {
        await expect(surface.getByRole("button", { name, exact: true })).toHaveCount(0);
      }
      const snapshot = await surface.ariaSnapshot();
      test.info().annotations.push({ type: `a11y-attachment-sha256:${evidence}`, description: createHash("sha256").update(snapshot).digest("hex") });
      await test.info().attach(evidence, { body: snapshot, contentType: "text/yaml" });

      const pendingForm = surface.locator('#explorer-step-17 details[data-disclosure]').first();
      await pendingForm.locator(':scope > summary').click();
      await expect(pendingForm).not.toHaveAttribute("open");
      await expect(surface.getByRole("combobox", { name: "Read result preview" })).toBeVisible();
      await expect(surface.getByRole("button", { name: "Preview paths", exact: true })).toHaveCount(0);
      await surface.getByRole("combobox", { name: "Read result preview" }).focus();
      await expect(surface.getByRole("combobox", { name: "Read result preview" })).toBeFocused();
      const finalForm = surface.locator('details[data-disclosure="22-finalize"]');
      await expect(finalForm).toHaveAttribute("open", "");
      const origin = surface.getByRole("button", { name: "Show source for Department", exact: true });
      await origin.click();
      const panel = surface.getByRole("dialog", { name: "Department source", exact: true });
      await expect(panel.getByRole("button", { name: "Close field source" })).toBeFocused();
      await expect(panel).toContainText("Workforce Job Summary");
      await expect(panel).toContainText("Department option list");
      await attachPresentationReference(page, test.info(), "department-source-drawer.png");
      await panel.getByRole("button", { name: "Go to original field", exact: true }).nth(1).click();
      await expect(surface.locator("#explorer-field-3-options")).toBeFocused();
      await expect(surface.locator('details[data-disclosure="3-request-options"]')).toHaveAttribute("open", "");
      await finalForm.locator(':scope > summary').click();
      await expect(finalForm).not.toHaveAttribute("open");
      await surface.getByRole("button", { name: "Return to filled field" }).click();
      await expect(origin).toBeFocused();
      await expect(surface.locator('details[data-disclosure="22-finalize"]')).toHaveAttribute("open", "");
      await origin.click();
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      await expect(origin).toBeFocused();
      await finalForm.locator(':scope > summary').click();
      await expect(origin).toBeHidden();
      await finalForm.locator(':scope > summary').click();
      await expect(origin).toBeVisible();
      const table = surface.locator('details[data-disclosure="22-finalize"]').locator("..");
      expect(await table.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(theme.attribute === "dark" ? "rgb(43, 43, 43)" : "rgb(244, 244, 244)");
      await expect(surface.getByRole("textbox", { name: "Find workflow" })).toHaveCount(0);
      await expect(surface.getByLabel("Action legend", { exact: true })).toHaveCount(0);
      expect(requests).toEqual([]);
    } finally { await server.close(); }
  });
}

test("Explorer branch previews stop writes, recover and reuse an existing receipt", async ({ page }) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    await installTheme(page, PARITY_THEMES[0]);
    await page.goto(`${server.baseUrl}/?explore=fixture-ui-explorer`);
    const identity = page.getByRole("combobox", { name: "Identity check preview" });
    const pending = page.getByRole("combobox", { name: "Read result preview" });
    const termination = page.getByRole("combobox", { name: "Existing termination preview" });
    await chooseSelect(identity, "review");

    await expect(page.getByText("Sessions close while waiting; reacquire and authenticate on resume.")).toBeVisible();
    await chooseSelect(identity, "rejected");

    await expect(page.locator("#explorer-step-16")).toBeHidden();
    await expect(page.getByText("Identity approval rejected", { exact: true })).toBeVisible();
    await chooseSelect(identity, "verified");

    await expect(page.locator("#explorer-step-22")).toBeVisible();
    await chooseSelect(pending, "some");

    await expect(page.getByText("Click Delete", { exact: true })).toBeVisible();
    await chooseSelect(pending, "unknown");

    await expect(page.locator("#explorer-step-18")).toBeVisible();
    await expect(page.getByText("Pending terminations could not be verified", { exact: true })).toBeVisible();
    await expect(page.locator("#explorer-step-19")).toBeHidden();
    await chooseSelect(pending, "none");

    await chooseSelect(termination, "present");

    await expect(page.getByText("Reuse this receipt · continue at step 20")).toBeVisible();
    await expect(page.getByText("Click Save and Submit", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Verify the existing receipt against the approved employee and effective date")).toBeVisible();
    await chooseSelect(termination, "unknown");

    await expect(page.locator("#explorer-step-20")).toBeHidden();
    await chooseSelect(termination, "absent");

    await expect(page.getByText("Click Save and Submit", { exact: true })).toBeVisible();
  } finally { await server.close(); }
});

test("named comment conditions update both UCPath fields and preserve Kuali text", async ({ page }) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    await installTheme(page, PARITY_THEMES[0]);
    await page.goto(`${server.baseUrl}/?explore=fixture-ui-explorer`);
    await page.getByText("Exact template · same text as Initiator comments", { exact: true }).click();
    const ucpath = page.getByLabel("UCPath comment template", { exact: true });
    await chooseSelect(page.getByRole("combobox", { name: "Leave scenario", exact: true }), "tie");

    await expect(ucpath).toHaveCount(2);
    expect(await ucpath.allTextContents()).toEqual(Array(2).fill("Termination eff {terminationEffectiveDate}. Last Day Worked {lastDayWorked}. Sick Leave on {latestSickDate}. Kuali form #{documentNumber}."));
    await chooseSelect(page.getByRole("combobox", { name: "Leave scenario", exact: true }), "operator");

    await expect(ucpath.first()).not.toContainText("Sick Leave");
    await chooseSelect(page.getByRole("combobox", { name: "Date changes", exact: true }), "both");

    await chooseSelect(page.getByRole("combobox", { name: "Date source", exact: true }), "operator");

    await chooseSelect(page.getByRole("combobox", { name: "Existing text", exact: true }), "yes");

    const kuali = page.getByLabel("Kuali comment template", { exact: true });
    await expect(kuali).toContainText("{existingComments}");
    await expect(kuali).toContainText("Updated Last Day Worked");
    await expect(kuali).toContainText("Updated Separation Date");
    expect((await kuali.textContent())?.match(/per operator entry at run start/g)).toHaveLength(2);
    const finalForm = page.locator('details[data-disclosure="22-finalize"]');
    await finalForm.locator(':scope > summary').click();
    await expect(page.getByRole("combobox", { name: "Date changes", exact: true })).toBeHidden();
    await finalForm.locator(':scope > summary').click();
    await expect(page.getByRole("combobox", { name: "Date changes", exact: true })).toHaveAttribute("data-value", "both");
    await expect(page.getByRole("combobox", { name: "Leave scenario", exact: true })).toHaveAttribute("data-value", "operator");
  } finally { await server.close(); }
});
