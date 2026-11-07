import { installFrozenMonotonic, moveAssistantLauncherAboveFooter } from "./helpers/app-driver.js";

import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { MOCK_WORKFLOWS } from "../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { chooseSelect } from "./helpers/select-choice.js";
import { attachShellA11y } from "./helpers/shell-proof.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`complete Explorer workflow contracts @ ${theme.attribute}-${width}`, { annotation: [{ type: "required-a11y-evidence", description: `explorer-work-study-${theme.attribute}-${width}.a11y.yml` }] }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET" || /\/api\/v1\/explorer/u.test(new URL(request.url()).pathname)) writes.push(request.url()); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installFrozenMonotonic(page); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?explore=fixture-ui-explorer`);
      const surface = page.getByRole("region", { name: "Workflow explorer preview", exact: true });
      for (const flow of MOCK_WORKFLOWS) {
        await chooseSelect(surface.getByRole("combobox", { name: "Explorer workflow", exact: true }), `fixture-${flow.id}`);
        await expect(surface.getByRole("list", { name: "Workflow steps", exact: true })).toBeVisible();
        await expect(surface.locator("li[data-step-number]:visible")).not.toHaveCount(0);
        await expect(page.locator('[data-slot="select-content"]')).toBeHidden();

      if (flow.id === "work-study") await attachShellA11y(page, info, `explorer-${flow.id}-${theme.attribute}-${width}.a11y.yml`);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      }
      await chooseSelect(surface.getByRole("combobox", { name: "Explorer workflow", exact: true }), "fixture-work-study");
      await expect(surface).toContainText("JRL"); await expect(surface).toContainText("Position pool");
      await surface.getByRole("button", { name: "Show source for Effective date", exact: true }).click();
      await expect(page.getByRole("dialog", { name: /Effective date/u })).toBeVisible(); await page.keyboard.press("Escape");
      await chooseSelect(surface.getByRole("combobox", { name: "Explorer workflow", exact: true }), "fixture-oath-upload");
      await chooseSelect(surface.getByRole("combobox", { name: "Linked signatures preview", exact: true }), "failed");
      await expect(surface.locator("li[data-step-number]:visible")).not.toContainText(["File ticket"]);
      await expect(surface).toContainText("Stop before opening ServiceNow");
      await chooseSelect(surface.getByRole("combobox", { name: "Processing mode preview", exact: true }), "upload-only");
      await expect(surface.locator("li[data-step-number]:visible")).not.toContainText(["OCR prep", "Wait signatures"]);
      await expect(surface.locator("li[data-step-number]:visible")).toContainText(["File ticket"]);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
  test(`PDF review and independent person outcomes @ ${theme.attribute}-${width}`, { annotation: [{ type: "required-a11y-evidence", description: `contact-review-${theme.attribute}-${width}.a11y.yml` }] }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installFrozenMonotonic(page); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
      await moveAssistantLauncherAboveFooter(page);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
      await rail.getByRole("button", { name: "Emergency Contact", exact: true }).click();
      await expect(logs.getByRole("tab")).toHaveCount(0);
      await expect(logs.getByRole("button", { name: /^Review records/u })).toHaveCount(0);
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      const drawer = logs.getByRole("region", { name: "OCR records", exact: true });
      const record = drawer.getByRole("region", { name: "Record person-1", exact: true });
      await expect(logs.getByRole("heading", { level: 2 })).toHaveText("emergency-contacts.pdf");
      await expect(logs.getByRole("navigation", { name: "Run timeline", exact: true })).toHaveCount(0);
      await expect(logs.getByRole("searchbox", { name: "Search logs", exact: true })).toHaveCount(0);
      await expect(logs.getByRole("button", { name: /^Records \d+$/u })).toHaveAttribute("aria-pressed", "true");
      const source = record.getByRole("region", { name: "Source PDF", exact: true });
      const sourceBox = (await source.boundingBox())!, fieldsBox = (await record.locator("[data-review-fields]").boundingBox())!;
      expect(sourceBox.x + sourceBox.width).toBeLessThanOrEqual(fieldsBox.x);
      const pageImage = source.getByRole("img");
      await expect.poll(() => pageImage.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      const sourceUrl = await pageImage.getAttribute("src"), fitWidth = (await pageImage.boundingBox())!.width;
      await source.getByRole("button", { name: "Zoom in", exact: true }).click();
      expect((await pageImage.boundingBox())!.width).toBeGreaterThan(fitWidth);
      await expect(source.getByRole("toolbar", { name: "PDF controls", exact: true })).toBeInViewport();
      await source.getByRole("button", { name: "Fit page", exact: true }).click();
      expect((await pageImage.boundingBox())!.width).toBe(fitWidth);
      for (const id of ["person-2", "person-3"]) {
        await drawer.getByRole("region", { name: `Record ${id}`, exact: true }).getByRole("checkbox", { name: /^Include /u }).click();
      }
      await record.getByRole("textbox", { name: "Employee ID", exact: true }).fill("x");
      await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toBeDisabled();
      await record.getByRole("textbox", { name: "Employee ID", exact: true }).fill("10000009");
      await record.getByRole("textbox", { name: "Contact name", exact: true }).fill("Sam Lee");
      await expect(record).not.toContainText("not confirmed by a UCPath lookup");
      const image = drawer.getByRole("img", { name: "Source page 1 of emergency-contacts.pdf", exact: true });
      await expect(image).toBeVisible();
      expect(await image.getAttribute("src")).toMatch(/emergency-contacts-1.*\.webp$/u);
      await record.getByRole("checkbox", { name: "Same address as employee", exact: true }).click();
      await expect(record.getByRole("textbox", { name: "Street", exact: true })).toBeVisible();
      await expect(pageImage).toHaveAttribute("src", sourceUrl!);

      await attachShellA11y(page, info, `contact-review-${theme.attribute}-${width}.a11y.yml`);
      await drawer.getByRole("button", { name: "Approve records", exact: true }).click();
      await expect(record.getByRole("textbox")).toHaveCount(0);
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      await logs.getByRole("button", { name: /^Linked runs \(/u }).click();
      await page.getByRole("dialog", { name: "Linked runs", exact: true }).getByRole("button", { name: /Jordan Lee/u }).click();
      await expect(logs).toContainText("Sam Lee"); await expect(logs).toContainText("10000009");
      await expect(logs.getByRole("tab")).toHaveCount(0); await expect(logs.getByRole("navigation", { name: "Run timeline", exact: true }).getByRole("button", { name: /^Result/u })).toHaveCount(0);
      await expect(logs.getByRole("button", { name: /^Records/u })).toHaveCount(0);

      await rail.getByRole("button", { name: "Oath Upload", exact: true }).click();
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      await drawer.getByRole("button", { name: "Approve records", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      await logs.getByRole("button", { name: /^Linked runs \(/u }).click();
      await page.getByRole("dialog", { name: "Linked runs", exact: true }).getByRole("button", { name: /Jordan Lee/u }).click();
      await expect(logs).toContainText("Verify onboarding and oath date");
      await expect(page.getByRole("region", { name: "Queue", exact: true })).toContainText("Jordan Lee");
      await logs.getByRole("button", { name: /^Linked runs \(/u }).click();
      await expect(page.getByRole("dialog", { name: "Linked runs", exact: true })).toContainText("Parent"); await page.keyboard.press("Escape");
      await rail.getByRole("button", { name: "OnBase", exact: true }).click();
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      await drawer.getByRole("button", { name: "Discard", exact: true }).click();
      await expect(drawer).toContainText("Discarded"); await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toHaveCount(0);
      await expect(drawer.getByRole("button", { name: /Undo/u })).toHaveCount(0);
      const discardedHeading = drawer.locator("[data-ocr-review-heading]").first();
      await expect(discardedHeading).toBeFocused();
      await discardedHeading.press("Control+z");
      await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toBeEnabled();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      await rail.getByRole("button", { name: "I-9 Check", exact: true }).click();
      await expect(logs.getByRole("textbox")).toHaveCount(0); await expect(logs.getByRole("tab")).toHaveCount(0);
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      await expect(drawer).toContainText("Section 2 page");
      const i9 = drawer.getByRole("region", { name: "Record person-1", exact: true });
      await expect(i9.getByRole("combobox", { name: "Source page", exact: true })).toContainText("Section 1 · Page 2");
      await chooseSelect(i9.getByRole("combobox", { name: "Source page", exact: true }), "1");
      await expect(i9.getByRole("img")).toHaveAccessibleName("Source page 1 of i9.pdf");
      await expect(i9.getByRole("combobox", { name: "Source page", exact: true })).toContainText("Section 2 · Page 1");
      await expect(i9.getByRole("img")).toHaveAttribute("src", /i9-1.*\.webp$/u);
      await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toBeEnabled();
      await expect(drawer).not.toContainText("Fictional extracted records");

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}

for (const theme of PARITY_THEMES) test(`delegated OCR form workspaces @ ${theme.attribute}`, { annotation: [{ type: "required-a11y-evidence", description: `ocr-Oath Upload-${theme.attribute}.a11y.yml` }] }, async ({ page }, info) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  const writes: string[] = []; page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 }); await installFrozenMonotonic(page); await installTheme(page, theme); await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
    const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
    const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
    for (const [label, field] of [["Oath Upload", "Officer signed"], ["Emergency Contact", "Contact name"], ["OnBase", "Contact name"], ["I-9 Check", "Section 2 page"]]) {
      await rail.getByRole("button", { name: label, exact: true }).click();
      await expect(logs.getByRole("tab")).toHaveCount(0);
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      const drawer = logs.getByRole("region", { name: "OCR records", exact: true });
      await expect(drawer).toContainText(field);
      const record = drawer.getByRole("region", { name: "Record person-1", exact: true });
      await expect(record.getByRole("textbox", { name: "Employee ID", exact: true })).toBeVisible();
      await record.getByRole("textbox", { name: "First name", exact: true }).fill("Taylor");
      await expect(drawer.getByRole("heading", { name: "Taylor Lee", exact: true })).toBeVisible();
      await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toBeEnabled();

      if (label === "Oath Upload") await attachShellA11y(page, info, `ocr-${label}-${theme.attribute}.a11y.yml`);
      await logs.getByRole("button", { name: /^Records \d+$/u }).click(); await expect(logs.getByRole("button", { name: /^Records \d+$/u })).toBeFocused();
    }
    expect(writes).toEqual([]);
  } finally { await server.close(); }
});

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`focused records, canonical rows and keyboard links @ ${theme.attribute}-${width}`, { annotation: [{ type: "required-a11y-evidence", description: `focused-records-${theme.attribute}-${width}.a11y.yml` }] }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installFrozenMonotonic(page); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
      await moveAssistantLauncherAboveFooter(page);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
      await rail.getByRole("button", { name: "Emergency Contact", exact: true }).click();
      const queue = page.getByRole("region", { name: "Queue", exact: true });
      await expect(queue.getByRole("button", { name: /emergency-contacts.pdf —/u })).toBeVisible();
      await expect(queue.getByRole("button", { name: "Attempts for emergency-contacts.pdf", exact: true })).toBeVisible();
      await expect(queue).not.toContainText("PDF preparation");
      await expect(queue).toContainText("Read emergency contact");
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      const reviewTrigger = logs.getByRole("button", { name: /^Records \d+$/u });
      await reviewTrigger.focus(); await page.keyboard.press("Enter");
      const drawer = logs.getByRole("region", { name: "OCR records", exact: true });
      const first = drawer.getByRole("region", { name: "Record person-1", exact: true });
      for (const id of ["person-2", "person-3"]) {
        await drawer.getByRole("region", { name: `Record ${id}`, exact: true }).getByRole("checkbox", { name: /^Include /u }).click();
      }
      await drawer.getByRole("checkbox", { name: "Include Jordan Lee", exact: true }).click();
      await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toBeDisabled();
      await drawer.getByRole("button", { name: "Add record", exact: true }).click();
      await expect(first).toHaveCount(1);
      const added = drawer.getByRole("region", { name: "Record manual-4", exact: true });
      await expect(added.getByRole("textbox", { name: "Employee ID", exact: true })).toBeFocused();
      await added.getByRole("textbox", { name: "Employee ID", exact: true }).fill("10001234");
      await added.getByRole("textbox", { name: "First name", exact: true }).fill("Taylor");
      await added.getByRole("textbox", { name: "Last name", exact: true }).fill("Chen");
      await drawer.getByRole("checkbox", { name: "Include Taylor Chen", exact: true }).click();
      await added.getByRole("textbox", { name: "Contact name", exact: true }).fill("Sam Chen");
      await expect(drawer.getByRole("combobox", { name: "Record", exact: true })).toHaveCount(0);
      await expect(first.getByRole("textbox", { name: "Contact name", exact: true })).toHaveValue("Alex Lee");
      await expect(added.getByRole("textbox", { name: "Contact name", exact: true })).toHaveValue("Sam Chen");
      await expect(added.getByRole("textbox", { name: "Employee ID", exact: true })).toHaveValue("10001234");

      await attachShellA11y(page, info, `focused-records-${theme.attribute}-${width}.a11y.yml`);
      await drawer.getByRole("button", { name: "Approve records", exact: true }).click();
      await expect(added.getByRole("textbox")).toHaveCount(0);
      await expect(drawer.getByRole("heading", { name: "Taylor Chen", exact: true })).toBeFocused();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click(); await expect(logs.getByRole("button", { name: /^Records \d+$/u })).toBeFocused();
      await expect(logs.getByRole("tab")).toHaveCount(0);
      const links = logs.getByRole("button", { name: "Linked runs (2)", exact: true });
      await links.focus(); await page.keyboard.press("Enter");
      const linked = page.getByRole("dialog", { name: "Linked runs", exact: true });
      await expect(linked).toContainText("Taylor Chen"); await page.keyboard.press("Escape"); await expect(links).toBeFocused();
      await links.click(); await linked.getByRole("button", { name: /Taylor Chen/u }).click();
      await expect(logs).toContainText("Sam Chen"); await expect(logs).toContainText("10001234");
      await expect(logs.getByRole("textbox")).toHaveCount(0); await expect(logs.getByRole("button", { name: /^Records/u })).toHaveCount(0);
      await logs.getByRole("button", { name: /^Linked runs \(/u }).click();
      await linked.getByRole("button", { name: /emergency-contacts.pdf.*Parent/u }).click();
      await expect(logs).toContainText("emergency-contacts.pdf");
      await expect(logs).not.toContainText("Emergency Contact · emergency-contacts.pdf");
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      const overflow = await drawer.evaluate(node => [...node.querySelectorAll<HTMLElement>("section, table, input:not([aria-hidden=true]), button:not([aria-hidden=true])")].filter(element => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1).map(element => element.getAttribute("aria-label") ?? element.tagName));
      expect(overflow).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}

for (const theme of PARITY_THEMES) test(`every local workflow uses canonical queue and log views @ ${theme.attribute}`, { annotation: [{ type: "required-a11y-evidence", description: `canonical-onboarding-${theme.attribute}.a11y.yml` }] }, async ({ page }, info) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 }); await installFrozenMonotonic(page); await installTheme(page, theme);
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
    const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
    const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
    for (const flow of MOCK_WORKFLOWS.filter(flow => !["person-lookup", "separations"].includes(flow.id))) {
      await rail.getByRole("button", { name: flow.label, exact: true }).click();
      await expect(page.getByRole("region", { name: "Queue", exact: true }).getByRole("button", { name: /^Attempts for/u }).first()).toBeVisible();
      await expect(logs.getByRole("tab")).toHaveCount(0);
      await expect(logs.getByRole("button", { name: /^Review records|^Records/u })).toHaveCount(flow.id === "ocr" ? 1 : 0);
      await expect(logs.getByRole("tab", { name: "Result", exact: true })).toHaveCount(0);
      await expect(logs.getByRole("tab", { name: /^Linked runs/u })).toHaveCount(0);
      await expect(logs).not.toContainText("Fictional workflow preview");

      if (flow.id === "onboarding") await attachShellA11y(page, info, `canonical-${flow.id}-${theme.attribute}.a11y.yml`);
    }
    await page.goto(`${server.baseUrl}/?day=invalid-day`);
    await rail.getByRole("button", { name: "OCR", exact: true }).click();
    await expect(page.getByText("Choose a valid date", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Search runs", exact: true }).click();
    const search = page.getByRole("dialog", { name: "Search runs", exact: true });
    await expect(search.getByRole("status")).toHaveText("Invalid date: invalid-day.");
    await expect(search.getByRole("option")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Choose date/u }).click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByRole("region", { name: "Queue", exact: true }).getByRole("button", { name: /^Attempts for/u }).first()).toBeVisible();
    expect(errors).toEqual([]); expect(writes).toEqual([]);
  } finally { await server.close(); }
});
