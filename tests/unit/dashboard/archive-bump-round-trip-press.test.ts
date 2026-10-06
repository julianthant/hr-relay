// @vitest-environment jsdom
/** Actual current Archive controls: successful apply, refresh, stale replies and route ownership. */
import assert from "node:assert/strict";
import { act,createElement,useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach,beforeEach,it,vi } from "vitest";
import { ArchiveWorkspace } from "../../../src/dashboard/surfaces/archive/archive.js";
import { RuntimeArchiveWorkspace } from "../../../src/dashboard/surfaces/archive/archive-runtime.js";
import { DashboardClientProvider } from "../../../src/dashboard/state/client-context.js";
import type { DashboardClient } from "../../../src/dashboard/client/index.js";
import { SavedRuntimeVersionIndexWireSchema,SavedVersionIndexWireSchema,type SavedRuntimeVersionIndexWire,type SavedVersionIndexWire } from "../../../src/domain/dashboard/archive.js";
import { planRuntimeVersionTransition,RuntimeVersionScopeSchema,type RuntimeVersionScope } from "../../../src/domain/archive/runtime-version.js";
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
beforeEach(()=>vi.stubGlobal("ResizeObserver",class { observe() {} unobserve() {} disconnect() {} }));
afterEach(async()=>{await dispose?.();dispose=undefined;document.body.replaceChildren();vi.unstubAllGlobals();});
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
  function Route(){const [view,setView]=useState<"runs"|"versions">("runs"),[selection,setSelection]=useState("");return createElement(DashboardClientProvider,{client:strictClient,children:createElement(ArchiveWorkspace,{view,selection,actorId:"local-operator",onView:setView,onSelection:setSelection})});}
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

const RUNTIME_WORKFLOWS = [
  {workflowId:"person-lookup",label:"Workflow A",version:{major:1,minor:2}},
  {workflowId:"other-workflow",label:"Workflow B",version:{major:1,minor:7}},
  {workflowId:"third-workflow",label:"Workflow C",version:{major:1,minor:4}},
] as const;
const RUNTIME_BEFORE = SavedRuntimeVersionIndexWireSchema.parse({revision:7,dashboard:{major:1,minor:0},workflows:RUNTIME_WORKFLOWS,changes:[]});
const RUNTIME_RUN_A="00000000-0000-4000-8000-000000000091";
const RUNTIME_RUN_B="00000000-0000-4000-8000-000000000092";
const RUNTIME_RUN_C="00000000-0000-4000-8000-000000000093";
const RUN_MEMBERS = [
  {runId:RUNTIME_RUN_A,workflowId:"person-lookup",recordVersion:1,attribution:"stamped" as const,state:"terminal"},
  {runId:RUNTIME_RUN_B,workflowId:"other-workflow",recordVersion:1,attribution:"stamped" as const,state:"queued"},
  {runId:RUNTIME_RUN_C,workflowId:"third-workflow",recordVersion:1,attribution:"stamped" as const,state:"running"},
];
function runtimeReview(index:SavedRuntimeVersionIndexWire,commandId:string,scope:RuntimeVersionScope) {
  const before={dashboard:index.dashboard,workflows:index.workflows.map(({workflowId,version})=>({workflowId,version}))};
  const after=planRuntimeVersionTransition(before,scope).after;
  const members=scope.kind==="dashboard"?RUN_MEMBERS:RUN_MEMBERS.filter(row=>scope.workflowIds.some(id=>id===row.workflowId));
  return SavedRuntimeVersionIndexWireSchema.parse({...index,changes:[...index.changes,{
    changeId:commandId,actorId:"local-operator",reviewedAt:"2026-09-27T12:00:00.000Z",reviewFingerprint:"d".repeat(64),scope,before,after,
    state:"planned",members,completedRunIds:[],
  }]});
}
const runtimeText=()=>document.body.textContent??"";
const runtimeButtons=()=>[...document.querySelectorAll("button")];
async function runtimePress(label:string){
  const matches=runtimeButtons().filter(button=>button.textContent?.trim()===label);assert.equal(matches.length,1,`${label}: ${runtimeButtons().map(button=>button.textContent).join(", ")}`);
  await act(async()=>{matches[0].click();await Promise.resolve();await Promise.resolve();});
}
function versionRow(label:string, before:string, after:string) {
  const row=[...document.querySelectorAll('[aria-label="Version changes"] tbody tr')].find(node=>node.querySelector('th')?.textContent===label);
  assert.ok(row,`version row ${label} exists`);
  const cells=[...row.querySelectorAll('td')];
  assert.equal(cells[0].textContent,before);
  assert.equal(cells[1].firstChild?.textContent,after);
}
async function flushRuntime(){await act(async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();});}
async function checkbox(label:string){
  if (![...document.querySelectorAll("label")].some(node=>node.textContent?.startsWith(`${label.split(" · ")[0]} · `))) {
    const trigger=[...document.querySelectorAll("button")].find(node=>node.getAttribute("aria-label")==="Workflow to bump");
    assert.ok(trigger,"workflow picker exists");
    await act(async()=>{trigger.click();await Promise.resolve();});
  }
  const copy=[...document.querySelectorAll("label")].find(node=>node.textContent?.startsWith(`${label.split(" · ")[0]} · `));
  const control=copy?.previousElementSibling;
  assert.ok(control instanceof HTMLButtonElement,`checkbox ${label} exists`);
  return control;
}
async function toggleRuntimeCheckbox(label:string){const control=await checkbox(label);await act(async()=>control.click());}
async function mountRuntime(options:{
  index?:SavedRuntimeVersionIndexWire;
  contextRunId?:string;
  contextWorkflowId?:string;
  contextReport?:unknown;
  read?:()=>Promise<SavedRuntimeVersionIndexWire>;
  execute?:(request:unknown)=>Promise<unknown>;
}={}){
  let index=options.index??RUNTIME_BEFORE;
  const commands:unknown[]=[];
  let reads=0;
  const client={
    savedRuntimeVersions:async()=>{reads++;return options.read===undefined?index:options.read();},
    savedArchiveGroups:async()=>({groups:[]}),
    savedArchiveIndex:async()=>({items:[],next:null}),
    savedArchiveReport:async()=>options.contextReport??null,
    executeCommand:async(request:unknown)=>{
      const command=CommandRequestSchema.parse(request);commands.push(command);
      if(options.execute!==undefined)return options.execute(command);
      if(command.type==="plan-runtime-version")index=runtimeReview(index,command.commandId,command.target.scope);
      else if(command.type==="apply-runtime-version"){
        const {applyingChangeId:_applyingChangeId,...current}=index;
        index=SavedRuntimeVersionIndexWireSchema.parse({...current,revision:index.revision+1,changes:index.changes.map(change=>change.changeId===command.target.changeId?{...change,state:"applied",completedRunIds:change.members.filter(member=>member.state==="terminal").map(member=>member.runId)}:change)});
      }
      return CommandResultSchema.parse({state:"applied",commandId:command.commandId,affectedTargets:[{family:"version-archive",versionPlanId:command.type==="apply-runtime-version"?command.target.changeId:command.commandId}]});
    },
  };
  const strictClient=new Proxy(client,{get(target,key){if(!(key in target))throw new Error(`Unexpected client call ${String(key)}`);return Reflect.get(target,key) as unknown;}}) as unknown as DashboardClient;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);dispose=async()=>{await act(async()=>root.unmount());};
  const folder=options.contextWorkflowId===undefined?null:{dashboardKey:"1.0",workflow:options.contextWorkflowId};
  await act(async()=>{root.render(createElement(DashboardClientProvider,{client:strictClient,children:createElement(RuntimeArchiveWorkspace,{view:"versions",selection:options.contextRunId??"",folder,actorId:"local-operator",onSelection:()=>undefined,onView:()=>undefined,onFolder:()=>undefined})}));await Promise.resolve();await Promise.resolve();});
  return {commands,reads:()=>reads,refreshIndex:(next:SavedRuntimeVersionIndexWire)=>{index=next;},host};
}

it("defaults to the selected report's eligible workflow and plans each served selection",async()=>{
  const report={...H_REPORT,workflow:"other-workflow"};
  const h=await mountRuntime({contextRunId:H_REPORT.runId,contextReport:report});
  await flushRuntime();
  assert.equal((await checkbox("Workflow B · 1.7 → 1.8")).getAttribute("aria-checked"),"true");
  assert.equal((await checkbox("Workflow A · 1.2 → 1.3")).getAttribute("aria-checked"),"false");
  await runtimePress("Review change");await flushRuntime();
  const first=CommandRequestSchema.parse(h.commands[0]);assert.equal(first.type,"plan-runtime-version");if(first.type!=="plan-runtime-version")throw new Error("wrong runtime plan");
  assert.deepEqual(first.target.scope,{kind:"workflows",workflowIds:["other-workflow"]});
  versionRow("Dashboard","1.0","1.0");versionRow("Workflow B","1.7","1.8");
  assert.match(runtimeText(),/Blocked by 1 active or pending run/u);
  assert.equal([...document.querySelectorAll('[aria-label="Version changes"] tbody th')].some(node=>node.textContent==="Workflow A"),false);
  await runtimePress("Back");
  await toggleRuntimeCheckbox("Workflow B · 1.7 → 1.8");
  await flushRuntime();
  await toggleRuntimeCheckbox("Workflow A · 1.2 → 1.3");
  await flushRuntime();await runtimePress("Review change");await flushRuntime();
  const second=CommandRequestSchema.parse(h.commands[1]);assert.equal(second.type,"plan-runtime-version");if(second.type!=="plan-runtime-version")throw new Error("wrong runtime plan");
  assert.deepEqual(second.target.scope,{kind:"workflows",workflowIds:["person-lookup"]});
  versionRow("Workflow A","1.2","1.3");
  assert.equal(runtimeButtons().filter(button=>button.textContent==="Apply reviewed change").length,1);
  assert.equal(document.querySelector("details details button"),null, "older blocked review cannot apply");
  assert.equal(h.reads()>=3,true);
});

it("uses the route-addressable folder workflow before any generic default",async()=>{
  const h=await mountRuntime({contextWorkflowId:"other-workflow"});
  await flushRuntime();

  assert.equal((await checkbox("Workflow B · 1.7 → 1.8")).getAttribute("aria-checked"),"true");
  assert.equal((await checkbox("Workflow A · 1.2 → 1.3")).getAttribute("aria-checked"),"false");
  await runtimePress("Review change");await flushRuntime();
  const command=CommandRequestSchema.parse(h.commands[0]);assert.equal(command.type,"plan-runtime-version");if(command.type!=="plan-runtime-version")throw new Error("wrong runtime plan");
  assert.deepEqual(command.target.scope,{kind:"workflows",workflowIds:["other-workflow"]});
});

it("refuses a retired route folder until an operator chooses a registered workflow",async()=>{
  const h=await mountRuntime({contextWorkflowId:"retired-workflow"});
  await flushRuntime();

  assert.match(document.querySelector('[role="alert"]')?.textContent??"",/not replaced with another workflow/u);
  assert.equal(h.commands.length,0);
  await runtimePress("Choose a registered workflow");await flushRuntime();
  assert.equal((await checkbox("Workflow A · 1.2 → 1.3")).getAttribute("aria-checked"),"false");
  await toggleRuntimeCheckbox("Workflow C · 1.4 → 1.5");await flushRuntime();
  await runtimePress("Review change");await flushRuntime();
  const command=CommandRequestSchema.parse(h.commands[0]);assert.equal(command.type,"plan-runtime-version");if(command.type!=="plan-runtime-version")throw new Error("wrong runtime plan");
  assert.deepEqual(command.target.scope,{kind:"workflows",workflowIds:["third-workflow"]});
});

it("keeps multi-workflow minor selection and maps all registered workflows to the major action",async()=>{
  const h=await mountRuntime();
  await toggleRuntimeCheckbox("Workflow B · 1.7 → 1.8");
  await flushRuntime();await runtimePress("Review change");await flushRuntime();
  const pair=CommandRequestSchema.parse(h.commands[0]);assert.equal(pair.type,"plan-runtime-version");if(pair.type!=="plan-runtime-version")throw new Error("wrong runtime plan");
  assert.deepEqual(pair.target.scope,{kind:"workflows",workflowIds:["other-workflow","person-lookup"]});
  await runtimePress("Back");
  await toggleRuntimeCheckbox("Workflow C · 1.4 → 1.5");
  await flushRuntime();await runtimePress("Review change");await flushRuntime();
  const all=CommandRequestSchema.parse(h.commands[1]);assert.equal(all.type,"plan-runtime-version");if(all.type!=="plan-runtime-version")throw new Error("wrong runtime plan");
  assert.deepEqual(all.target.scope,{kind:"dashboard"});
  versionRow("Dashboard","1.0","2.0");
  for(const [label,before] of [["Workflow A","1.2"],["Workflow B","1.7"],["Workflow C","1.4"]])versionRow(label,before,"2.0");
});

it("maps a sole registered workflow to the all-workflow major action",async()=>{
  const only=SavedRuntimeVersionIndexWireSchema.parse({...RUNTIME_BEFORE,workflows:RUNTIME_WORKFLOWS.slice(0,1)});
  const h=await mountRuntime({index:only});
  assert.match(runtimeText(),/All workflow versions advance together/u);
  await runtimePress("Review change");
  const command=CommandRequestSchema.parse(h.commands[0]);assert.equal(command.type,"plan-runtime-version");if(command.type!=="plan-runtime-version")throw new Error("wrong runtime plan");
  assert.deepEqual(command.target.scope,{kind:"dashboard"});
});

it("shows no eligible workflows and does not offer a version command",async()=>{
  const empty=SavedRuntimeVersionIndexWireSchema.parse({...RUNTIME_BEFORE,workflows:[]});
  await mountRuntime({index:empty});
  assert.match(runtimeText(),/No eligible workflows are registered/u);
  assert.equal(runtimeButtons().find(button=>button.textContent==="Review change")?.disabled,true);
  assert.equal([...document.querySelectorAll<HTMLInputElement>('input[name="archive-bump-scope"]')].every(input=>input.disabled),true);
});

it("shows pending and unavailable served indexes",async()=>{
  let resolve:(value:SavedRuntimeVersionIndexWire)=>void=()=>undefined;
  await mountRuntime({read:()=>new Promise<SavedRuntimeVersionIndexWire>(done=>{resolve=done;})});
  assert.match(runtimeText(),/Loading runtime versions/u);
  await act(async()=>resolve(RUNTIME_BEFORE));await flushRuntime();
  assert.match(runtimeText(),/Workflow A/u);
  await dispose?.();dispose=undefined;document.body.replaceChildren();
  await mountRuntime({read:async()=>{throw new Error("runtime index unavailable");}});
  await act(async()=>Promise.resolve());
  assert.match(document.querySelector('[role="alert"]')?.textContent??"",/runtime index unavailable/u);
});

it("invalidates workflow A when selection moves to blocked workflow B",async()=>{
  const h=await mountRuntime();
  await runtimePress("Review change");await flushRuntime();
  const firstApply=runtimeButtons().find(button=>button.textContent==="Apply reviewed change");assert.ok(firstApply);assert.equal(firstApply.disabled,false);
  await runtimePress("Back");
  await toggleRuntimeCheckbox("Workflow A · 1.2 → 1.3");await flushRuntime();
  await toggleRuntimeCheckbox("Workflow B · 1.7 → 1.8");await flushRuntime();
  const stale=runtimeButtons().find(button=>button.textContent==="Apply reviewed change");assert.equal(stale,undefined);
  assert.match(runtimeText(),/Choose what to update/u);
  assert.equal(document.querySelector('[aria-label="Version changes"]'),null);
  await runtimePress("Review change");await flushRuntime();
  versionRow("Dashboard","1.0","1.0");versionRow("Workflow B","1.7","1.8");
  assert.match(runtimeText(),/Blocked by 1 active or pending run/u);assert.doesNotMatch(runtimeText(),new RegExp(RUNTIME_RUN_C));
  const blocked=runtimeButtons().filter(button=>button.textContent==="Apply reviewed change").find(button=>!button.disabled);
  assert.equal(blocked,undefined);
  assert.equal(runtimeButtons().find(button=>button.textContent==="Review change")?.disabled,false);
  assert.equal(h.commands.filter(value=>CommandRequestSchema.parse(value).type==="apply-runtime-version").length,0);
});

it("holds the review page through command and readback, then Back preserves the draft without apply authority",async()=>{
  const commandReply=Promise.withResolvers<unknown>();
  const readback=Promise.withResolvers<SavedRuntimeVersionIndexWire>();
  let reads=0;
  const h=await mountRuntime({read:()=>++reads===1?Promise.resolve(RUNTIME_BEFORE):readback.promise,execute:()=>commandReply.promise});
  await runtimePress("Review change");
  assert.equal(document.activeElement?.textContent,"Review version change");
  assert.equal(document.querySelector('[aria-label="Version bump scope"]'),null);
  assert.equal(runtimeButtons().find(button=>button.textContent==="Back")?.disabled,true);
  assert.equal(runtimeButtons().some(button=>button.textContent==="Apply reviewed change"),false);
  const request=CommandRequestSchema.parse(h.commands[0]);
  assert.equal(request.type,"plan-runtime-version");if(request.type!=="plan-runtime-version")throw new Error("wrong runtime plan");
  await act(async()=>commandReply.resolve(CommandResultSchema.parse({state:"applied",commandId:request.commandId,affectedTargets:[{family:"version-archive",versionPlanId:request.commandId}]})));
  await flushRuntime();
  assert.equal(reads,2);
  assert.equal(runtimeButtons().find(button=>button.textContent==="Back")?.disabled,true);
  assert.equal(runtimeButtons().some(button=>button.textContent==="Apply reviewed change"),false);
  await act(async()=>readback.resolve(runtimeReview(RUNTIME_BEFORE,request.commandId,request.target.scope)));
  await flushRuntime();
  assert.equal(runtimeButtons().find(button=>button.textContent==="Apply reviewed change")?.disabled,false);
  versionRow("Workflow A","1.2","1.3");
  await runtimePress("Back");
  assert.equal(document.activeElement?.textContent,"Choose what to update");
  assert.equal(runtimeButtons().some(button=>button.textContent==="Apply reviewed change"),false);
  assert.equal((await checkbox("Workflow A")).getAttribute("aria-checked"),"true");
  assert.equal(h.commands.length,1);
});

it("resumes an interrupted transfer with the exact retained request and shows its applied result",async()=>{
  const changeId="00000000-0000-4000-8000-000000000094";
  const original=CommandRequestSchema.parse({commandId:"00000000-0000-4000-8000-000000000095",requestedAt:"2026-09-27T12:01:00.000Z",requestedBy:"local-operator",source:"archive",family:"version-archive",type:"apply-runtime-version",target:{changeId,reviewFingerprint:"d".repeat(64)}});
  assert.equal(original.type,"apply-runtime-version");if(original.type!=="apply-runtime-version")throw new Error("wrong retained request");
  const planned=runtimeReview(RUNTIME_BEFORE,changeId,RuntimeVersionScopeSchema.parse({kind:"workflows",workflowIds:["person-lookup"]}));
  const applying=SavedRuntimeVersionIndexWireSchema.parse({...planned,applyingChangeId:changeId,changes:planned.changes.map(change=>({...change,state:"applying",resumeRequest:original}))});
  const h=await mountRuntime({index:applying});
  await flushRuntime();assert.match(runtimeText(),/Transfer interrupted or still applying/u);
  await runtimePress("Resume version change");await flushRuntime();
  assert.deepEqual(CommandRequestSchema.parse(h.commands[0]),original);
  assert.match(runtimeText(),/Version change applied/u);assert.doesNotMatch(runtimeText(),/1 run was archived/u);
});

it("does not invent a resume request or dispatch twice while recovery is pending",async()=>{
  const changeId="00000000-0000-4000-8000-000000000096";
  const planned=runtimeReview(RUNTIME_BEFORE,changeId,RuntimeVersionScopeSchema.parse({kind:"workflows",workflowIds:["person-lookup"]}));
  const interrupted=SavedRuntimeVersionIndexWireSchema.parse({...planned,applyingChangeId:changeId,changes:planned.changes.map(change=>({...change,state:"applying"}))});
  await mountRuntime({index:interrupted});
  await flushRuntime();
  assert.match(runtimeText(),/The original apply request is unavailable/u);
  assert.equal(runtimeButtons().some(button=>button.textContent==="Resume version change"),false);
  await dispose?.();dispose=undefined;document.body.replaceChildren();

  const original=CommandRequestSchema.parse({commandId:"00000000-0000-4000-8000-000000000097",requestedAt:"2026-09-27T12:02:00.000Z",requestedBy:"local-operator",source:"archive",family:"version-archive",type:"apply-runtime-version",target:{changeId,reviewFingerprint:"d".repeat(64)}});
  let rejectCommand:(error:Error)=>void=()=>undefined;
  const resumed=SavedRuntimeVersionIndexWireSchema.parse({...planned,applyingChangeId:changeId,changes:planned.changes.map(change=>({...change,state:"applying",resumeRequest:original}))});
  const h=await mountRuntime({index:resumed,execute:()=>new Promise((_resolve,reject)=>{rejectCommand=reject;})});
  await flushRuntime();
  const resume=runtimeButtons().find(button=>button.textContent==="Resume version change");assert.ok(resume);
  await act(async()=>{resume.click();resume.click();});
  assert.equal(h.commands.length,1);assert.deepEqual(CommandRequestSchema.parse(h.commands[0]),original);
  await act(async()=>rejectCommand(new Error("synthetic transport failure")));await flushRuntime();
  assert.match(runtimeText(),/synthetic transport failure/u);
});
