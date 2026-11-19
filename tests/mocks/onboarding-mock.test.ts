import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect } from "@playwright/test";
import { build, preview, type PreviewServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { test } from "./helpers/fixtures.js";
import { ONBOARDING_SCENES, ONBOARDING_SCENE_IDS } from "./helpers/onboarding-scenes.js";
import { mockOutDir } from "./helpers/out-dir.js";

// Log in, sign-up, the Duo step, ready and the Duo setup window; frames are evidence, never test references.
const repoRoot = resolve(import.meta.dirname, "../..");
const fixtureRoot = join(repoRoot, `tests/mocks/.output/onboarding-fixture-${process.pid}`);
const OUT = mockOutDir(process.env.ONBOARDING_MOCK_OUT, "onboarding");
const THEMES = ["dark", "light"] as const;
const WIDTHS = [1280, 1024] as const;
/** The control each scene must show, so a broken scene names what it looked for. */
const LOOKED_FOR = (id: keyof typeof ONBOARDING_SCENES) => ONBOARDING_SCENES[id].setup === true
  ? { role: "heading", name: "Set up Duo for Relay" } as const
  : ONBOARDING_SCENES[id].step === "login" ? { role: "button", name: "Log in" } as const
  : ONBOARDING_SCENES[id].step === "signup" ? { role: "button", name: "Create profile" } as const
  : ONBOARDING_SCENES[id].step === "ready" ? { role: "button", name: "Go to dashboard" } as const
  : { role: "list", name: "Duo methods" } as const;

let server: PreviewServer;
let baseUrl: string;
test.beforeAll(async () => {
  mkdirSync(fixtureRoot, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(fixtureRoot, "index.html"), `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Onboarding</title></head><body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>`);
  writeFileSync(join(fixtureRoot, "main.tsx"), `import { mountOnboardingScene } from ${JSON.stringify(join(repoRoot, "tests/mocks/helpers/onboarding-scenes.tsx"))};\nimport "./style.css";\nmountOnboardingScene();\n`);
  writeFileSync(join(fixtureRoot, "style.css"), `@import ${JSON.stringify(join(repoRoot, "src/dashboard/app/index.css"))};\n@source ${JSON.stringify(join(repoRoot, "src/dashboard"))};\n`);
  const outDir = join(fixtureRoot, "dist");
  await build({ configFile: false, root: fixtureRoot, plugins: [react(), tailwindcss()], logLevel: "warn", build: { outDir, emptyOutDir: true } });
  server = await preview({ configFile: false, root: fixtureRoot, logLevel: "warn", build: { outDir }, preview: { host: "127.0.0.1", port: 0, strictPort: true } });
  const address = server.httpServer.address();
  if (address === null || typeof address === "string") throw new Error("onboarding-server-address-invalid");
  baseUrl = `http://127.0.0.1:${address.port}`;
});
test.afterAll(async () => { await new Promise<void>((done, reject) => server.httpServer.close(error => error ? reject(error) : done())); });

for (const theme of THEMES) for (const width of WIDTHS) test(`onboarding frames @ ${theme} ${width}`, async ({ page }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width, height: 720 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const id of ONBOARDING_SCENE_IDS) {
    await page.goto(`${baseUrl}/?scene=${id}&theme=${theme}`);
    const looked = LOOKED_FOR(id);
    await expect(page.getByRole(looked.role, { name: looked.name }), `${id}: ${looked.role} "${looked.name}"`).toBeVisible({ timeout: 5_000 });
    if (ONBOARDING_SCENES[id].submit === true) {
      await page.getByRole("button", { name: looked.name }).click();
      await expect(page.locator(".hub-auth-error").filter({ hasText: /\S/ }).first(), `${id}: field error`).toBeVisible({ timeout: 5_000 });
    }
    await page.screenshot({ path: join(OUT, `${id}-${theme}-${width}.png`) });
  }
  expect(errors, "page errors").toEqual([]);
});
