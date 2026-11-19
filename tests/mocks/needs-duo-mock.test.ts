import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { build, preview, type PreviewServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { test } from "./helpers/fixtures.js";
import { DUO_VARIANTS } from "./helpers/needs-duo-scenes.js";
import { MOCK_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_DAY_WIRE } from "./helpers/fixture-queue.js";
import { mockOutDir } from "./helpers/out-dir.js";

// "Needs Duo" variants in the parity mock harness; frames are evidence, never test references.
const repoRoot = resolve(import.meta.dirname, "../..");
const fixtureRoot = join(repoRoot, `tests/mocks/.output/needs-duo-fixture-${process.pid}`);
const OUT = mockOutDir(process.env.NEEDS_DUO_MOCK_OUT, "runs-needs-duo");
const THEMES = ["light", "dark"] as const;
const WIDTHS = [1280, 1024] as const;

let server: PreviewServer;
let baseUrl: string;
test.beforeAll(async () => {
  mkdirSync(fixtureRoot, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(fixtureRoot, "index.html"), `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Needs Duo</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`);
  writeFileSync(join(fixtureRoot, "main.tsx"), `import { mountNeedsDuoScene } from ${JSON.stringify(join(repoRoot, "tests/mocks/helpers/needs-duo-scenes.tsx"))};\nimport "./style.css";\nmountNeedsDuoScene();\n`);
  writeFileSync(join(fixtureRoot, "style.css"), `@import ${JSON.stringify(join(repoRoot, "src/dashboard/app/index.css"))};\n@source ${JSON.stringify(join(repoRoot, "src/dashboard"))};\n`);
  const outDir = join(fixtureRoot, "dist");
  await build({ configFile: false, root: fixtureRoot, plugins: [react(), tailwindcss()], logLevel: "warn", build: { outDir, emptyOutDir: true } });
  server = await preview({ configFile: false, root: fixtureRoot, logLevel: "warn", build: { outDir }, preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") throw new Error("needs-duo-server-address-invalid");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done())); });

for (const theme of THEMES) for (const width of WIDTHS) test(`needs duo frames @ ${theme} ${width}`, async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const variant of DUO_VARIANTS) {
    await page.goto(`${baseUrl}/?variant=${variant}&theme=${theme}`);
    // The status reads Needs Duo in the row, and the Duo run sits above the ordinary active rows.
    await expect(page.getByText("Needs Duo").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve Duo" }).first()).toBeVisible();
    const order = await page.evaluate(() => {
      const heading = (text: string) => [...document.querySelectorAll("h3")].find(h => h.textContent?.toLowerCase().startsWith(text))!.getBoundingClientRect().top;
      const duo = [...document.querySelectorAll("li")].find(li => li.textContent?.includes("Dana Whitfield"))!.getBoundingClientRect().top;
      return { needs: heading("needs you"), active: heading("active"), duo };
    });
    expect(order.duo, `${variant} Duo run is under NEEDS YOU`).toBeGreaterThan(order.needs);
    expect(order.duo, `${variant} Duo run is above ACTIVE`).toBeLessThan(order.active);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `${variant} horizontal overflow`).toBe(false);
    await page.screenshot({ path: join(OUT, `${variant}-${theme}-${width}.png`) });
  }
  expect(errors).toEqual([]);
});

// Served dashboard, before and after: the same run held by Duo, once as the old running row and once with the served operatorWait.
for (const state of ["before", "after"] as const) for (const width of WIDTHS) test(`served needs duo ${state} @ ${width}`, async ({ page }) => {
  test.setTimeout(240_000);
  // The same run held by Duo: before it is the old running row, after it carries the served operatorWait.
  const day = structuredClone(FIXTURE_DAY_WIRE) as { queueSurfaces: Record<string, unknown>[] };
  const target = day.queueSurfaces.find(row => row.surfaceKind !== "operation" && (row.parent ?? null) === null && row.status === "running");
  if (target === undefined) throw new Error("needs-duo-served-running-row-missing");
  target.liveMessage = { state: "present", value: "Waiting for Duo approval" };
  if (state === "after") {
    target.status = "awaiting-approval";
    target.operatorWait = { state: "present", kind: "duo", system: "ucpath", since: new Date().toISOString() };
  }
  const served = await startFixtureServer({ distDir: MOCK_DIST_DIR, bundle: { proof: "working-tree" }, dayWire: day as never });
  try {
    await page.setViewportSize({ width, height: 720 });
    await page.goto(`${served.baseUrl}/?day=${FIXTURE_DAY}&fixture=picked-a`);
    await expect(page.getByRole("navigation", { name: "Workflows", exact: true })).toBeVisible();
    await page.addStyleTag({ content: ".hub-assistant-launcher { display: none !important; }" });
    const row = page.getByRole("button").filter({ hasText: "Waiting for Duo approval" }).first();
    await expect(row).toBeVisible();
    await row.click();
    if (state === "after") {
      await expect(page.getByText("Needs Duo").first()).toBeVisible();
      await expect(page.getByText("Approve the Duo sign-in")).toBeVisible();
    } else await expect(page.getByText("Needs Duo")).toHaveCount(0);
    await page.mouse.move(1, 1);
    await page.screenshot({ path: join(OUT, `served-${state}-${width}.png`) });
  } finally { await served.close(); }
});
