/** Archive warnings remain readable in the public search and saved-report flow. */
import { expect,test,type Page } from "@playwright/test";
import { SavedArchiveReportWireSchema } from "../../src/domain/dashboard/archive.js";
import { gotoAppState,routeUrl } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR,ensureParityBundle } from "./helpers/bundle.js";
import { FIXTURE_SAVED_REPORT } from "./helpers/fixture-archive.js";
import { startFixtureServer,type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_EXPLORER_WORKFLOW_ID } from "./helpers/fixture-explorer.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

const FIRST_WARNING = "CRM returned a stale session on attempt 1";
const PARTIAL_RUN_ID = "00000000-0000-4000-8000-000000000099";
const NARROW_DESKTOP_VIEWPORT = { width: 1024, height: 768 } as const;

let server: FixtureServer;

async function expectExactSearch(page: Page, search: string): Promise<void> {
  await expect.poll(() => new URL(page.url()).search).toBe(search);
}

async function expectVersionRegistry(page: Page, search: string): Promise<void> {
  await expectExactSearch(page, search);
  await expect(page.getByRole("region", { name: "Plan a version bump" })).toBeVisible();
  await expect(page.locator("button[aria-pressed='true']").filter({ hasText: "Plan a bump" }).first())
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
    const warnings=page.getByRole("region",{name:"Details",exact:true});
    await expect(warnings).toBeVisible();
    await expect(warnings).toContainText(FIRST_WARNING);
    await expect(warnings.getByRole("row")).toHaveCount(warning.count+1);

  });
}

test("archive search filters public groups and the saved report retains failed warning facts", async ({page})=>{
  const failed=SavedArchiveReportWireSchema.parse({...FIXTURE_SAVED_REPORT,runId:PARTIAL_RUN_ID,title:"Failed saved lookup",outcome:"failed",
    sections:[{kind:"table",title:"Warning facts",columns:["Warning"],rows:[[FIRST_WARNING]]}]});
  const searchRequests:string[]=[];
  const workflowGroup={dashboardVersion:null,workflow:failed.workflow,workflowVersion:null,reportCount:1,latestCompletedAt:failed.completedAt};
  await page.route("**/api/v1/archive/groups?*",route=>{
    const search=new URL(route.request().url()).searchParams.get("search")??"";searchRequests.push(search);
    return route.fulfill({json:{groups:search===""||failed.title.toLowerCase().includes(search.toLowerCase())?[workflowGroup]:[]}});
  });
  await page.route("**/api/v1/archive/reports?*",route=>{
    const search=new URL(route.request().url()).searchParams.get("search")??"";
    return route.fulfill({json:{items:search===""||failed.title.toLowerCase().includes(search.toLowerCase())?[failed]:[],next:null}});
  });
  await page.route(`**/api/v1/archive/reports/${failed.runId}`,route=>route.fulfill({json:failed}));
  await gotoAppState(page,server.baseUrl,{day:FIXTURE_DAY,archive:""});
  await page.getByRole("button",{name:new RegExp(failed.workflow,"u")}).click();
  const search=page.getByRole("textbox",{name:"Search all public archive fields",exact:true});
  await search.fill("does-not-match");
  await expect(page.getByRole("cell",{name:/No saved reports match this scope/})).toBeVisible();
  await search.fill(failed.title);
  await expect.poll(()=>searchRequests.at(-1)).toBe(failed.title);
  await expect(page.getByRole("table").first()).toBeVisible();
  await expect.poll(()=>searchRequests.at(-1)).toBe(failed.title);
  await page.getByRole("button",{name:failed.title,exact:true}).click();
  await expect(page.getByRole("heading",{name:failed.title,exact:true,level:1})).toBeVisible();
  const article=page.getByRole("article",{name:"Saved archive report"});
  await expect(article).toContainText("Failed");
  const warnings=page.getByRole("region",{name:"Details",exact:true});
  await expect(warnings).toContainText(FIRST_WARNING);
  await expect(warnings.getByRole("row")).toHaveCount(2);
});

test("one-workflow dashboard normalizes that workflow's selection to a major bump review", async ({ page }) => {
  await gotoAppState(page, server.baseUrl, { day: FIXTURE_DAY, archive: "", archiveView: "versions" });
  const bump = page.getByRole("region", { name: "Plan a version bump" });
  await expect(bump.getByRole("button", { name: "Workflow to bump" })).toContainText("Person lookup");
  await expect(bump.getByRole("radio", { name: "Selected workflow" })).toBeChecked();
  await expect(page.getByRole("dialog", { name: "Plan a version bump" }).getByRole("button", { name: "Review change" })).toBeEnabled();
  await expect(bump.getByText("For every workflow, choose Dashboard version.")).toHaveCount(0);
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

test("Explorer's Version registry action keeps a clear 32px desktop hit target", async ({ page }) => {
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

  expect(proof.visualHeight).toBe(32);
  expect(proof.effectiveHeight).toBe(proof.visualHeight);
  expect(proof.ownsTop).toBe(true);
  expect(proof.ownsBottom).toBe(true);
  expect(proof.overlaps).toEqual([]);
});
