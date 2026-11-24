/** Fixtures for the state gallery: builds and serves the gallery page once per worker and saves a frame per story. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, test as base, type Page, type Request } from "@playwright/test";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { build, preview } from "vite";
import { watchPageDiagnostics } from "./smoke-fixtures.js";
import type { StateRuleContext } from "./state-rules.js";
import { framePath, type CatalogueEntry } from "./story-catalogue.js";

const REPO_ROOT = resolve(import.meta.dirname, "../../../../../");
const GALLERY_ROOT = join(REPO_ROOT, "tests/smoke/gallery");
const SMOKE_OUTPUT = join(REPO_ROOT, "tests/smoke/.output");
/** Where the frames and their index page land, inside the smoke output folder. */
export const STATE_FRAMES_DIR = join(SMOKE_OUTPUT, "states");

interface GalleryWorkerFixtures { galleryUrl: string }
interface GalleryTestFixtures { diagnostics: StateRuleContext["diagnostics"] }

export const test = base.extend<GalleryTestFixtures, GalleryWorkerFixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright parses fixture dependencies from this pattern.
  galleryUrl: [async ({}, use, workerInfo) => {
    const galleryDist = join(SMOKE_OUTPUT, `gallery-page-${String(workerInfo.parallelIndex)}`);
    // One page, no fallback: a path the gallery does not serve answers 404, as the dashboard's backend does.
    const shared = { configFile: false, root: GALLERY_ROOT, logLevel: "warn", appType: "mpa",
      build: { outDir: galleryDist, emptyOutDir: true, chunkSizeWarningLimit: 10_000 } } as const;
    // A failed test restarts the worker; the page this run already built is still current.
    const stamp = join(galleryDist, "built-by-run");
    const run = String(process.ppid);
    if (!existsSync(stamp) || readFileSync(stamp, "utf8") !== run) {
      await build({ ...shared, plugins: [react(), tailwindcss()], resolve: { alias: { "@": join(REPO_ROOT, "src/dashboard") } } });
      writeFileSync(stamp, run);
    }
    const server = await preview({ ...shared, preview: { host: "127.0.0.1", port: 0, strictPort: true } });
    const address = server.httpServer.address();
    if (address === null || typeof address === "string") throw new Error("the gallery preview server reported no port");
    try {
      await use(`http://127.0.0.1:${String(address.port)}`);
    } finally {
      await new Promise<void>((done, reject) => { server.httpServer.close(error => { if (error) reject(error); else done(); }); });
    }
  }, { scope: "worker" }],
  baseURL: async ({ galleryUrl }, use) => { await use(galleryUrl); },
  diagnostics: async ({ page }, use) => {
    const seen = await watchPageDiagnostics(page);
    const inFlight = new Set<Request>();
    page.on("request", request => { inFlight.add(request); });
    page.on("requestfinished", request => { inFlight.delete(request); });
    page.on("requestfailed", request => { inFlight.delete(request); });
    await use({
      seen,
      settle: async () => {
        await expect.poll(() => inFlight.size, { message: "requests the story started and never finished" }).toBe(0);
        // One round trip to the page lets a finished request's console line arrive.
        await page.evaluate(() => new Promise(requestAnimationFrame));
      },
    });
  },
});

export { expect };

/** Saves what the story looks like at this width. Frames are for looking at; nothing compares them. */
export async function saveStateFrame(page: Page, id: string, width: number): Promise<void> {
  const path = join(STATE_FRAMES_DIR, framePath(id, width));
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path, animations: "disabled" });
}

const escapeHtml = (text: string): string => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/** Writes the index page that lists every saved frame by surface. */
export function writeStateFrameIndex(catalogue: readonly CatalogueEntry[], widths: readonly number[]): void {
  const surfaces = [...new Set(catalogue.map(entry => entry.surface))];
  const sections = surfaces.map(surface => {
    const stories = catalogue.filter(entry => entry.surface === surface).map(entry => {
      const frames = widths.filter(width => existsSync(join(STATE_FRAMES_DIR, framePath(entry.id, width))))
        .map(width => `<figure><a href="${framePath(entry.id, width)}"><img loading="lazy" src="${framePath(entry.id, width)}" alt="${escapeHtml(entry.story.title)} at ${String(width)} wide"></a><figcaption>${String(width)}</figcaption></figure>`);
      return frames.length === 0 ? "" : `<article><h3>${escapeHtml(entry.story.title)}</h3><p>${escapeHtml(entry.id)}</p><div class="frames">${frames.join("")}</div></article>`;
    }).join("\n");
    return stories === "" ? "" : `<section><h2>${escapeHtml(surface)}</h2>\n${stories}</section>`;
  }).join("\n");
  mkdirSync(STATE_FRAMES_DIR, { recursive: true });
  writeFileSync(join(STATE_FRAMES_DIR, "index.html"), `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><title>Relay dashboard states</title><style>
body { margin: 24px; background: #111; color: #eee; font: 14px system-ui, sans-serif; }
h2 { margin-top: 32px; text-transform: capitalize; } h3 { margin: 24px 0 2px; } p { margin: 0 0 8px; color: #999; }
.frames { display: flex; flex-wrap: wrap; gap: 12px; } figure { margin: 0; } img { width: 480px; border: 1px solid #333; display: block; }
figcaption { color: #999; margin-top: 4px; } a { color: inherit; }
</style></head><body><h1>Relay dashboard states</h1>
${sections}
</body></html>
`);
}
