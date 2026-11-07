import { expect } from "@playwright/test";
import { join } from "node:path";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { DIRECTIONS, SCENARIOS, type DirectionId } from "../../src/dashboard/surfaces/assistant/assistant-mock-directions.js";

// Scenario sheets for the assistant design (dark only until the operator approves); output goes to the gitignored .work folder.
const OUT = process.env.ASSISTANT_SHEET_OUT ?? join(import.meta.dirname, "../../.work/assistant-sheets");

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

test("assistant scenario sheets @ dark", async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => { Reflect.set(window, "relayParityTheme", "dark"); });
  for (const scenario of SCENARIOS) {
    const shots: string[] = [];
    for (const direction of Object.keys(DIRECTIONS) as DirectionId[]) {
      await page.setViewportSize({ width: 1680, height: 900 });
      await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&view=${encodeURIComponent(JSON.stringify({ preview: "separations", mockRun: "mock:separations:sample" }))}&assistantSheet=${scenario.id}:${direction}`);
      const panel = page.locator("#hub-shell-assistant");
      await expect(panel.locator(".hub-chat-title")).toHaveText(DIRECTIONS[direction]);
      const extra = await panel.getByRole("log", { name: "Assistant conversation" }).evaluate(node => node.scrollHeight - node.clientHeight);
      if (extra > 0) await page.setViewportSize({ width: 1680, height: 900 + extra + 8 });
      await page.mouse.move(1, 1);
      await page.waitForTimeout(400);
      shots.push((await panel.screenshot()).toString("base64"));
    }
    const columns = (Object.keys(DIRECTIONS) as DirectionId[]).map((direction, index) => `<figure><figcaption>${DIRECTIONS[direction]}${direction === scenario.recommend ? " <b>· recommended</b>" : ""}</figcaption><img src="data:image/png;base64,${shots[index]}"></figure>`).join("");
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.setContent(`<style>body{margin:0;padding:28px;background:#121212;color:#e8e8e8;font:14px/1.4 system-ui,sans-serif}h1{font-size:20px;margin:0 0 18px}main{display:flex;gap:28px;align-items:flex-start}figure{margin:0}figcaption{margin-bottom:10px;color:#a0a0a0}b{color:#7fb3ff;font-weight:600}img{display:block}</style><h1>${scenario.name}</h1><main>${columns}</main>`);
    await page.screenshot({ path: join(OUT, `${scenario.id}-dark.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});
