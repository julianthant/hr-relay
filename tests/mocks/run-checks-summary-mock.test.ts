import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { build, preview, type PreviewServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { test } from "./helpers/fixtures.js";
import { SUMMARY_FLOWS, SUMMARY_STATES, SUMMARY_VARIANTS } from "./helpers/run-checks-summary-scenes.js";

// Run dialog Checks-stage summary variants in the parity mock harness; frames are evidence, never test references.
const repoRoot = resolve(import.meta.dirname, "../..");
const fixtureRoot = join(repoRoot, "tests/mocks/.output/run-checks-summary-fixture");
const OUT = process.env.RUN_CHECKS_SUMMARY_MOCK_OUT ?? "/home/julian/Projects/hr-relay/.work/evidence/ui-state-fixes/run-dialog-checks-summary/mock";
const THEMES = ["light", "dark"] as const;
const WIDTHS = [1280, 1024] as const;

let server: PreviewServer;
let baseUrl: string;
test.beforeAll(async () => {
  mkdirSync(fixtureRoot, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(fixtureRoot, "index.html"), `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Checks summary</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`);
  writeFileSync(join(fixtureRoot, "main.tsx"), `import { mountSummaryScene } from ${JSON.stringify(join(repoRoot, "tests/mocks/helpers/run-checks-summary-scenes.tsx"))};\nimport "./style.css";\nmountSummaryScene();\n`);
  writeFileSync(join(fixtureRoot, "style.css"), `@import ${JSON.stringify(join(repoRoot, "src/dashboard/app/index.css"))};\n@source ${JSON.stringify(join(repoRoot, "src/dashboard"))};\n`);
  const outDir = join(fixtureRoot, "dist");
  await build({ configFile: false, root: fixtureRoot, plugins: [react(), tailwindcss()], logLevel: "warn", build: { outDir, emptyOutDir: true } });
  server = await preview({ configFile: false, root: fixtureRoot, logLevel: "warn", build: { outDir }, preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") throw new Error("run-checks-summary-server-address-invalid");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done())); });

for (const theme of THEMES) for (const width of WIDTHS) test(`checks summary frames @ ${theme} ${width}`, async ({ page }) => {
  test.setTimeout(300_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const variant of SUMMARY_VARIANTS) for (const flow of SUMMARY_FLOWS) for (const state of SUMMARY_STATES) {
    const opens = state === "all-ready" && flow === "start" ? [false, true] : [false];
    for (const open of opens) {
      await page.goto(`${baseUrl}/?variant=${variant}&state=${state}&flow=${flow}&theme=${theme}${open ? "&open=1" : ""}`);
      await expect(page.getByRole("region", { name: "Checks", exact: true })).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      expect(overflow, `${variant}/${state}/${flow} horizontal overflow`).toBe(false);
      await page.screenshot({ path: join(OUT, `${variant}-${state}-${flow}${open ? "-open" : ""}-${theme}-${width}.png`) });
    }
  }
  expect(errors).toEqual([]);
});
