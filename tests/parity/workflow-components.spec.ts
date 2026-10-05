import { expect, test } from "@playwright/test";
import { MOCK_WORKFLOWS } from "../../src/dashboard/surfaces/workflow-mock-catalog.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { chooseSelect } from "./helpers/select-choice.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`complete Explorer workflow contracts @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle(); const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET" || /\/api\/v1\/explorer/u.test(new URL(request.url()).pathname)) writes.push(request.url()); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?explore=fixture-ui-explorer`);
      const surface = page.getByRole("region", { name: "Workflow explorer preview", exact: true });
      for (const flow of MOCK_WORKFLOWS) {
        await chooseSelect(surface.getByRole("combobox", { name: "Explorer workflow", exact: true }), `fixture-${flow.id}`);
        await expect(surface.getByRole("list", { name: "Workflow steps", exact: true })).toBeVisible();
        await expect(surface.locator("li[data-step-number]:visible")).not.toHaveCount(0);
        await expect(page.locator('[data-slot="select-content"]')).toBeHidden();
        await info.attach(`explorer-${flow.id}-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
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
  test(`PDF review and independent person outcomes @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle(); const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
      await rail.getByRole("button", { name: "Emergency Contact", exact: true }).click();
      await expect(logs.getByRole("tab")).toHaveCount(0);
      await expect(logs.getByRole("button", { name: /^Review records/u })).toHaveCount(0);
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: "Review records 1", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: "OCR records", exact: true });
      const record = drawer.getByRole("region", { name: "Record person-1", exact: true });
      await record.getByRole("textbox", { name: "Employee ID", exact: true }).fill("x");
      await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toBeDisabled();
      await record.getByRole("textbox", { name: "Employee ID", exact: true }).fill("10000009");
      await record.getByRole("textbox", { name: "Contact name", exact: true }).fill("Sam Lee");
      await expect(record).toContainText("not confirmed by a UCPath lookup");
      await record.getByRole("button", { name: "Source fields", exact: true }).click();
      await expect(record.getByRole("complementary")).toContainText("Alex Lee");
      await record.getByRole("button", { name: "Source fields", exact: true }).click();
      await record.getByRole("checkbox", { name: "Same address as employee", exact: true }).click();
      await expect(record.getByRole("textbox", { name: "Street", exact: true })).toBeVisible();
      await info.attach(`contact-review-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
      await drawer.getByRole("button", { name: "Approve records", exact: true }).click();
      await expect(record.getByRole("textbox")).toHaveCount(0);
      await drawer.getByRole("button", { name: "Close", exact: true }).click();
      await logs.getByRole("button", { name: /^Linked runs \(/u }).click();
      await page.getByRole("dialog", { name: "Linked runs", exact: true }).getByRole("button", { name: /Jordan Lee/u }).click();
      await expect(logs).toContainText("Sam Lee"); await expect(logs).toContainText("10000009");
      await expect(logs.getByRole("tab")).toHaveCount(0); await expect(logs).toContainText("Result");
      await expect(logs.getByRole("button", { name: /^Records/u })).toHaveCount(0);
      await info.attach(`contact-person-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
      await rail.getByRole("button", { name: "Oath Upload", exact: true }).click();
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: "Review records 1", exact: true }).click();
      await drawer.getByRole("button", { name: "Approve records", exact: true }).click();
      await drawer.getByRole("button", { name: "Close", exact: true }).click();
      await logs.getByRole("button", { name: /^Linked runs \(/u }).click();
      await page.getByRole("dialog", { name: "Linked runs", exact: true }).getByRole("button", { name: /Jordan Lee/u }).click();
      await expect(logs).toContainText("Verify onboarding and oath date");
      await expect(page.getByRole("region", { name: "Queue", exact: true })).toContainText("Jordan Lee");
      await logs.getByRole("button", { name: /^Linked runs \(/u }).click();
      await expect(page.getByRole("dialog", { name: "Linked runs", exact: true })).toContainText("Parent"); await page.keyboard.press("Escape");
      await rail.getByRole("button", { name: "OnBase", exact: true }).click();
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: "Review records 1", exact: true }).click();
      await drawer.getByRole("button", { name: "Discard", exact: true }).click();
      await expect(drawer).toContainText("Discarded"); await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toHaveCount(0);
      await expect(drawer.getByRole("button", { name: "Undo discard", exact: true })).toBeFocused();
      await drawer.getByRole("button", { name: "Undo discard", exact: true }).click();
      await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toBeEnabled();
      await drawer.getByRole("button", { name: "Close", exact: true }).click();
      await rail.getByRole("button", { name: "I-9 Check", exact: true }).click();
      await expect(logs.getByRole("textbox")).toHaveCount(0); await expect(logs.getByRole("tab")).toHaveCount(0);
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: "Review records 1", exact: true }).click();
      await expect(drawer).toContainText("Section 2 page");
      await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toBeEnabled();
      await expect(drawer).not.toContainText("Fictional extracted records");
      await info.attach(`report-I-9-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}

for (const theme of PARITY_THEMES) test(`delegated OCR form workspaces @ ${theme.attribute}`, async ({ page }, info) => {
  ensureParityBundle(); const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  const writes: string[] = []; page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 }); await installTheme(page, theme); await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
    const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
    const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
    for (const [label, field] of [["Oath Upload", "Officer signed"], ["Emergency Contact", "Contact name"], ["OnBase", "Contact name"], ["I-9 Check", "Section 2 page"]]) {
      await rail.getByRole("button", { name: label, exact: true }).click();
      await expect(logs.getByRole("tab")).toHaveCount(0);
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: "Review records 1", exact: true }).click();
      const drawer = page.getByRole("dialog", { name: "OCR records", exact: true });
      await expect(drawer).toContainText(field);
      await expect(drawer.getByRole("textbox", { name: "Employee ID", exact: true })).toBeVisible();
      await drawer.getByRole("textbox", { name: "First name", exact: true }).fill("Taylor");
      await expect(drawer.getByRole("heading", { name: "Taylor Lee", exact: true })).toBeVisible();
      await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toBeEnabled();
      await info.attach(`ocr-${label}-${theme.attribute}.png`, { body: await page.screenshot(), contentType: "image/png" });
      await page.keyboard.press("Escape"); await expect(logs.getByRole("button", { name: "Review records 1", exact: true })).toBeFocused();
    }
    expect(writes).toEqual([]);
  } finally { await server.close(); }
});

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`focused records, canonical rows and keyboard links @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle(); const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
      await rail.getByRole("button", { name: "Emergency Contact", exact: true }).click();
      const queue = page.getByRole("region", { name: "Queue", exact: true });
      await expect(queue.getByRole("button", { name: /emergency-contact.pdf —/u })).toBeVisible();
      await expect(queue.getByRole("button", { name: "Attempts for emergency-contact.pdf", exact: true })).toBeVisible();
      await expect(queue).not.toContainText("PDF preparation");
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      const reviewTrigger = logs.getByRole("button", { name: "Review records 1", exact: true });
      await reviewTrigger.focus(); await page.keyboard.press("Enter");
      const drawer = page.getByRole("dialog", { name: "OCR records", exact: true });
      const first = drawer.getByRole("region", { name: "Record person-1", exact: true });
      await drawer.getByRole("checkbox", { name: "Include Jordan Lee", exact: true }).click();
      await expect(drawer.getByRole("button", { name: "Approve records", exact: true })).toBeDisabled();
      await drawer.getByRole("button", { name: "Add record", exact: true }).click();
      await expect(first).toHaveCount(0);
      const added = drawer.getByRole("region", { name: "Record manual-2", exact: true });
      await expect(added.getByRole("textbox", { name: "Employee ID", exact: true })).toBeFocused();
      await added.getByRole("textbox", { name: "Employee ID", exact: true }).fill("0012345");
      await added.getByRole("textbox", { name: "First name", exact: true }).fill("Taylor");
      await added.getByRole("textbox", { name: "Last name", exact: true }).fill("Chen");
      await drawer.getByRole("checkbox", { name: "Include Taylor Chen", exact: true }).click();
      await added.getByRole("textbox", { name: "Contact name", exact: true }).fill("Sam Chen");
      const table = drawer.getByRole("table", { name: "Extracted records", exact: true });
      await table.getByRole("button", { name: "Jordan Lee", exact: true }).click();
      await expect(first.getByRole("textbox", { name: "Contact name", exact: true })).toHaveValue("Alex Lee");
      const taylor = table.getByRole("button", { name: "Taylor Chen", exact: true });
      await taylor.focus(); await page.keyboard.press("Enter");
      await expect(added.getByRole("textbox", { name: "Contact name", exact: true })).toHaveValue("Sam Chen");
      await expect(added.getByRole("textbox", { name: "Employee ID", exact: true })).toHaveValue("0012345");
      await info.attach(`focused-records-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
      await drawer.getByRole("button", { name: "Approve records", exact: true }).click();
      await expect(added.getByRole("textbox")).toHaveCount(0);
      await expect(added.getByRole("heading", { name: "Taylor Chen", exact: true })).toBeFocused();
      await page.keyboard.press("Escape"); await expect(logs.getByRole("button", { name: "Records 2", exact: true })).toBeFocused();
      await expect(logs.getByRole("tab")).toHaveCount(0);
      const links = logs.getByRole("button", { name: "Linked runs (2)", exact: true });
      await links.focus(); await page.keyboard.press("Enter");
      const linked = page.getByRole("dialog", { name: "Linked runs", exact: true });
      await expect(linked).toContainText("Taylor Chen"); await page.keyboard.press("Escape"); await expect(links).toBeFocused();
      await links.click(); await linked.getByRole("button", { name: /Taylor Chen/u }).click();
      await expect(logs).toContainText("Sam Chen"); await expect(logs).toContainText("0012345");
      await expect(logs.getByRole("textbox")).toHaveCount(0); await expect(logs.getByRole("button", { name: /^Records/u })).toHaveCount(0);
      await logs.getByRole("button", { name: /^Linked runs \(/u }).click();
      await linked.getByRole("button", { name: /emergency-contact.pdf.*Parent/u }).click();
      await expect(logs).toContainText("Emergency Contact · emergency-contact.pdf");
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: "Records 2", exact: true }).click();
      const overflow = await drawer.evaluate(node => [...node.querySelectorAll<HTMLElement>("section, table, input")].filter(element => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1).map(element => element.getAttribute("aria-label") ?? element.tagName));
      expect(overflow).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}

for (const theme of PARITY_THEMES) test(`every local workflow uses canonical queue and log views @ ${theme.attribute}`, async ({ page }, info) => {
  ensureParityBundle(); const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 }); await installTheme(page, theme);
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
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
      await info.attach(`canonical-${flow.id}-${theme.attribute}.png`, { body: await page.screenshot(), contentType: "image/png" });
    }
    await page.goto(`${server.baseUrl}/?day=invalid-day`);
    await rail.getByRole("button", { name: "OCR", exact: true }).click();
    await expect(page.getByText("Choose a valid date", { exact: true })).toBeVisible();
    expect(errors).toEqual([]); expect(writes).toEqual([]);
  } finally { await server.close(); }
});
