/**
 * The URL + readiness contract the parity lane drives the app through.
 *
 * The app takes its whole visible state from the query string — day, open run,
 * open section, start dialog. That is not a test affordance bolted on: it is
 * what makes a dashboard state addressable, shareable and reproducible, and it
 * is the only way two different backends can be asked for *the same screen*.
 *
 * `data-parity-ready` flips to "true" only once bootstrap AND the day have both
 * resolved, so a capture can never catch a half-painted shell. A timeout here
 * is a real failure — never a reason to screenshot anyway.
 */
import { expect, type Page } from "@playwright/test";

export interface AppRoute {
  readonly day: string;
  readonly run?: string;
  readonly section?: string;
  readonly start?: boolean;
  /** `new` for the dropzone, or an intake session id for the workspace (2i-E3). */
  readonly intake?: string;
}

export function routeUrl(baseUrl: string, route: AppRoute): string {
  const url = new URL("/", baseUrl);
  url.searchParams.set("day", route.day);
  if (route.run !== undefined) url.searchParams.set("run", route.run);
  if (route.section !== undefined) url.searchParams.set("section", route.section);
  if (route.start === true) url.searchParams.set("start", "1");
  if (route.intake !== undefined) url.searchParams.set("intake", route.intake);
  return url.toString();
}

/** Navigates and waits for the app's own readiness statement. */
export async function gotoAppState(page: Page, baseUrl: string, route: AppRoute): Promise<void> {
  await page.goto(routeUrl(baseUrl, route), { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-parity-ready='true']")).toBeVisible({ timeout: 30_000 });
  // Enter transitions are one frame of opacity/translate; settle them so a
  // capture is of the resting state rather than of the animation.
  await page.waitForTimeout(250);
}

/**
 * The queue row for a run. `data-demo-row-id` is the queue surface's own
 * attribute — the one the shell's `m` shortcut already targets — so the parity
 * lane addresses rows exactly the way the product does rather than through a
 * hook that exists only for tests.
 */
export function rowOf(page: Page, runId: string) {
  return page.locator(`[data-demo-row-id='${runId}']`);
}
