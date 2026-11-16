import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { MOCK_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";

// Decision cards with buttons (synthetic reference fixtures): footer buttons are 28px. Frames go to the gitignored .work folder.
const OUT = `${process.env.NOTIFICATIONS_MOCK_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/next-20261101/notifications-mock"}/sweep`;
const THEMES = (process.env.NOTIFICATIONS_MOCK_THEMES ?? "light,dark").split(",") as ("light" | "dark")[];
test.use({ deviceScaleFactor: Number(process.env.NOTIFICATIONS_MOCK_SCALE ?? 1) });
let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: MOCK_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

for (const theme of THEMES) for (const fixture of ["ucpath-found"]) test(`decision card ${fixture} @ ${theme}`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${server.baseUrl}/?fixture=${fixture}${fixture === "ucpath-found" ? "&state=exact" : ""}`);
  const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
  await expect(logs).toBeVisible();
  await page.waitForTimeout(500);
  const heights = await logs.locator("form button, footer.log-decision-footer button, .log-decision-actions button").evaluateAll(nodes => nodes.map(node => Math.round(node.getBoundingClientRect().height)));
  console.log(`DECISION ${fixture} ${theme} ${JSON.stringify(heights)}`);
  expect(heights.length).toBeGreaterThan(0);
  expect(heights.every(height => height === 28)).toBe(true);
  await page.screenshot({ path: `${OUT}/decision-${fixture}-${theme}-1280.png` });
});
