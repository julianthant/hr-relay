import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { DashboardDayWireSchema } from "../../src/models/dashboard/projection.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { MOCK_DIST_DIR } from "./helpers/bundle.js";
import { FIXTURE_START_PICKER_BOOTSTRAP, FIXTURE_START_PICKER_DAY_WIRE } from "./helpers/fixture-start.js";
import { startWorkbookSweepServer } from "./helpers/sweep-workbook-server.js";

const out = process.env.SWEEP_FIXTURES_OUT ?? "tests/mocks/.output/sweep-fixtures";
test.beforeAll(async () => { await mkdir(out, { recursive: true }); });
const emptyDay = DashboardDayWireSchema.parse({ ...FIXTURE_START_PICKER_DAY_WIRE,
  queueSurfaces: [], attemptHistory: [], monthCounts: [], workflowCounts: [], statusCounts: [], notifications: [],
});
const duoDay = DashboardDayWireSchema.parse({ ...emptyDay,
  workerCards: emptyDay.workerCards.map(card => ({ ...card,
    browsers: card.browsers.map(browser => ({ ...browser, signIn: "needs-duo" })),
  })),
});

for (const width of [1280, 1024]) {
  test(`served empty Work Study queue and page at ${width}`, async ({ page }) => {
    const server = await startFixtureServer({ distDir: MOCK_DIST_DIR, bundle: { proof: "working-tree" },
      profile: { bootstrap: FIXTURE_START_PICKER_BOOTSTRAP, descriptorHash: emptyDay.descriptorHash, day: emptyDay } });
    try {
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`${server.baseUrl}/?fixture=product-workflows&day=${emptyDay.day}&view=${encodeURIComponent(JSON.stringify({ workflow: "work-study" }))}`);
      await expect(page.getByRole("button", { name: "Start run", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Work-Study queue", exact: true })).toBeVisible();
      await expect(page.locator("[data-demo-row-id]")).toHaveCount(0);
      await page.screenshot({ path: `${out}/work-study-empty-${width}.png` });
      await writeFile(`${out}/work-study-empty-${width}.yaml`, await page.locator("body").ariaSnapshot());
    } finally { await server.close(); }
  });

  for (const workflow of ["work-study", "separations", "onboarding"]) {
    test(`served ${workflow} input sentences at ${width}`, async ({ page }) => {
      const server = await startWorkbookSweepServer({ bootstrap: FIXTURE_START_PICKER_BOOTSTRAP, descriptorHash: emptyDay.descriptorHash, day: emptyDay });
      try {
        await page.setViewportSize({ width, height: 720 });
        const view = { workflow, launchServed: workflow, launchStage: "Input" };
        await page.goto(`${server.baseUrl}/?fixture=product-workflows&day=${emptyDay.day}&start=1&view=${encodeURIComponent(JSON.stringify(view))}`);
        await expect(page.getByRole("dialog")).toBeVisible();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByText(/Not available yet/u)).toHaveCount(0);
        if (workflow === "onboarding") await expect.soft(dialog.getByText("Choose saved roster rows and a hire mode. Each selected row starts one run.", { exact: true })).toBeVisible();
        else await expect(dialog.getByRole("textbox").first()).toBeVisible();
        if (workflow === "work-study") {
          await dialog.getByRole("textbox", { name: "Effective date", exact: true }).fill("08/03/2026");
          await expect(dialog.getByRole("textbox", { name: "Effective date", exact: true })).toHaveValue("08/03/2026");
          await expect.soft(dialog.getByText("Each Employee ID starts one run; every run uses the one effective date.", { exact: true })).toBeVisible();
          await dialog.getByRole("textbox", { name: "Employee IDs", exact: true }).fill("12");
          await dialog.getByRole("textbox", { name: "Employee IDs", exact: true }).press("Tab");
          await expect(dialog.getByText("Employee IDs must contain at least five digits.", { exact: true })).toBeVisible();
        }
        if (workflow === "separations") await expect(dialog.getByText("Kuali ID. Separate values with a semicolon or Shift+Enter.", { exact: true })).toBeVisible();
        await page.screenshot({ path: `${out}/${workflow}-input-${width}.png` });
        await writeFile(`${out}/${workflow}-input-${width}.yaml`, await page.getByRole("dialog").ariaSnapshot());
      } finally { await server.close(); }
    });
  }

  test(`served Sessions Needs Duo at ${width}`, async ({ page }) => {
    const server = await startFixtureServer({ distDir: MOCK_DIST_DIR, bundle: { proof: "working-tree" },
      profile: { bootstrap: FIXTURE_START_PICKER_BOOTSTRAP, descriptorHash: duoDay.descriptorHash, day: duoDay } });
    try {
      await page.setViewportSize({ width, height: 720 });
      await page.goto(`${server.baseUrl}/?fixture=product-workflows&day=${duoDay.day}&view=${encodeURIComponent(JSON.stringify({ sessions: true }))}`);
      await expect(page.getByText("Needs Duo", { exact: true }).first()).toBeVisible();
      await page.screenshot({ path: `${out}/sessions-duo-${width}.png` });
    } finally { await server.close(); }
  });
}
