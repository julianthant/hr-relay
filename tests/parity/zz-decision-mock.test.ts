import { expect, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { DECISION_IDS, MOCK_SCENES } from "../../src/dashboard/surfaces/run-detail/decision-mock/decision-mock-model.js";

// Design mock renders for the run-decision rules; output goes to the gitignored .work folder.
const OUT = process.env.DECISION_MOCK_OUT ?? join(import.meta.dirname, "../../.work/decision-mock");

async function grow(page: Page, scroller: Locator) {
  await page.mouse.move(1, 1);
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
  for (const id of DECISION_IDS) {
    const scene = MOCK_SCENES[id];
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&view=${encodeURIComponent(JSON.stringify({ preview: scene.workflow, mockRun: `mock:${scene.workflow}:sample` }))}&decisionMock=${id}`);
    const close = page.getByRole("button", { name: "Close assistant", exact: true });
    await close.click({ timeout: 8000 });
    await expect(close).toHaveCount(0);
    const panel = page.getByRole("region", { name: "Selected run logs", exact: true });
    await expect(panel.getByRole("heading", { level: 2 })).toHaveText(scene.subject);
    if (scene.decision.kind === "pick") await panel.getByRole("radio").first().check();
    await grow(page, panel.getByRole("region", { name: "Run logs", exact: true }));
    await page.screenshot({ path: join(OUT, `${id}-${scene.name.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/-$/u, "")}-${theme}.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${server.baseUrl}/?explore=fixture-person-lookup&decisionMock=explorer`);
  const surface = page.getByRole("region", { name: "Workflow explorer preview", exact: true });
  await expect(surface.getByRole("heading", { name: "Search for person", exact: true })).toBeVisible();
  const scroller = surface.locator("xpath=ancestor::*[contains(@class,'overflow-y-auto') or contains(@class,'overflow-auto')][1]");
  await grow(page, (await scroller.count()) ? scroller : surface);
  await page.screenshot({ path: join(OUT, `explorer-person-lookup-${theme}.png`) });
  expect(errors).toEqual([]);
});
