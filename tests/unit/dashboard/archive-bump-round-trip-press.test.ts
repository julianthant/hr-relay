// @vitest-environment jsdom
/** Actual current Archive controls: successful apply, refresh, stale replies and route ownership. */
import assert from "node:assert/strict";
import { act,createElement,useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach,it } from "vitest";
import { ArchiveWorkspace } from "../../../src/dashboard/surfaces/archive.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { SavedVersionIndexWireSchema,type SavedVersionIndexWire } from "../../../src/domain/dashboard/archive.js";
import { CommandRequestSchema,CommandResultSchema } from "../../../src/domain/commands.js";
import { H_REPORT } from "../../parity/helpers/fixture-archive-report.js";
Reflect.set(globalThis,"IS_REACT_ACT_ENVIRONMENT",true);
const PLAN_ID="aa11bb22-0004-4000-8000-aa11bb220004";
const SECOND="aa11bb22-0013-4000-8000-aa11bb220013";
const BEFORE=SavedVersionIndexWireSchema.parse({appVersion:"0.1.0",workflows:[{workflow:"person-lookup",label:"Person lookup",version:2,fingerprint:"b".repeat(64)}],historicalChanges:0,changes:[{
  changeId:PLAN_ID,state:"planned",targetVersion:"2.0.0",change:{kind:"major",what:"Reviewed workflow change",why:"Retain earlier results",commit:{state:"absent",reason:"Synthetic review"}},reviewFingerprint:"c".repeat(64),scope:{kind:"workflows",workflowIds:["person-lookup"]},memberRunIds:[H_REPORT.runId,SECOND],blockerRunIds:[],completedRunIds:[],
}]});
const AFTER=SavedVersionIndexWireSchema.parse({...BEFORE,changes:BEFORE.changes.map(change=>({...change,state:"applied",completedRunIds:change.memberRunIds}))});
let dispose:(()=>Promise<void>)|undefined;
afterEach(async()=>{await dispose?.();dispose=undefined;document.body.replaceChildren();});
const text=()=>document.body.textContent??"";
const buttons=()=>[...document.querySelectorAll("button")];
async function press(label:string) {
  const matches=buttons().filter(button=>button.textContent?.trim()===label);assert.equal(matches.length,1,`${label}: ${buttons().map(button=>button.textContent).join(", ")}`);
  await act(async()=>{matches[0].click();});
}
function titleField(){const label=[...document.querySelectorAll("label")].find(row=>row.textContent==="Title");const field=label?.querySelector("input");assert.ok(field);return field;}
async function mount(versions:SavedVersionIndexWire[]= [BEFORE,AFTER]) {
  const commands:unknown[]=[],queries:unknown[]=[];let reads=0,hold=false,release:(()=>void)|undefined;
  const client={
    savedArchiveIndex:async(query:unknown)=>{queries.push(query);return {items:[H_REPORT,{...H_REPORT,runId:SECOND,title:"Second retained report"}],next:null};},
    savedArchiveVersions:async()=>{if(hold){hold=false;await new Promise<void>(resolve=>{release=resolve;});}const result=versions[Math.min(reads,versions.length-1)];reads++;return result;},
    executeCommand:async(request:unknown)=>{commands.push(request);return CommandResultSchema.parse({state:"applied",commandId:CommandRequestSchema.parse(request).commandId,affectedTargets:[{family:"version-archive",versionPlanId:PLAN_ID}]});},
  };
  const strictClient=new Proxy(client,{get(target,key){if(!(key in target))throw new Error(`Unexpected client call ${String(key)}`);return Reflect.get(target,key) as unknown;}}) as unknown as DashboardClient;
  function Route(){const [view,setView]=useState<"runs"|"versions">("runs"),[selection,setSelection]=useState("");return createElement(DashboardClientProvider,{client:strictClient,children:createElement(ArchiveWorkspace,{view,selection,actorId:"local-operator",onView:setView,onSelection:setSelection,onClose:()=>undefined})});}
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);dispose=async()=>{await act(async()=>root.unmount());};
  await act(async()=>root.render(createElement(Route)));
  return {commands,queries,reads:()=>reads,holdNextRead:()=>{hold=true;},release:async()=>{assert.ok(release);await act(async()=>release?.());}};
}
it("keeps the applied message and archive door after the authoritative version reread",async()=>{
  const h=await mount();await press("Versions & bumps");await press("Apply reviewed change");
  assert.equal(h.commands.length,1);assert.equal(h.reads(),2);assert.match(text(),/Version change saved/u);assert.match(text(),/2 reviewed runs · 2 archived/u);assert.ok(buttons().some(button=>button.textContent==="Open the archive"));
  const request=CommandRequestSchema.parse(h.commands[0]);assert.equal(request.type,"apply-version-bump");if(request.type!=="apply-version-bump")throw new Error("wrong command");assert.deepEqual(request.target,{versionPlanId:PLAN_ID,expectedVersion:1});assert.equal(request.payload.planFingerprint,BEFORE.changes[0].reviewFingerprint);
});
it("opens saved reports with the standing title filter cleared",async()=>{
  const h=await mount();const field=titleField();await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")?.set?.call(field,"zzz-matches-nothing");field.dispatchEvent(new Event("input",{bubbles:true}));});assert.equal(titleField().value,"zzz-matches-nothing");
  await press("Versions & bumps");await press("Apply reviewed change");await press("Open the archive");assert.equal(titleField().value,"");assert.deepEqual(h.queries.at(-1),{limit:50});assert.match(text(),/Second retained report/u);
});
it("never offers a completed apply again during refresh or after a stale planned reply",async()=>{
  const h=await mount([BEFORE,BEFORE]);await press("Versions & bumps");h.holdNextRead();await press("Apply reviewed change");assert.equal(h.reads(),1);assert.match(text(),/Version change saved/u);assert.ok(!buttons().some(button=>button.textContent==="Apply reviewed change"));await h.release();assert.equal(h.reads(),2);assert.ok(!buttons().some(button=>button.textContent==="Apply reviewed change"));assert.equal(h.commands.length,1);
});
it("clears transient apply feedback when leaving its owning view",async()=>{
  const h=await mount();await press("Versions & bumps");await press("Apply reviewed change");assert.match(text(),/Version change saved/u);await press("Saved reports");await press("Versions & bumps");assert.doesNotMatch(text(),/Version change saved/u);assert.equal(h.commands.length,1);assert.match(text(),/2 reviewed runs · 2 archived/u);
});
