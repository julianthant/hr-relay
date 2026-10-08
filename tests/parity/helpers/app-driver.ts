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
  /** A workflow id — the read-only Workflow Explorer takeover (2i-G). */
  readonly explore?: string;
  /**
   * The UI catalog's search term; `""` browses it unfiltered (2i-G). Since D295
   * it is SUBORDINATE to `settings`: `settings: "ui-catalog"` is what opens the
   * section, and the app drops this key on any other route.
   */
  readonly catalog?: string;
  /** `""` is the archive ledger; a run id opens that archived run (2i-G). */
  readonly archive?: string;
  /** The Archive-owned view restored by a deep link. */
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

/**
 * Freeze the page's MONOTONIC clock, before navigation (D256).
 *
 * The fixture BFF pins the server's instant (`FIXTURE_NOW`). Since D256 the
 * app no longer renders that instant directly: it renders
 * `servedInstant + (monotonicNow − monotonicAtReceipt)`, so every live elapsed
 * advances instead of being frozen at page load. That second term is real
 * browser time, and a reference photographed at load+0.8 s would disagree with
 * one asserted at load+1.2 s — `45m 0s` against `45m 1s`.
 *
 * Freezing `performance.now` is the other half of the pin, and it is the whole
 * of it: with no monotonic time passing, the derived instant is EXACTLY the
 * served one, which is what every reference in the corpus was captured
 * against. Nothing else is faked — `setTimeout`, `requestAnimationFrame` and
 * CSS animation all keep running, so the app's own settling behaves as it
 * always did (Playwright's own `animations: "disabled"` still handles the
 * screenshot). It is installed idempotently because a spec may navigate twice
 * on one page.
 */
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

/**
 * Prove the page adopted the freeze — D187's rule, on the clock this time.
 *
 * A harness that installs a script and never checks it has only expressed a
 * preference. Two reads separated by real wall time is the only observation
 * that can tell a frozen monotonic clock from a running one, and a drift here
 * means the whole capture is dated by a clock nobody pinned.
 */
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
  await expect(page.locator("[data-parity-ready='true']")).toBeVisible({ timeout: 30_000 });
  // Enter transitions are one frame of opacity/translate; settle them so a
  // capture is of the resting state rather than of the animation.
  await page.waitForTimeout(250);
  await assertMonotonicFrozen(page);
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
