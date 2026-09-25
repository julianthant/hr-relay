import { expect, test } from "@playwright/test";
import { ensureParityBundle, PARITY_DIST_DIR } from "./helpers/bundle.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { startFixtureServer, type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";

let server: FixtureServer;
test.beforeAll(async () => {
  ensureParityBundle();
  server = await startFixtureServer({distDir:PARITY_DIST_DIR,bundle:{proof:"working-tree"}});
});
test.afterAll(async () => { await server?.close(); });

for (const viewport of [{width:1024,height:720},{width:1440,height:900}]) {
  test(`groups saved reports and places view controls in the Archive header at ${viewport.width}`, async ({page}) => {
    await page.setViewportSize(viewport);
    await gotoAppState(page, server.baseUrl, {day:FIXTURE_DAY,archive:""});
    const archive = page.locator("main");
    await expect(archive.getByRole("button",{name:"Version archives",exact:true})).toHaveAttribute("aria-pressed","true");
    await expect(archive.getByRole("button",{name:"Plan a bump",exact:true}).first()).toBeVisible();
    await expect(archive.getByRole("button",{name:"Refresh",exact:true})).toHaveCount(0);
    await expect(archive.getByRole("button",{name:"Back",exact:true})).toHaveCount(0);
    await expect(archive.getByRole("region",{name:"Version archives"})).toContainText("Version not recorded");
    await expect(archive.getByRole("button",{name:/Synthetic saved lookup/u})).toBeVisible();
    await archive.getByRole("button",{name:/Synthetic saved lookup/u}).click();
    await expect(archive.getByRole("article",{name:"Saved archive report"})).toContainText("Synthetic saved lookup");
    await expect(archive.getByRole("article",{name:"Saved archive report"})).toContainText("Runtime version not recorded");
    await archive.getByRole("combobox",{name:"Outcome"}).selectOption("failed");
    await expect(archive.getByText("No saved reports match these filters.")).toBeVisible();
    await archive.getByRole("button",{name:"Clear filters"}).click();
    await expect(archive.getByRole("button",{name:/Synthetic saved lookup/u})).toBeVisible();
    await archive.getByRole("button",{name:"Plan a bump",exact:true}).first().click();
    await expect(archive.getByRole("region",{name:"Plan a version bump"})).toBeVisible();
    await expect(archive.getByRole("button",{name:"Plan a bump",exact:true})).toHaveAttribute("aria-pressed","true");
  });
}
