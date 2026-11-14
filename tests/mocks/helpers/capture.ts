
import type { Page } from "@playwright/test";
export const MOCK_VIEWPORTS = Object.freeze([
  { name: "1280x720", width: 1280, height: 720 },
] as const);

export const MOCK_THEMES = Object.freeze([
  { name: "graphite-warm", attribute: "dark" },
] as const);

export type MockViewport = (typeof MOCK_VIEWPORTS)[number];
export type MockTheme = (typeof MOCK_THEMES)[number];

export interface A11ySnapshotSource {
  locator(selector: string): { ariaSnapshot(): Promise<string> };
}

export async function installTheme(page: Page, theme: MockTheme): Promise<void> {
  await page.addInitScript(
    attribute => { Reflect.set(window, "relayMockTheme", attribute); },
    theme.attribute,
  );
}

export async function assertThemeApplied(page: Page, theme: MockTheme): Promise<void> {
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
      + "means the page rendered a theme nobody selected",
    );
  }
}

export async function readA11yTree(page: A11ySnapshotSource): Promise<string> {
  return page.locator("body").ariaSnapshot();
}
