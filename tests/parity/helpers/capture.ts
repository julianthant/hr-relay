/**
 * The ref frontend-backend-integration §7.1 capture contract.
 *
 * "The stored reference includes viewport, theme, fixture id, descriptor hash,
 * app version, and capture date. A screenshot without the matching a11y
 * snapshot is incomplete." — so this helper refuses to store one without the
 * other, and stamps every pair with the metadata that makes a stored pixel
 * auditable later. A reference whose provenance is unknown is not evidence.
 *
 * Both halves of a pair are ASSERTED, never rewritten in place: the pixels
 * through Playwright's baseline comparison, the a11y tree and provenance
 * record through `reference-store.ts`. One switch — PARITY_UPDATE=1, i.e.
 * `npm run test:parity:update` — refreshes both, so the semantic half can
 * never quietly re-freeze itself while the pixel half is held to a baseline.
 */
import { expect, type Page } from "@playwright/test";
import {
  assertOrUpdateParityReference,
  captureName,
  type CaptureMetadata,
} from "./reference-store.js";

export {
  captureName,
  parityUpdateRequested,
  PARITY_UPDATE_COMMAND,
} from "./reference-store.js";
export type { CaptureMetadata } from "./reference-store.js";

export const PARITY_VIEWPORTS = Object.freeze([
  { name: "1280x720", width: 1280, height: 720 },
  { name: "1440x900", width: 1440, height: 900 },
  /** the one narrow supported width (ref frontend-backend-integration §7.1) */
  { name: "narrow-1024x768", width: 1024, height: 768 },
] as const);

export const PARITY_THEMES = Object.freeze([
  { name: "graphite-warm", attribute: "dark" },
  { name: "paper-ink", attribute: "light" },
] as const);

export type ParityViewport = (typeof PARITY_VIEWPORTS)[number];
export type ParityTheme = (typeof PARITY_THEMES)[number];

/**
 * The only page capability the semantic half needs. Narrowing it to this makes
 * the a11y assertion executable outside the Playwright runner, which is what
 * lets the guard suite run the real arm against a violating tree.
 */
export interface A11ySnapshotSource {
  locator(selector: string): { ariaSnapshot(): Promise<string> };
}

/**
 * The key `useDemoTheme` persists its selection under
 * (`src/dashboard/ds/theme.ts`). Seeding it is how the harness asks the PRODUCT
 * for a theme instead of telling the DOM about one.
 */
const DEMO_THEME_STORAGE_KEY = "rebuild-demo.theme";

/**
 * Select the theme through the product's own contract, BEFORE navigation.
 *
 * ## The defect this replaces (2j, D187)
 *
 * `applyTheme` used to stamp `data-demo-theme` on `<html>` and `<body>` with a
 * post-navigation `page.evaluate`. That reached the portalled overlays and
 * nothing else, because `LoadedApp` renders its own `data-demo-theme={theme}`
 * on the app root and `tokens.css` scopes the whole palette off the bare
 * `[data-demo-theme=…]` selector — so the app root re-themed its entire
 * subtree from INSIDE, out of React state the harness never touched. Every
 * `paper-ink` reference in the corpus was photographed DARK, and the semantic
 * half agreed with the pixels: the toggle's accessible name read
 * "Switch to Paper Ink", which is what a DARK app says. The harness set a
 * theme, the product ignored it, and nothing compared the two — a check that
 * could not fail.
 *
 * Seeding `localStorage` before the first navigation makes `readStoredTheme()`
 * seed React state itself, so the app root, `<html>`, `<body>` and the toggle
 * label all agree because they all come from one value. It also removes the
 * fight with the shipped shell's hardcoded `class="dark"`, which the product
 * never has to win either.
 */
export async function installTheme(page: Page, theme: ParityTheme): Promise<void> {
  await page.addInitScript(
    ([key, attribute]) => {
      window.localStorage.setItem(String(key), String(attribute));
    },
    [DEMO_THEME_STORAGE_KEY, theme.attribute] as const,
  );
}

/**
 * Prove the product actually adopted the theme, on all three writers.
 *
 * This is the half whose absence hid the defect for the whole corpus. A
 * harness that selects a theme and does not verify it has only expressed a
 * preference. The app root is checked explicitly because it is the one that
 * wins the cascade.
 */
export async function assertThemeApplied(page: Page, theme: ParityTheme): Promise<void> {
  const observed = await page.evaluate(() => ({
    html: document.documentElement.getAttribute("data-demo-theme"),
    body: document.body.getAttribute("data-demo-theme"),
    root: document.querySelector("[data-parity-ready]")?.getAttribute("data-demo-theme") ?? null,
  }));
  const disagreeing = Object.entries(observed)
    .filter(([, value]) => value !== theme.attribute)
    .map(([where, value]) => `${where}=${value ?? "absent"}`);
  if (disagreeing.length > 0) {
    throw new Error(
      `theme ${theme.name} (${theme.attribute}) was requested but ${disagreeing.join(", ")}; `
      + "the app root's own data-demo-theme scopes the whole palette, so a disagreement here "
      + "means the capture is photographing a theme nobody selected",
    );
  }
}

/**
 * The semantic half of a capture: read the accessibility tree and hold it to
 * its stored reference (or refresh it under an explicit PARITY_UPDATE=1).
 * Returns the reference name so the caller can address the pixel half.
 */
export async function captureA11yReference(
  page: A11ySnapshotSource,
  referencesDir: string,
  metadata: CaptureMetadata,
): Promise<string> {
  const name = captureName(metadata);
  const tree = await page.locator("body").ariaSnapshot();
  if (tree.trim().length === 0) {
    throw new Error(`a11y snapshot for ${name} is empty; refusing to compare a screenshot without its semantic pair`);
  }
  assertOrUpdateParityReference({ referencesDir, tree, metadata });
  return name;
}

/**
 * One capture = one screenshot + one a11y snapshot + one metadata record.
 * The a11y snapshot is asserted FIRST: if the accessibility tree cannot be read
 * or no longer matches its reference the pair is incomplete, and no pixel
 * comparison result should stand in for a semantic one.
 */
export async function captureParityPair(
  page: Page,
  referencesDir: string,
  metadata: CaptureMetadata,
): Promise<void> {
  const name = await captureA11yReference(page, referencesDir, metadata);
  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: false, animations: "disabled" });
}

/**
 * Reads the a11y tree without storing it — the dual-adapter comparison
 * (ref frontend-backend-integration §7.2) needs both adapters' trees in memory to assert they agree.
 */
export async function readA11yTree(page: A11ySnapshotSource): Promise<string> {
  return page.locator("body").ariaSnapshot();
}
