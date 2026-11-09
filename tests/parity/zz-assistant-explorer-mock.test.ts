import { expect, type Page } from "@playwright/test";
import { join } from "node:path";
import { test } from "./helpers/fixtures.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

// Design mock renders for the floating Sessions dock, the three assistant launchers and Explorer; output goes to the gitignored .work folder.
const OUT = process.env.AX_MOCK_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/next-20261101/assistant-explorer-mock";
const THEMES = (process.env.AX_MOCK_THEMES ?? "light,dark").split(",");
const WIDTH = Number(process.env.AX_MOCK_WIDTH ?? 1280);
const ONLY = process.env.AX_MOCK_ONLY?.split(",");
test.use({ deviceScaleFactor: Number(process.env.AX_MOCK_SCALE ?? 1) });

type Frame = { id: string; query?: string; view?: Record<string, unknown>; settings?: string; act?: (page: Page) => Promise<void> };
const RUN = { preview: "separations", mockRun: "mock:separations:sample" };
const LAUNCHERS = ["a", "b", "c"] as const;
const launcherFrames = LAUNCHERS.flatMap((l): Frame[] => [
  { id: `launcher-${l}-closed`, query: `assistantLauncher=${l}&assistantOpen=0`, view: RUN },
  { id: `launcher-${l}-needs`, query: `assistantLauncher=${l}&assistantOpen=0&assistantNeeds=2`, view: RUN },
  { id: `launcher-${l}-open`, query: `assistantLauncher=${l}&assistantOpen=1&assistantNeeds=2&assistantMock=01-chat-basics`, view: RUN },
]);
const FRAMES: Frame[] = [
  { id: "dock-closed", query: "assistantOpen=0", view: RUN },
  { id: "dock-open", query: "assistantOpen=0", view: { ...RUN, sessions: true } },
  { id: "dock-open-assistant", query: "assistantOpen=1&assistantMock=01-chat-basics", view: { ...RUN, sessions: true } },
  { id: "assistant-effort-menu", query: "assistantOpen=1&assistantMock=01b-model-effort", view: RUN, act: async page => { await page.getByRole("button", { name: /^Thinking effort:/u }).click(); } },
  { id: "assistant-model-menu", query: "assistantOpen=1&assistantMock=01-chat-basics", view: RUN, act: async page => { await page.getByRole("button", { name: /^Model:/u }).click(); } },
  { id: "dock-rail-collapsed", query: "assistantOpen=0", view: RUN, act: async page => { await page.locator(".workspace-rail-actions button").first().click(); } },
  { id: "dock-open-rail-collapsed", query: "assistantOpen=0", view: { ...RUN, sessions: true }, act: async page => { await page.locator(".workspace-rail-actions button").first().click(); } },
  { id: "rail-footer", query: "assistantOpen=0", view: RUN },
  ...launcherFrames,
  { id: "explorer-settings", settings: "explorer", query: "assistantOpen=0", act: async page => {
    await page.getByRole("combobox", { name: "Explorer workflow", exact: true }).click();
    await page.getByRole("option", { name: "Person Lookup", exact: true }).click();
  } },
  { id: "settings-sessions-open", settings: "explorer", query: "assistantOpen=0", view: { sessions: true } },
  { id: "explorer-pick", settings: "explorer", query: "assistantOpen=0", act: async page => {
    await page.getByRole("combobox", { name: "Explorer workflow", exact: true }).click();
    await page.getByRole("option", { name: "Person Lookup", exact: true }).click();
    await page.getByText("Enter employee ID", { exact: false }).first().scrollIntoViewIfNeeded();
    await page.locator("main").evaluate(main => { main.scrollBy(0, 140); });
  } },
  { id: "explorer-bottom", settings: "explorer", query: "assistantOpen=0", act: async page => {
    await page.getByRole("combobox", { name: "Explorer workflow", exact: true }).click();
    await page.getByRole("option", { name: "Person Lookup", exact: true }).click();
    await page.evaluate(() => { for (const el of document.querySelectorAll<HTMLElement>("*")) if (/auto|scroll/u.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 200) el.scrollTop = el.scrollHeight; });
  } },
  { id: "explorer-takeover", query: "assistantOpen=0&explore=fixture-person-lookup", act: async page => {
    await page.getByRole("combobox", { name: "Explorer workflow", exact: true }).click();
    await page.getByRole("option", { name: "Person Lookup", exact: true }).click();
  } },
];

let server: FixtureServer;
test.beforeAll(async () => { server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } }); });
test.afterAll(async () => { await server.close(); });

for (const theme of THEMES) test(`assistant explorer mock @ ${theme} ${WIDTH}`, async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(value => { Reflect.set(window, "relayParityTheme", value); }, theme);
  for (const frame of FRAMES.filter(item => ONLY === undefined || ONLY.includes(item.id))) {
    await page.setViewportSize({ width: WIDTH, height: 720 });
    const view = frame.view ? `&view=${encodeURIComponent(JSON.stringify(frame.view))}` : "";
    await page.goto(`${server.baseUrl}/?day=${FIXTURE_DAY}${frame.settings ? `&settings=${frame.settings}` : ""}${view}${frame.query ? `&${frame.query}` : ""}&statusMock=general-a`);
    if (frame.settings || frame.query?.includes("explore=")) await expect(page.getByRole("heading", { name: "Explorer", exact: true })).toBeVisible();
    else await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toBeVisible();
    await frame.act?.(page);
    await page.mouse.move(1, 1);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, `${frame.id}-${theme}.png`) });
    await page.evaluate(() => { window.localStorage.removeItem("relay.workflow-rail.collapsed"); });
  }
  expect(errors).toEqual([]);
});
