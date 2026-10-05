import { expect, test } from "@playwright/test";
import { MOCK_WORKFLOWS } from "../../src/dashboard/surfaces/workflow-mock-catalog.js";
import { seedMockRuns } from "../../src/dashboard/surfaces/workflow-mock-model.js";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./helpers/fixture-start.js";

const mockProfile = { bootstrap: { ...FIXTURE_START_PICKER_BOOTSTRAP, workflows: FIXTURE_START_PICKER_BOOTSTRAP.workflows.filter((flow: unknown) => (flow as { id: string }).id === "separations") }, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH };
const pdf = { name: "fictional-packet.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") };
for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
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
          await expect(picker.getByRole("button", { name: flow.label, exact: true })).toHaveCount(0);
          await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
          await rail.getByRole("button", { name: flow.label, exact: true }).click();
          const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
          await expect(logs.getByRole("heading", { level: 2 })).toHaveText(seedMockRuns().find(run => run.workflowId === flow.id)!.subject);
          if (flow.methods[0] === "delegated") await expect(logs).toContainText("Read Section 2 signer");
          await info.attach(`delegated-${flow.id}-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
          continue;
        }
        await picker.getByRole("button", { name: flow.label, exact: true }).click();
        if (flow.id === "separations") {
          await expect(dialog).toContainText("New work · Separations");
          await dialog.getByRole("textbox", { name: "Kuali ID", exact: true }).fill(flow.example);
          await dialog.getByRole("button", { name: "Continue", exact: true }).click();
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
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(dialog.getByRole("region", { name: "Options", exact: true })).toBeVisible();
        await expect(dialog.getByRole("checkbox", { name: "Dry run", exact: true })).toHaveCount(flow.dryRun ? 1 : 0);
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(dialog.getByRole("region", { name: "Confirm", exact: true })).toBeVisible();
        await dialog.getByRole("button", { name: "Start preview", exact: true }).click();
        await expect(dialog).toHaveCount(0);
        const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
        await expect(logs.getByRole("heading", { level: 2 })).toHaveText(flow.methods[0] === "pdf" ? pdf.name : flow.example);
        expect(writes).toEqual([]); expect(external).toEqual([]);
        await logs.getByRole("button", { name: "Rerun", exact: true }).click();
        const rerun = page.getByRole("dialog", { name: "Rerun", exact: true });
        await expect(rerun.getByRole("list", { name: "Run configuration path" }).getByRole("listitem")).toHaveText([/^1\s*Steps$/u, /^2\s*Values$/u, /^3\s*Options$/u, /^4\s*Confirm$/u]);
        await expect(rerun.getByRole("complementary", { name: "Source run", exact: true })).toContainText(flow.label);
        await rerun.getByRole("button", { name: "Continue", exact: true }).click();
        await expect(rerun.getByRole("region", { name: "Values", exact: true })).toBeVisible();
        await rerun.getByRole("button", { name: "Continue", exact: true }).click();
        await rerun.getByRole("button", { name: "Continue", exact: true }).click();
        await rerun.getByRole("button", { name: "Create rerun", exact: true }).click();
        await expect(rerun).toHaveCount(0);
        await logs.getByRole("button", { name: /^Linked runs \(\d+\)$/u }).click();
        await expect(page.getByRole("dialog", { name: "Linked runs", exact: true })).toContainText("Rerun source ·");
        await page.keyboard.press("Escape");
      }
      await rail.getByRole("button", { name: "Oath Upload", exact: true }).click();
      const approvalLogs = page.getByRole("region", { name: "Selected run logs", exact: true });
      await approvalLogs.getByRole("button", { name: "Open OCR", exact: true }).click();
      await approvalLogs.getByRole("button", { name: "Review records 1", exact: true }).click();
      const review = page.getByRole("dialog", { name: "OCR records", exact: true });
      await review.getByRole("button", { name: "Approve records", exact: true }).click();
      await review.getByRole("button", { name: "Close", exact: true }).click();
      await rail.getByRole("button", { name: "Oath Signature", exact: true }).click();
      await expect(page.getByRole("region", { name: "Queue", exact: true })).toContainText("Jordan Lee");
      await rail.getByRole("button", { name: "Oath Upload", exact: true }).click();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      const upload = page.getByRole("dialog", { name: "Start a run", exact: true });
      await upload.getByRole("radio", { name: "Upload-only", exact: true }).press("Space");
      await expect(upload.getByRole("button", { name: /Roster$/u })).toHaveCount(0);
      await upload.locator('input[type="file"]').setInputFiles(pdf);
      await upload.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(upload.getByRole("button", { name: /Workers$/u })).toHaveCount(0);
      await expect(upload.getByRole("spinbutton", { name: "Workers", exact: true })).toHaveCount(0);
      await upload.getByRole("button", { name: "Continue", exact: true }).click();
      await expect(upload.getByRole("list", { name: "Workflow plan", exact: true })).not.toContainText("Wait for all signatures");
      await info.attach(`upload-only-${theme.attribute}-${width}.png`, { body: await page.screenshot(), contentType: "image/png" });
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
    await expect(dialog.getByRole("button", { name: "Use existing Onboarding Roster Roster", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
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
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("list", { name: "Workflow plan", exact: true })).toContainText("Read employment status · skipped");
    await page.keyboard.press("Escape");
    await rail.getByRole("button", { name: "Onboarding", exact: true }).click();
    await page.getByRole("button", { name: "Start a run", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Emails", exact: true }).fill("jordan.lee@example.com");
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await dialog.getByRole("radio", { name: "Rehire", exact: true }).press("Space");
    await dialog.getByRole("checkbox", { name: "Choose steps", exact: true }).click();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog.getByRole("region", { name: "Steps", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(dialog).toContainText("Rehire · UC_CONC_HIRE");
    await expect(dialog.getByRole("list", { name: "Workflow plan", exact: true })).toContainText("Create I-9 profile · skipped");
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
