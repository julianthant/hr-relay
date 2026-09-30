/** D340: desktop control density and hit ownership, measured in the built browser. */
import { expect,test,type Locator,type Page } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR,ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer,type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

/** Approved shared Explorer/Dashboard toolbar height: `--ds-h-lg`. */
const TOOLBAR_PAINT = 32;

const VIEWPORT = { width: 1440, height: 900 } as const;

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

test.afterAll(async () => {
  await server.close();
});

async function assertDesktopPointer(page: Page): Promise<void> {
  expect(await page.evaluate(() => matchMedia("(pointer: fine)").matches)).toBe(true);
}

async function boxOf(control: Locator): Promise<{ width: number; height: number; x: number; y: number }> {
  const box = await control.boundingBox();
  if (box === null) throw new Error("a toolbar control the spec measured is not laid out at all");
  return box;
}

/**
 * The queue toolbar's own controls, by their accessible names.
 *
 * One button since D296, and the panel toggle beside it — which is a toolbar
 * control in the same row taking the same token, so measuring it is what keeps
 * this a statement about the FAMILY now that the primary is alone in its group.
 */
const TOOLBAR_CONTROLS = ["Start a run"] as const;

/** the leading control, whose accessible name carries the panel's whole state */
const PANEL_TOGGLE = /^Workflow Panel — /u;

test.describe("the density a mouse gets is unchanged", () => {
  test.use({ viewport: VIEWPORT });

  test("every toolbar control still paints --ds-h-toolbar at pointer: fine", async ({ page }) => {
    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
    await assertDesktopPointer(page);

    for (const name of TOOLBAR_CONTROLS) {
      const control = page.getByRole("button", { name, exact: true }).first();
      expect((await boxOf(control)).height, name).toBe(TOOLBAR_PAINT);
    }
    const toggle = page.getByRole("button", { name: PANEL_TOGGLE }).first();
    expect((await boxOf(toggle)).height, "panel toggle").toBe(TOOLBAR_PAINT);
  });
});
