/**
 * The doc 13 §7.1 capture contract.
 *
 * "The stored reference includes viewport, theme, fixture id, descriptor hash,
 * app version, and capture date. A screenshot without the matching a11y
 * snapshot is incomplete." — so this helper refuses to write one without the
 * other, and stamps every pair with the metadata that makes a stored pixel
 * auditable later. A reference whose provenance is unknown is not evidence.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { expect, type Page } from "@playwright/test";

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

export interface CaptureMetadata {
  /** the state being captured, e.g. "queue-all-statuses" */
  readonly stateId: string;
  readonly viewport: string;
  readonly theme: string;
  /** which adapter produced the data — "fixture" or "seeded" (doc 13 §7.2) */
  readonly adapter: string;
  readonly fixtureId: string;
  readonly descriptorHash: string;
  readonly appVersion: string;
  readonly capturedAt: string;
  /** keyboard-only / reduced-motion variants (doc 13 §7.1) */
  readonly variant: string;
}

export function captureName(input: Readonly<{
  stateId: string;
  viewport: string;
  theme: string;
  variant?: string;
}>): string {
  const variant = input.variant === undefined || input.variant === "default" ? "" : `--${input.variant}`;
  return `${input.stateId}--${input.theme}--${input.viewport}${variant}`;
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
 * One capture = one screenshot + one a11y snapshot + one metadata record.
 * The a11y snapshot is taken FIRST: if the accessibility tree cannot be read
 * the pair is incomplete and nothing is stored, rather than leaving a pixel
 * file with no semantic counterpart beside it.
 */
export async function captureParityPair(
  page: Page,
  referencesDir: string,
  metadata: CaptureMetadata,
): Promise<void> {
  const name = captureName(metadata);
  const tree = await page.locator("body").ariaSnapshot();
  if (tree.trim().length === 0) {
    throw new Error(`a11y snapshot for ${name} is empty; refusing to store a screenshot without its semantic pair`);
  }

  const a11yPath = join(referencesDir, `${name}.a11y.yml`);
  mkdirSync(dirname(a11yPath), { recursive: true });
  writeFileSync(
    a11yPath,
    [
      `# ${name}`,
      `# adapter: ${metadata.adapter}`,
      `# fixture: ${metadata.fixtureId}`,
      `# descriptorHash: ${metadata.descriptorHash}`,
      `# appVersion: ${metadata.appVersion}`,
      `# viewport: ${metadata.viewport}  theme: ${metadata.theme}  variant: ${metadata.variant}`,
      `# capturedAt: ${metadata.capturedAt}`,
      "",
      tree,
      "",
    ].join("\n"),
  );

  writeFileSync(
    join(referencesDir, `${name}.meta.json`),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );

  await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: false, animations: "disabled" });
}

/**
 * Reads the a11y tree without storing it — the dual-adapter comparison
 * (doc 13 §7.2) needs both adapters' trees in memory to assert they agree.
 */
export async function readA11yTree(page: Page): Promise<string> {
  return page.locator("body").ariaSnapshot();
}
