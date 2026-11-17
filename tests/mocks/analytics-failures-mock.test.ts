import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { build, preview, type PreviewServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { test } from "./helpers/fixtures.js";
import { FAILURE_CASES, FAILURE_STATES, FAILURE_VARIANTS, classesFor } from "./helpers/analytics-failures-scenes.js";

// Analytics "Why runs failed" grouping variants in the parity mock harness; frames are evidence, never test references.
const repoRoot = resolve(import.meta.dirname, "../..");
const fixtureRoot = join(repoRoot, "tests/mocks/.output/analytics-failures-fixture");
const OUT = process.env.ANALYTICS_FAILURES_MOCK_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/evidence/ui-state-fixes/analytics-failure-grouping";
const THEMES = ["light", "dark"] as const;
const WIDTHS = [1280, 1024] as const;
const TOTAL_FAILED = 57;

let server: PreviewServer;
let baseUrl: string;
test.beforeAll(async () => {
  mkdirSync(fixtureRoot, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(fixtureRoot, "index.html"), `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Analytics failures</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`);
  writeFileSync(join(fixtureRoot, "main.tsx"), `import { mountFailuresScene } from ${JSON.stringify(join(repoRoot, "tests/mocks/helpers/analytics-failures-scenes.tsx"))};\nimport "./style.css";\nmountFailuresScene();\n`);
  writeFileSync(join(fixtureRoot, "style.css"), `@import ${JSON.stringify(join(repoRoot, "src/dashboard/app/index.css"))};\n@source ${JSON.stringify(join(repoRoot, "src/dashboard"))};\n`);
  const outDir = join(fixtureRoot, "dist");
  await build({ configFile: false, root: fixtureRoot, plugins: [react(), tailwindcss()], logLevel: "warn", build: { outDir, emptyOutDir: true } });
  server = await preview({ configFile: false, root: fixtureRoot, logLevel: "warn", build: { outDir }, preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") throw new Error("analytics-failures-server-address-invalid");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done())); });

test("fixture counts add up to the failed runs", () => {
  const sum = classesFor("full").reduce((n, cls) => n + cls.hits.reduce((m, hit) => m + hit.runs, 0), 0);
  expect(sum).toBe(TOTAL_FAILED);
  expect(Math.max(...classesFor("full").map(cls => cls.hits.reduce((m, hit) => m + hit.runs, 0)))).toBe(40);
});

for (const theme of THEMES) for (const width of WIDTHS) test(`analytics failure grouping frames @ ${theme} ${width}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 900 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const variant of FAILURE_VARIANTS) for (const scene of FAILURE_CASES) for (const state of FAILURE_STATES) {
    await page.goto(`${baseUrl}/?variant=${variant}&case=${scene}&state=${state}&theme=${theme}`);
    await expect(page.getByRole("heading", { name: "Why runs failed" })).toBeVisible();
    const body = await page.locator(".af-wrap").innerText();
    expect(body, `${variant}/${scene} never shows an uncatalogued-code row`).not.toContain("not in the current catalog");
    if (scene === "none") await expect(page.getByText("No runs failed in this period")).toBeVisible();
    if (scene === "full" && !(variant === "drill-in" && state === "open")) await expect(page.getByText("Other failures").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `${variant}/${scene}/${state} horizontal overflow`).toBe(false);
    await page.screenshot({ path: join(OUT, `${variant}-${scene}-${state}-${theme}-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});
