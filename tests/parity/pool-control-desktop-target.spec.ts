/** D340: desktop control density and hit ownership, measured in the built browser. */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { DashboardDayWireSchema } from "../../src/domain/dashboard/projection.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY, FIXTURE_DAY_WIRE } from "./helpers/fixture-day.js";

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

async function assertDesktopPointer(page: Page): Promise<void> {
  expect(await page.evaluate(() => matchMedia("(pointer: fine)").matches)).toBe(true);
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

test.describe("the density a mouse gets is unchanged", () => {
  test.use({ viewport: VIEWPORT });

  test("every pool control still paints its resting height at pointer: fine", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertDesktopPointer(page);
    const dialog = await openAddWorkers(page);

    const steps = dialog.getByRole("group", { name: "How many workers to plan" }).getByRole("button");
    expect((await boxOf(steps.first())).height, "a stepper button").toBe(CONTROL_PAINT);
    expect((await boxOf(steps.first())).width, "a stepper button's width").toBe(CONTROL_PAINT);

    const spawn = dialog.getByRole("button", { name: "Spawn worker 3", exact: true });
    expect((await boxOf(spawn)).height, "the roster's spawn").toBe(BUTTON_PAINT);

    const confirm = dialog.getByRole("button", { name: /^Stop 1 member and plan 1 worker$/u });
    expect((await boxOf(confirm)).height, "the plan confirmation").toBe(CONTROL_PAINT);
    await page.keyboard.press("Escape");
    await openDrawer(page);
    const stop = page.getByRole("button", { name: /^Stop$/u }).first();
    expect((await boxOf(stop)).height, "the worker card stop control").toBe(BUTTON_PAINT);
  });
});
