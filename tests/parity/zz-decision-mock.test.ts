import { expect, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { DECISION_IDS, MOCK_SCENES, type DecisionId } from "../../src/dashboard/surfaces/run-detail/decision-mock/decision-mock-model.js";

// Design mock renders for the run-decision rules; output goes to the gitignored .work folder.
const OUT = process.env.DECISION_MOCK_OUT ?? join(import.meta.dirname, "../../.work/decision-mock");
// Comma list of frames to render (scene ids, "rename", "explorer"); all when unset.
const ONLY = process.env.DECISION_MOCK_ONLY?.split(",");
const wanted = (key: string) => ONLY === undefined || ONLY.includes(key);

async function grow(page: Page, scroller: Locator) {
  await page.mouse.move(1, 1);
  await page.setViewportSize({ width: 1280, height: 720 });
  const extra = await scroller.evaluate(node => node.scrollHeight - node.clientHeight);
  if (extra > 0) await page.setViewportSize({ width: 1280, height: 720 + extra + 8 });
  await page.waitForTimeout(300);
}

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

for (const theme of ["light", "dark"] as const) test(`decision mock @ ${theme}`, async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);
  const open = async (id: DecisionId, query = "") => {
    const scene = MOCK_SCENES[id];
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&view=${encodeURIComponent(JSON.stringify({ preview: scene.workflow, mockRun: `mock:${scene.workflow}:sample` }))}&decisionMock=${id}${query}`);
    const close = page.getByRole("button", { name: "Close assistant", exact: true });
    await close.click({ timeout: 8000 });
    await expect(close).toHaveCount(0);
    const panel = page.getByRole("region", { name: "Selected run logs", exact: true });
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText(scene.subject);
    return panel;
  };
  if (wanted("rename")) {
    await open("d9p");
    await page.locator("[data-demo-row-title]", { hasText: "Scan_0412.pdf" }).dblclick();
    const name = page.getByRole("textbox", { name: "Run name", exact: true });
    await name.fill("April contacts scan");
    await page.mouse.move(1, 1);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `d9-rename-queue-title-${theme}.png`) });
  }
  for (const id of DECISION_IDS.filter(wanted)) {
    const scene = MOCK_SCENES[id];
    const panel = await open(id);
    const logs = panel.getByRole("region", { name: "Run logs", exact: true });
    const file = `${id}-${scene.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/-$/u, "")}`;
    const control = scene.decision?.kind === "card" ? scene.decision.control : undefined;
    if (control?.kind === "pick") await panel.getByRole("radio").first().check();
    await grow(page, logs);
    await page.screenshot({ path: join(OUT, `${file}-${theme}.png`) });
    if (id === "d8") {
      await panel.getByRole("button", { name: "Confirm", exact: true }).click();
      await expect(panel.getByText("Answered: Check again", { exact: false })).toBeVisible();
      await grow(page, logs);
      await page.screenshot({ path: join(OUT, `d8-answered-${theme}.png`) });
    }
    if (control?.kind !== "pick") continue;
    await panel.getByRole("radio", { name: "None of these", exact: true }).check();
    await panel.getByRole("textbox", { name: control.other.label, exact: true }).fill(control.other.sample);
    await expect(panel.getByRole("button", { name: "Confirm", exact: true })).toBeEnabled();
    await grow(page, logs);
    await page.screenshot({ path: join(OUT, `${file}-none-of-these-${theme}.png`) });
  }
  if (!wanted("explorer")) { expect(errors).toEqual([]); return; }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${server.baseUrl}/?explore=fixture-person-lookup&decisionMock=explorer`);
  const surface = page.getByRole("region", { name: "Workflow explorer preview", exact: true });
  await expect(surface.getByRole("heading", { name: "Search for person", exact: true })).toBeVisible();
  const scroller = surface.locator("xpath=ancestor::*[contains(@class,'overflow-y-auto') or contains(@class,'overflow-auto')][1]");
  await grow(page, (await scroller.count()) ? scroller : surface);
  await page.screenshot({ path: join(OUT, `explorer-person-lookup-${theme}.png`) });
  expect(errors).toEqual([]);
});
