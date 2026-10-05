import { chooseSelect } from "./helpers/select-choice.js";
import { createHash } from "node:crypto";
import { expect,test,type Locator } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_THEMES,installTheme,assertThemeApplied,captureParityPair } from "./helpers/capture.js";
import { FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH,FIXTURE_APP_VERSION } from "./helpers/fixture-identity.js";
import { REFERENCES,dismissWorkflowWindow,failOnPageErrors } from "./helpers/reference-harness.js";
import { ensureParityBundle } from "./helpers/bundle.js";
import { startSetupPreflightServer } from "./helpers/fixture-setup-preflight.js";
import { SETUP_SCENES } from "./helpers/reference-setup-preflight-scenes.js";

type ServedCheck = { check:string; status:"pass"|"warning"|"fail"; summary:string; blocks:readonly string[]; remediation?:string };
type ServedRead = { state:"unavailable"; reason:string } | { state:"present"; report:{ checkedAt:string; requestedCapabilities:readonly string[]; results:readonly ServedCheck[] } };

async function assertChecks(surface:Locator, served:ServedRead, settings:boolean):Promise<void> {
  const rows=surface.locator(settings?".diagnostic-check-entry":".settings-preflight-item");
  if(served.state==="unavailable") { await expect(rows).toHaveCount(0);return; }
  await expect(rows).toHaveCount(served.report.results.length);
  if(settings) {
    await expect(surface.getByText("Technical details",{exact:true})).toHaveCount(0);
    await expect(surface.getByText("Scope details",{exact:true})).toHaveCount(0);
    await expect(rows.getByText("Passed",{exact:true})).toHaveCount(served.report.results.filter(check=>check.status==="pass").length);
    await expect(rows.getByText("Needs attention",{exact:true})).toHaveCount(served.report.results.filter(check=>check.status==="warning").length);
    await expect(rows.getByText("Blocked",{exact:true})).toHaveCount(served.report.results.filter(check=>check.status==="fail").length);
    return;
  }
  for(const [index,check] of served.report.results.entries()) {
    const row=rows.nth(index);
    await expect(row).toContainText(check.status);
    if(check.status!=="pass") await expect(row).toContainText(check.summary);
    if(check.status==="fail")for(const block of check.blocks)await expect(row).toContainText(block);
    if(check.remediation!==undefined)await expect(row).toContainText(check.remediation);
  }
}

test.beforeAll(()=>{ensureParityBundle();});
for(const scene of SETUP_SCENES)for(const theme of PARITY_THEMES)for(const viewport of [{width:1280,height:720},{width:1440,height:900}]) {
  const a11yName=`setup-${scene.id}-${theme.name}-${String(viewport.width)}.a11y.yml`;
  test(`Setup ${scene.id} ${theme.name} ${String(viewport.width)}`,{annotation:[{type:"required-a11y-evidence",description:a11yName}]},async({page},info)=>{
    const server=await startSetupPreflightServer(scene.id);
    try {
      const errors=failOnPageErrors(page);await page.setViewportSize(viewport);await page.clock.setFixedTime(new Date(server.now));await installTheme(page,theme);
      await gotoAppState(page,server.baseUrl,{day:FIXTURE_DAY,settings:"preflight"});await dismissWorkflowWindow(page);await assertThemeApplied(page,theme);
      const setup=page.getByRole("region",{name:"Preflight",exact:true});
      await expect(setup.getByRole("combobox")).toBeVisible();if(scene.selected)await chooseSelect(setup.getByRole("combobox"), server.scope);
      await expect(setup).toContainText(scene.expected);await expect(setup.getByRole("button",{name:"Run checks again",exact:true})).toBeEnabled();
      const readUrl=new URL("/api/v1/preflight",server.baseUrl);
      if(scene.selected)readUrl.searchParams.set("selection",JSON.stringify({workflowId:server.scope}));
      const read=await page.context().request.get(readUrl.toString());expect(read.ok()).toBe(true);
      const served=await read.json() as ServedRead;
      const a11y=await page.locator("body").ariaSnapshot();info.annotations.push({type:`a11y-attachment-sha256:${a11yName}`,description:createHash("sha256").update(a11y).digest("hex")});await info.attach(a11yName,{body:a11y,contentType:"text/yaml"});
      if(served.state==="present") {
        await expect(setup.locator("time")).toHaveCount(1);
        await expect(setup.getByRole("group",{name:"Readiness summary",exact:true})).toContainText("Last checked");
        await expect(setup.locator("time")).toHaveAttribute("dateTime",served.report.checkedAt);
        await expect(setup.getByText("Scope details",{exact:true})).toHaveCount(0);
      }else await expect(setup).toContainText(served.reason);
      await assertChecks(setup,served,true);
      await captureParityPair(page,REFERENCES,{stateId:"setup-preflight",viewport:`${String(viewport.width)}x${String(viewport.height)}`,theme:theme.name,adapter:"production-preflight-services",fixtureId:scene.id,descriptorHash:FIXTURE_DESCRIPTOR_HASH,appVersion:FIXTURE_APP_VERSION,capturedAt:FIXTURE_DAY,variant:scene.id});
      const trigger=page.getByRole("button",{name:/^Preflight: /u});await trigger.click();
      const doctor=page.getByRole("dialog",{name:"Preflight",exact:true});await expect(doctor).toBeVisible();await expect(doctor).toContainText(scene.expected);
      const box=await doctor.boundingBox();expect(box).not.toBeNull();expect((box?.y??0)+(box?.height??0)).toBeLessThanOrEqual(viewport.height);
      if(served.state==="present") {
        await expect(doctor.locator("time")).toHaveAttribute("dateTime",served.report.checkedAt);
        await expect(doctor.locator("time")).toHaveText(served.report.checkedAt);
        for(const capability of served.report.requestedCapabilities)await expect(doctor).toContainText(capability);
      }else await expect(doctor).toContainText(served.reason);
      await assertChecks(doctor,served,false);
      await captureParityPair(page,REFERENCES,{stateId:"setup-preflight",viewport:`${String(viewport.width)}x${String(viewport.height)}`,theme:theme.name,adapter:"production-preflight-services",fixtureId:scene.id,descriptorHash:FIXTURE_DESCRIPTOR_HASH,appVersion:FIXTURE_APP_VERSION,capturedAt:FIXTURE_DAY,variant:`${scene.id}-doctor`});
      await page.keyboard.press("Escape");await expect(doctor).not.toBeVisible();await expect(trigger).toBeFocused();
      expect(errors).toEqual([]);await info.attach("production-preflight-proof",{body:JSON.stringify({provenance:server.provenance(),requests:server.requests}),contentType:"application/json"});
    }finally{await server.close();}
  });
}
test("Setup minimum canvas retains keyboard rerun and authoritative readback",async({page})=>{
  const server=await startSetupPreflightServer("unavailable");
  try {
    await page.setViewportSize({width:1024,height:720});await page.clock.setFixedTime(new Date(server.now));await gotoAppState(page,server.baseUrl,{day:FIXTURE_DAY,settings:"preflight"});await dismissWorkflowWindow(page);
    const setup=page.getByRole("region",{name:"Preflight",exact:true});await chooseSelect(setup.getByRole("combobox"), server.scope);await expect(setup).toContainText("Readiness unavailable");const rerun=setup.getByRole("button",{name:"Run checks again",exact:true});await expect(rerun).toBeEnabled();await rerun.focus();await page.keyboard.press("Enter");
    await expect(setup.getByRole("group",{name:"Readiness summary",exact:true})).toBeVisible();await expect(rerun).toBeEnabled();
    const readUrl=new URL("/api/v1/preflight",server.baseUrl);readUrl.searchParams.set("selection",JSON.stringify({workflowId:server.scope}));
    const read=await page.context().request.get(readUrl.toString());expect(read.ok()).toBe(true);
    const served=await read.json() as ServedRead;expect(served.state).toBe("present");
    if(served.state!=="present")throw new Error("PREFLIGHT_RERUN_REPORT_MISSING");
    expect(served.report.checkedAt).toBe(server.now);await expect(setup.locator("time")).toHaveCount(1);
    await assertChecks(setup,served,true);expect(server.requests.some(request=>request.method==="POST"&&request.path==="/api/v1/preflight/rerun"&&request.status===200)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }finally{await server.close();}
});

test("Setup keeps an expired check visible as a previous result",async({page},info)=>{
  const server=await startSetupPreflightServer("stale");
  try {
    await page.setViewportSize({width:1280,height:720});await page.clock.setFixedTime(new Date(server.now));
    await gotoAppState(page,server.baseUrl,{day:FIXTURE_DAY,settings:"preflight"});await dismissWorkflowWindow(page);
    const setup=page.getByRole("region",{name:"Preflight",exact:true});
    await expect(setup).toContainText("Previous result");
    await expect(setup).toContainText("Previous check");
    await expect(setup.locator("time")).toHaveCount(1);
    await expect(setup).toContainText("Run checks again for current readiness");
    await expect(setup).not.toContainText("Ready to run");
    await expect(setup.locator(".diagnostic-check-entry")).not.toHaveCount(0);
    await info.attach("historical-preflight.png",{body:await setup.screenshot(),contentType:"image/png"});
  }finally{await server.close();}
});
