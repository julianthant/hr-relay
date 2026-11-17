import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { build, preview, type PreviewServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { test } from "./helpers/fixtures.js";
import { GENERAL_STATES, GENERAL_VARIANTS } from "./helpers/settings-general-chatgpt-scenes.js";

// Settings > General top variants (ChatGPT card, then Permissions) in the parity mock harness; frames are evidence, never test references.
const repoRoot = resolve(import.meta.dirname, "../..");
const fixtureRoot = join(repoRoot, "tests/mocks/.output/settings-general-chatgpt-fixture");
const OUT = process.env.SETTINGS_GENERAL_CHATGPT_MOCK_OUT ?? "/Users/julianhein/Projects/hr-relay/.work/evidence/ui-state-fixes/settings-general-chatgpt/mock";
const THEMES = ["light", "dark"] as const;
const WIDTHS = [1280, 1024] as const;

let server: PreviewServer;
let baseUrl: string;
test.beforeAll(async () => {
  mkdirSync(fixtureRoot, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(fixtureRoot, "index.html"), `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>General</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`);
  writeFileSync(join(fixtureRoot, "main.tsx"), `import { mountGeneralScene } from ${JSON.stringify(join(repoRoot, "tests/mocks/helpers/settings-general-chatgpt-scenes.tsx"))};\nimport "./style.css";\nmountGeneralScene();\n`);
  writeFileSync(join(fixtureRoot, "style.css"), `@import ${JSON.stringify(join(repoRoot, "src/dashboard/app/index.css"))};\n@source ${JSON.stringify(join(repoRoot, "src/dashboard"))};\n`);
  const outDir = join(fixtureRoot, "dist");
  await build({ configFile: false, root: fixtureRoot, plugins: [react(), tailwindcss()], logLevel: "warn", build: { outDir, emptyOutDir: true } });
  server = await preview({ configFile: false, root: fixtureRoot, logLevel: "warn", build: { outDir }, preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") throw new Error("settings-general-chatgpt-server-address-invalid");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done())); });

for (const theme of THEMES) for (const width of WIDTHS) test(`general top frames @ ${theme} ${width}`, async ({ page }) => {
  test.setTimeout(240_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const variant of GENERAL_VARIANTS) for (const state of GENERAL_STATES) {
    await page.goto(`${baseUrl}/?variant=${variant}&state=${state}&theme=${theme}`);
    const heading = (name: string) => page.getByRole("heading", { name, exact: true });
    await expect(heading("Permissions")).toBeVisible();
    // The card comes first, Permissions second.
    const order = await page.evaluate(() => {
      const top = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().top ?? Number.NaN;
      return { card: top("[data-settings-path='chatgpt.account']"), permissions: top("[data-settings-path='assistant.fullAccess']") };
    });
    expect(order.card, `${variant}/${state} card position`).toBeLessThan(order.permissions);
    await expect(page.getByRole("switch", { name: /Full access/ })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `${variant}/${state} horizontal overflow`).toBe(false);
    await page.screenshot({ path: join(OUT, `${variant}-${state}-${theme}-${width}.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});
