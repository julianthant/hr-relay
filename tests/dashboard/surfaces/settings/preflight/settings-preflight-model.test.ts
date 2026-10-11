// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,it,vi } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { PreflightActionsProvider } from "../../../../../src/dashboard/surfaces/settings/preflight/preflight-actions.js";
import { projectPreflight,useSettingsPreflight } from "../../../../../src/dashboard/surfaces/settings/preflight/settings-preflight-model.js";
import { PreflightReportContent } from "../../../../../src/dashboard/surfaces/settings/preflight/settings-preflight.js";
import { preflightVerdict } from "../../../../../src/dashboard/surfaces/shell/preflight-popover-model.js";
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
it("refuses absent, empty, stale and future observations; a fresh served report retains scope, blocks and timestamp",async()=>{
  const served=await report();
  assert.equal(preflightVerdict([]),"unavailable");
  assert.deepEqual(projectPreflight({state:"unavailable",reason:"No current report"},now.valueOf()),{state:"refused",message:"No current report"});
  for(const [candidate,at] of [[{...served,results:[] as typeof served.results},now.valueOf()],[served,now.valueOf()-1]] as const)
    assert.equal(projectPreflight({state:"present",report:candidate},at).state,"refused");
  assert.equal(projectPreflight({state:"present",report:served},now.valueOf()+60_000).state,"historical");
  assert.equal(projectPreflight({state:"unavailable",reason:"Expired",lastCompleted:served},now.valueOf()+60_000).state,"historical");
  const current=projectPreflight({state:"present",report:served},now.valueOf());
  assert.equal(current.state,"completed");if(current.state!=="completed")throw new Error("fresh control refused");
  assert.equal(current.report,served);assert.deepEqual(current.checks.map(check=>check.checkedAt),served.results.map(()=>served.checkedAt));
});
it("pending readiness retains prior evidence without inventing a current verdict or a new historical warning",async()=>{
  const served=await report();
  const refreshing=projectPreflight({state:"running",lastCompleted:served,previous:{state:"present",report:served}},now.valueOf());
  assert.equal(refreshing.state,"refreshing");
  if(refreshing.state!=="refreshing")throw new Error("pending readiness incorrectly projected");
  assert.equal(refreshing.previousMessage,undefined);
  assert.equal(refreshing.report,served);
  assert.equal(refreshing.checks.length,served.results.length);
  const expired=projectPreflight({state:"running",lastCompleted:served,previous:{state:"unavailable",reason:"Expired on server",lastCompleted:served}},now.valueOf()+60_000);
  assert.equal(expired.state,"refreshing");
  if(expired.state!=="refreshing")throw new Error("expired pending evidence dropped");
  assert.equal(expired.previousMessage,"Expired on server");
  assert.equal(projectPreflight({state:"running"},now.valueOf()).state,"running");
  assert.equal(projectPreflight({state:"running",lastCompleted:{...served,results:[]}},now.valueOf()).state,"running");
  assert.equal(projectPreflight({state:"running",lastCompleted:served},now.valueOf()-1).state,"running");
});
for(const presentation of ["settings","compact"] as const)for(const outcome of ["success","failure"] as const)it(`${presentation} refresh keeps report nodes through command and readback ${outcome}`,async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);
  const served=await report();
  const command=Promise.withResolvers<unknown>(),readback=Promise.withResolvers<unknown>();
  let reruns=0,reads=0;
  const client={preflightScopes:()=>Promise.resolve([]),readPreflight:()=>{reads++;return reruns===0?Promise.resolve({state:"present",report:served}):readback.promise;},rerunPreflight:()=>{reruns++;return command.promise;}} as unknown as DashboardClient;
  const actions={actorId:"local-operator",descriptorFingerprint:served.descriptorFingerprint,showSettings(){},showSessions(){}};
  function Subscriber(){const state=useSettingsPreflight({state:"loaded",document:FIXTURE_EDITABLE_SETTINGS},actions);return createElement(PreflightReportContent,{presentation,preflight:state.preflight,onRerun:state.rerunPreflight,protectedSettings:FIXTURE_EDITABLE_SETTINGS.protectedSettings});}
  host=document.createElement("div");document.body.append(host);
  await act(async()=>{root=createRoot(host as HTMLElement);root.render(createElement(DashboardClientProvider,{client,children:createElement(PreflightActionsProvider,{actions,children:createElement(Subscriber)})}));});
  const button=[...host.querySelectorAll("button")].find(candidate=>candidate.textContent==="Run preflight");assert.ok(button);
  const selector=presentation==="settings"?".diagnostic-summary, .diagnostic-check-entry":"time, .settings-preflight-item";
  const retained=[...host.querySelectorAll(selector)];assert.ok(retained.length>1);
  const rowSelector=presentation==="settings"?".diagnostic-check-entry":".settings-preflight-item";
  const copy=[...host.querySelectorAll(rowSelector)].map(row=>row.textContent);
  const assertPending=()=>{
    assert.equal(button.disabled,true);assert.equal(button.getAttribute("aria-busy"),"true");assert.equal(button.textContent,"Run preflight");
    assert.match(host?.textContent??"",/Checking readiness/u);assert.doesNotMatch(host?.textContent??"",/Ready to run|Previous result|Loading readiness/u);
    assert.deepEqual([...host?.querySelectorAll(selector)??[]],retained);
    assert.deepEqual([...host?.querySelectorAll(rowSelector)??[]].map(row=>row.textContent),copy);
    assert.equal(host?.querySelector("time")?.getAttribute("datetime"),served.checkedAt);
  };
  await act(async()=>button.click());assert.equal(reruns,1);assertPending();
  await act(async()=>{command.resolve({});});assert.equal(reads,2);assertPending();
  await act(async()=>{if(outcome==="success")readback.resolve({state:"present",report:served});else readback.reject(new Error("Readback unavailable"));});
  assert.equal(button.disabled,false);assert.notEqual(button.getAttribute("aria-busy"),"true");
  assert.deepEqual([...host.querySelectorAll(selector)],retained);
  if(outcome==="failure"){
    assert.match(host.textContent??"",/Previous result|Readback unavailable/u);
    assert.match(host.textContent??"",/Previous check/u);
    assert.doesNotMatch(host.textContent??"",/Ready to run/u);
  }else assert.doesNotMatch(host.textContent??"",/Previous result|Checking readiness/u);
});
it("Setup and doctor subscribers show the same report and command readback, then expire together",async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);
  const served=await report();let reads=0;let reruns=0;let unavailable=false;
  const client={preflightScopes:()=>Promise.resolve([]),readPreflight:()=>{reads++;return Promise.resolve(unavailable?{state:"unavailable",reason:"Expired on server"}:{state:"present",report:served});},rerunPreflight:()=>{reruns++;return Promise.resolve({});}} as unknown as DashboardClient;
  const actions={actorId:"local-operator",descriptorFingerprint:served.descriptorFingerprint,showSettings(){},showSessions(){}};
  function Subscriber(){const state=useSettingsPreflight({state:"loaded",document:FIXTURE_EDITABLE_SETTINGS},actions);return createElement(PreflightReportContent,{preflight:state.preflight,onRerun:state.rerunPreflight});}
  host=document.createElement("div");document.body.append(host);
  await act(async()=>{root=createRoot(host as HTMLElement);root.render(createElement(DashboardClientProvider,{client,children:createElement(PreflightActionsProvider,{actions,children:[createElement(Subscriber,{key:"setup"}),createElement(Subscriber,{key:"doctor"})]})}));});
  const sections=host.children;assert.equal(sections.length,2);assert.equal(sections[0].textContent,sections[1].textContent);assert.match(host.textContent??"",/Last checked/u);
  const button=[...host.querySelectorAll("button")].find(candidate=>candidate.textContent==="Run preflight");assert.ok(button);await act(async()=>button.click());assert.equal(reruns,1);assert.ok(reads>=3);assert.equal(sections[0].textContent,sections[1].textContent);
  unavailable=true;await act(async()=>{await vi.advanceTimersByTimeAsync(60_000);});
  assert.equal(sections[0].textContent,sections[1].textContent);assert.match(host.textContent??"",/Expired on server/u);assert.equal(host.querySelectorAll("time").length,2);
});
it("restart-required settings refuse without rerunning an obsolete identity",async()=>{
  vi.useFakeTimers();vi.setSystemTime(now);
  let reads=0,reruns=0;
  const client={preflightScopes:()=>Promise.resolve([]),readPreflight:()=>{reads++;return Promise.resolve({state:"unavailable",reason:"Settings restart required"});},rerunPreflight:()=>{reruns++;throw new Error("unexpected rerun");}} as unknown as DashboardClient;
  const documentWithRestart=structuredClone(FIXTURE_EDITABLE_SETTINGS);
  Reflect.set(documentWithRestart,"runtimeStatus",{state:"restart-required"});
  function Subscriber(){const state=useSettingsPreflight({state:"loaded",document:documentWithRestart},{actorId:"local-operator",descriptorFingerprint:"a".repeat(64)});return createElement("button",{onClick:state.rerunPreflight},state.preflight.state==="refused"?state.preflight.message:state.preflight.state);}
  host=document.createElement("div");document.body.append(host);
  await act(async()=>{root=createRoot(host as HTMLElement);root.render(createElement(DashboardClientProvider,{client,children:createElement(Subscriber)}));});
  assert.match(host.textContent??"",/restart required/u);await act(async()=>host?.querySelector("button")?.click());assert.equal(reads,1);assert.equal(reruns,0);
});
