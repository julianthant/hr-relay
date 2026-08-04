/**
 * The doc 13 §7.1 capture contract.
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
  /** the one narrow supported width (doc 13 §7.1) */
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

/** Applies the theme the way the app does: the attribute on html AND body. */
export async function applyTheme(page: Page, theme: ParityTheme): Promise<void> {
  await page.evaluate((attribute) => {
    document.documentElement.setAttribute("data-demo-theme", attribute);
    document.body.setAttribute("data-demo-theme", attribute);
    // The shipped shell hardcodes `class="dark"`; the light theme has to win
    // against it exactly as it does in the product.
    document.documentElement.classList.toggle("dark", attribute === "dark");
    document.body.classList.toggle("dark", attribute === "dark");
  }, theme.attribute);
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
 * (doc 13 §7.2) needs both adapters' trees in memory to assert they agree.
 */
export async function readA11yTree(page: A11ySnapshotSource): Promise<string> {
  return page.locator("body").ariaSnapshot();
}
