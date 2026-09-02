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
 * Since D305 the controls live in the bar's Add workers dialog (the demo's
 * `+`): the count is a two-button stepper, the plan is the dialog's primary,
 * and a declared member with no running worker takes its spawn on a roster
 * row. The served day here DECLARES three members and holds leases for two,
 * so the roster has one spawn to measure. The card's Stop is still in the
 * drawer.
 *
 * Nothing here is photographed. The corpus renders at `pointer: fine` and no
 * reference opens this dialog or drawer at all.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { DashboardDayWireSchema } from "../../src/domain/dashboard/projection.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY, FIXTURE_DAY_WIRE } from "./helpers/fixture-day.js";

/** The floor a finger needs — WCAG 2.5.5. */
const TOUCH_FLOOR = 44;

/** What `IconButton size="md"` and `Button` paint: `--ds-h-md`, the density a mouse gets. */
const CONTROL_PAINT = 28;

/** What `Button size="sm"` paints: `--ds-h-sm`, the card footer's density. */
const BUTTON_PAINT = 24;

const VIEWPORT = { width: 1440, height: 900 } as const;

/**
 * A pool DECLARED at three with leases served for members 1 and 2 only, so the
 * dialog's roster holds exactly one unmet member (index 3) and its spawn.
 */
const DECLARED_POOL_DAY = DashboardDayWireSchema.parse({
  ...FIXTURE_DAY_WIRE,
  workerCards: FIXTURE_DAY_WIRE.workerCards.filter((card) => String(card.workerId) !== "person-lookup-worker-3"),
  workerPools: [{
    workflowId: "person-lookup",
    desiredWorkers: 3,
    version: 7,
    plannedBy: "local-operator",
    plannedAt: "2026-08-03T09:00:00.000-07:00",
  }],
});

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
    dayWire: DECLARED_POOL_DAY,
  });
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

/** The pool controls live behind the bar's `+`. */
async function openAddWorkers(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Add workers", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add workers" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The worker cards live behind the Session Panel's bar toggle. */
async function openDrawer(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^Sessions/u }).click();
  await expect(page.locator("[data-session-strip]")).toBeVisible();
}

async function boxOf(control: Locator): Promise<{ width: number; height: number; x: number; y: number }> {
  const box = await control.boundingBox();
  if (box === null) throw new Error("a pool control the spec measured is not laid out at all");
  return box;
}

test.describe("every pool control clears the touch floor on a coarse pointer", () => {
  test.use({ hasTouch: true, viewport: VIEWPORT });

  test("the stepper, the spawn and the plan confirmation are all >= 44px", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertPointer(page, "coarse");
    const dialog = await openAddWorkers(page);

    const steps = dialog.getByRole("group", { name: "How many workers to plan" }).getByRole("button");
    await expect(steps).toHaveCount(2);
    for (let index = 0; index < 2; index += 1) {
      const box = await boxOf(steps.nth(index));
      expect(box.height, `stepper button ${String(index + 1)} height`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
      // The stepper buttons are the one control whose WIDTH is also under the
      // floor without help: their label is a single glyph.
      expect(box.width, `stepper button ${String(index + 1)} width`).toBeGreaterThanOrEqual(TOUCH_FLOOR);
    }

    const spawn = dialog.getByRole("button", { name: "Spawn worker 3", exact: true });
    expect((await boxOf(spawn)).height, "the roster's spawn").toBeGreaterThanOrEqual(TOUCH_FLOOR);

    // A count of one is a scale-down of the declared three, so the
    // confirmation names the stop and is drawn enabled.
    const confirm = dialog.getByRole("button", { name: /^Stop 1 member and plan 1 worker$/u });
    await expect(confirm).toHaveCount(1);
    await expect(confirm).toBeEnabled();
    expect((await boxOf(confirm)).height, "the plan confirmation").toBeGreaterThanOrEqual(TOUCH_FLOOR);
  });

  test("the stepper buttons do not reach into each other", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertPointer(page, "coarse");
    const dialog = await openAddWorkers(page);

    const steps = dialog.getByRole("group", { name: "How many workers to plan" }).getByRole("button");
    const [fewer, more] = await Promise.all([boxOf(steps.nth(0)), boxOf(steps.nth(1))]);
    // Growing a control that sits in a flex row grows the ROW; it must never
    // grow INTO the control beside it, which is the failure the member toggle's
    // overlay produced twice in two different axes.
    expect(more.x, "the `+` starts after the `−` ends").toBeGreaterThanOrEqual(fewer.x + fewer.width);
  });

  test("the worker card's Stop clears the floor in the drawer", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertPointer(page, "coarse");
    await openDrawer(page);

    const stop = page.getByRole("button", { name: /^Stop$/u }).first();
    expect((await boxOf(stop)).height, "the worker card's Stop").toBeGreaterThanOrEqual(TOUCH_FLOOR);
  });
});

test.describe("the density a mouse gets is unchanged", () => {
  test.use({ hasTouch: false, viewport: VIEWPORT });

  test("every pool control still paints its resting height at pointer: fine", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertPointer(page, "fine");
    const dialog = await openAddWorkers(page);

    const steps = dialog.getByRole("group", { name: "How many workers to plan" }).getByRole("button");
    expect((await boxOf(steps.first())).height, "a stepper button").toBe(CONTROL_PAINT);
    expect((await boxOf(steps.first())).width, "a stepper button's width").toBe(CONTROL_PAINT);

    const spawn = dialog.getByRole("button", { name: "Spawn worker 3", exact: true });
    expect((await boxOf(spawn)).height, "the roster's spawn").toBe(BUTTON_PAINT);

    const confirm = dialog.getByRole("button", { name: /^Stop 1 member and plan 1 worker$/u });
    expect((await boxOf(confirm)).height, "the plan confirmation").toBe(CONTROL_PAINT);
  });
});
