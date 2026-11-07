import { expect, type Locator, type Page } from "@playwright/test";
import { join } from "node:path";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

// Sessions bar header options (design mock): one full frame and one states sheet per option and theme; output goes to the gitignored .work folder.
const OUT = process.env.SESSIONS_BAR_OUT ?? join(import.meta.dirname, "../../.work/sessions-bar");
const OPTIONS = ["a", "b", "c"] as const;

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

async function open(page: Page, option: string, extra = "") {
  await page.setViewportSize({ width: 1680, height: 900 });
  await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&view=${encodeURIComponent(JSON.stringify({ preview: "separations", mockRun: "mock:separations:sample" }))}&sessionsBar=${option}${extra}`);
  const close = page.getByRole("button", { name: "Close assistant", exact: true });
  await close.click();
  await expect(close).toHaveCount(0);
  const bar = page.locator(`[data-sessions-bar="${option}"]`);
  await expect(bar).toBeVisible();
  await page.mouse.move(1, 1);
  await page.waitForTimeout(250);
  return bar;
}
const shot = async (target: Locator, page: Page, height?: number) => {
  const box = await target.boundingBox();
  if (!box) throw new Error("SESSIONS_BAR_NOT_LAID_OUT");
  return (await page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: height ?? box.height } })).toString("base64");
};

for (const theme of ["dark", "light"] as const) test(`sessions bar options @ ${theme}`, async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);
  for (const option of OPTIONS) {
    const states: [string, string][] = [];
    let bar = await open(page, option);
    await page.screenshot({ path: join(OUT, `${option}-full-${theme}.png`) });
    states.push(["Rest", await shot(bar, page)]);
    const toggle = bar.getByRole("button", { name: /^Sessions/u });
    await toggle.hover(); await page.waitForTimeout(200);
    states.push(["Hover · Sessions toggle", await shot(bar, page)]);
    await bar.getByRole("button", { name: "Add workers" }).hover(); await page.waitForTimeout(200);
    states.push(["Hover · Add workers", await shot(bar, page)]);
    await toggle.hover(); await page.mouse.down(); await page.waitForTimeout(150);
    states.push(["Pressed · Sessions toggle", await shot(bar, page)]);
    await page.mouse.up(); await page.waitForTimeout(250);
    states.push(["Open (bar expanded)", await shot(bar, page, 220)]);
    bar = await open(page, option);
    await bar.getByRole("button", { name: "Add workers" }).focus();
    await page.keyboard.press("Shift+Tab"); await page.waitForTimeout(150);
    states.push(["Focus-visible · Sessions toggle (keyboard)", await shot(bar, page)]);
    bar = await open(page, option, "&assistantLogoState=needs-you");
    states.push(["Assistant needs you · Orbit mark", await shot(bar, page)]);
    const colours = theme === "dark" ? "background:#121212;color:#e8e8e8" : "background:#f2f2f2;color:#1a1a1a";
    await page.setContent(`<style>body{margin:0;padding:24px;${colours};font:13px/1.4 system-ui,sans-serif}h1{font-size:18px;margin:0 0 16px}figure{margin:0 0 14px}figcaption{margin-bottom:6px;opacity:.7}img{display:block;max-width:100%;border:1px solid #8884}</style><h1>Sessions bar · option ${option.toUpperCase()} · ${theme}</h1>${states.map(([label, data]) => `<figure><figcaption>${label}</figcaption><img src="data:image/png;base64,${data}"></figure>`).join("")}`);
    await page.screenshot({ path: join(OUT, `${option}-states-${theme}.png`), fullPage: true });
  }
});
