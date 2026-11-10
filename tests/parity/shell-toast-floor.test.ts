
import { expect } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer,type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 2000, height: 900 },
] as const;

let server: FixtureServer;

test.beforeAll(async () => {
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
});

interface ToastFloorGeometry {
  readonly viewportBottom: number;
  readonly sessionTop: number;
  readonly sessionBottom: number;
  readonly sessionHeight: number;
  readonly clearance: number;
  readonly floor: number;
  readonly computedBottom: number;
  readonly viewportHeight: number;
}

function formatGeometry(geometry: ToastFloorGeometry): string {
  return [
    `toast bottom ${geometry.viewportBottom}px`,
    `Sessions ${geometry.sessionTop}px→${geometry.sessionBottom}px`,
    `clearance ${geometry.clearance}px`,
    `floor ${geometry.floor}px`,
    `computed bottom ${geometry.computedBottom}px`,
    `viewport ${geometry.viewportHeight}px`,
  ].join(", ");
}

async function measureToastFloor(page: Parameters<typeof gotoAppState>[0]): Promise<ToastFloorGeometry> {
  return page.evaluate(() => {
    const toast = document.querySelector<HTMLElement>("[data-ds-toast-viewport='default']");
    const sessions = document.querySelector<HTMLElement>("[aria-label='Session Panel']");
    if (toast === null || sessions === null) {
      throw new Error(
        `expected toast viewport and Session Panel; found toast=${String(toast !== null)}, sessions=${String(sessions !== null)}`,
      );
    }
    const card = toast.querySelector<HTMLElement>("[data-slot='toast']");
    if (card === null) throw new Error("expected a painted toast card");
    const toastRect = card.getBoundingClientRect();
    const sessionRect = sessions.getBoundingClientRect();
    const computedBottom = Number.parseFloat(window.getComputedStyle(toast).bottom);
    if (!Number.isFinite(computedBottom)) {
      throw new Error(`toast viewport has no numeric computed bottom inset: ${window.getComputedStyle(toast).bottom}`);
    }
    return {
      viewportBottom: toastRect.bottom,
      sessionTop: sessionRect.top,
      sessionBottom: sessionRect.bottom,
      sessionHeight: sessionRect.height,
      clearance: sessionRect.top - toastRect.bottom,
      floor: window.innerHeight - toastRect.bottom,
      computedBottom,
      viewportHeight: window.innerHeight,
    };
  });
}

for (const viewport of VIEWPORTS) {
  test(`A169 — a toast clears Sessions at ${String(viewport.width)}×${String(viewport.height)}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });

    await page.getByRole("button", { name: "Run next" }).first().click();
    const toast = page.locator("[data-ds-toast-viewport='default']");
    // Run next raises the outcome toast and a command-result toast; the first painted card is measured.
    const card = toast.locator("[data-slot='toast']").first();
    await expect(card).toBeVisible();
    await expect(card).not.toHaveAttribute("data-starting-style", "");
    await expect(card).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");

    const geometry = await measureToastFloor(page);
    const evidence = formatGeometry(geometry);


    // The Sessions bar floats 12px above the viewport bottom.
    expect(Math.abs(geometry.sessionBottom - (geometry.viewportHeight - 12)), evidence).toBeLessThanOrEqual(1);
    // This is the operator-visible assertion: no painted toast pixel occupies
    // the Session Panel, and the shell's loose gutter leaves a real separation.
    expect(geometry.clearance, evidence).toBeGreaterThan(0);
    // The toast stack hangs from the top edge, so its floor is far below the Sessions bar's height.
    expect(geometry.floor, evidence).toBeGreaterThan(geometry.sessionHeight);
  });
}
