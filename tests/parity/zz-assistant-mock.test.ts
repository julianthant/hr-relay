import { expect } from "@playwright/test";
import { join } from "node:path";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { ASSISTANT_FRAMES } from "../../src/dashboard/surfaces/assistant/assistant-mock-frames.js";

// Design mock renders for the assistant plan; output goes to the gitignored .work folder.
const OUT = process.env.ASSISTANT_MOCK_OUT ?? join(import.meta.dirname, "../../.work/assistant-mock");
// Comma list of frame ids to render; all when unset.
const ONLY = process.env.ASSISTANT_MOCK_ONLY?.split(",");

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

// Comma list of themes; dark unless asked.
const THEMES = (process.env.ASSISTANT_MOCK_THEMES ?? "dark").split(",");
for (const theme of THEMES) test(`assistant mock @ ${theme}`, async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);
  for (const frame of ASSISTANT_FRAMES.filter(item => ONLY === undefined || ONLY.includes(item.id))) {
    await page.setViewportSize({ width: 1680, height: 900 });
    const workflow = frame.logs.workflow;
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&view=${encodeURIComponent(JSON.stringify({ preview: workflow, mockRun: `mock:${workflow}:sample`, ...(frame.queueFilter ? { queueFilter: frame.queueFilter } : {}) }))}&assistantMock=${frame.id}`);
    const logs = page.getByRole("region", { name: "Selected run logs", exact: true });
    await expect(logs.getByRole("heading", { level: 2 })).toHaveText(frame.logs.subject);
    await expect(page.getByRole("region", { name: "Relay assistant", exact: true })).toBeVisible();
    // Show the run's decision (or its answered line) when it has one, else the latest step.
    await logs.getByRole("region", { name: "Run logs", exact: true }).evaluate(feed => {
      const target = feed.querySelector("form") ?? [...feed.querySelectorAll("p")].find(line => line.textContent?.startsWith("Answered:"));
      if (target) target.scrollIntoView({ block: "center" }); else feed.scrollTop = feed.scrollHeight;
    });
    if (frame.menu === "effort") await page.getByRole("button", { name: /^Thinking effort:/u }).click();
    else await page.mouse.move(1, 1);
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, `${frame.id}-${theme}.png`) });
  }
  expect(errors).toEqual([]);
});
