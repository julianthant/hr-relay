/**
 * DCR4's scope buttons paint the incumbent compact height but their coarse
 * pointer target is an actual 44px `::after` reach. Measure the built bundle:
 * class strings cannot prove Tailwind emitted the media rule, that a dialog
 * ancestor did not clip it, or that one scope control steals the other tap.
 */
import { expect, test, type Page } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-day.js";

const TOUCH_FLOOR = 44;
const COMPACT_PAINT = 24;
const VIEWPORT = { width: 1024, height: 768 } as const;

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
});

async function assertPointer(page: Page, pointer: "coarse" | "fine"): Promise<void> {
  const observed = await page.evaluate(() => ({
    coarse: matchMedia("(pointer: coarse)").matches,
    fine: matchMedia("(pointer: fine)").matches,
  }));
  if (observed.coarse !== (pointer === "coarse") || observed.fine !== (pointer === "fine")) {
    throw new Error(
      `the page did not adopt a ${pointer} pointer (coarse=${String(observed.coarse)}, fine=${String(observed.fine)})`,
    );
  }
}

async function openSearch(page: Page): Promise<void> {
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
  await page.getByRole("button", { name: "Search runs across dates" }).click();
  await expect(page.getByRole("group", { name: "Search scope" })).toBeVisible();
}

test.describe("the Top Bar scope controls on a coarse pointer", () => {
  test.use({ hasTouch: true, viewport: VIEWPORT });

  test("each painted compact toggle owns a 44px effective target without overlap", async ({ page }) => {
    await openSearch(page);
    await assertPointer(page, "coarse");
    const proof = await page.getByRole("group", { name: "Search scope" }).evaluate((group) => {
      const buttons = [...group.querySelectorAll<HTMLButtonElement>("button")];
      return buttons.map((button) => {
        const visual = button.getBoundingClientRect();
        const pseudo = getComputedStyle(button, "::after");
        const effectiveHeight = Number.parseFloat(pseudo.height);
        const effectiveWidth = Number.parseFloat(pseudo.width);
        const left = visual.left + (Number.parseFloat(pseudo.left) || 0);
        const top = visual.top + visual.height / 2 - effectiveHeight / 2;
        const right = left + effectiveWidth;
        const bottom = top + effectiveHeight;
        const centerX = left + effectiveWidth / 2;
        const owns = (y: number): boolean => {
          const hit = document.elementFromPoint(centerX, y);
          return hit === button || (hit !== null && button.contains(hit));
        };
        return {
          label: button.textContent?.trim() ?? "unnamed",
          visualHeight: visual.height,
          effectiveHeight,
          left,
          right,
          top,
          bottom,
          ownsTop: owns(top + 1),
          ownsBottom: owns(bottom - 1),
        };
      });
    });

    expect(proof).toHaveLength(2);
    for (const target of proof) {
      expect(target.visualHeight, `${target.label} keeps compact paint`).toBe(COMPACT_PAINT);
      expect(target.effectiveHeight, `${target.label} effective target`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
      expect(target.ownsTop, `${target.label} owns its upper transparent reach`).toBe(true);
      expect(target.ownsBottom, `${target.label} owns its lower transparent reach`).toBe(true);
    }
    const [acrossDates, thisDay] = proof;
    if (acrossDates === undefined || thisDay === undefined) throw new Error("the scope control did not render both choices");
    expect(thisDay.left, "This day begins after Across dates ends").toBeGreaterThanOrEqual(acrossDates.right);
  });
});

test.describe("the Top Bar scope controls on a fine pointer", () => {
  test.use({ hasTouch: false, viewport: VIEWPORT });

  test("preserves the compact mouse density", async ({ page }) => {
    await openSearch(page);
    await assertPointer(page, "fine");
    const buttons = page.getByRole("group", { name: "Search scope" }).getByRole("button");
    await expect(buttons).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      const box = await buttons.nth(index).boundingBox();
      if (box === null) throw new Error(`scope button ${String(index)} was not laid out`);
      expect(box.height).toBe(COMPACT_PAINT);
    }
  });
});
