import { expect,test } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { ensureParityBundle,PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer,type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { startSeededServer,type SeededServer,SEEDED_COVERAGE_GAPS } from "./helpers/seeded-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { PARITY_THEMES,installTheme } from "./helpers/capture.js";
let fixture:FixtureServer;
let seeded:SeededServer;
test.beforeAll(async()=>{
  ensureParityBundle();
  fixture=await startFixtureServer({distDir:PARITY_DIST_DIR,bundle:{proof:"working-tree"}});
  seeded=await startSeededServer({distDir:PARITY_DIST_DIR,bundle:{proof:"working-tree"}});
});
test.afterAll(async()=>{await fixture.close();await seeded.close();});
for(const theme of PARITY_THEMES){
  test(`Run dialog restores its external door after every dismissal @ ${theme.name}`,async({page})=>{
    await installTheme(page,theme);
    await gotoAppState(page,fixture.baseUrl,{day:FIXTURE_DAY});
    const start=page.getByRole("button",{name:"Start a run",exact:true});
    for(const launch of ["button","shortcut"]){
      for(const dismissal of ["Cancel","Escape","Close"]){
        if(launch==="button")await start.press("Enter");
        else {await start.focus();await page.keyboard.press("r");}
        const dialog=page.getByRole("dialog",{name:"Start a run",exact:true});await expect(dialog).toBeVisible();
        await expect.poll(()=>dialog.evaluate(el=>el.contains(document.activeElement))).toBe(true);
        if(dismissal==="Escape")await page.keyboard.press("Escape");
        else await dialog.getByRole("button",{name:dismissal,exact:true}).press("Enter");
        await expect(dialog).toHaveCount(0);await expect(start).toBeFocused();
      }
    }
  });
  test(`route, reload, native and toolbar history @ ${theme.name}`,async({page},info)=>{
    await installTheme(page,theme);
    await gotoAppState(page,fixture.baseUrl,{day:FIXTURE_DAY,run:FIXTURE_IDS.doneRun,section:"receipt"});
    const receipt=page.getByRole("tab",{name:"Receipt",exact:true});
    const logs=page.getByRole("region",{name:"Selected run logs",exact:true});
    await expect(receipt).toHaveCount(0);
    await expect(logs).toBeVisible();
    await page.locator(`[data-demo-row-id="${FIXTURE_IDS.doneRun}"]`).click();await expect(page).toHaveURL(/section=logs/);
    await page.goBack();await expect(page).toHaveURL(/section=receipt/);await expect(logs).toBeVisible();
    await page.goForward();await expect(logs).toBeVisible();
    await page.reload();await expect(logs).toBeVisible();
    await page.locator(`[data-demo-row-id="${FIXTURE_IDS.runningRun}"]`).click();
    await expect(page).toHaveURL(new RegExp(`run=${FIXTURE_IDS.runningRun}`));
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`run=${FIXTURE_IDS.doneRun}`));
    await expect(logs).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`run=${FIXTURE_IDS.runningRun}`));
    await expect(page.getByRole("button",{name:"Back",exact:true})).toHaveCount(0);
    await expect(page.getByRole("button",{name:"Forward",exact:true})).toHaveCount(0);
    for(const [name,param] of [["Explorer","explorer"],["Analytics","activity"]]){
      await page.getByRole("button",{name:"Settings",exact:true}).click();
      const door=page.getByRole("link",{name,exact:true});await door.click();
      await expect(page).toHaveURL(new RegExp(`settings=${param}`));
      await expect(door).toHaveAttribute("aria-current","page");
      const length=await page.evaluate(()=>history.length);await door.click();
      expect(await page.evaluate(()=>history.length)).toBe(length);
      await page.getByRole("button",{name:"Back to dashboard",exact:true}).click();
      await expect(page.getByRole("region",{name:"Selected run logs",exact:true})).toBeVisible();
    }
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    await page.getByRole("link",{name:"Keyboard",exact:true}).click();
    await expect(page).toHaveURL(/settings=keyboard/);
    const before=page.url();await page.keyboard.press("j");await page.keyboard.press("r");expect(page.url()).toBe(before);
    await info.attach("navigation-a11y",{body:await page.locator("body").ariaSnapshot(),contentType:"text/plain"});
  });
  test(`dirty Settings keeps its draft and chosen native exit @ ${theme.name}`,async({page})=>{
    await installTheme(page,theme);
    await gotoAppState(page,fixture.baseUrl,{day:FIXTURE_DAY});
    await page.getByRole("button",{name:"Settings",exact:true}).click();
    await page.getByRole("searchbox", { name: "Search settings", exact: true }).fill("backoff");
    await page.getByRole("link", { name: "Backoff base Performance", exact: true }).click();
      await page.getByRole("searchbox", { name: "Search settings", exact: true }).fill("");
    const width=page.getByRole("textbox",{name:"Task",exact:true});await width.fill("1777");
    await page.getByRole("link",{name:"Keyboard",exact:true}).click();
    await page.goBack();await expect(width).toHaveValue("1777");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button",{name:"Back to dashboard",exact:true}).click();
    await page.getByRole("button",{name:"Keep editing",exact:true}).click();await expect(width).toHaveValue("1777");
    await page.goBack(); // Another Settings section, editor remains mounted.
    await page.goBack(); // Exit to the queue: restore first, then confirm.
    await expect(page.getByRole("button",{name:"Discard changes",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Keep editing",exact:true}).click();
    await page.goBack();await page.getByRole("button",{name:"Discard changes",exact:true}).click();
    await expect(page.getByRole("button",{name:"Start a run",exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Back to dashboard",exact:true})).toHaveCount(0);
    expect(new URL(page.url()).searchParams.has("settings")).toBe(false);
  });
  test(`seeded service route and unavailable run @ ${theme.name}`,async({page},info)=>{
    await installTheme(page,theme);
    const runId=seeded.runIds.runningRun;
    if(runId===undefined)throw new Error("seeded running run is missing");
    await gotoAppState(page,seeded.baseUrl,{day:seeded.day,run:runId});
    const response=await page.request.get(`${seeded.baseUrl}/api/v1/runs/${runId}`);expect(response.ok()).toBe(true);
    const detail:unknown=await response.json();
    const {RunDetailWireSchema}=await import("../../src/models/dashboard/run-detail.js");
    const served=RunDetailWireSchema.parse(detail);expect(String(served.runId)).toBe(runId);
    await expect(page.getByRole("region",{name:"Selected run logs",exact:true})).toBeVisible();
    await expect(page.locator(`[data-demo-row-id="${runId}"]`)).toHaveAttribute("aria-pressed","true");
    await expect(page.locator(`[data-demo-row-id="${runId}"]`)).toBeVisible();
    await gotoAppState(page,seeded.baseUrl,{day:seeded.day,run:"unavailable-run"});
    await expect(page.getByText("Run unavailable",{exact:true})).toBeVisible();
    await expect(page.getByText("No run open",{exact:true})).toHaveCount(0);
    await info.attach("seeded-proof",{body:JSON.stringify({runId,served,coverageGaps:SEEDED_COVERAGE_GAPS,fakes:["manual clock","synthetic runtime config","person-lookup descriptor seed","fixture preflight/archive/explorer/intake dependencies"]},null,2),contentType:"application/json"});
  });
}
