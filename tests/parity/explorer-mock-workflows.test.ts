
import { chooseSelect } from "./helpers/select-choice.js";
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  const evidence = `explorer-mocks-${theme.attribute}-${width}.a11y.yml`;
  test(`Explorer onboarding and contact mock paths @ ${theme.attribute} ${width}`, {
    annotation: [{ type: "required-a11y-evidence", description: evidence }],
  }, async ({ page }) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 });
      await installTheme(page, theme);
      const requests: string[] = [];
      page.on("request", (request) => { if (request.method() !== "GET" || /\/api\/v1\/(?:explorer|runs\/)/u.test(new URL(request.url()).pathname)) requests.push(`${request.method()} ${request.url()}`); });
      await page.goto(`${server.baseUrl}/?explore=fixture-ui-explorer`);
      const surface = page.getByRole("region", { name: "Workflow explorer preview", exact: true });
      const workflows = surface.getByRole("combobox", { name: "Explorer workflow", exact: true });
      await workflows.click();
      await expect(page.locator('[data-slot="select-content"][data-open]').getByRole("option")).toHaveText(["Person Lookup", "I-9 Lookup", "Separations", "I-9 Check", "Onboarding", "Oath Signature", "Oath Upload", "Emergency Contact", "Work-Study", "Kronos Pay Rule", "OCR", "CRM Doc Download", "SharePoint Download", "OnBase", "Old Kronos Reports"]);
      await page.keyboard.press("Escape");
      await workflows.focus();
      await chooseSelect(workflows, "fixture-onboarding");

      await expect(workflows).toBeFocused();
      await expect(workflows).toHaveAttribute("data-value", "fixture-onboarding");
      await expect(surface.getByRole("heading", { name: "Onboarding", exact: true })).toHaveCount(0);
      await expect(surface).toContainText("Browse workflows, their steps and field sources.");
      await expect(surface).not.toContainText("Fictional preview data");
      await expect(surface.locator("li[data-step-number]")).toHaveCount(11);
      await expect(surface.locator("#explorer-step-1")).toContainText("Open browser sessions");
      await expect(surface.locator("#explorer-step-1")).toContainText("CRM");
      await expect(surface.locator("#explorer-step-1")).toContainText("UCPath");
      await expect(surface.locator("#explorer-step-1")).toContainText("I-9");
      await expect(surface.locator("#explorer-step-2")).toContainText("Choose the hire type");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

      await expect(surface.getByRole("button", { name: "Preview paths", exact: true })).toHaveCount(0);
      const person = surface.getByRole("combobox", { name: "Person search result preview" });
      await person.focus();
      await expect(person).toBeFocused();
      await chooseSelect(person, "review");

      await expect(surface.locator("#explorer-step-7")).toBeHidden();
      await expect(surface.getByText("Pause for identity approval. No I-9 profile or hire is filed.", { exact: true })).toBeVisible();
      await chooseSelect(person, "none");

      await chooseSelect(surface.getByRole("combobox", { name: "Hire type preview" }), "rehire");

      await expect(surface.locator("#explorer-step-7")).toBeHidden();
      await chooseSelect(person, "matched");

      await expect(surface.locator("#explorer-step-7")).toContainText("Skip I-9 creation");
      await expect(surface.locator("#explorer-step-8")).toContainText("UC_CONC_HIRE");
      await surface.getByRole("button", { name: "Show source for Compensation rate", exact: true }).click();
      const wage = surface.getByRole("dialog", { name: "Compensation rate source", exact: true });
      await wage.getByRole("button", { name: "Go to original field" }).click();
      await expect(surface.locator("#explorer-field-3-wage")).toBeFocused();
      await surface.getByRole("button", { name: "Return to filled field" }).click();
      await expect(surface.getByRole("button", { name: "Show source for Compensation rate", exact: true })).toBeFocused();
      await chooseSelect(surface.getByRole("combobox", { name: "Hire rehearsal preview" }), "dry");

      await expect(surface.locator("#explorer-step-10")).toBeHidden();
      await chooseSelect(workflows, "fixture-emergency-contact");

      await expect(workflows).toHaveAttribute("data-value", "fixture-emergency-contact");
      await expect(surface.getByRole("heading", { name: "Emergency Contact", exact: true })).toHaveCount(0);
      await expect(surface.locator("li[data-step-number]")).toHaveCount(11);
      await expect(surface.locator("#explorer-step-1")).toContainText("Open browser sessions");
      await expect(surface.locator("#explorer-step-1")).toContainText("UCPath");
      await expect(surface.locator("#explorer-step-1")).toContainText("Authentication waits until the contact packet is reviewed.");
      await expect(surface.locator("#explorer-step-2")).toContainText("Extract the contact packet");

      const snapshot = await surface.ariaSnapshot();
      test.info().annotations.push({ type: `a11y-attachment-sha256:${evidence}`, description: createHash("sha256").update(snapshot).digest("hex") });
      await test.info().attach(evidence, { body: snapshot, contentType: "text/yaml" });
      await expect(surface.getByRole("button", { name: "Preview paths", exact: true })).toHaveCount(0);
      const review = surface.getByRole("combobox", { name: "Contact review preview" });
      await review.focus();
      await expect(review).toBeFocused();
      await chooseSelect(review, "pending");

      await expect(surface.locator("#explorer-step-4")).toBeHidden();
      await expect(surface.locator("#explorer-step-5")).toBeHidden();
      await chooseSelect(review, "approved");

      const identity = surface.getByRole("combobox", { name: "Contact identity preview" });
      await chooseSelect(identity, "mismatch");

      await expect(surface.locator("#explorer-step-6")).toBeHidden();
      await chooseSelect(identity, "verified");

      const existing = surface.getByRole("combobox", { name: "Existing contact preview" });
      await chooseSelect(existing, "exact");

      await expect(surface.locator("#explorer-step-8")).toHaveCount(0);
      await expect(surface.locator("#explorer-step-10")).toHaveCount(0);
      await expect(surface.locator("#explorer-step-11")).toBeVisible();
      await chooseSelect(existing, "fuzzy");

      await expect(surface.locator("#explorer-step-7")).toContainText("Demote the existing");
      await chooseSelect(surface.getByRole("combobox", { name: "Contact address preview" }), "manual");

      const address = surface.getByRole("button", { name: "Show source for Street · city · state · postal code · country", exact: true });
      await address.click();
      await expect(surface.getByRole("dialog")).toContainText("Emergency Contact Form");
      await page.keyboard.press("Escape");
      await expect(address).toBeFocused();
      await chooseSelect(surface.getByRole("combobox", { name: "Contact rehearsal preview" }), "dry");

      await expect(surface.locator("#explorer-step-10")).toHaveCount(0);
      await expect(surface.locator("#explorer-step-7")).not.toContainText("Demote the existing");
      await expect(surface.locator("#explorer-step-11")).toBeVisible();
      await chooseSelect(workflows, "fixture-separations");

      await expect(surface.locator("li[data-step-number]")).toHaveCount(22);
      await expect(surface.getByRole("combobox", { name: "Identity check preview" })).toHaveAttribute("data-value", "verified");
      await expect(workflows).toHaveAttribute("data-value", "fixture-separations");
      await expect(surface.getByRole("textbox", { name: "Find workflow" })).toHaveCount(0);
      await workflows.click();
      await expect(page.locator('[data-slot="select-content"][data-open]').getByRole("option")).toHaveCount(15);
      await page.keyboard.press("Escape");
      expect(requests).toEqual([]);
    } finally { await server.close(); }
  });
}
