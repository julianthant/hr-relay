import { expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "./helpers/fixtures.js";
import { MOCK_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { RUN_CHECKS_SCENARIOS } from "../../src/dashboard/surfaces/run-start/run-checks-mock-model.js";

// Design mock renders for the Checks stage of the approved Run dialog; frames go to the gitignored .work folder of the worktree.
const OUT = process.env.RUN_CHECKS_OUT ?? join(process.cwd(), ".work/run-checks/frames");
const THEMES = (process.env.RUN_CHECKS_THEMES ?? "light,dark").split(",") as ("light" | "dark")[];
const WIDTH = Number(process.env.RUN_CHECKS_WIDTH ?? 1280);
const KINDS = (process.env.RUN_CHECKS_KINDS ?? "run,rerun").split(",");
const ONLY = process.env.RUN_CHECKS_ONLY?.split(",");

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: MOCK_DIST_DIR, bundle: { proof: "working-tree" } }); mkdirSync(OUT, { recursive: true }); });
test.afterAll(async () => { await server.close(); });

const rail = (page: Page) => page.getByRole("navigation", { name: "Workflows", exact: true });

for (const theme of THEMES) test(`run checks mock @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(Number(process.env.RUN_CHECKS_TIMEOUT ?? 900_000));
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayMockTheme", value); }, theme);
  await page.setViewportSize({ width: WIDTH, height: 720 });
  for (const kind of KINDS) for (const scenario of RUN_CHECKS_SCENARIOS) {
    if (ONLY !== undefined && !ONLY.includes(scenario)) continue;
    const base = `${server.baseUrl}/?day=${FIXTURE_DAY}&runChecks=${scenario}`;
    if (kind === "run") {
      await page.goto(`${base}&statusMock=run-person-lookup`);
      await rail(page).getByRole("button", { name: "Person Lookup", exact: true }).last().click();
      await page.getByRole("button", { name: "Start run", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Start run", exact: true });
      await dialog.getByRole("textbox").first().fill("10000001; 10000002; Lee, Jordan");
      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
      await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    } else {
      await page.goto(`${base}&statusMock=run-rerun-steps`);
      await rail(page).getByRole("button", { name: "Separations", exact: true }).last().click();
      await page.getByRole("button", { name: "Rerun", exact: true }).click();
      const dialog = page.getByRole("dialog");
      for (let step = 0; step < 3; step++) await dialog.getByRole("button", { name: "Continue", exact: true }).click();
    }
    await expect(page.getByRole("dialog").getByRole("region", { name: "Checks", exact: true })).toBeVisible();
    // The conditional check sorts last: scroll it into view.
    if (scenario === "conditional") await page.locator(".launch-content").evaluate(node => { node.scrollTop = node.scrollHeight; });
    await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
    await page.mouse.move(1, 1);
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT, `${kind}-${scenario}-${theme}-${WIDTH}.png`) });
  }
  expect(errors).toEqual([]);
});
