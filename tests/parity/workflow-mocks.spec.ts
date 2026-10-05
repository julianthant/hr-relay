import { expect, test, type Locator } from "@playwright/test";
import { MOCK_WORKFLOWS } from "../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { seedMockRuns } from "../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./helpers/fixture-start.js";

const mockProfile = { bootstrap: { ...FIXTURE_START_PICKER_BOOTSTRAP, workflows: FIXTURE_START_PICKER_BOOTSTRAP.workflows.filter((flow: unknown) => (flow as { id: string }).id === "separations") }, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH };
const pdf = { name: "fictional-packet.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") };
async function advance(dialog: Locator) {
  const preview = dialog.getByRole("button", { name: "Preview plan", exact: true });
  await (await preview.count() ? preview : dialog.getByRole("button", { name: "Continue", exact: true })).click();
}

for (const theme of PARITY_THEMES) test(`OnBase document type selection and review @ ${theme.attribute}-1440`, async ({ page }, info) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: mockProfile });
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
  const types = ["Oath", "I-9 Section 1", "I-9 Section 2", "Emergency Contact"];
  try {
    await page.setViewportSize({ width: 1440, height: 900 }); await installTheme(page, theme);
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
    const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
    const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
    for (const type of types) {
      await rail.getByRole("button", { name: "OnBase", exact: true }).click();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
      const picker = dialog.getByRole("button", { name: "Emergency Contact Document type", exact: true });
      await picker.press("Enter");
      const menu = page.getByRole("menu", { name: "Emergency Contact Document type", exact: true });
      await expect(menu.getByRole("menuitemradio")).toHaveText(types);
      await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveText("Emergency Contact");
      await info.attach(`document-types-${type}-${theme.attribute}.png`, { body: await page.screenshot(), contentType: "image/png" });
      await menu.getByRole("menuitemradio", { name: type, exact: true }).click();
      await expect(dialog.getByRole("button", { name: `${type} Document type`, exact: true })).toBeFocused();
      await expect(dialog.getByText("Other document types", { exact: true })).toHaveCount(0);
      await expect(dialog).not.toContainText("Unavailable");
      await dialog.locator('input[type="file"]').setInputFiles(pdf);
      await advance(dialog); await advance(dialog);
      await expect(dialog.getByRole("region", { name: "Confirm", exact: true }).locator("dl")).toContainText(type);
      await dialog.getByRole("button", { name: "Start preview", exact: true }).click();
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      const review = logs.getByRole("region", { name: "OCR records", exact: true });
      if (type === "Oath") await expect(review.getByRole("textbox", { name: "Printed name", exact: true })).toBeVisible();
      else if (type === "Emergency Contact") await expect(review.getByRole("textbox", { name: "Contact name", exact: true })).toBeVisible();
      else {
        const section = type.endsWith("1") ? 1 : 2;
        await expect(review.getByRole("textbox", { name: `Section ${section} page`, exact: true })).toBeVisible();
        await expect(review.getByRole("textbox", { name: `Section ${section === 1 ? 2 : 1} page`, exact: true })).toHaveCount(0);
        await expect(review.getByRole("combobox", { name: "Source page", exact: true })).toHaveCount(0);
        await expect(review.getByRole("img")).toHaveCount(1);
      }
      await info.attach(`review-${type}-${theme.attribute}.png`, { body: await page.screenshot(), contentType: "image/png" });
      await review.getByRole("button", { name: "Approve records", exact: true }).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      await logs.getByRole("button", { name: /^Linked runs \(/u }).click();
      await page.getByRole("dialog", { name: "Linked runs", exact: true }).getByRole("button", { name: /Jordan Lee/u }).click();
      await expect(logs).toContainText(type);
      await expect(logs).not.toContainText("X_HR_Emergency Contact");
      await logs.getByRole("button", { name: /^Linked runs \(/u }).click();
      await page.getByRole("dialog", { name: "Linked runs", exact: true }).getByRole("button").filter({ hasText: "Parent ·" }).click();
      await logs.getByRole("button", { name: "Rerun", exact: true }).click();
      const rerun = page.getByRole("dialog", { name: "Rerun", exact: true });
      await advance(rerun);
      await expect(rerun.getByRole("button", { name: `${type} Document type`, exact: true })).toBeVisible();
      await rerun.getByRole("button", { name: "Cancel", exact: true }).click();
    }
    expect(errors).toEqual([]); expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  } finally { await server.close(); }
});

for (const theme of PARITY_THEMES) for (const width of [1024, 1440, 1920]) {
  test(`all workflow previews, Run and Rerun @ ${theme.attribute}-${width}`, async ({ page }, info) => {
    ensureParityBundle();
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: mockProfile });
    const errors: string[] = [], writes: string[] = [], external: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { const url = new URL(request.url()); if (request.method() !== "GET") writes.push(url.pathname); if (url.origin !== new URL(server.baseUrl).origin) external.push(url.origin); });
    try {
      await page.setViewportSize({ width, height: width === 1024 ? 720 : 1000 }); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      await expect(rail.getByRole("button")).toHaveCount(15);
      for (const flow of MOCK_WORKFLOWS) {
        await rail.getByRole("button", { name: "Onboarding", exact: true }).click();
        await page.getByRole("button", { name: "Start a run", exact: true }).click();
        let dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
        const picker = dialog.getByRole("navigation", { name: "Workflow", exact: true });
        if (!flow.runnable) {
          await expect(picker.getByRole("button", { name: flow.label, exact: true })).toBeDisabled();
          await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
          await rail.getByRole("button", { name: flow.label, exact: true }).click();
          const sample = seedMockRuns().find(run => run.workflowId === flow.id)!;
          await page.getByRole("region", { name: "Queue", exact: true }).getByRole("button", { name: new RegExp(`^${sample.subject.replaceAll(".", "\\.")} —`, "u") }).click();
          const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
          await expect(logs.getByRole("heading", { level: 2 })).toHaveText(sample.subject);
          if (flow.methods[0] === "delegated") await expect(logs).toContainText("Read Section 2 signer");
          await info.attach(`delegated-${flow.id}-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
          continue;
        }
        await picker.getByRole("button", { name: flow.label, exact: true }).click();
        if (flow.id === "separations") {
          await expect(dialog).toContainText("New work · Separations");
          await dialog.getByRole("textbox", { name: "Kuali ID", exact: true }).fill(flow.example);
          await advance(dialog);
          await expect(dialog.getByRole("region", { name: "Options", exact: true })).toBeVisible();
          await expect(dialog.getByRole("button", { name: "Start preview", exact: true })).toHaveCount(0);
          await page.keyboard.press("Escape");
          continue;
        }
        dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
        await expect(dialog).toHaveCSS("opacity", "1");
        const box = (await dialog.boundingBox())!;
        expect(box.width).toBe(880); expect(box.height).toBe(628);
        expect((await dialog.locator(".launch-workflow-rail").boundingBox())!.width).toBe(190);
        await expect(dialog).not.toContainText("The composition:");
        if (flow.methods[0] === "typed") await dialog.getByRole("textbox", { name: flow.inputLabel, exact: true }).fill(flow.example);
        if (flow.methods[0] === "pdf") await dialog.locator('input[type="file"]').setInputFiles(pdf);
        if (flow.id === "sharepoint-download") {
          await expect(dialog.getByRole("button", { name: "Onboarding Roster Spreadsheet", exact: true })).toBeVisible();
          await expect(dialog.locator('input[type="url"]')).toHaveCount(0);
        }
        await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
        await info.attach(`input-${flow.id}-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
        await advance(dialog);
        await expect(dialog.getByRole("region", { name: "Options", exact: true })).toBeVisible();
        await expect(dialog.getByRole("checkbox", { name: "Dry run", exact: true })).toHaveCount(flow.dryRun ? 1 : 0);
        const flags = dialog.locator(".launch-flags"), controls = dialog.locator(".launch-options-grid");
        expect((await flags.boundingBox())!.y).toBeLessThan((await controls.boundingBox())!.y);
        await expect(dialog.getByRole("checkbox", { name: "Capture screenshots", exact: true })).toBeChecked();
        await dialog.getByRole("radio", { name: "Bulk", exact: true }).press("Space");
        await dialog.getByRole("radio", { name: "Headless", exact: true }).press("Space");
        await dialog.getByRole("checkbox", { name: "Capture screenshots", exact: true }).uncheck();
        await dialog.getByRole("checkbox", { name: "Customize steps", exact: true }).check();
        await info.attach(`options-${flow.id}-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
        await advance(dialog);
        const stepRegion = dialog.getByRole("region", { name: "Steps", exact: true });
        await expect(stepRegion.getByRole("checkbox")).toHaveCount(flow.steps.length);
        await expect(dialog).toContainText(`${flow.steps.length} / ${flow.steps.length} included`);
        await expect(stepRegion.locator("li").first()).toHaveCSS("min-height", "58px");
        await stepRegion.getByRole("checkbox", { name: flow.steps[0].label, exact: true }).uncheck();
        await info.attach(`steps-${flow.id}-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
        await advance(dialog);
        await expect(dialog.getByRole("region", { name: "Confirm", exact: true })).toBeVisible();
        const confirmation = dialog.getByRole("region", { name: "Confirm", exact: true });
        await expect(confirmation.getByRole("heading", { name: "1 run ready to queue", exact: true })).toBeVisible();
        const summaryGap = await confirmation.evaluate(el => getComputedStyle(el).getPropertyValue("--ds-space-cozy").trim());
        await expect(confirmation).toHaveCSS("gap", summaryGap);
        await expect(confirmation).toContainText("Bulk");
        await expect(confirmation).toContainText("Headless · screenshots off");
        await expect(confirmation).toContainText(`Omitted: ${flow.steps[0].label}`);
        await expect(confirmation.locator("dl")).toHaveCSS("font-family", /-apple-system/);
        await expect(confirmation.locator("details")).toHaveCount(0);
        await expect(confirmation.getByText("Workflow plan", { exact: true })).toHaveCount(0);
        expect((await dialog.locator(":scope > footer").boundingBox())!.height).toBe(57);
        await info.attach(`confirm-${flow.id}-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
        await dialog.getByRole("button", { name: "Start preview", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
        await expect(logs.getByRole("heading", { level: 2 })).toHaveText(flow.methods[0] === "pdf" ? pdf.name : flow.example);
        expect(writes).toEqual([]); expect(external).toEqual([]);
        await logs.getByRole("button", { name: "Rerun", exact: true }).click();
        const rerun = page.getByRole("dialog", { name: "Rerun", exact: true });
        await expect(rerun.getByRole("list", { name: "Run configuration path" }).getByRole("listitem")).toHaveText([/^1\s*Steps$/u, /^2\s*Values$/u, /^3\s*Options$/u, /^4\s*Confirm$/u]);
        await expect(rerun.getByRole("complementary", { name: "Source run", exact: true })).toContainText(flow.label);
        await expect(rerun.getByRole("checkbox", { name: flow.steps[0].label, exact: true })).not.toBeChecked();
        await expect(rerun.locator(".launch-step-status")).toHaveCount(flow.steps.length);
        await advance(rerun);
        await expect(rerun.getByRole("region", { name: "Values", exact: true })).toBeVisible();
        await advance(rerun);
        await expect(rerun.getByRole("radio", { name: "Bulk", exact: true })).toBeChecked();
        await expect(rerun.getByRole("radio", { name: "Headless", exact: true })).toBeChecked();
        await expect(rerun.getByRole("checkbox", { name: "Capture screenshots", exact: true })).not.toBeChecked();
        await advance(rerun);
        await expect(rerun.getByText("Workflow plan", { exact: true })).toHaveCount(0);
        await rerun.getByRole("button", { name: "Create rerun", exact: true }).click();
        await expect(rerun).toHaveCount(0);
        await logs.getByRole("button", { name: /^Linked runs \(\d+\)$/u }).click();
        await expect(page.getByRole("dialog", { name: "Linked runs", exact: true })).toContainText("Rerun source ·");
        await page.keyboard.press("Escape");
      }
      await rail.getByRole("button", { name: "Oath Upload", exact: true }).click();
      const approvalLogs = page.getByRole("region", { name: "Selected run logs", exact: true });
      await approvalLogs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await approvalLogs.getByRole("button", { name: /^Records \d+$/u }).click();
      const review = approvalLogs.getByRole("region", { name: "OCR records", exact: true });
      await review.getByRole("button", { name: "Approve records", exact: true }).click();
      await approvalLogs.getByRole("button", { name: /^Records \d+$/u }).click();
      await rail.getByRole("button", { name: "Oath Signature", exact: true }).click();
      await expect(page.getByRole("region", { name: "Queue", exact: true })).toContainText("Jordan Lee");
      await rail.getByRole("button", { name: "Oath Upload", exact: true }).click();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      const upload = page.getByRole("dialog", { name: "Start a run", exact: true });
      await upload.getByRole("radio", { name: "Upload-only", exact: true }).press("Space");
      await expect(upload.getByRole("button", { name: /Roster$/u })).toHaveCount(0);
      await upload.locator('input[type="file"]').setInputFiles(pdf);
      await advance(upload);
      await expect(upload.getByRole("button", { name: /Workers$/u })).toHaveCount(0);
      await expect(upload.getByRole("spinbutton", { name: "Workers", exact: true })).toHaveCount(0);
      await advance(upload);
      await expect(upload.getByText("Workflow plan", { exact: true })).toHaveCount(0);
      await info.attach(`upload-only-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
      await upload.getByRole("button", { name: "Start preview", exact: true }).click();
      await expect(upload).toHaveCount(0);
      await expect(approvalLogs.getByRole("navigation", { name: "Run timeline", exact: true }).getByRole("button", { name: /^Wait for all signatures/u })).toHaveCount(0);
      await page.keyboard.press("Escape");
      expect(errors).toEqual([]); expect(writes).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await server.close(); }
  });
}

for (const theme of PARITY_THEMES) test(`workflow mode controls @ ${theme.attribute}`, async ({ page }) => {
  ensureParityBundle();
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: mockProfile });
  const writes: string[] = [];
  page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 }); await installTheme(page, theme);
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
    const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
    await rail.getByRole("button", { name: "Oath Signature", exact: true }).click();
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
    await dialog.getByRole("radio", { name: "PDFs", exact: true }).press("Space");
    await dialog.locator('input[type="file"]').setInputFiles(pdf);
    await expect(dialog.getByRole("button", { name: "Existing Onboarding Roster Roster", exact: true })).toBeVisible();
    await advance(dialog);
    await expect(dialog.getByRole("button", { name: "Auto Workers", exact: true })).toBeVisible();
    await expect(dialog.getByRole("checkbox", { name: "Dry run", exact: true })).not.toBeChecked();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    await dialog.getByRole("navigation", { name: "Workflow", exact: true }).getByRole("button", { name: "Person Lookup", exact: true }).click();
    await dialog.getByRole("radio", { name: "Match", exact: true }).press("Space");
    const match = dialog.getByRole("textbox", { name: "Name, DOB and SSN", exact: true });
    await match.fill("Lee, Jordan, x, x");
    await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("checkbox", { name: "CRM check", exact: true })).not.toBeChecked();
    await match.fill("Lee, Jordan, 01/01/2000, x");
    await advance(dialog);
    await advance(dialog);
    await expect(dialog.getByText("Workflow plan", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Start preview", exact: true }).click();
    const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
    await expect(logs.getByRole("navigation", { name: "Run timeline", exact: true }).getByRole("button", { name: /^Read employment status · Skipped/u })).toBeVisible();
    await page.keyboard.press("Escape");
    await rail.getByRole("button", { name: "Onboarding", exact: true }).click();
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Emails", exact: true }).fill("jordan.lee@example.com");
    await advance(dialog);
    await dialog.getByRole("radio", { name: "Rehire", exact: true }).press("Space");
    await dialog.getByRole("checkbox", { name: "Customize steps", exact: true }).click();
    await advance(dialog);
    await expect(dialog.getByRole("region", { name: "Steps", exact: true })).toBeVisible();
    const stepChecks = dialog.getByRole("region", { name: "Steps", exact: true }).getByRole("checkbox");
    for (const checkbox of await stepChecks.all()) await checkbox.uncheck();
    await expect(dialog.getByRole("button", { name: "Preview plan", exact: true })).toBeDisabled();
    await dialog.getByRole("button", { name: "2 Options", exact: true }).click();
    await dialog.getByRole("checkbox", { name: "Customize steps", exact: true }).uncheck();
    await advance(dialog);
    await expect(dialog).toContainText("8 / 8 included");
    await expect(dialog).toContainText("Rehire · UC_CONC_HIRE");
    await expect(dialog.getByText("Workflow plan", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Start preview", exact: true }).click();
    await expect(logs.getByRole("navigation", { name: "Run timeline", exact: true }).getByRole("button", { name: /^Create I-9 profile · Skipped/u })).toBeVisible();
    await page.keyboard.press("Escape");
    await rail.getByRole("button", { name: "Person Lookup", exact: true }).click();
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    await dialog.getByRole("navigation", { name: "Workflow", exact: true }).getByRole("button", { name: "Emergency Contact", exact: true }).click();
    await expect(dialog).toContainText("Emergency Contact · Workflow preview");
    await expect(dialog.locator('input[type="file"]')).toBeVisible();
    await page.keyboard.press("Escape");
    expect(writes).toEqual([]);
  } finally { await server.close(); }
});
