import { createHash } from "node:crypto";
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
  const evidenceName = `archive-groups-landing-${viewport.width}.a11y.yml`;
  test(`projects the served Archive landing into dashboard and workflow groups at ${viewport.width}`, {
    annotation: [{type:"required-a11y-evidence",description:evidenceName}],
  }, async ({page}) => {
    await page.setViewportSize(viewport);
    await gotoAppState(page, server.baseUrl, {day:FIXTURE_DAY,archive:""});
    const archive = page.locator("main");
    const landing = archive;
    await expect(archive).toContainText("Current · 1.0");
    await expect(landing).toContainText("Version not recorded");
    await expect(landing).not.toContainText("latest");
    const workflow = landing.getByRole("button",{name:/retired-synthetic-workflow.*Workflow version not recorded/u});
    await expect(workflow).toBeVisible();
    await expect(workflow).toHaveCSS("min-height","62.5px");
    const snapshot = await page.locator("body").ariaSnapshot();
    test.info().annotations.push({type:`a11y-attachment-sha256:${evidenceName}`,description:createHash("sha256").update(snapshot).digest("hex")});
    await test.info().attach(evidenceName,{body:snapshot,contentType:"text/yaml"});
    await workflow.click();
    await expect(archive.getByRole("heading",{name:"retired-synthetic-workflow",exact:true})).toBeVisible();
    await expect(archive.getByRole("navigation",{name:"Archive path"})).toContainText("Version not recorded");
  });

  test(`groups saved reports and places view controls in the Archive header at ${viewport.width}`, async ({page}) => {
    await page.setViewportSize(viewport);
    await gotoAppState(page, server.baseUrl, {day:FIXTURE_DAY,archive:""});
    const archive = page.locator("main");
    await expect(archive.getByRole("button",{name:"Version archives",exact:true})).toHaveAttribute("aria-pressed","true");
    await expect(archive.getByRole("button",{name:"Plan a bump",exact:true}).first()).toBeVisible();
    await expect(archive.getByRole("button",{name:"Refresh",exact:true})).toHaveCount(0);
    await expect(archive.getByRole("button",{name:"Back",exact:true})).toHaveCount(0);
    await expect(archive).toContainText("Version not recorded");
    const workflow = archive.getByRole("button",{name:/retired-synthetic-workflow.*Workflow version not recorded/u});
    await expect(workflow).toBeVisible();
    await workflow.click();
    const runs = archive.getByRole("table",{name:"retired-synthetic-workflow saved runs"});
    await expect(runs).toContainText("Synthetic saved lookup");
    const runsBody = archive.locator(".ds-body-scope").first();
    await expect(runsBody).toHaveCSS("max-width", "none");
    await expect.poll(async () => (await runsBody.boundingBox())?.width ?? 0).toBeGreaterThan(viewport.width * 0.9);
    const exportButton = archive.getByRole("button",{name:"Export workflow",exact:true});
    await expect(exportButton).toBeVisible();
    await exportButton.click();
    await expect(page.getByRole("button",{name:"JSON",exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"CSV",exact:true})).toBeVisible();
    await page.keyboard.press("Escape");
    await runs.getByRole("button",{name:"Synthetic saved lookup",exact:true}).click();
    await expect(archive.getByRole("heading",{name:"Synthetic saved lookup",exact:true,level:1})).toBeVisible();
    const report = archive.getByRole("article",{name:"Saved archive report"});
    await expect(report).toContainText("Workflow version");
    await expect(report).toContainText("Not recorded");
    await archive.getByRole("navigation",{name:"Archive path"}).getByRole("button",{name:"Archive",exact:true}).click();
    await archive.getByRole("button",{name:"Plan a bump",exact:true}).first().click();
    const bump = page.getByRole("region",{name:"Plan a version bump"});
    await expect(bump).toBeVisible();
    await expect.poll(async () => (await bump.boundingBox())?.width ?? 0).toBeLessThanOrEqual(650);
    await expect(page.locator("button[aria-pressed='true']").filter({hasText:"Plan a bump"})).toHaveAttribute("aria-pressed","true");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Plan a version bump" })).toHaveCount(0);
    await expect(archive.getByRole("button", { name: "Plan a bump", exact: true })).toBeFocused();
  });
}
