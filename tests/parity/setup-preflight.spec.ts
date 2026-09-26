import { createHash } from "node:crypto";
import { expect,test } from "@playwright/test";
import { gotoAppState } from "./helpers/app-driver.js";
import { PARITY_THEMES,installTheme,assertThemeApplied,captureParityPair } from "./helpers/capture.js";
import { FIXTURE_DAY,FIXTURE_DESCRIPTOR_HASH,FIXTURE_APP_VERSION } from "./helpers/fixture-identity.js";
import { REFERENCES,dismissWorkflowWindow,failOnPageErrors } from "./helpers/reference-harness.js";
import { ensureParityBundle } from "./helpers/bundle.js";
import { startSetupPreflightServer } from "./helpers/fixture-setup-preflight.js";
import { SETUP_SCENES } from "./helpers/reference-setup-preflight-scenes.js";

test.beforeAll(()=>{ensureParityBundle();});
for(const scene of SETUP_SCENES)for(const theme of PARITY_THEMES)for(const viewport of [{width:1280,height:720},{width:1440,height:900}]) {
  const a11yName=`setup-${scene.id}-${theme.name}-${String(viewport.width)}.a11y.yml`;
  test(`Setup ${scene.id} ${theme.name} ${String(viewport.width)}`,{annotation:[{type:"required-a11y-evidence",description:a11yName}]},async({page},info)=>{
    const server=await startSetupPreflightServer(scene.id);
    try {
      const errors=failOnPageErrors(page);await page.setViewportSize(viewport);await page.clock.setFixedTime(new Date(server.now));await installTheme(page,theme);
      await gotoAppState(page,server.baseUrl,{day:FIXTURE_DAY,settings:"preflight"});await dismissWorkflowWindow(page);await assertThemeApplied(page,theme);
      const setup=page.getByRole("region",{name:"Preflight",exact:true});
      await expect(setup.getByRole("combobox")).toBeVisible();if(scene.selected)await setup.getByRole("combobox").selectOption(server.scope);
      await expect(setup).toContainText(scene.expected);await expect(setup.getByRole("button",{name:"Rerun preflight",exact:true})).toBeEnabled();
      const a11y=await page.locator("body").ariaSnapshot();info.annotations.push({type:`a11y-attachment-sha256:${a11yName}`,description:createHash("sha256").update(a11y).digest("hex")});await info.attach(a11yName,{body:a11y,contentType:"text/yaml"});
      await captureParityPair(page,REFERENCES,{stateId:"setup-preflight",viewport:`${String(viewport.width)}x${String(viewport.height)}`,theme:theme.name,adapter:"production-preflight-services",fixtureId:scene.id,descriptorHash:FIXTURE_DESCRIPTOR_HASH,appVersion:FIXTURE_APP_VERSION,capturedAt:FIXTURE_DAY,variant:scene.id});
      const setupText=await setup.locator("[aria-live=polite]").innerText();
      const trigger=page.getByRole("button",{name:/^Preflight: /u});await trigger.click();
      const doctor=page.getByRole("dialog",{name:"Preflight",exact:true});await expect(doctor).toBeVisible();await expect(doctor).toContainText(scene.expected);
      const box=await doctor.boundingBox();expect(box).not.toBeNull();expect((box?.y??0)+(box?.height??0)).toBeLessThanOrEqual(viewport.height);
      expect(await doctor.locator("[aria-live=polite]").innerText()).toBe(setupText);
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
    const setup=page.getByRole("region",{name:"Preflight",exact:true});await setup.getByRole("combobox").selectOption(server.scope);await expect(setup).toContainText("Readiness unavailable");const rerun=setup.getByRole("button",{name:"Rerun preflight",exact:true});await expect(rerun).toBeEnabled();await rerun.focus();await page.keyboard.press("Enter");
    await expect(setup.locator("time")).toHaveText(server.now);expect(server.requests.some(request=>request.method==="POST"&&request.path==="/api/v1/preflight/rerun"&&request.status===200)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }finally{await server.close();}
});
