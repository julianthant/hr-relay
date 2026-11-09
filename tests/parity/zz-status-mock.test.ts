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
const WIDTH = Number(process.env.STATUS_MOCK_WIDTH ?? 1280);
const HEIGHT = 720;
const ONLY = process.env.STATUS_MOCK_ONLY?.split(",");

const SETTINGS_PAGE: Partial<Record<StatusMockId, string>> = {
  "general-a": "general", "general-a-chatgpt-limit": "general", "general-a-chatgpt-disconnected": "general",
  "analytics-a": "activity", "analytics-b": "activity",
};

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

async function settle(page: Page) {
  await page.mouse.move(1, 1);
  await page.waitForTimeout(500);
}

for (const theme of THEMES) test(`status mock @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);
  for (const id of STATUS_MOCK_IDS.filter(item => ONLY === undefined || ONLY.includes(item))) {
    await page.setViewportSize({ width: WIDTH, height: HEIGHT });
    const settings = SETTINGS_PAGE[id];
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}${settings ? `&settings=${settings}` : ""}&statusMock=${id}`);
    if (settings) await expect(page.getByRole("navigation", { name: "Settings sections", exact: true })).toBeVisible();
    else if (!id.startsWith("signup")) await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toBeVisible();
    // A modal dialog blocks pointer clicks, so close the assistant panel through the DOM.
    await page.getByRole("button", { name: "Close assistant", exact: true }).evaluate(el => (el as HTMLElement).click(), undefined, { timeout: 3000 }).catch(() => undefined);
    await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
    const firstToast = { toasts: "UCPath is down for maintenance", "toasts-storage": "Your disk is full", "toasts-restored": "Restored a damaged file from the 6:30 PM backup" }[id as string];
    if (firstToast) await expect(page.getByText(firstToast)).toBeVisible();
    if (id.startsWith("run")) {
      // The way the operator opens it: Emergency Contact in the rail, then Start a run, then choose the scan.
      await page.getByRole("navigation", { name: "Workflows", exact: true }).getByRole("button", { name: "Emergency Contact", exact: true }).click();
      await page.getByRole("button", { name: "Start a run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start a run", exact: true });
      await dialog.locator('input[type="file"]').setInputFiles({ name: "Scan_0412.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF") });
      await expect(dialog.getByText("Scan_0412.pdf").first()).toBeVisible();
      if (id === "run-b") {
        await dialog.getByRole("button", { name: "Continue", exact: true }).click();
        await dialog.getByRole("button", { name: "Preview plan", exact: true }).click();
        await expect(dialog.getByText("Before you start")).toBeVisible();
      }
    }
    if (settings === "general") await expect(page.getByText(id.endsWith("limit") ? "Usage limit reached" : id.endsWith("disconnected") ? "Disconnected" : "Working · checked 2 min ago").first()).toBeVisible();
    if (settings === "activity") await expect(page.getByRole("heading", { name: "Why runs failed" })).toBeVisible();
    await settle(page);
    // Toasts stack collapsed; hover expands them so all three show.
    if (firstToast) { await page.mouse.move(WIDTH - 130, HEIGHT - 70); await page.waitForTimeout(800); }
    await page.screenshot({ path: join(OUT, `${id}-${theme}-${WIDTH}.png`) });
    // Settings pages scroll inside the window; a second full-window frame shows what sits below the fold.
    const scroller = page.locator("#dashboard-settings-content");
    if (settings && await scroller.evaluate(node => node.scrollHeight - node.clientHeight > 8)) {
      await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(OUT, `${id}-${theme}-${WIDTH}-more.png`) });
    }
  }
  expect(errors).toEqual([]);
});
