import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const evidence = `explorer-preview-${theme.attribute}-${width}.a11y.yml`;
  test(`complete Explorer layout and source return @ ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence }],
  }, async ({ page }) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      const requests: string[] = [];
      page.on("request", (request) => { if (request.method() !== "GET" || /\/api\/v1\/(?:explorer|runs\/)/u.test(new URL(request.url()).pathname)) requests.push(`${request.method()} ${request.url()}`); });
      await page.goto(`${server.baseUrl}/?explore=fixture-ui-explorer`);
      const surface = page.getByRole("region", { name: "Workflow explorer preview", exact: true });
      await expect(surface).toBeVisible();
      await expect(surface.getByRole("list", { name: "Workflow steps" }).getByRole("listitem")).toHaveCount(22);
      await expect(surface.getByText("Mock data", { exact: true })).toBeVisible();
      expect(await surface.getByRole("navigation").evaluate((node) => node.getBoundingClientRect().width)).toBe(width === 1024 ? 190 : 230);
      expect(await surface.locator('[data-step-number="1"] > span').evaluate((node) => node.getBoundingClientRect().width)).toBe(28);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(surface.getByRole("button", { name: "Back to dashboard" }).locator("svg")).toHaveCount(1);
      await expect(surface.getByRole("button", { name: "Show action legend" }).locator("svg")).toHaveCount(1);
      const snapshot = await surface.ariaSnapshot();
      test.info().annotations.push({ type: `a11y-attachment-sha256:${evidence}`, description: createHash("sha256").update(snapshot).digest("hex") });
      await test.info().attach(evidence, { body: snapshot, contentType: "text/yaml" });
      await test.info().attach(evidence.replace(".a11y.yml", ".png"), { body: await page.screenshot(), contentType: "image/png" });
      await surface.getByRole("button", { name: "Collapse all", exact: true }).click();
      await expect(surface.locator("details[open]")).toHaveCount(0);
      await expect(surface.getByRole("combobox", { name: "Read result preview" })).toBeVisible();
      await surface.getByRole("button", { name: "Preview paths", exact: true }).click();
      await expect(surface.getByRole("combobox", { name: "Read result preview" })).toBeFocused();
      await surface.getByRole("button", { name: "Expand all", exact: true }).click();
      await expect(surface.locator("details:not([open])")).toHaveCount(0);
      const origin = surface.getByRole("button", { name: "Show source for Department", exact: true });
      await origin.click();
      const panel = surface.getByRole("dialog", { name: "Department source", exact: true });
      await expect(panel.getByRole("button", { name: "Close field source" })).toBeFocused();
      await expect(panel).toContainText("Workforce Job Summary");
      await expect(panel).toContainText("Department option list");
      await panel.getByRole("button", { name: "Go to original field", exact: true }).nth(1).click();
      await expect(surface.locator("#explorer-field-3-options")).toBeFocused();
      await expect(surface.locator('details[data-disclosure="3-request-options"]')).toHaveAttribute("open", "");
      await surface.getByRole("button", { name: "Collapse all", exact: true }).click();
      await surface.getByRole("button", { name: "Return to filled field" }).click();
      await expect(origin).toBeFocused();
      await expect(surface.locator('details[data-disclosure="22-finalize"]')).toHaveAttribute("open", "");
      await origin.click();
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      await expect(origin).toBeFocused();
      await surface.getByRole("button", { name: "Collapse all", exact: true }).click();
      await expect(surface.locator("details[open]")).toHaveCount(0);
      await surface.getByRole("button", { name: "Expand all", exact: true }).click();
      const table = surface.locator('details[data-disclosure="22-finalize"]').locator("..");
      expect(await table.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe(theme.attribute === "dark" ? "rgb(43, 43, 43)" : "rgb(244, 244, 244)");
      const search = surface.getByRole("textbox", { name: "Find workflow" });
      await search.fill("unmatched");
      await expect(surface.getByText("No matching workflow", { exact: true })).toBeVisible();
      await search.fill("Separation");
      await expect(surface.getByRole("button", { name: "Separations 22" })).toBeVisible();
      await surface.getByRole("button", { name: "Show action legend" }).click();
      await expect(surface.getByText("Compute", { exact: true })).toBeVisible();
      expect(requests).toEqual([]);
    } finally { await server.close(); }
  });
}

test("Explorer branch previews stop writes, recover and reuse an existing receipt", async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    await page.goto(`${server.baseUrl}/?explore=fixture-ui-explorer`);
    const identity = page.getByRole("combobox", { name: "Identity check preview" });
    const pending = page.getByRole("combobox", { name: "Read result preview" });
    const termination = page.getByRole("combobox", { name: "Existing termination preview" });
    await identity.selectOption("review");
    await expect(page.getByText("Sessions close while waiting; reacquire and authenticate on resume.")).toBeVisible();
    await identity.selectOption("rejected");
    await expect(page.locator("#explorer-step-16")).toBeHidden();
    await expect(page.getByText("Identity approval rejected", { exact: true })).toBeVisible();
    await identity.selectOption("verified");
    await expect(page.locator("#explorer-step-22")).toBeVisible();
    await pending.selectOption("some");
    await expect(page.getByText("Click Delete", { exact: true })).toBeVisible();
    await pending.selectOption("unknown");
    await expect(page.locator("#explorer-step-18")).toBeVisible();
    await expect(page.getByText("Pending terminations could not be verified", { exact: true })).toBeVisible();
    await expect(page.locator("#explorer-step-19")).toBeHidden();
    await pending.selectOption("none");
    await termination.selectOption("present");
    await expect(page.getByText("Reuse this receipt · continue at step 20")).toBeVisible();
    await expect(page.getByText("Click Save and Submit", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Verify the existing receipt against the approved employee and effective date")).toBeVisible();
    await termination.selectOption("unknown");
    await expect(page.locator("#explorer-step-20")).toBeHidden();
    await termination.selectOption("absent");
    await expect(page.getByText("Click Save and Submit", { exact: true })).toBeVisible();
  } finally { await server.close(); }
});

test("named comment conditions update both UCPath fields and preserve Kuali text", async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  try {
    await page.goto(`${server.baseUrl}/?explore=fixture-ui-explorer`);
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    const ucpath = page.getByLabel("UCPath comment template", { exact: true });
    await page.getByRole("combobox", { name: "Leave scenario", exact: true }).selectOption("tie");
    await expect(ucpath).toHaveCount(2);
    expect(await ucpath.allTextContents()).toEqual(Array(2).fill("Termination eff {terminationEffectiveDate}. Last Day Worked {lastDayWorked}. Sick Leave on {latestSickDate}. Kuali form #{documentNumber}."));
    await page.getByRole("combobox", { name: "Leave scenario", exact: true }).selectOption("operator");
    await expect(ucpath.first()).not.toContainText("Sick Leave");
    await page.getByRole("combobox", { name: "Date changes", exact: true }).selectOption("both");
    await page.getByRole("combobox", { name: "Date source", exact: true }).selectOption("operator");
    await page.getByRole("combobox", { name: "Existing text", exact: true }).selectOption("yes");
    const kuali = page.getByLabel("Kuali comment template", { exact: true });
    await expect(kuali).toContainText("{existingComments}");
    await expect(kuali).toContainText("Updated Last Day Worked");
    await expect(kuali).toContainText("Updated Separation Date");
    expect((await kuali.textContent())?.match(/per operator entry at run start/g)).toHaveLength(2);
    await page.getByRole("button", { name: "Collapse all", exact: true }).click();
    await page.getByRole("button", { name: "Expand all", exact: true }).click();
    await expect(page.getByRole("combobox", { name: "Date changes", exact: true })).toHaveValue("both");
    await expect(page.getByRole("combobox", { name: "Leave scenario", exact: true })).toHaveValue("operator");
  } finally { await server.close(); }
});
