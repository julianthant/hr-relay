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
import {
  CAPTURE_PHONE_ASSET_ENTRY,
  CAPTURE_TOKEN_FRAGMENT_KEY,
} from "../../../src/domain/capture-surface.js";

export interface AppRoute {
  readonly day: string;
  readonly run?: string;
  readonly section?: string;
  readonly start?: boolean;
  /** `new` for the dropzone, or an intake session id for the workspace (2i-E3). */
  readonly intake?: string;
  /** A workflow id — the read-only Workflow Explorer takeover (2i-G). */
  readonly explore?: string;
  /** The UI catalog takeover's search term; `""` opens it browsing (2i-G). */
  readonly catalog?: string;
  /** `""` is the archive ledger; a run id opens that archived run (2i-G). */
  readonly archive?: string;
  /** `from..to`; `""` opens the report on its default range (2i-G). */
  readonly activity?: string;
}

export function routeUrl(baseUrl: string, route: AppRoute): string {
  const url = new URL("/", baseUrl);
  url.searchParams.set("day", route.day);
  if (route.run !== undefined) url.searchParams.set("run", route.run);
  if (route.section !== undefined) url.searchParams.set("section", route.section);
  if (route.start === true) url.searchParams.set("start", "1");
  if (route.intake !== undefined) url.searchParams.set("intake", route.intake);
  if (route.archive !== undefined) url.searchParams.set("archive", route.archive);
  if (route.activity !== undefined) url.searchParams.set("activity", route.activity);
  if (route.explore !== undefined) url.searchParams.set("explore", route.explore);
  if (route.catalog !== undefined) url.searchParams.set("catalog", route.catalog);
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
 * The phone capture surface (2i-F).
 *
 * It is a SEPARATE entry, so the lane navigates to `/capture.html` rather than
 * to a route of the operator app — the fixture server has no SPA fallback, for
 * the same reason the real ingress has none: it serves exactly the phone page
 * and that page's own assets.
 *
 * The token rides the FRAGMENT, which is what the QR encodes and what the page
 * reads. It never appears in the path or the query here either, because the
 * lane drives the product's own URL shape rather than a convenient one.
 */
export function captureUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}${CAPTURE_PHONE_ASSET_ENTRY}#${CAPTURE_TOKEN_FRAGMENT_KEY}=${token}`;
}

/**
 * Navigates and waits for the phone's own readiness statement, which includes
 * every page's bytes having resolved — a tile grid mid-fetch is a half-painted
 * page, and a capture of one documents nothing.
 */
export async function gotoCaptureState(
  page: Page,
  baseUrl: string,
  token: string,
): Promise<void> {
  await page.goto(captureUrl(baseUrl, token), { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-parity-ready='true'], [data-parity-ready='refused']"))
    .toBeVisible({ timeout: 30_000 });
  // The one authored entrance is 180ms of opacity + translate; settle it so a
  // capture is of the resting state rather than of the animation.
  await page.waitForTimeout(300);
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
