/**
 * H stores warnings as frozen generic report sections and filters terminal outcomes.
 * Preserve warning-count accessibility, exact rows and route-history proof on that surface.
 */
import { expect, test, type Page } from "@playwright/test";
import { SavedArchiveReportWireSchema } from "../../src/domain/dashboard/archive.js";
import { gotoAppState, routeUrl } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR, ensureParityBundle } from "./helpers/bundle.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_SAVED_REPORT } from "./helpers/fixture-archive.js";
import { FIXTURE_DAY } from "./helpers/fixture-day.js";
import { FIXTURE_EXPLORER_WORKFLOW_ID } from "./helpers/fixture-explorer.js";

const FIRST_WARNING = "CRM returned a stale session on attempt 1";
const PARTIAL_RUN_ID = "00000000-0000-4000-8000-000000000099";
const NARROW_DESKTOP_VIEWPORT = { width: 1024, height: 768 } as const;

let server: FixtureServer;

async function expectExactSearch(page: Page, search: string): Promise<void> {
  await expect.poll(() => new URL(page.url()).search).toBe(search);
}

async function expectVersionRegistry(page: Page, search: string): Promise<void> {
  await expectExactSearch(page, search);
  await expect(page.getByRole("region", { name: "Versions and saved changes" })).toBeVisible();
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
    const report = SavedArchiveReportWireSchema.parse({ ...FIXTURE_SAVED_REPORT,
      sections: [{kind:"table",title:warning.accessibleName,columns:["Warning"],
        rows:Array.from({length:warning.count},(_,index)=>[`${FIRST_WARNING} — ${String(index+1)}`])}] });
    await page.route(`**/api/v1/archive/reports/${report.runId}`, route=>route.fulfill({json:report}));
    await gotoAppState(page,server.baseUrl,{day:FIXTURE_DAY,archive:report.runId});
    const warnings=page.getByRole("region",{name:warning.accessibleName,exact:true});
    await expect(warnings).toBeVisible();
    await expect(warnings).toContainText(FIRST_WARNING);
    await expect(warnings.getByRole("row")).toHaveCount(warning.count+1);

  });
}

test("archive outcome filter uses terminal outcomes and retains warning facts in the report", async ({page})=>{
  const failed=SavedArchiveReportWireSchema.parse({...FIXTURE_SAVED_REPORT,runId:PARTIAL_RUN_ID,outcome:"failed"});
  const requests:string[]=[];
  await page.route("**/api/v1/archive/reports?*",route=>{
    const outcome=new URL(route.request().url()).searchParams.get("outcome");requests.push(outcome??"");
    return route.fulfill({json:{items:outcome==="failed"?[failed]:[FIXTURE_SAVED_REPORT,failed],next:null}});
  });
  await gotoAppState(page,server.baseUrl,{day:FIXTURE_DAY,archive:""});
  const filter=page.getByRole("combobox",{name:"Outcome",exact:true});
  await expect(filter.getByRole("option")).toHaveText(["All outcomes","done","failed","cancelled","discarded","interrupted","superseded"]);
  await filter.selectOption("failed");
  await expect.poll(()=>requests.at(-1)).toBe("failed");
  await expect(page.getByRole("table",{name:"Saved reports"}).getByRole("row")).toHaveCount(2);
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

test("Explorer's Version registry action keeps ghost-sm geometry and a clear desktop hit target", async ({ page }) => {
  await page.setViewportSize(NARROW_DESKTOP_VIEWPORT);
  await gotoAppState(page, server.baseUrl, {
    day: FIXTURE_DAY,
    explore: FIXTURE_EXPLORER_WORKFLOW_ID,
  });

  const action = page.getByRole("button", { name: "Version registry" });
  const proof = await action.evaluate((button) => {
    const visual = button.getBoundingClientRect();
    const effectiveHeight = visual.height;
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
  expect(proof.effectiveHeight).toBe(proof.visualHeight);
  expect(proof.ownsTop).toBe(true);
  expect(proof.ownsBottom).toBe(true);
  expect(proof.overlaps).toEqual([]);
});
