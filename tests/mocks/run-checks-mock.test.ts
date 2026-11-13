import { expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "./helpers/fixtures.js";
import { MOCK_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { RUN_CHECKS_DIRECTIONS, RUN_CHECKS_SCENARIOS } from "../../src/dashboard/surfaces/run-start/run-checks-mock-model.js";

// Design mock renders for the Checks step; frames go to the gitignored .work folder of the worktree.
const OUT = process.env.RUN_CHECKS_OUT ?? join(process.cwd(), ".work/run-checks/frames");
const THEMES = (process.env.RUN_CHECKS_THEMES ?? "light,dark").split(",") as ("light" | "dark")[];
const WIDTH = Number(process.env.RUN_CHECKS_WIDTH ?? 1280);
const KINDS = (process.env.RUN_CHECKS_KINDS ?? "run,rerun").split(",");
const ONLY = process.env.RUN_CHECKS_ONLY?.split(",");

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: MOCK_DIST_DIR, bundle: { proof: "working-tree" } }); mkdirSync(OUT, { recursive: true }); });
test.afterAll(async () => { await server.close(); });

for (const theme of THEMES) test(`run checks mock @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(480_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: 720 });
  for (const direction of RUN_CHECKS_DIRECTIONS) for (const kind of KINDS) for (const scenario of RUN_CHECKS_SCENARIOS) {
    if (ONLY !== undefined && !ONLY.includes(scenario)) continue;
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}&runChecks=${direction}&runChecksScenario=${scenario}&runChecksKind=${kind}`);
    if (scenario === "settings") await expect(page.getByRole("region", { name: "Settings", exact: true })).toBeVisible();
    else await expect(page.getByRole("dialog", { name: kind === "rerun" ? "Rerun" : "Start run", exact: true })).toBeVisible();
    await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
    await page.mouse.move(1, 1);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${direction}-${kind}-${scenario}-${theme}-${WIDTH}.png`) });
  }
  expect(errors).toEqual([]);
});
