import { expect, type Page } from "@playwright/test";
import { rename } from "node:fs/promises";
import { join } from "node:path";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { MARK_DIRECTIONS } from "../../src/dashboard/surfaces/shell/assistant-mark-model.js";

// Logo design mock: stills per direction and theme (motion reduced, so every state is static) and one short dark recording per direction.
const OUT = process.env.ASSISTANT_LOGO_OUT ?? join(import.meta.dirname, "../../.work/assistant-logo");

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

const url = (direction: string, extra = "") => `${server.baseUrl}/?day=${FIXTURE_DAY}&view=${encodeURIComponent(JSON.stringify({ preview: "separations", mockRun: "mock:separations:sample" }))}&assistantLogo=${direction}${extra}`;
async function ready(page: Page) {
  await expect(page.locator("#hub-shell-assistant .hub-chat-title")).toHaveText("Assistant mark");
  await page.mouse.move(1, 1);
}

for (const theme of ["dark", "light"] as const) test(`assistant logo stills @ ${theme}`, async ({ page }) => {
  test.setTimeout(180_000);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);
  for (const direction of MARK_DIRECTIONS) {
    await page.setViewportSize({ width: 1680, height: 900 });
    await page.goto(url(direction));
    await ready(page);
    const panel = page.locator("#hub-shell-assistant");
    const extra = await panel.getByRole("log", { name: "Assistant conversation" }).evaluate(node => node.scrollHeight - node.clientHeight);
    if (extra > 0) await page.setViewportSize({ width: 1680, height: 900 + extra + 8 });
    await page.waitForTimeout(300);
    await panel.screenshot({ path: join(OUT, `${direction}-states-${theme}.png`) });
    await page.setViewportSize({ width: 1680, height: 900 });
    await page.goto(url(direction, "&assistantLogoState=needs-you"));
    await ready(page);
    await page.getByRole("button", { name: "Close assistant", exact: true }).click();
    const launcher = page.getByRole("button", { name: "Ask Relay", exact: true });
    await expect(launcher).toBeVisible();
    await page.waitForTimeout(300);
    const box = await launcher.boundingBox();
    if (!box) throw new Error("LAUNCHER_NOT_LAID_OUT");
    await page.screenshot({ path: join(OUT, `${direction}-launcher-needs-you-${theme}.png`), clip: { x: box.x - 360, y: box.y - 40, width: 420, height: box.height + 80 } });
  }
});

test("assistant logo recordings @ dark", async ({ browser }) => {
  test.setTimeout(180_000);
  for (const direction of MARK_DIRECTIONS) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: OUT, size: { width: 1280, height: 800 } } });
    const page = await context.newPage();
    await page.addInitScript(() => { Reflect.set(window, "relayParityTheme", "dark"); });
    await page.goto(url(direction));
    await ready(page);
    await page.waitForTimeout(9_000);
    const video = page.video();
    await context.close();
    if (video) await rename(await video.path(), join(OUT, `${direction}-states.webm`));
  }
});
