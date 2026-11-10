import { setSwitchChecked } from "./helpers/switch-choice.js";
import { workflowReferenceId } from "./helpers/workflow-reference-id.js";
import { capturePresentationReference } from "./helpers/presentation-reference.js";
import { installFrozenMonotonic } from "./helpers/app-driver.js";

import { createHash } from "node:crypto";
import { chooseSelect } from "./helpers/select-choice.js";
import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { MOCK_WORKFLOWS } from "../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { manualReadFields, mockStepIsLocked, mockStepIsDependency } from "../../src/dashboard/surfaces/workflows/mocks/workflow-manual-model.js";
import { seedMockRuns, mockOcrReadSteps, mockSelectableSteps, initialMockDraft } from "../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE, FIXTURE_START_PICKER_DESCRIPTOR_HASH } from "./helpers/fixture-start.js";

const mockProfile = { bootstrap: { ...FIXTURE_START_PICKER_BOOTSTRAP, workflows: FIXTURE_START_PICKER_BOOTSTRAP.workflows.filter((flow: unknown) => (flow as { id: string }).id === "separations") }, day: FIXTURE_START_PICKER_DAY_WIRE, descriptorHash: FIXTURE_START_PICKER_DESCRIPTOR_HASH };
const pdf = { name: "fictional-packet.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") };
async function attachScreenshotFile(page: Page, info: TestInfo, name: string) {
  await capturePresentationReference(page, info, name);
}
async function dismissCreatedToast(page: Page, title: string) {
  const toast = page.locator('[data-slot="toast"]').filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(toast).toBeVisible();
  await toast.click();
  await expect(toast).toHaveCount(0);
}
async function advance(dialog: Locator) { await dialog.getByRole("button", { name: "Continue", exact: true }).click(); }
const startRun = (dialog: Locator) => dialog.getByRole("button", { name: /^Start (dry run|live run|run)$/u });
const recordsDialog = (page: Page) => page.getByRole("dialog", { name: /^Review records/u });
const currentStage = (dialog: Locator) => dialog.getByRole("list", { name: "Run configuration path" }).locator('[aria-current="step"]');

for (const theme of PARITY_THEMES) test(`OnBase document type selection and review @ ${theme.attribute}-1440`, { annotation: [{ type: "required-a11y-evidence", description: `onbase-types-${theme.attribute}.a11y.yml` }] }, async ({ page }, info) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: mockProfile });
  const errors: string[] = [], writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
  const types = ["Oath", "I-9 Section 1", "I-9 Section 2", "Emergency Contact"];
  try {
    await page.setViewportSize({ width: 1280, height: 720 }); await installFrozenMonotonic(page); await installTheme(page, theme);
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
    const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
    const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
    for (const [index, type] of types.entries()) {
      const previousType = types[index - 1] ?? "Emergency Contact";
      await rail.getByRole("button", { name: "OnBase", exact: true }).click();
      await page.getByRole("button", { name: "Start run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
      const picker = dialog.getByRole("button", { name: `${previousType} Document type`, exact: true });
      await picker.press("Enter");
      const menu = page.getByRole("menu", { name: `${previousType} Document type`, exact: true });
      await expect(menu.getByRole("menuitemradio")).toHaveText(types);
      await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveText(previousType);

      await menu.getByRole("menuitemradio", { name: type, exact: true }).click();
      await expect(dialog.getByRole("button", { name: `${type} Document type`, exact: true })).toBeFocused();
      await expect(dialog.getByText("Other document types", { exact: true })).toHaveCount(0);
      await expect(dialog).not.toContainText("Unavailable");
      await dialog.locator('input[type="file"]').setInputFiles(pdf);
      await advance(dialog);
      await startRun(dialog).click();
      await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      const review = recordsDialog(page).getByRole("region", { name: "OCR records", exact: true });
      if (type === "Oath") await expect(review.getByRole("textbox", { name: "Printed name", exact: true })).toBeVisible();
      else if (type === "Emergency Contact") await expect(review.getByRole("group", { name: "Emergency contact", exact: true }).getByRole("textbox", { name: "Name", exact: true })).toBeVisible();
      else {
        const section = type.endsWith("1") ? 1 : 2;
        await expect(review.getByRole("textbox", { name: `Section ${section} page`, exact: true })).toBeVisible();
        await expect(review.getByRole("textbox", { name: `Section ${section === 1 ? 2 : 1} page`, exact: true })).toHaveCount(0);
        await expect(review.getByRole("combobox", { name: "Source page", exact: true })).toHaveCount(0);
        await expect(review.getByRole("img")).toHaveCount(1);
      }

      await review.getByRole("button", { name: "Approve records", exact: true }).click();
      await page.keyboard.press("Escape"); await expect(review).toHaveCount(0);
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
    const a11yName = `onbase-types-${theme.attribute}.a11y.yml`, a11y = await logs.ariaSnapshot();

    await info.attach(a11yName, { body: a11y, contentType: "text/yaml" });
    info.annotations.push({ type: `a11y-attachment-sha256:${a11yName}`, description: createHash("sha256").update(a11y).digest("hex") });
    expect(errors).toEqual([]); expect(writes).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440);
  } finally { await server.close(); }
});

for (const theme of PARITY_THEMES) for (const width of [1280]) {
  test(`all workflow previews, Run and Rerun @ ${theme.attribute}-${width}`, { annotation: [{ type: "required-a11y-evidence", description: `workflow-previews-${theme.attribute}-${width}.a11y.yml` }] }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: mockProfile });
    const errors: string[] = [], writes: string[] = [], external: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { const url = new URL(request.url()); if (request.method() !== "GET") writes.push(url.pathname); if (url.origin !== new URL(server.baseUrl).origin) external.push(url.origin); });
    try {
      await page.setViewportSize({ width, height: 720 }); await installFrozenMonotonic(page); await installTheme(page, theme);
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
      await expect(rail.getByRole("button")).toHaveCount(13);
      for (const flow of MOCK_WORKFLOWS.filter(item => item.id !== "ocr")) {
        await rail.getByRole("button", { name: "Onboarding", exact: true }).click();
        await page.getByRole("button", { name: "Start run", exact: true }).click();
        let dialog = page.getByRole("dialog", { name: "Start run", exact: true });
        const picker = dialog.getByRole("navigation", { name: "Workflow", exact: true });
        if (!flow.runnable) {
          await expect(picker.getByRole("button", { name: flow.label, exact: true })).toHaveCount(0);
          await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
          await rail.getByRole("button", { name: flow.label, exact: true }).click();
          const sample = seedMockRuns().find(run => run.workflowId === flow.id)!;
          await page.getByRole("region", { name: "Queue", exact: true }).getByRole("button", { name: new RegExp(`^${sample.subject.replaceAll("./", "\\.")} —`, "u") }).click({ position: { x: 24, y: 14 } });
          const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
          await expect(logs.getByRole("heading", { level: 2 })).toHaveText(sample.subject);
          if (flow.methods[0] === "delegated") await expect(logs).toContainText("Read Section 2 signer");
          await expect(logs.getByRole("button", { name: "Rerun", exact: true })).toHaveCount(0);

          continue;
        }
        await picker.getByRole("button", { name: flow.label, exact: true }).click();
        dialog = page.getByRole("dialog", { name: "Start run", exact: true });
        await expect(dialog).toHaveCSS("opacity", "1");
        const box = (await dialog.boundingBox())!;
        expect(box.width).toBe(880); expect(box.height).toBe(628);
        expect((await dialog.locator(".launch-workflow-rail").boundingBox())!.width).toBe(190);
        await expect(dialog).not.toContainText("The composition:");
        if (flow.methods[0] === "typed") await dialog.getByRole("textbox", { name: flow.inputLabel, exact: true }).fill(flow.example);
        if (flow.methods[0] === "pdf") await dialog.locator('input[type="file"]').setInputFiles(pdf);
        await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeEnabled();
        await attachScreenshotFile(page, info, `input-${workflowReferenceId(flow.id)}-${theme.attribute}-${width}.png`);
        await advance(dialog);
        await expect(currentStage(dialog)).toHaveText(/Options/u);
        await expect(dialog.getByRole("button", { name: /Workers$/u })).toHaveCount(0);
        await expect(dialog.getByRole("spinbutton", { name: "Workers", exact: true })).toHaveCount(0);
        await expect(dialog.getByRole("switch", { name: "Dry run", exact: true })).toHaveCount(flow.dryRun ? 1 : 0);
        await expect(dialog.getByRole("checkbox", { name: "Capture screenshots", exact: true })).toHaveCount(0);
        await expect(dialog.getByText("Always on", { exact: true })).toBeVisible();
        const priority = dialog.getByRole("switch", { name: "Priority", exact: true });
        await expect(priority).toBeChecked(); await setSwitchChecked(priority, false);
        await dialog.getByRole("radio", { name: "Headless", exact: true }).press("Space");
        await expect(dialog.getByRole("checkbox", { name: "Capture screenshots", exact: true })).toHaveCount(0);
        await setSwitchChecked(dialog.getByRole("switch", { name: "Customize steps", exact: true }), true);

        if (flow.id === "onboarding") await attachScreenshotFile(page, info, "run-shared-options.png");
        await advance(dialog);
        const stepRegion = dialog.getByRole("region", { name: "Steps", exact: true }).last();
        const visibleSteps = mockSelectableSteps(flow.id, initialMockDraft(flow.id));
        const reading = mockOcrReadSteps(flow.id, initialMockDraft(flow.id));
        const stepCount = visibleSteps.length + reading.length;
        await expect(stepRegion.getByRole("switch")).toHaveCount(stepCount + visibleSteps.filter(step => mockStepIsLocked(flow.id, step) && manualReadFields(flow.id, step.key).length > 0).length);
        await expect(dialog).toContainText(`${stepCount} of ${stepCount} included`);
        await expect(stepRegion.locator(".ds-run-row").first()).toHaveCSS("min-height", /^(44|60)px$/u);
        const optionalStep = visibleSteps.find(step => !mockStepIsLocked(flow.id, step) && !mockStepIsDependency(step));
        // Sign-in that a required form action depends on is locked, so some flows have no optional step.
        const optional = optionalStep;
        if (optional === undefined) {
          for (const step of visibleSteps.filter(candidate => !mockStepIsDependency(candidate))) {
            const box = stepRegion.getByRole("switch", { name: `${step.label} (required)`, exact: true });
            await expect(box).toBeDisabled(); await expect(box).toBeChecked();
          }
        } else await setSwitchChecked(stepRegion.getByRole("switch", { name: `Include ${optional.label}`, exact: true }), false);
        if (optional !== undefined) for (const field of manualReadFields(flow.id, optional.key)) {
          const value = field.date ? "10/06/2026" : field.options ? field.options[0] : /employee id/iu.test(field.label) ? "10000001" : field.token === "$name" ? "Jordan Lee" : "None";
          const group = stepRegion.getByRole("group", { name: `Manual values for ${optional.label}`, exact: true });
          if (field.options) await chooseSelect(group.getByRole("combobox", { name: field.label, exact: true }), value);
          else await group.getByRole("textbox", { name: field.label, exact: true }).fill(value);
        }

        if (flow.id === "onboarding") await attachScreenshotFile(page, info, "run-shared-steps.png");
        await expect(dialog).toContainText(`${optional === undefined ? stepCount : stepCount - 1} of ${stepCount} steps`);
        await expect(dialog).not.toContainText("· Priority");
        expect((await dialog.locator(":scope > footer").boundingBox())!.height).toBe(57);

        await startRun(dialog).click();
        await expect(dialog).toHaveCount(0);
        await dismissCreatedToast(page, "Run started");
        const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
        await expect(logs.getByRole("heading", { level: 2 })).toHaveText(flow.methods[0] === "pdf" ? pdf.name : flow.example);
        expect(writes).toEqual([]); expect(external).toEqual([]);
        await logs.getByRole("button", { name: "Rerun", exact: true }).click();
        const rerun = page.getByRole("dialog", { name: "Rerun", exact: true });
        await expect(rerun).toBeVisible();
        await attachScreenshotFile(page, info, `rerun-${workflowReferenceId(flow.id)}.png`);
        await expect(rerun.getByRole("list", { name: "Run configuration path" }).getByRole("listitem")).toHaveText([/^1\s*Steps$/u, /^2\s*Values$/u, /^3\s*Options$/u]);
        await expect(rerun.getByRole("complementary", { name: "Source run", exact: true })).toHaveCount(0);
        if (optional !== undefined) await expect(rerun.getByRole("switch", { name: `Include ${optional.label}`, exact: true })).not.toBeChecked();
        await expect(rerun.locator(".launch-step-status")).toHaveCount(stepCount);
        await advance(rerun);
        await expect(rerun.getByRole("region", { name: "Values", exact: true })).toBeVisible();
        if (flow.id === "onboarding") await attachScreenshotFile(page, info, "rerun-shared-values.png");
        await advance(rerun);
        await expect(rerun.getByRole("radio", { name: "Headless", exact: true })).toBeChecked();
        await expect(rerun.getByRole("checkbox", { name: "Capture screenshots", exact: true })).toHaveCount(0);
        await expect(rerun.getByRole("button", { name: /Workers$/u })).toHaveCount(0);
        await expect(rerun.getByRole("spinbutton", { name: "Workers", exact: true })).toHaveCount(0);
        if (flow.id === "onboarding") await attachScreenshotFile(page, info, "rerun-shared-options.png");
        await expect(rerun.getByText("Workflow plan", { exact: true })).toHaveCount(0);
        await startRun(rerun).click();
        await expect(rerun).toHaveCount(0);
        await dismissCreatedToast(page, "Rerun created");
        await logs.getByRole("button", { name: /^Linked runs \(\d+\)$/u }).click();
        await expect(page.getByRole("dialog", { name: "Linked runs", exact: true })).toContainText("Rerun source ·");
        if (flow.id === "onboarding") await attachScreenshotFile(page, info, "linked-runs-dialog.png");
        await page.keyboard.press("Escape");
      }
      await rail.getByRole("button", { name: "Oath Upload", exact: true }).click();
      const approvalLogs = page.getByRole("region", { name: "Selected run logs", exact: true });
      await approvalLogs.getByRole("button", { name: /^Records \d+$/u }).click();
      const review = recordsDialog(page).getByRole("region", { name: "OCR records", exact: true });
      await review.getByRole("button", { name: "Approve records", exact: true }).click();
      await page.keyboard.press("Escape"); await expect(review).toHaveCount(0);
      await rail.getByRole("button", { name: "Oath Signature", exact: true }).click();
      await expect(page.getByRole("region", { name: "Queue", exact: true })).toContainText("Jordan Lee");
      await rail.getByRole("button", { name: "Oath Upload", exact: true }).click();
      await page.getByRole("button", { name: "Start run", exact: true }).click();
      const upload = page.getByRole("dialog", { name: "Start run", exact: true });
      await upload.getByRole("radio", { name: "Upload-only", exact: true }).press("Space");
      await expect(upload.getByRole("button", { name: /Roster$/u })).toHaveCount(0);
      await upload.locator('input[type="file"]').setInputFiles(pdf);
      await advance(upload);
      await expect(upload.getByRole("button", { name: /Workers$/u })).toHaveCount(0);
      await expect(upload.getByRole("spinbutton", { name: "Workers", exact: true })).toHaveCount(0);
      await expect(upload.getByText("Workflow plan", { exact: true })).toHaveCount(0);

      await startRun(upload).click();
      await expect(upload).toHaveCount(0);
      await expect(approvalLogs.getByRole("navigation", { name: "Run timeline", exact: true }).getByRole("button", { name: /^Wait for all signatures/u })).toHaveCount(0);
      await page.keyboard.press("Escape");
      const a11yName = `workflow-previews-${theme.attribute}-${width}.a11y.yml`, a11y = await approvalLogs.ariaSnapshot();

      await info.attach(a11yName, { body: a11y, contentType: "text/yaml" });
      info.annotations.push({ type: `a11y-attachment-sha256:${a11yName}`, description: createHash("sha256").update(a11y).digest("hex") });
      expect(errors).toEqual([]); expect(writes).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await server.close(); }
  });
}

for (const theme of PARITY_THEMES) test(`workflow mode controls @ ${theme.attribute}`, async ({ page }) => {
  const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" }, profile: mockProfile });
  const writes: string[] = [];
  page.on("request", request => { if (request.method() !== "GET") writes.push(new URL(request.url()).pathname); });
  try {
    await page.setViewportSize({ width: 1280, height: 720 }); await installFrozenMonotonic(page); await installTheme(page, theme);
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
    const rail = page.getByRole("navigation", { name: "Workflows", exact: true });
    await rail.getByRole("button", { name: "Oath Signature", exact: true }).click();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
    await dialog.getByRole("radio", { name: "PDFs", exact: true }).press("Space");
    await dialog.locator('input[type="file"]').setInputFiles(pdf);
    await expect(dialog.getByRole("button", { name: "Add spreadsheet", exact: true })).toBeVisible();
    await advance(dialog);
    await expect(dialog.getByRole("button", { name: /Workers$/u })).toHaveCount(0);
    await expect(dialog.getByRole("spinbutton", { name: "Workers", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("switch", { name: "Dry run", exact: true })).not.toBeChecked();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await dialog.getByRole("navigation", { name: "Workflow", exact: true }).getByRole("button", { name: "Person Lookup", exact: true }).click();
    await dialog.getByRole("radio", { name: "Match", exact: true }).press("Space");
    const match = dialog.getByRole("textbox", { name: "Name, DOB and SSN", exact: true });
    await match.fill("Lee, Jordan, x, x");
    await expect(dialog.getByRole("button", { name: "Continue", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("switch", { name: "CRM check", exact: true })).not.toBeChecked();
    await match.fill("Lee, Jordan, 01/01/2000, x");
    await advance(dialog);
    await expect(dialog.getByText("Workflow plan", { exact: true })).toHaveCount(0);
    await startRun(dialog).click();
    const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
    await expect(logs.getByRole("navigation", { name: "Run timeline", exact: true }).getByRole("button", { name: /^Read employment status · Skipped/u })).toBeVisible();
    await page.keyboard.press("Escape");
    await rail.getByRole("button", { name: "Onboarding", exact: true }).click();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Emails", exact: true }).fill("jordan.lee@example.com");
    await advance(dialog);
    await dialog.getByRole("radio", { name: "Rehire", exact: true }).press("Space");
    await setSwitchChecked(dialog.getByRole("switch", { name: "Customize steps", exact: true }), true);
    await advance(dialog);
    await expect(dialog.getByRole("region", { name: "Steps", exact: true }).last()).toBeVisible();
    const stepChecks = dialog.getByRole("region", { name: "Steps", exact: true }).last().getByRole("switch");
    for (const checkbox of await stepChecks.all()) {
      if (await checkbox.isDisabled()) await expect(checkbox).toBeChecked();
      else await setSwitchChecked(checkbox, false);
    }
    await expect(startRun(dialog)).toBeDisabled();
    await dialog.getByRole("button", { name: "2 Options", exact: true }).click();
    await setSwitchChecked(dialog.getByRole("switch", { name: "Customize steps", exact: true }), false);
    await expect(dialog).toContainText("8 of 8 steps");
    await expect(dialog.getByText("Workflow plan", { exact: true })).toHaveCount(0);
    await startRun(dialog).click();
    await expect(logs.getByRole("navigation", { name: "Run timeline", exact: true }).getByRole("button", { name: /^Create I-9 profile · Skipped/u })).toBeVisible();
    await page.keyboard.press("Escape");
    await rail.getByRole("button", { name: "Person Lookup", exact: true }).click();
    await page.getByRole("button", { name: "Start run", exact: true }).click();
    await dialog.getByRole("navigation", { name: "Workflow", exact: true }).getByRole("button", { name: "Emergency Contact", exact: true }).click();
    await expect(dialog).toContainText("Emergency Contact · Workflow preview");
    await expect(dialog.getByRole("button", { name: "Choose PDFs", exact: true })).toBeVisible();
    await expect(dialog.locator('input[type="file"]')).toHaveCount(1);
    await page.keyboard.press("Escape");
    expect(writes).toEqual([]);
  } finally { await server.close(); }
});
