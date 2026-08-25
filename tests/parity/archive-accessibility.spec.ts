/**
 * The Archive's compact warning chip is visible production UI, so its name is
 * proved through the built React bundle rather than by inspecting JSX. The
 * warning row is supplied only to this test: the stored archive references
 * remain reserved for Track F's one deliberate final re-freeze.
 */
import { expect, test } from "@playwright/test";
import { ArchiveIndexWireSchema } from "../../src/domain/dashboard/archive.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_ARCHIVE_INDEX } from "./helpers/fixture-archive.js";
import { FIXTURE_DAY } from "./helpers/fixture-day.js";

const FIRST_WARNING = "CRM returned a stale session on attempt 1";
const PARTIAL_RUN_ID = "00000000-0000-4000-8000-000000000099";

let server: FixtureServer;

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
