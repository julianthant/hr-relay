import { createHash } from "node:crypto";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { previewScenarios } from "../../src/dashboard/surfaces/run-detail/logs/log-fixture.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { FIXTURE_INTAKE_IDS } from "../support/fixtures/dashboard/fixture-intake.js";
import { chooseSelect } from "./helpers/select-choice.js";
import { attachPresentationReference } from "./helpers/presentation-reference.js";
import { MOCK_WORKFLOWS } from "../../src/dashboard/surfaces/workflows/mocks/workflow-mock-catalog.js";
import { seedMockRuns } from "../../src/dashboard/surfaces/workflows/mocks/workflow-mock-model.js";
import { installFrozenMonotonic } from "./helpers/app-driver.js";

async function witness(page: Page, info: TestInfo, name: string) {
  const tree = await page.locator("body").ariaSnapshot();
  await info.attach(name, { body: tree, contentType: "text/yaml" });
  info.annotations.push({ type: `a11y-attachment-sha256:${name}`, description: createHash("sha256").update(tree).digest("hex") });
}

for (const theme of PARITY_THEMES) {
  test(`mounted Logs and all Explorer workflows @ ${theme.attribute}`, { annotation: [{ type: "required-a11y-evidence", description: "baseline-workflows.a11y.yml" }] }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    const errors: string[] = [], writes: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.method() !== "GET") writes.push(request.url()); });
    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await installTheme(page, theme);
      await installFrozenMonotonic(page);
      for (const scenario of previewScenarios) {
        await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&run=${FIXTURE_IDS.doneRun}&logPreview=${scenario.id}`);
        await page.getByRole("button", { name: "Close assistant", exact: true }).click();
        const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
        await expect(logs).toBeVisible();
        if (["empty", "waiting", "failed"].includes(scenario.id)) await attachPresentationReference(page, info, `logs-${scenario.id}-${theme.attribute}.png`);
      }
      for (const flow of MOCK_WORKFLOWS) {
        if (["person-lookup", "separations"].includes(flow.id)) {
          await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&view=${encodeURIComponent(JSON.stringify({ preview: flow.id, mockRun: `mock:${flow.id}:sample` }))}`);
        } else {
          await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}`);
          await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: flow.label, exact: true }).click();
        }
        await page.getByRole("button", { name: "Close assistant", exact: true }).click();
        await expect(page.getByRole("region", { name: "Queue", exact: true })).toBeVisible();
        const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
        await expect(logs).toBeVisible();
        await expect(logs.getByRole("heading", { level: 2 })).toHaveText(seedMockRuns().find(run => run.workflowId === flow.id)!.subject);
        await expect(page.getByRole("heading", { level: 1, name: `${flow.label} queue`, exact: true })).toBeVisible();
        await attachPresentationReference(page, info, `workflow-queue-logs-${flow.id}.png`);
        if (["ocr", "oath-signature", "oath-upload", "emergency-contact", "i9-check", "onbase"].includes(flow.id)) {
          if (flow.id !== "ocr") await logs.getByRole("button", { name: "Open OCR", exact: true }).click();
          await logs.getByRole("button", { name: /^Records \d+$/u }).click();
          await expect(logs.getByRole("region", { name: "OCR records", exact: true })).toBeVisible();
          await attachPresentationReference(page, info, `workflow-records-${flow.id}.png`);
        }
      }
      await page.goto(`${server.baseUrl}/?settings=explorer`);
      const explorer = page.getByRole("region", { name: "Workflow explorer preview", exact: true });
      const picker = explorer.getByRole("combobox", { name: "Explorer workflow", exact: true });
      await picker.click();
      const options = await page.locator('[data-slot="select-content"][data-open]').getByRole("option").evaluateAll(nodes => nodes.map(node => ({ label: node.textContent, value: node.getAttribute("data-value") })));
      expect(options).toHaveLength(15);
      await page.keyboard.press("Escape");
      for (const option of options) {
        if (option.value === null) throw new Error("explorer-workflow-option-value-missing");
        await chooseSelect(picker, option.value);
        await expect(picker).toHaveAttribute("data-value", option.value);
        await expect(explorer.getByRole("list", { name: "Workflow steps" })).toBeVisible();
        await expect(page.getByRole("listbox")).toHaveCount(0);
        await attachPresentationReference(page, info, `explorer-${option.value}-${theme.attribute}.png`);
      }
      await witness(page, info, "baseline-workflows.a11y.yml");
      expect(errors).toEqual([]); expect(writes).toEqual([]);
    } finally { await server.close(); }
  });

  test(`existing Intake session loading and failure @ ${theme.attribute}`, { annotation: [{ type: "required-a11y-evidence", description: "baseline-intake.a11y.yml" }] }, async ({ page }, info) => {
    const server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    try {
      await page.setViewportSize({ width: 1280, height: 720 }); await installTheme(page, theme);
      await page.route(`**/api/v1/intake/${FIXTURE_INTAKE_IDS.mapping}`, async route => { await pending; await route.fulfill({ status: 503, json: { error: "fixture-intake-unavailable" } }); });
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&intake=${FIXTURE_INTAKE_IDS.mapping}`);
      await expect(page.getByRole("region", { name: "Spreadsheet intake" })).toBeVisible();
      await attachPresentationReference(page, info, `intake-loading-${theme.attribute}.png`);
      release();
      await expect(page.getByRole("alert")).toBeVisible();
      await attachPresentationReference(page, info, `intake-failure-${theme.attribute}.png`);
      await witness(page, info, "baseline-intake.a11y.yml");
    } finally { release(); await server.close(); }
  });
}
