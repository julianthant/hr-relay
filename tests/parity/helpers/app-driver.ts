
import { expect, type Page } from "@playwright/test";

export interface AppRoute {
  readonly day: string;
  readonly run?: string;
  readonly section?: string;
  readonly start?: boolean;

  readonly intake?: string;
  /** A workflow id — the read-only Workflow Explorer takeover (2i-G). */
  readonly explore?: string;

  readonly catalog?: string;
  /** A legacy Archive link shown as a removal notice. */
  readonly archive?: string;
  /** A legacy Archive view named by a deep link. */
  readonly archiveView?: "runs" | "versions";
  /** `from..to`; `""` opens the report on its default range (2i-G). */
  readonly activity?: string;
  /** A settings section id; `""` opens the gear on its first section. */
  readonly settings?: string;
  readonly logPreview?: "selected";
}

export function routeUrl(baseUrl: string, route: AppRoute): string {
  const url = new URL("/", baseUrl);
  url.searchParams.set("day", route.day);
  if (route.run !== undefined) url.searchParams.set("run", route.run);
  if (route.section !== undefined) url.searchParams.set("section", route.section);
  if (route.start === true) url.searchParams.set("start", "1");
  if (route.intake !== undefined) url.searchParams.set("intake", route.intake);
  if (route.archive !== undefined) url.searchParams.set("archive", route.archive);
  if (route.archiveView !== undefined) url.searchParams.set("archiveView", route.archiveView);
  if (route.activity !== undefined) url.searchParams.set("activity", route.activity);
  if (route.settings !== undefined) url.searchParams.set("settings", route.settings);
  if (route.explore !== undefined) url.searchParams.set("explore", route.explore);
  if (route.catalog !== undefined) url.searchParams.set("catalog", route.catalog);
  if (route.logPreview !== undefined) url.searchParams.set("logPreview", route.logPreview);
  return url.toString();
}

// Freeze the browser monotonic clock before navigation so elapsed labels remain deterministic.
export async function installFrozenMonotonic(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const scope = window as unknown as { __parityMonotonicFrozen?: true };
    if (scope.__parityMonotonicFrozen === true) return;
    scope.__parityMonotonicFrozen = true;
    const frozen = performance.now();
    Object.defineProperty(performance, "now", {
      configurable: true,
      writable: true,
      value: () => frozen,
    });
  });
}


export async function assertMonotonicFrozen(page: Page): Promise<void> {
  const observed = await page.evaluate(async () => {
    const first = performance.now();
    await new Promise((resolve) => setTimeout(resolve, 25));
    return { first, second: performance.now() };
  });
  if (observed.first !== observed.second) {
    throw new Error(
      `the page's monotonic clock advanced ${String(observed.second - observed.first)}ms during the capture `
      + "(performance.now was not frozen), so every live elapsed on this screen is dated by real browser "
      + "time and no reference holding one can be stable",
    );
  }
}

/** Navigates and waits for the app's own readiness statement. */
export async function gotoAppState(page: Page, baseUrl: string, route: AppRoute): Promise<void> {
  await installFrozenMonotonic(page);
  await page.goto(routeUrl(baseUrl, route), { waitUntil: "domcontentloaded" });
  // Observe readiness each frame before the assertion's retry backoff.
  await page.waitForFunction(() => document.querySelector("[data-parity-ready='true']") !== null, undefined, { timeout: 30_000 });
  await expect(page.locator("[data-parity-ready='true']")).toBeVisible({ timeout: 30_000 });
  // Enter transitions are one frame of opacity/translate; settle them so a
  // capture is of the resting state rather than of the animation.
  await page.waitForTimeout(250);
  await assertMonotonicFrozen(page);
}


export function rowOf(page: Page, runId: string) {
  return page.locator(`[data-demo-row-id='${runId}']`);
}

export async function moveAssistantLauncherAboveFooter(page: Page): Promise<void> {
  const launcher = page.getByRole("button", { name: "Assistant", exact: true });
  const before = await launcher.boundingBox();
  if (!before) throw new Error("Assistant launcher is unavailable");
  await launcher.focus();
  for (let step = 0; step < 4; step++) await launcher.press("Alt+ArrowUp");
  await expect.poll(async () => (await launcher.boundingBox())?.y).toBe(before.y - 64);
}
