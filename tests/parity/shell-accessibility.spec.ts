import { expect,test,type Page } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { ensureParityBundle,PARITY_DIST_DIR } from "./helpers/bundle.js";
import { startFixtureServer,type FixtureServer } from "./helpers/fixture-bff.js";
import { FIXTURE_DAY } from "./helpers/fixture-identity.js";
import { FIXTURE_IDS } from "./helpers/fixture-queue.js";
import { PARITY_THEMES,installTheme } from "./helpers/capture.js";
import { assertShellGeometry } from "./helpers/geometry.js";
import { attachShellA11y,shellTextContrast } from "./helpers/shell-proof.js";
let server:FixtureServer;
test.beforeAll(async()=>{ensureParityBundle();server=await startFixtureServer({distDir:PARITY_DIST_DIR,bundle:{proof:"working-tree"}});});
test.afterAll(async()=>server.close());
async function assertPanels(page:Page){
  await assertShellGeometry(page,"shell desktop containment");
  const boxes=await page.getByRole("region",{name:"Queue",exact:true}).evaluate(queue=>{
    const detail=queue.nextElementSibling;if(!detail)throw Error("detail panel missing");
    const q=queue.getBoundingClientRect(),d=detail.getBoundingClientRect();
    return {q:{x:q.x,right:q.right,y:q.y,height:q.height},d:{x:d.x,y:d.y,width:d.width,height:d.height}};
  });
  expect(boxes.q.right).toBeLessThanOrEqual(boxes.d.x);
  expect(boxes.q.y).toBe(boxes.d.y);expect(boxes.d.width).toBeGreaterThan(0);expect(boxes.d.height).toBeGreaterThan(0);
  await expect(page.getByRole("tab",{name:"Logs",exact:true})).toHaveAttribute("aria-selected","true");
  return boxes;
}
for(const theme of PARITY_THEMES){
  for(const viewport of [{width:1280,height:720},{width:1440,height:900},{width:1024,height:768}]){
    const evidenceName=`shell-${viewport.width}x${viewport.height}-${theme.name}.a11y.yml`;
    test(`selected run resize ${viewport.width}x${viewport.height} @ ${theme.name}`,{annotation:[{type:"required-a11y-evidence",description:evidenceName}]},async({page},info)=>{
      await installTheme(page,theme);await page.setViewportSize(viewport);
      await page.addInitScript(()=>localStorage.setItem("hr-dashboard.workflow-panel","icon"));
      await gotoAppState(page,server.baseUrl,{day:FIXTURE_DAY,run:FIXTURE_IDS.runningRun});
      const before=await assertPanels(page);
      if(viewport.width===1024){await page.setViewportSize({width:1024,height:720});await assertPanels(page);await page.setViewportSize(viewport);await assertPanels(page);}
      for(const name of ["Settings","Notifications","Start a run"]){
        const control=page.getByRole("button",{name,exact:name!=="Notifications"}).first();
        await expect(control).toBeVisible();
        expect(await control.evaluate(node=>{const box=node.getBoundingClientRect();return node.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));})).toBe(true);
      }
      await info.attach("geometry",{body:JSON.stringify({viewport,theme,before}),contentType:"application/json"});
      await info.attach("shell",{body:await page.screenshot(),contentType:"image/png"});
      await attachShellA11y(page,info,evidenceName);
    });
  }
  test(`floor, keyboard, modes, status, motion and toast @ ${theme.name}`,async({page},info)=>{
    await installTheme(page,theme);await page.emulateMedia({reducedMotion:"reduce"});
    await page.setViewportSize({width:900,height:600});
    await page.addInitScript(()=>localStorage.setItem("hr-dashboard.workflow-panel","icon"));
    await gotoAppState(page,server.baseUrl,{day:FIXTURE_DAY,run:FIXTURE_IDS.runningRun});
    await assertPanels(page);
    const floor=await page.locator("[data-app-root]").evaluate(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
    expect(floor.width).toBe(1024);expect(floor.height).toBe(720);expect(floor.scrollWidth).toBeGreaterThan(900);expect(floor.scrollHeight).toBeGreaterThan(600);
    const gear=page.getByRole("button",{name:"Settings",exact:true});
    for(let n=0;n<40 && !await gear.evaluate(node=>node===document.activeElement);n++)await page.keyboard.press("Tab");
    await expect(gear).toBeFocused();
    expect(await gear.evaluate(node=>{const b=node.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth;})).toBe(true);
    await page.keyboard.press("Enter");await expect(page.getByRole("region",{name:"Settings",exact:true})).toBeFocused();
    await page.getByRole("button",{name:"Back to the dashboard",exact:true}).click();await expect(gear).toBeFocused();
    await page.setViewportSize({width:1440,height:900});await page.evaluate(()=>scrollTo(0,0));await assertPanels(page);
    const toggle=page.getByRole("button",{name:/^Workflow Panel —/});
    await toggle.click();await expect(page.getByRole("dialog",{name:"Workflow Panel"})).toBeVisible();
    await page.keyboard.press("Escape");await expect(toggle).toBeFocused();
    await toggle.click();await page.getByRole("button",{name:"Dock the Workflow Panel as a sidebar",exact:true}).click();
    await expect(page.getByRole("navigation",{name:"Workflow Panel"})).toBeVisible();
    await page.getByRole("button",{name:"Minimise the Workflow Panel to an icon",exact:true}).click();
    await expect(toggle).toHaveAttribute("aria-expanded","false");
    const filters=page.getByRole("group",{name:"Filter the queue by status",exact:true});
    await expect(filters.getByRole("button",{name:"Failed — 1",exact:true})).toBeVisible();
    await filters.getByRole("button",{name:"Failed — 1",exact:true}).click();
    await expect(filters.getByRole("button",{name:"Failed — 1",exact:true})).toHaveAttribute("aria-pressed","true");
    await filters.getByRole("button",{name:"All 14",exact:true}).click();
    await page.getByRole("button",{name:"Run next",exact:true}).first().click();
    const toast=page.locator('[data-ds-toast-viewport="default"]');await expect(toast).toBeVisible();
    const clearance=await toast.evaluate(node=>{const sessions=document.querySelector('[aria-label="Session Panel"]');if(!sessions)throw Error("sessions missing");return sessions.getBoundingClientRect().top-node.getBoundingClientRect().bottom;});
    expect(clearance).toBeGreaterThan(0);
    expect(await page.evaluate(()=>document.getAnimations().filter(animation=>animation.playState==="running"&&animation.effect?.getComputedTiming().iterations===Infinity).length)).toBe(0);
    const contrasts=await shellTextContrast(page);expect(contrasts.length).toBeGreaterThan(10);
    for(const sample of contrasts)expect(sample.ratio,sample.name).toBeGreaterThanOrEqual(4.5);
    await info.attach("contrast",{body:JSON.stringify(contrasts),contentType:"application/json"});
    await info.attach("floor-proof",{body:JSON.stringify({floor,clearance,reducedMotion:true}),contentType:"application/json"});
    await info.attach("shell-after",{body:await page.screenshot(),contentType:"image/png"});
    await info.attach("a11y",{body:await page.locator("body").ariaSnapshot(),contentType:"text/plain"});
  });
}
