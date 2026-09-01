/**
 * `--ds-h-toolbar` ON A FINGER, MEASURED IN A REAL ENGINE.
 *
 * The `ghost` door D275 item 1 restored — `Workflow explorer` — paints 28px,
 * which is 16px short of the WCAG 2.5.5 floor. (`UI catalog` was the second of
 * that pair until D295 moved the catalog into Settings and deleted its door;
 * the floor was never about those two buttons.) It is not special: DESIGN.md's rule is that EVERY control in a toolbar is
 * `--ds-h-toolbar` tall, and that token exists precisely because growing one
 * control's box at its call site is how the bar acquired "controls of different
 * sizes" the first time. So the floor is on the token, under `pointer: coarse`,
 * and this spec measures the family rather than the two buttons that were
 * reviewed — a fix that reached only the reviewed pair would leave the primary
 * beside them short and would say so nowhere.
 *
 * Nothing here is asserted from a class name, and nothing here is photographed:
 * the corpus renders at `pointer: fine`, which the second describe block proves
 * is still the 28px density — that gate is what keeps every reference still.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-day.js";

/** The floor a finger needs — WCAG 2.5.5. */
const TOUCH_FLOOR = 44;

/** What `--ds-h-toolbar` paints for a mouse: `--ds-h-md`. */
const TOOLBAR_PAINT = 28;

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

async function boxOf(control: Locator): Promise<{ width: number; height: number; x: number; y: number }> {
  const box = await control.boundingBox();
  if (box === null) throw new Error("a toolbar control the spec measured is not laid out at all");
  return box;
}

/** The queue toolbar's own controls, by their accessible names. */
const TOOLBAR_CONTROLS = ["Workflow explorer", "Start a run", "Import spreadsheet"] as const;

test.describe("every queue toolbar control clears the touch floor on a coarse pointer", () => {
  test.use({ hasTouch: true, viewport: VIEWPORT });

  test("the restored ghost door and the controls beside it are >= 44px tall", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertPointer(page, "coarse");

    for (const name of TOOLBAR_CONTROLS) {
      const control = page.getByRole("button", { name, exact: true }).first();
      await expect(control, `${name} is not on the toolbar at all`).toHaveCount(1);
      expect((await boxOf(control)).height, name).toBeGreaterThanOrEqual(TOUCH_FLOOR);
    }
  });

  test("a grown control does not reach into the one beside it", async ({ page }) => {
    // The row is flex, so growing a control grows the ROW — the failure the
    // member toggle produced twice, in two different axes, was an overlay that
    // grew into a neighbour instead. Measured, not argued.
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertPointer(page, "coarse");

    const explorer = await boxOf(page.getByRole("button", { name: "Workflow explorer", exact: true }).first());
    const start = await boxOf(page.getByRole("button", { name: "Start a run", exact: true }).first());
    expect(start.x, "Start a run begins after Workflow explorer ends")
      .toBeGreaterThanOrEqual(explorer.x + explorer.width);
  });
});

test.describe("the density a mouse gets is unchanged", () => {
  test.use({ hasTouch: false, viewport: VIEWPORT });

  test("every toolbar control still paints --ds-h-toolbar at pointer: fine", async ({ page }) => {
    // The negative control. Without it the coarse rules above could be
    // ungated — every photographed reference would have moved, and this whole
    // family would have grown for a mouse that never asked.
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertPointer(page, "fine");

    for (const name of TOOLBAR_CONTROLS) {
      const control = page.getByRole("button", { name, exact: true }).first();
      expect((await boxOf(control)).height, name).toBe(TOOLBAR_PAINT);
    }
  });
});
