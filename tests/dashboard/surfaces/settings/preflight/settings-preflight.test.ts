// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,it,vi } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { PreflightActionsProvider } from "../../../../../src/dashboard/surfaces/settings/preflight/preflight-actions.js";
import { projectPreflight } from "../../../../../src/dashboard/surfaces/settings/preflight/settings-preflight-model.js";
import { PreflightReportContent } from "../../../../../src/dashboard/surfaces/settings/preflight/settings-preflight.js";
import { PreflightCheckIdSchema } from "../../../../../src/models/preflight/preflight-contract.js";
import { FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { FIXTURE_EDITABLE_SETTINGS } from "../../../../parity/helpers/fixture-settings.js";
import { createPreflightHarness } from "../../../../support/fixtures/preflight-seams.js";

Reflect.set(globalThis,"IS_REACT_ACT_ENVIRONMENT",true);
const now = new Date("2026-09-19T12:00:00.000Z");
let root:Root|undefined, host:HTMLElement|undefined;
afterEach(()=>{if(root!==undefined)act(()=>root?.unmount());host?.remove();root=undefined;host=undefined;vi.useRealTimers();});
async function report() {
  return {...await createPreflightHarness(manualClock(now), FIXTURE_EDITABLE_SETTINGS.activeConfigFingerprint).authority.refresh(new AbortController().signal), descriptorFingerprint: FingerprintSchema.parse("b".repeat(64))};
}

it("Settings groups served checks and keeps failures, blocks, and only exact remedies visible",async()=>{
  const served=await report();let storage=0,sessions=0,settings=0,reruns=0;
  const checks=["fiscal.current","authority.health","provider.nominatim","browser.assets"].map(id=>({
    id:PreflightCheckIdSchema.parse(id),label:id,verdict:"fail" as const,
    detail:`Synthetic ${id} unavailable`,blocks:["executor.run"],remediation:`Repair ${id}`,checkedAt:served.checkedAt,
  }));
  const actions={actorId:"local-operator",descriptorFingerprint:served.descriptorFingerprint,
    showSettings(section?:"storage"){if(section==="storage")storage++;else settings++;},showSessions(){sessions++;}};
  const client={preflightScopes:()=>Promise.resolve([])} as unknown as DashboardClient;
  host=document.createElement("div");document.body.append(host);
  await act(async()=>{root=createRoot(host as HTMLElement);root.render(createElement(DashboardClientProvider,{client,children:createElement(PreflightActionsProvider,{actions,children:createElement(PreflightReportContent,{presentation:"settings",preflight:{state:"completed",report:served,checks},onRerun(){reruns++;}})})}));});
  assert.match(host.textContent??"",/Readiness for the dashboard and its workflows/u);
  const workflow=host.querySelector('[role="group"][aria-label="Workflow readiness"]');
  const runtime=host.querySelector('[role="group"][aria-label="Runtime"]');
  assert.ok(workflow?.textContent?.includes("Current fiscal year"));
  assert.ok(runtime?.textContent?.includes("Data store readiness"));
  assert.ok(runtime?.textContent?.includes("Browser tools"));
  assert.doesNotMatch(host.textContent??"",/Scope details|Technical details|Synthetic .* unavailable|Remedy:|Repair browser.assets/u);
  assert.match(host.textContent??"",/Affected: Run execution/u);
  const buttons=[...host.querySelectorAll("button")].filter(button=>button.textContent?.startsWith("Open "));
  assert.equal(buttons.length,4);
  for(const button of buttons)await act(async()=>button.click());
  assert.deepEqual([storage,sessions,settings],[1,0,3]);
  const rerun=[...host.querySelectorAll("button")].find(button=>button.textContent==="Run preflight");
  assert.ok(rerun);await act(async()=>rerun.click());assert.equal(reruns,1);
});

it("Settings names missing UCPath fields from presence readback and opens Credentials",async()=>{
  const served=await report();let destination:string|undefined;
  const check={id:PreflightCheckIdSchema.parse("secrets.ucpath-sso"),label:"secrets.ucpath-sso",verdict:"fail" as const,
    detail:"ucpathUserId: missing; ucpathPassword: missing",blocks:["system.ucpath.prod","system.crm.prod"],
    remediation:"configure protected Settings",checkedAt:served.checkedAt};
  const actions={actorId:"local-operator",descriptorFingerprint:served.descriptorFingerprint,
    showSettings(section?:"storage"|"credentials"){destination=section;},showSessions(){}};
  const client={preflightScopes:()=>Promise.resolve([])} as unknown as DashboardClient;
  host=document.createElement("div");document.body.append(host);
  await act(async()=>{root=createRoot(host as HTMLElement);root.render(createElement(DashboardClientProvider,{client,children:createElement(PreflightActionsProvider,{actions,children:createElement(PreflightReportContent,{presentation:"settings",preflight:{state:"completed",report:served,checks:[check]},protectedSettings:FIXTURE_EDITABLE_SETTINGS.protectedSettings,onRerun(){}})})}));});
  assert.match(host.textContent??"",/UCPath username and password are missing/u);
  assert.match(host.textContent??"",/Affected: UCPath · CRM/u);
  assert.doesNotMatch(host.textContent??"",/UCPath credentials are configured/u);
  const configure=[...host.querySelectorAll("button")].find(button=>button.textContent==="Configure credentials");
  assert.ok(configure);await act(async()=>configure.click());assert.equal(destination,"credentials");
  assert.doesNotMatch(host.textContent??"",/Technical details|ucpathUserId|ucpathPassword|system.ucpath.prod|Remedy:|configure protected Settings/u);
  assert.equal(host.querySelector(".diagnostic-technical-content"),null);
});

it("Settings keeps unknown credential presence unknown while retaining blocked verdict",async()=>{
  const served=await report();
  const check={id:PreflightCheckIdSchema.parse("secrets.ucpath-sso"),label:"secrets.ucpath-sso",verdict:"fail" as const,
    detail:"presence unavailable",blocks:["system.ucpath.prod"],remediation:"review protected Settings",checkedAt:served.checkedAt};
  const actions={actorId:"local-operator",descriptorFingerprint:served.descriptorFingerprint,showSettings(){},showSessions(){}};
  const client={preflightScopes:()=>Promise.resolve([])} as unknown as DashboardClient;
  host=document.createElement("div");document.body.append(host);
  await act(async()=>{root=createRoot(host as HTMLElement);root.render(createElement(DashboardClientProvider,{client,children:createElement(PreflightActionsProvider,{actions,children:createElement(PreflightReportContent,{presentation:"settings",preflight:{state:"completed",report:served,checks:[check]},protectedSettings:{state:"unknown",rows:FIXTURE_EDITABLE_SETTINGS.protectedSettings.rows,reason:"credential-store-unavailable"},onRerun(){}})})}));});
  assert.match(host.textContent??"",/Credential presence could not be verified/u);
  assert.doesNotMatch(host.textContent??"",/username and password are missing/u);
  assert.match(host.textContent??"",/Blocked/u);
});

it("Settings labels the last completed report as historical without current-ready status",async()=>{
  const served=await report();
  const projected=projectPreflight({state:"unavailable",reason:"Settings changed; re-check readiness.",lastCompleted:served},now.valueOf()+60_000);
  assert.equal(projected.state,"historical");
  const client={preflightScopes:()=>Promise.resolve([])} as unknown as DashboardClient;
  const actions={actorId:"local-operator",descriptorFingerprint:served.descriptorFingerprint,showSettings(){},showSessions(){}};
  host=document.createElement("div");document.body.append(host);
  await act(async()=>{root=createRoot(host as HTMLElement);root.render(createElement(DashboardClientProvider,{client,children:createElement(PreflightActionsProvider,{actions,children:createElement(PreflightReportContent,{presentation:"settings",preflight:projected,onRerun(){}})})}));});
  assert.match(host.textContent??"",/Previous result/u);
  assert.match(host.textContent??"",/Previous check/u);
  assert.match(host.textContent??"",/Run preflight for current readiness/u);
  assert.doesNotMatch(host.textContent??"",/Ready to run|Technical details|Scope details/u);
  assert.equal(host.querySelectorAll("time").length,1);
  assert.equal(host.querySelector("time")?.getAttribute("datetime"),served.checkedAt);
});

it("Settings directs missing SharePoint roster configuration to Routes",async()=>{
  const served=await report();let destination:string|undefined;
  const check={id:PreflightCheckIdSchema.parse("secrets.sharepoint-roster"),label:"secrets.sharepoint-roster",verdict:"fail" as const,
    detail:"missing roster",blocks:["system.sharepoint.prod"],checkedAt:served.checkedAt};
  const actions={actorId:"local-operator",descriptorFingerprint:served.descriptorFingerprint,
    showSettings(section?:"storage"|"credentials"|"routes"){destination=section;},showSessions(){}};
  const client={preflightScopes:()=>Promise.resolve([])} as unknown as DashboardClient;
  host=document.createElement("div");document.body.append(host);
  await act(async()=>{root=createRoot(host as HTMLElement);root.render(createElement(DashboardClientProvider,{client,children:createElement(PreflightActionsProvider,{actions,children:createElement(PreflightReportContent,{presentation:"settings",preflight:{state:"completed",report:served,checks:[check]},protectedSettings:FIXTURE_EDITABLE_SETTINGS.protectedSettings,onRerun(){}})})}));});
  const configure=[...host.querySelectorAll("button")].find(button=>button.textContent==="Configure SharePoint route");
  assert.ok(configure);await act(async()=>configure.click());assert.equal(destination,"routes");
});

it("keeps independent workflow operations when readiness cannot be read", async () => {
  const client = { preflightScopes: () => Promise.resolve([]), settingsFacts: () => Promise.resolve(FIXTURE_SETTINGS_FACTS) } as unknown as DashboardClient;
  host = document.createElement("div"); document.body.append(host);
  const actions = { actorId: "local-operator", descriptorFingerprint: "a".repeat(64), showSettings() {}, showSessions() {} };
  await act(async () => {
    root = createRoot(host!);
    root.render(createElement(DashboardClientProvider, { client, children: createElement(PreflightActionsProvider, { actions, children: createElement(PreflightReportContent, {
      presentation: "settings", preflight: { state: "refused", message: "Readiness unavailable" }, onRerun() {}, workflowLabels: new Map([["person-lookup", "Person lookup"]]),
    }) }) }));
  });
  assert.match(host.textContent ?? "", /Readiness unavailable/);
  assert.match(host.textContent ?? "", /Workflow readiness/);
  assert.ok(host.querySelector(".workflow-operations-card"));
  assert.match(host.textContent ?? "", /Supported operations/);
  assert.equal(host.querySelector('[aria-label="Loading readiness checks"]'), null);
});

import { FIXTURE_SETTINGS_FACTS } from "../../../../parity/helpers/fixture-settings.js";

it("does not claim an empty readiness group before any report has been observed", async () => {
  const client = { preflightScopes: () => Promise.resolve([]) } as unknown as DashboardClient;
  host = document.createElement("div"); document.body.append(host);
  await act(async () => {
    root = createRoot(host!);
    root.render(createElement(DashboardClientProvider, { client, children: createElement(PreflightActionsProvider, { actions: { actorId: "local-operator", descriptorFingerprint: "a".repeat(64), showSettings() {}, showSessions() {} }, children: createElement(PreflightReportContent, {
      presentation: "settings", preflight: { state: "idle" }, onRerun() {},
    }) }) }));
  });
  assert.doesNotMatch(host.textContent ?? "", /No checks were returned|Not checked/);
  assert.equal(host.querySelector('[data-slot="skeleton"]'), null);
});
