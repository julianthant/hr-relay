/** D340: desktop control density and hit ownership, measured in the built browser. */
import { expect,test,type Locator,type Page } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR,ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer,type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { installTheme, PARITY_THEMES } from "./helpers/capture.js";

/** Approved shared Explorer/Dashboard toolbar height: `--ds-h-lg`. */
const TOOLBAR_PAINT = 32;

const VIEWPORT = { width: 1440, height: 900 } as const;

let server: FixtureServer;

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({ distDir: PARITY_DIST_DIR, bundle: { proof: "working-tree" } });
});

for (const theme of PARITY_THEMES) {
  for (const viewport of [VIEWPORT, { width: 1024, height: 720 }]) {
    test(`workflow panel modes keep launch controls fixed @ ${theme.name} ${viewport.width}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await installTheme(page, theme);
      await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY });
      const toggle = page.getByRole("button", { name: PANEL_TOGGLE });
      const start = page.getByRole("button", { name: "Start a run", exact: true });
      const position = { toggle: await boxOf(toggle), start: await boxOf(start) };
      const floating = page.getByRole("dialog", { name: "Workflow Panel", exact: true });
      await expect(floating).toBeVisible();
      expect((await boxOf(floating)).width).toBe(280);
      await page.getByRole("button", { name: "Dock the Workflow Panel as a sidebar", exact: true }).click();
      const sidebar = page.getByRole("navigation", { name: "Workflow Panel", exact: true });
      await expect(sidebar).toBeVisible();
      expect((await boxOf(sidebar)).width).toBe(280);
      expect((await boxOf(sidebar)).y).toBeGreaterThan(position.start.y + position.start.height);
      for (const control of ["toggle", "start"] as const) {
        expect(await boxOf(control === "toggle" ? toggle : start)).toEqual(position[control]);
      }
      await page.getByRole("button", { name: "Minimise the Workflow Panel to an icon", exact: true }).click();
      await expect(sidebar).toHaveCount(0);
      expect(await boxOf(toggle)).toEqual(position.toggle);
      expect(await boxOf(start)).toEqual(position.start);
      await toggle.click();
      await expect(floating).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(floating).toHaveCount(0);
      await expect(toggle).toBeFocused();
      expect(await boxOf(toggle)).toEqual(position.toggle);
      expect(await boxOf(start)).toEqual(position.start);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    });
  }
}

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
