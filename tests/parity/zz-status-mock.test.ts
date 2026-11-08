import { expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { STATUS_MOCK_IDS, type StatusMockId } from "../../src/dashboard/surfaces/settings/status-mock/status-mock-model.js";

// Design mock renders for the status pages that leave Settings; output goes to the gitignored .work folder.
const OUT = process.env.STATUS_MOCK_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/next-20261101/settings-status-mock";
const THEMES = (process.env.STATUS_MOCK_THEMES ?? "light").split(",") as ("light" | "dark")[];
const WIDTH = Number(process.env.STATUS_MOCK_WIDTH ?? 1440);
const ONLY = process.env.STATUS_MOCK_ONLY?.split(",");

const SETTINGS_PAGE: Partial<Record<StatusMockId, string>> = {
  "general-a": "general", "general-a-problem": "general", "general-b": "general", "general-b-problem": "general",
  "analytics-a": "activity", "analytics-b": "activity",
};

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

async function settle(page: Page) {
  await page.mouse.move(1, 1);
  const grow = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  if (grow > 0) await page.setViewportSize({ width: WIDTH, height: 900 + grow });
  await page.waitForTimeout(500);
}

for (const theme of THEMES) test(`status mock @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);
  for (const id of STATUS_MOCK_IDS.filter(item => ONLY === undefined || ONLY.includes(item))) {
    await page.setViewportSize({ width: WIDTH, height: 900 });
    const settings = SETTINGS_PAGE[id];
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}${settings ? `&settings=${settings}` : ""}&statusMock=${id}`);
    if (settings) await expect(page.getByRole("navigation", { name: "Settings sections", exact: true })).toBeVisible();
    else if (!id.startsWith("signup")) await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toBeVisible();
    // A modal dialog blocks pointer clicks, so close the assistant panel through the DOM.
    await page.getByRole("button", { name: "Close assistant", exact: true }).evaluate(el => (el as HTMLElement).click(), undefined, { timeout: 3000 }).catch(() => undefined);
    await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
    if (id === "toasts") await expect(page.getByText("UCPath is down for maintenance")).toBeVisible();
    if (id.startsWith("run")) await expect(page.getByRole("dialog")).toBeVisible();
    if (settings === "general") await expect(page.getByText(id.endsWith("problem") ? "Saved data needs attention" : "Saved on this computer").first()).toBeVisible();
    if (settings === "activity") await expect(page.getByRole("heading", { name: "Why runs failed" })).toBeVisible();
    await settle(page);
    // Toasts stack collapsed; hover expands them so all three show.
    if (id === "toasts") { await page.getByRole("region", { name: "Notifications" }).getByText("Saved data needs attention").hover(); await page.waitForTimeout(600); }
    await page.screenshot({ path: join(OUT, `${id}-${theme}-${WIDTH}.png`) });
  }
  expect(errors).toEqual([]);
});
