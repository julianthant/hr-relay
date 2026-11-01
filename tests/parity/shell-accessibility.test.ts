import { expect, type Page } from "@playwright/test";
import { test } from "./helpers/fixtures.js";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer,type FixtureServer } from "../support/helpers/dashboard/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { PARITY_THEMES,installTheme } from "./helpers/capture.js";
import { assertShellGeometry } from "./helpers/geometry.js";
import { attachShellA11y,shellTextContrast } from "./helpers/shell-proof.js";

let server:FixtureServer;
test.beforeAll(async()=>{server=await startFixtureServer({distDir:PARITY_DIST_DIR,bundle:{proof:"working-tree"}});});
test.afterAll(async()=>server.close());
async function assertPanels(page:Page){
  await assertShellGeometry(page,"shell desktop containment");
  const boxes=await page.locator(".dashboard-panel-columns").evaluate(columns=>{
    const queue=columns.querySelector(".dashboard-queue-column"),detail=columns.querySelector(".dashboard-log-column");
    if(!queue||!detail)throw Error("queue/detail columns missing");
    const q=queue.getBoundingClientRect(),d=detail.getBoundingClientRect();
    return {q:{x:q.x,right:q.right,y:q.y,height:q.height},d:{x:d.x,y:d.y,width:d.width,height:d.height}};
  });
  expect(boxes.q.right).toBeLessThanOrEqual(boxes.d.x);
  expect(boxes.q.y).toBe(boxes.d.y);expect(boxes.d.width).toBeGreaterThan(0);expect(boxes.d.height).toBeGreaterThan(0);
  await expect(page.getByRole("region",{name:"Queue",exact:true})).toBeVisible();
  await expect(page.getByRole("region",{name:"Action panel",exact:true})).toBeVisible();
  return boxes;
}
for(const theme of PARITY_THEMES){
  for(const viewport of [{width:1280,height:720},{width:1440,height:900},{width:1024,height:768}]){
    const evidenceName=`shell-${viewport.width}x${viewport.height}-${theme.name}.a11y.yml`;

test(`selected run resize ${viewport.width}x${viewport.height} @ ${theme.name}`,{annotation:[{type:"required-a11y-evidence",description:evidenceName}]},async({page},info)=>{
      await installTheme(page,theme);await page.setViewportSize(viewport);
      await gotoAppState(page,server.baseUrl,{day:FIXTURE_DAY,run:FIXTURE_IDS.runningRun});
      const before=await assertPanels(page);
      if(viewport.width===1024){await page.setViewportSize({width:1024,height:720});await assertPanels(page);await page.setViewportSize(viewport);await assertPanels(page);}
      for(const name of ["Settings","Notifications","Start a run"]){
        const control=page.getByRole("button",{name,exact:name!=="Notifications"}).first();
        await expect(control).toBeVisible();
        expect(await control.evaluate(node=>{const box=node.getBoundingClientRect();return node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));})).toBe(true);
      }
      await info.attach("geometry",{body:JSON.stringify({viewport,theme,before}),contentType:"application/json"});
      await attachShellA11y(page,info,evidenceName);
    });
}

test(`floor, keyboard, status and motion @ ${theme.name}`,async({page},info)=>{
    await installTheme(page,theme);await page.emulateMedia({reducedMotion:"reduce"});
    await page.setViewportSize({width:900,height:600});
    await gotoAppState(page,server.baseUrl,{day:FIXTURE_DAY,run:FIXTURE_IDS.runningRun});
    await assertPanels(page);
    const floor=await page.locator("[data-app-root]").evaluate(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
    expect(floor.width).toBe(1024);expect(floor.height).toBe(720);expect(floor.scrollWidth).toBeGreaterThan(900);expect(floor.scrollHeight).toBeGreaterThan(600);
    const gear=page.getByRole("button",{name:"Settings",exact:true});
    const tabStops=await page.locator("button:visible,input:visible,select:visible,textarea:visible,a[href]:visible,[tabindex]:visible").evaluateAll(nodes=>nodes.filter(node=>node instanceof HTMLElement && node.tabIndex>=0 && !node.matches(":disabled") && !node.closest("[inert]")).length);
    let tabsToGear=0;
    while(tabsToGear<=tabStops && !await gear.evaluate(node=>node===document.activeElement)){await page.keyboard.press("Tab");tabsToGear++;}
    await info.attach("keyboard-traversal",{body:JSON.stringify({tabStops,bound:tabStops+1,tabsToGear,active:await page.evaluate(()=>({tag:document.activeElement?.tagName,label:document.activeElement?.getAttribute("aria-label"),text:document.activeElement?.textContent?.trim()}))}),contentType:"application/json"});
    await expect(gear).toBeFocused();
    expect(await gear.evaluate(node=>{const b=node.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth;})).toBe(true);
    await page.keyboard.press("Enter");await expect(page.getByRole("region",{name:"Settings",exact:true})).toBeFocused();
    await page.getByRole("button",{name:"Back to dashboard",exact:true}).click();await expect(gear).toBeFocused();
    await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>scrollTo(0,0));await assertPanels(page);
    const filters=page.getByRole("button",{name:"Filter queue by status",exact:true});
    await filters.click();
    const failed=page.getByRole("menuitemcheckbox",{name:"Failed 1",exact:true});
    await expect(failed).toBeVisible();await failed.click();
    await expect(failed).toHaveAttribute("aria-checked","true");
    await page.getByRole("menuitemcheckbox",{name:"All 14",exact:true}).click();
    await expect(page.getByRole("menuitemcheckbox",{name:"All 14",exact:true})).toHaveAttribute("aria-checked","true");
    await page.keyboard.press("Escape");await expect(filters).toBeFocused();
    expect(await page.evaluate(()=>document.getAnimations().filter(animation=>animation.playState==="running"&&animation.effect?.getComputedTiming().iterations===Infinity).length)).toBe(0);
    const contrasts=await shellTextContrast(page);
    await info.attach("contrast",{body:JSON.stringify(contrasts),contentType:"application/json"});
    expect(contrasts.length).toBeGreaterThan(10);
    for(const sample of contrasts)expect(sample.ratio,sample.name).toBeGreaterThanOrEqual(4.5);
    await info.attach("floor-proof",{body:JSON.stringify({floor,tabStops,tabsToGear,reducedMotion:true}),contentType:"application/json"});
    await info.attach("a11y",{body:await page.locator("body").ariaSnapshot(),contentType:"text/plain"});
  });
}
