/**
 * The Archive's compact warning chip is visible production UI, so its name is
 * proved through the built React bundle rather than by inspecting JSX. The
 * warning row is supplied only to this test: the stored archive references
 * remain reserved for Track F's one deliberate final re-freeze.
 */
import { expect, test, type Page } from "@playwright/test";
import { ArchiveIndexWireSchema } from "../../src/domain/dashboard/archive.js";
import { gotoAppState, routeUrl } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_ARCHIVE_INDEX } from "./helpers/fixture-archive.js";
import { FIXTURE_DAY } from "./helpers/fixture-day.js";
import { FIXTURE_EXPLORER_WORKFLOW_ID } from "./helpers/fixture-explorer.js";

const FIRST_WARNING = "CRM returned a stale session on attempt 1";
const PARTIAL_RUN_ID = "00000000-0000-4000-8000-000000000099";
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;

let server: FixtureServer;

async function expectExactSearch(page: Page, search: string): Promise<void> {
  await expect.poll(() => new URL(page.url()).search).toBe(search);
}

async function expectVersionRegistry(page: Page, search: string): Promise<void> {
  await expectExactSearch(page, search);
  await expect(page.getByRole("table", { name: "Workflow version registry" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Versions & bumps" }))
    .toHaveAttribute("aria-pressed", "true");
}

test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({
    distDir: PARITY_DIST_DIR,
    bundle: { proof: "working-tree" },
  });
});

test.afterAll(async () => {
  await server.close();
});

for (const warning of [
  { count: 1, accessibleName: "1 warning" },
  { count: 3, accessibleName: "3 warnings" },
] as const) {
  test(`archive warning count names ${warning.accessibleName}`, async ({ page }) => {
    const entry = FIXTURE_ARCHIVE_INDEX.entries[0];
    if (entry === undefined) throw new Error("the archive accessibility fixture has no archived row");
    const warningIndex = ArchiveIndexWireSchema.parse({
      ...FIXTURE_ARCHIVE_INDEX,
      entries: [{
        ...entry,
        warnings: { state: "present", count: warning.count, first: FIRST_WARNING },
      }],
    });
    await page.route("**/api/v1/archive", async (route) => {
      await route.fulfill({ json: warningIndex });
    });

    await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: "" });

    await expect(page.getByTitle(FIRST_WARNING)).toHaveAccessibleName(warning.accessibleName);
  });
}

test("archive status filter distinguishes done from done with warnings", async ({ page }) => {
  const entry = FIXTURE_ARCHIVE_INDEX.entries[0];
  if (entry === undefined) throw new Error("the archive accessibility fixture has no archived row");
  const statusIndex = ArchiveIndexWireSchema.parse({
    ...FIXTURE_ARCHIVE_INDEX,
    entries: [
      entry,
      { ...entry, runId: PARTIAL_RUN_ID, status: "partial" },
    ],
  });
  await page.route("**/api/v1/archive", async (route) => {
    await route.fulfill({ json: statusIndex });
  });

  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: "" });

  await expect(page.getByRole("combobox", { name: "Final status" }).getByRole("option"))
    .toHaveText(["Any outcome", "Done", "Done with warnings"]);
});

test("Explorer's Version registry door restores the route-owned view through links and history", async ({ page }) => {
  /*
    The competing `?catalog=` key retired with D295: the catalog is a Settings
    section now, so a catalog term opens no takeover and the app drops it on any
    route that is not `settings=ui-catalog` — there is no takeover key left that
    ranks BELOW `explore` for the door to have to clear. What this test still
    owns is the half that matters: the door lands on the real Versions panel,
    and the route-owned view survives a link, Back and Forward.
  */
  const explorerRoute = {
    day: FIXTURE_DAY,
    explore: FIXTURE_EXPLORER_WORKFLOW_ID,
  } as const;
  const registryRoute = { day: FIXTURE_DAY, archive: "", archiveView: "versions" } as const;
  const explorerSearch = new URL(routeUrl(server.baseUrl, explorerRoute)).search;
  const registrySearch = new URL(routeUrl(server.baseUrl, registryRoute)).search;

  await gotoAppState(page, server.baseUrl, {
    ...explorerRoute,
  });
  await expectExactSearch(page, explorerSearch);

  await page.getByRole("button", { name: "Version registry" }).click();
  await expectVersionRegistry(page, registrySearch);

  await page.goBack();
  await expectExactSearch(page, explorerSearch);
  await expect(page.getByRole("button", { name: "Version registry" })).toBeVisible();

  await page.goForward();
  await expectVersionRegistry(page, registrySearch);

  await gotoAppState(page, server.baseUrl, registryRoute);
  await expectVersionRegistry(page, registrySearch);
});

test("Explorer's mobile Version registry action keeps ghost-sm geometry with a 44px clear hit target", async ({ page }) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await gotoAppState(page, server.baseUrl, {
    day: FIXTURE_DAY,
    explore: FIXTURE_EXPLORER_WORKFLOW_ID,
  });

  const action = page.getByRole("button", { name: "Version registry" });
  const proof = await action.evaluate((button) => {
    const visual = button.getBoundingClientRect();
    const pseudo = getComputedStyle(button, "::after");
    const effectiveHeight = Number.parseFloat(pseudo.height);
    const effective = {
      left: visual.left,
      right: visual.right,
      top: visual.top + visual.height / 2 - effectiveHeight / 2,
      bottom: visual.top + visual.height / 2 + effectiveHeight / 2,
    };
    const centerX = (effective.left + effective.right) / 2;
    const ownsPoint = (y: number): boolean => {
      const hit = document.elementFromPoint(centerX, y);
      return hit === button || (hit !== null && button.contains(hit));
    };
    const overlaps = [...document.querySelectorAll("button")]
      .filter((candidate) => candidate !== button)
      .filter((candidate) => {
        const style = getComputedStyle(candidate);
        if (style.visibility === "hidden" || style.display === "none") return false;
        const rect = candidate.getBoundingClientRect();
        return rect.width > 0
          && rect.height > 0
          && effective.left < rect.right
          && effective.right > rect.left
          && effective.top < rect.bottom
          && effective.bottom > rect.top;
      })
      .map((candidate) => candidate.getAttribute("aria-label") ?? candidate.textContent?.trim() ?? "unnamed");

    return {
      visualHeight: visual.height,
      effectiveHeight,
      ownsTop: ownsPoint(effective.top + 1),
      ownsBottom: ownsPoint(effective.bottom - 1),
      overlaps,
    };
  });

  expect(proof.visualHeight).toBe(24);
  expect(proof.effectiveHeight).toBeGreaterThanOrEqual(44);
  expect(proof.ownsTop).toBe(true);
  expect(proof.ownsBottom).toBe(true);
  expect(proof.overlaps).toEqual([]);
});
