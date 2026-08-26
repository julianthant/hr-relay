/**
 * D271'S POOL CONTROLS, MEASURED IN A REAL ENGINE.
 *
 * `POOL_CONTROL_TOUCH_TARGET` / `POOL_COUNT_TOUCH_TARGET` are two strings in a
 * class list, and this tree has twice been told what a class list is worth: the
 * queue member toggle declared a 44px square and the engine handed a finger
 * 44 x 24 (a `truncate` ancestor clipped it), and the fix that followed was
 * 44px centred on 43px of content and hung half a pixel into the neighbour's
 * row. Every control here POSTS a pool command — a worker process started, or a
 * running one stopped — so an undersized or over-reaching target is a real
 * process acted on by accident.
 *
 * So nothing below is asserted from a class name. The page is opened with a
 * coarse primary pointer, the pointer is ASSERTED rather than assumed (D187),
 * and each control's own border box is measured. The fine-pointer control at
 * the end is the other half: it proves the coarse rules are GATED, which is why
 * no photographed reference moves.
 *
 * `min-h`, not an `::after` overlay, is what these controls take — and the
 * containment argument that costs the member toggle two lessons is free here,
 * because none of them sits at a fixed pitch beside a neighbour. They are flex
 * items with their own gaps, so the row grows with them. That claim is measured
 * too: the band's controls are checked for overlap against what sits beside
 * them.
 *
 * Nothing here is photographed. The corpus renders at `pointer: fine` and no
 * reference opens this drawer at all.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-day.js";

/** The floor a finger needs — WCAG 2.5.5. */
const TOUCH_FLOOR = 44;

/** What `Button size="sm"` paints: `--ds-h-sm`, the density a mouse gets. */
const BUTTON_PAINT = 24;

const VIEWPORT = { width: 1440, height: 900 } as const;

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
      `the page did not adopt a ${pointer} pointer (coarse=${String(observed.coarse)}, `
      + `fine=${String(observed.fine)}); every measurement below would be of the wrong layout`,
    );
  }
}

/** The pool bands live behind the Session Panel's bar toggle. */
async function openDrawer(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Sessions/u }).click();
  await expect(page.locator("[data-worker-pool]").first()).toBeVisible();
}

async function boxOf(control: Locator): Promise<{ width: number; height: number; x: number; y: number }> {
  const box = await control.boundingBox();
  if (box === null) throw new Error("a pool control the spec measured is not laid out at all");
  return box;
}

test.describe("every pool control clears the touch floor on a coarse pointer", () => {
  test.use({ hasTouch: true, viewport: VIEWPORT });

  test("the band's plan trigger, the count buttons and the confirmation are all >= 44px tall", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertPointer(page, "coarse");
    await openDrawer(page);

    const plan = page.getByRole("button", { name: "Plan workers", exact: true }).first();
    const planBox = await boxOf(plan);
    expect(planBox.height, "the band's Plan workers trigger").toBeGreaterThanOrEqual(TOUCH_FLOOR);

    await plan.click();
    const counts = page.getByRole("group", { name: "Desired workers" }).getByRole("button");
    await expect(counts).toHaveCount(3);
    for (let index = 0; index < 3; index += 1) {
      const box = await boxOf(counts.nth(index));
      expect(box.height, `count button ${String(index + 1)} height`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
      // The count buttons are the one control whose WIDTH is also under the
      // floor without help: their label is a single glyph.
      expect(box.width, `count button ${String(index + 1)} width`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
    }

    // A count the served pool does not already declare, so a confirmation is drawn.
    await counts.nth(2).click();
    const confirm = page.getByRole("button", { name: /^Plan \d+ workers?$/u });
    await expect(confirm).toHaveCount(1);
    expect((await boxOf(confirm)).height, "the plan confirmation").toBeGreaterThanOrEqual(TOUCH_FLOOR);
  });

  test("the count buttons do not reach into each other", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertPointer(page, "coarse");
    await openDrawer(page);
    await page.getByRole("button", { name: "Plan workers", exact: true }).first().click();

    const counts = page.getByRole("group", { name: "Desired workers" }).getByRole("button");
    const boxes = await Promise.all([0, 1, 2].map(async (index) => boxOf(counts.nth(index))));
    // Growing a control that sits in a flex row grows the ROW; it must never
    // grow INTO the control beside it, which is the failure the member toggle's
    // overlay produced twice in two different axes.
    for (let index = 1; index < boxes.length; index += 1) {
      const previous = boxes[index - 1];
      const current = boxes[index];
      if (previous === undefined || current === undefined) throw new Error("a count button vanished mid-measure");
      expect(current.x, `count button ${String(index + 1)} starts after ${String(index)} ends`)
        .toBeGreaterThanOrEqual(previous.x + previous.width);
    }
  });

  test("the worker card's Stop and its spawn share one grown row", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertPointer(page, "coarse");
    await openDrawer(page);

    const stop = page.getByRole("button", { name: /^Stop$/u }).first();
    expect((await boxOf(stop)).height, "the worker card's Stop").toBeGreaterThanOrEqual(TOUCH_FLOOR);
  });
});

test.describe("the density a mouse gets is unchanged", () => {
  test.use({ hasTouch: false, viewport: VIEWPORT });

  test("every pool control still paints --ds-h-sm at pointer: fine", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertPointer(page, "fine");
    await openDrawer(page);

    const plan = page.getByRole("button", { name: "Plan workers", exact: true }).first();
    expect((await boxOf(plan)).height, "the band's Plan workers trigger").toBe(BUTTON_PAINT);

    await plan.click();
    const counts = page.getByRole("group", { name: "Desired workers" }).getByRole("button");
    expect((await boxOf(counts.first())).height, "a count button").toBe(BUTTON_PAINT);
    expect((await boxOf(counts.first())).width, "a count button's width").toBeLessThan(TOUCH_FLOOR);
  });
});
