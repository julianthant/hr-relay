import { setSwitchChecked } from "./helpers/switch-choice.js";
import { installFrozenMonotonic, moveAssistantLauncherAboveFooter } from "./helpers/app-driver.js";

import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { MOCK_WORKFLOWS } from "../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { mockWorkflowCounts, seedMockRuns } from "../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

for (const theme of PARITY_THEMES) for (const width of [1024, 1440]) {
  test(`detailed timeline, subject title and workflow counts @ ${theme.attribute}-${width}`, async ({ page }, _info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message)); page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    const height = width === 1024 ? 720 : 1000;
    try {
      await page.setViewportSize({ width, height }); await installFrozenMonotonic(page); await installTheme(page, theme); await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
      await page.getByRole("button", { name: "Close assistant", exact: true }).click();
      await moveAssistantLauncherAboveFooter(page);
      const rail = page.getByRole("navigation", { name: "Workflows", exact: true }), logs = page.getByRole("region", { name: "Selected run logs", exact: true });
      const counts = mockWorkflowCounts(seedMockRuns());
      for (const flow of MOCK_WORKFLOWS.filter(flow => !["person-lookup", "separations"].includes(flow.id))) {
        const row = counts.find(row => row.workflowId === flow.id)!;
        const active = row.statusCounts.filter(item => ["queued", "running", "cancelling"].includes(item.status)).reduce((sum, item) => sum + item.count, 0);
        await expect(rail.getByRole("button", { name: flow.label, exact: true }).locator(".workflow-rail-meta")).toHaveText(`${active} · ${row.count}`);
        await expect(rail.getByRole("button", { name: flow.label, exact: true }).locator(".workflow-rail-meta")).toBeVisible();
      }
      await rail.getByRole("button", { name: "Onboarding", exact: true }).click();
      await expect(logs.getByRole("heading", { level: 2 })).toHaveText("jordan.lee@example.com");
      const timeline = logs.getByRole("navigation", { name: "Run timeline", exact: true }), hire = timeline.getByRole("button", { name: /^Submit hire · Completed/u });
      await hire.hover(); const tooltip = page.getByRole("tooltip");
      await expect(tooltip.getByRole("list", { name: "Submit hire substeps", exact: true }).getByRole("listitem")).toContainText(["Hire template", "Personal Data", "Job Data", "Earns Dist", "Employee Experience", "Initiator comments", "Save and Submit", "Hire confirmation"]);
      await expect(hire).toHaveAccessibleName(/^Submit hire · Completed/u);
      await expect(tooltip).toContainText("9m 0s");
      const box = await tooltip.boundingBox(); expect(box).not.toBeNull(); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.y + box!.height).toBeLessThanOrEqual(height);

      await hire.focus(); await page.keyboard.press("Enter");
      await expect(logs.getByRole("heading", { name: "Submit hire", exact: true })).toBeFocused();
      await logs.getByRole("searchbox", { name: "Search logs", exact: true }).fill("Expected job end date");
      await expect(logs).toContainText("06/30/2027");

      await logs.getByRole("searchbox", { name: "Search logs", exact: true }).fill("");
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      const launcher = page.getByRole("dialog", { name: "Start a run", exact: true });
      await launcher.getByRole("navigation", { name: "Workflow", exact: true }).getByRole("button", { name: "Onboarding", exact: true }).click();
      await launcher.getByRole("textbox", { name: "Emails", exact: true }).fill("jordan.lee@example.com");
      await launcher.getByRole("button", { name: "Continue", exact: true }).click();
      await launcher.getByRole("radio", { name: "Rehire", exact: true }).press("Space");
      await setSwitchChecked(launcher.getByRole("switch", { name: "Dry run Fill and check every step without submitting.", exact: true }), true);
      await expect(launcher.getByRole("switch", { name: "Dry run Fill and check every step without submitting.", exact: true })).toBeChecked();
      const preview = launcher.getByRole("button", { name: "Preview plan", exact: true });
      await (await preview.count() ? preview : launcher.getByRole("button", { name: "Continue", exact: true })).click();
      await launcher.getByRole("button", { name: "Start preview", exact: true }).click();
      const concurrent = logs.getByRole("navigation", { name: "Run timeline", exact: true }).getByRole("button", { name: /^Submit hire · Skipped/u });
      await expect(concurrent).toBeVisible();
      await concurrent.hover();
      await expect(page.getByRole("tooltip").getByRole("listitem")).toContainText(["Enter Transaction Details", "Resolved identity", "Transaction reason", "Acknowledge the matching Person ID", "Job Data", "Earns Dist", "Personal Data", "Pre-filled legal name", "Cancel unsubmitted draft", "Draft cleanup"]);
      const concurrentBox = await page.getByRole("tooltip").boundingBox(); expect(concurrentBox!.y).toBeGreaterThanOrEqual(0); expect(concurrentBox!.y + concurrentBox!.height).toBeLessThanOrEqual(height);

      await rail.getByRole("button", { name: "Emergency Contact", exact: true }).click();
      await expect(rail.getByRole("button", { name: "Emergency Contact", exact: true }).locator(".workflow-rail-meta")).toHaveText("1 · 1");
      await logs.getByRole("button", { name: "Open OCR", exact: true }).click(); await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      const drawer = logs.getByRole("region", { name: "OCR records", exact: true });
      await drawer.getByRole("button", { name: "Approve records", exact: true }).click(); await logs.getByRole("button", { name: /^Records \d+$/u }).click();
      await expect(rail.getByRole("button", { name: "Emergency Contact", exact: true }).locator(".workflow-rail-meta")).toHaveText("0 · 4");
      await rail.getByRole("button", { name: "Emergency Contact", exact: true }).click();
      await logs.getByRole("button", { name: /^Linked runs \(/u }).click(); await page.getByRole("dialog", { name: "Linked runs", exact: true }).getByRole("button", { name: /Jordan Lee/u }).click();
      await expect(logs.getByRole("heading", { level: 2 })).toHaveText("Jordan Lee");
      await logs.getByRole("navigation", { name: "Run timeline", exact: true }).getByRole("button", { name: /^Fill emergency contact · Completed/u }).hover();
      await expect(page.getByRole("tooltip")).toContainText("Contact details");

      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });
}
