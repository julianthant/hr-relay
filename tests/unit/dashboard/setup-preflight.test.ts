// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { FingerprintSchema } from "../../../src/domain/ids.js";
import { PreflightCheckIdSchema } from "../../../src/domain/preflight-contract.js";
import { manualClock } from "../../../src/domain/clock.js";
import { createPreflightHarness } from "../../fixtures/preflight-seams.js";
import { FIXTURE_EDITABLE_SETTINGS } from "../../parity/helpers/fixture-settings.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import { PreflightActionsProvider } from "../../../src/dashboard/state/preflight-actions.js";
import { projectPreflight, useSettingsPreflight } from "../../../src/dashboard/surfaces/settings-preflight-model.js";
import { preflightVerdict } from "../../../src/dashboard/surfaces/preflight-popover-model.js";
import { PreflightReportContent } from "../../../src/dashboard/surfaces/settings-preflight.js";

Reflect.set(globalThis,"IS_REACT_ACT_ENVIRONMENT",true);
const now = new Date("2026-09-19T12:00:00.000Z");
let root:Root|undefined, host:HTMLElement|undefined;
afterEach(()=>{if(root!==undefined)act(()=>root?.unmount());host?.remove();root=undefined;host=undefined;vi.useRealTimers();});
async function report() {
  return {...await createPreflightHarness(manualClock(now), FIXTURE_EDITABLE_SETTINGS.activeConfigFingerprint).authority.refresh(new AbortController().signal), descriptorFingerprint: FingerprintSchema.parse("b".repeat(64))};
}
it("refuses absent, empty, stale and future observations; a fresh served report retains scope, blocks and timestamp",async()=>{
  const served=await report();
  assert.equal(preflightVerdict([]),"unavailable");
  assert.deepEqual(projectPreflight({state:"unavailable",reason:"No current report"},now.valueOf()),{state:"refused",message:"No current report"});
  for(const [candidate,at] of [[{...served,results:[] as typeof served.results},now.valueOf()],[served,now.valueOf()+60_000],[served,now.valueOf()-1]] as const)
    assert.equal(projectPreflight({state:"present",report:candidate},at).state,"refused");
  const current=projectPreflight({state:"present",report:served},now.valueOf());
  assert.equal(current.state,"completed");if(current.state!=="completed")throw new Error("fresh control refused");
  assert.equal(current.report,served);assert.deepEqual(current.checks.map(check=>check.checkedAt),served.results.map(()=>served.checkedAt));
});
it("Setup and doctor subscribers show the same report and command readback, then expire together",async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);
  const served=await report();let reads=0;let reruns=0;let unavailable=false;
  const client={preflightScopes:()=>Promise.resolve([]),readPreflight:()=>{reads++;return Promise.resolve(unavailable?{state:"unavailable",reason:"Expired on server"}:{state:"present",report:served});},rerunPreflight:()=>{reruns++;return Promise.resolve({});}} as unknown as DashboardClient;
  const actions={actorId:"local-operator",descriptorFingerprint:served.descriptorFingerprint,showSettings(){},showSessions(){}};
  function Subscriber(){const state=useSettingsPreflight({state:"loaded",document:FIXTURE_EDITABLE_SETTINGS},actions);return createElement(PreflightReportContent,{preflight:state.preflight,onRerun:state.rerunPreflight});}
  host=document.createElement("div");document.body.append(host);
  await act(async()=>{root=createRoot(host as HTMLElement);root.render(createElement(DashboardClientProvider,{client,children:createElement(PreflightActionsProvider,{actions,children:[createElement(Subscriber,{key:"setup"}),createElement(Subscriber,{key:"doctor"})]})}));});
  const sections=host.children;assert.equal(sections.length,2);assert.equal(sections[0].textContent,sections[1].textContent);assert.match(host.textContent??"",/Scope: dashboard/u);
  const button=host.querySelector("button");assert.ok(button);await act(async()=>button.click());assert.equal(reruns,1);assert.ok(reads>=3);assert.equal(sections[0].textContent,sections[1].textContent);
  unavailable=true;await act(async()=>{await vi.advanceTimersByTimeAsync(60_000);});
  assert.equal(sections[0].textContent,sections[1].textContent);assert.match(host.textContent??"",/Expired on server/u);assert.equal(host.querySelectorAll("time").length,0);
});
it("restart-required settings refuse without rerunning an obsolete identity",async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);
  let reads=0,reruns=0;
  const client={preflightScopes:()=>Promise.resolve([]),readPreflight:()=>{reads++;throw new Error("unexpected read");},rerunPreflight:()=>{reruns++;throw new Error("unexpected rerun");}} as unknown as DashboardClient;
  const documentWithRestart=structuredClone(FIXTURE_EDITABLE_SETTINGS);
  Reflect.set(documentWithRestart,"runtimeStatus",{state:"restart-required"});
  function Subscriber(){const state=useSettingsPreflight({state:"loaded",document:documentWithRestart},{actorId:"local-operator",descriptorFingerprint:"a".repeat(64)});return createElement("button",{onClick:state.rerunPreflight},state.preflight.state==="refused"?state.preflight.message:state.preflight.state);}
  host=document.createElement("div");document.body.append(host);
  await act(async()=>{root=createRoot(host as HTMLElement);root.render(createElement(DashboardClientProvider,{client,children:createElement(Subscriber)}));});
  assert.match(host.textContent??"",/restart required/u);await act(async()=>host?.querySelector("button")?.click());assert.equal(reads,0);assert.equal(reruns,0);
});
it("remedies navigate to their owner and never repair through rendering",async()=>{
  const served=await report();let storage=0,sessions=0,settings=0;
  const checks=["authority.health","process.orphans","config.valid"].map(id=>({id:PreflightCheckIdSchema.parse(id),label:id,verdict:"fail" as const,detail:"Synthetic dependency unavailable",blocks:["executor.run"],remediation:"Use the existing remedy",checkedAt:served.checkedAt}));
  const actions={actorId:"local-operator",descriptorFingerprint:served.descriptorFingerprint,showSettings(section?:"storage"){if(section==="storage")storage++;else settings++;},showSessions(){sessions++;}};
  const client={preflightScopes:()=>Promise.resolve([])} as unknown as DashboardClient;
  host=document.createElement("div");document.body.append(host);
  await act(async()=>{root=createRoot(host as HTMLElement);root.render(createElement(DashboardClientProvider,{client,children:createElement(PreflightActionsProvider,{actions,children:createElement(PreflightReportContent,{preflight:{state:"completed",report:served,checks},onRerun(){}})})}));});
  assert.equal(storage+sessions+settings,0);for(const button of host.querySelectorAll("button"))if(button.textContent?.startsWith("Open "))await act(async()=>button.click());
  assert.deepEqual([storage,sessions,settings],[1,1,1]);assert.match(host.textContent??"",/Blocks: executor.run/u);
});
