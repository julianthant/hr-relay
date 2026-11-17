import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { build, preview, type PreviewServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { test } from "./helpers/fixtures.js";
import { NOTICE_COPY, NOTICE_SCENES, NOTICE_VARIANTS } from "./helpers/failure-notice-scenes.js";

// Failure-notice scenes (the approved beneath notice) in the parity mock harness; frames are evidence, never test references.
const repoRoot = resolve(import.meta.dirname, "../..");
const fixtureRoot = join(repoRoot, "tests/mocks/.output/failure-notice-fixture");
const OUT = process.env.FAILURE_NOTICE_MOCK_OUT ?? "/home/julian/Projects/hr-relay/.work/evidence/ui-state-fixes/failure-notice-mock";
const THEMES = ["light", "dark"] as const;
const WIDTHS = [1280, 1024] as const;

let server: PreviewServer;
let baseUrl: string;
test.beforeAll(async () => {
  mkdirSync(fixtureRoot, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(fixtureRoot, "index.html"), `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Failure notice</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`);
  writeFileSync(join(fixtureRoot, "main.tsx"), `import { mountNoticeScene } from ${JSON.stringify(join(repoRoot, "tests/mocks/helpers/failure-notice-scenes.tsx"))};\nimport "./style.css";\nmountNoticeScene();\n`);
  writeFileSync(join(fixtureRoot, "style.css"), `@import ${JSON.stringify(join(repoRoot, "src/dashboard/app/index.css"))};\n@source ${JSON.stringify(join(repoRoot, "src/dashboard"))};\n`);
  const outDir = join(fixtureRoot, "dist");
  await build({ configFile: false, root: fixtureRoot, plugins: [react(), tailwindcss()], logLevel: "warn", build: { outDir, emptyOutDir: true } });
  server = await preview({ configFile: false, root: fixtureRoot, logLevel: "warn", build: { outDir }, preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") throw new Error("failure-notice-server-address-invalid");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done())); });

for (const theme of THEMES) for (const width of WIDTHS) test(`failure notice frames @ ${theme} ${width}`, async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const scene of NOTICE_SCENES) for (const copy of NOTICE_COPY) {
    await page.goto(`${baseUrl}/?scene=${scene}&copy=${copy}&theme=${theme}`);
    const notice = page.locator(".fn-sentence");
    const action = page.getByRole("button", { name: /^(Retry|Reload|Start again|Open existing run)/ }).first();
    await expect(notice).toBeVisible();
    await expect(action).toBeVisible();
    // The action keeps a gap from the sentence and the notice says what still works.
    const gap = await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(b => /^(Retry|Reload|Start again|Open existing run)/.test(b.textContent ?? ""))!.getBoundingClientRect();
      const still = document.querySelector(".fn-still")!.getBoundingClientRect();
      const sentence = document.querySelector(".fn-sentence")!.getBoundingClientRect();
      const overlap = !(button.right <= sentence.left || button.left >= sentence.right || button.bottom <= sentence.top || button.top >= sentence.bottom);
      return { overlap, horizontal: button.left - sentence.right, vertical: button.top - Math.max(still.bottom, sentence.bottom), stillText: document.querySelector(".fn-still")!.textContent };
    });
    expect(gap.overlap, `${scene}/${copy} action overlaps the sentence`).toBe(false);
    expect(Math.max(gap.horizontal, gap.vertical), `${scene}/${copy} action gap`).toBeGreaterThanOrEqual(8);
    expect(gap.stillText).toBeTruthy();
    await expect(page.getByText("Copy details")).toHaveCount(0);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `${scene}/${copy} horizontal overflow`).toBe(false);
    await page.screenshot({ path: join(OUT, `${scene}-beneath1-${copy}-${theme}-${width}.png`) });
  }
  expect(errors).toEqual([]);
});
