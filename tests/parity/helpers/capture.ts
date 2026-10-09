
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
] as const);

export const PARITY_THEMES = Object.freeze([
  { name: "graphite-warm", attribute: "dark" },
] as const);

export type ParityViewport = (typeof PARITY_VIEWPORTS)[number];
export type ParityTheme = (typeof PARITY_THEMES)[number];


export interface A11ySnapshotSource {
  locator(selector: string): { ariaSnapshot(): Promise<string> };
}


const DEMO_THEME_STORAGE_KEY = "rebuild-demo.theme";


export async function installTheme(page: Page, theme: ParityTheme): Promise<void> {
  await page.addInitScript(
    ([key, attribute]) => {
      window.localStorage.setItem(String(key), String(attribute));
    },
    [DEMO_THEME_STORAGE_KEY, theme.attribute] as const,
  );
}


export async function assertThemeApplied(page: Page, theme: ParityTheme): Promise<void> {
  const observed = await page.evaluate(() => ({
    html: document.documentElement.getAttribute("data-demo-theme"),
    body: document.body.getAttribute("data-demo-theme"),
    // Read the outer app root so the theme proof includes portals above the content providers.
    root: document.querySelector("[data-app-root]")?.getAttribute("data-demo-theme") ?? null,
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


export async function captureParityPair(
  page: Page,
  referencesDir: string,
  metadata: CaptureMetadata,
  // Use fullPage only when the subject itself is a scrolling specimen column.
  options: Readonly<{ fullPage?: boolean; screenshotStyle?: string }> = {},
): Promise<void> {
  const name = await captureA11yReference(page, referencesDir, metadata);
  const screenshotStyle = options.screenshotStyle === undefined ? undefined : await page.addStyleTag({ content: options.screenshotStyle });
  try {
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: options.fullPage ?? false,
      animations: "disabled",
    });
  } finally {
    await screenshotStyle?.evaluate(element => { element.parentNode?.removeChild(element); });
  }
}


export async function readA11yTree(page: A11ySnapshotSource): Promise<string> {
  return page.locator("body").ariaSnapshot();
}
