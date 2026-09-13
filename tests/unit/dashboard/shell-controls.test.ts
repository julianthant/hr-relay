// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { useGlobalKeys, type GlobalKeyBindings } from "../../../src/dashboard/app/global-keys.js";
Reflect.set(globalThis,"IS_REACT_ACT_ENVIRONMENT",true);
let root: Root | undefined;
afterEach(async () => {await act(async () => root?.unmount());document.body.innerHTML="";});
async function mount() {
  const calls: string[]=[];
  const bindings: GlobalKeyBindings = {onStartRun:()=>calls.push("run"),onCyclePanelMode:()=>calls.push("cycle"),panelMode:"icon",onMinimisePanel:()=>calls.push("minimise"),visibleRunIds:["one","two"],attentionRunIds:["two"],selectedRunId:"one",onSelectRun:id=>calls.push(id),panelTabs:["logs","receipt"],onTab:tab=>calls.push(tab)};
  function Harness() {useGlobalKeys(bindings);return createElement("select",{"aria-label":"Native choice"},createElement("option",null,"One"));}
  const host=document.createElement("div");document.body.append(host);root=createRoot(host);
  await act(async () => root?.render(createElement(Harness)));
  return calls;
}
function key(target: EventTarget, value: string, prevented=false) {
  const event=new KeyboardEvent("keydown",{key:value,bubbles:true,cancelable:true});
  if(prevented)event.preventDefault();target.dispatchEvent(event);return event;
}
it("native selectors and already-handled keys own their interaction",async()=>{
  const calls=await mount();const select=document.querySelector("select");assert.ok(select);
  key(select,"ArrowDown");key(window,"j",true);assert.deepEqual(calls,[]);
  key(window,"j");assert.deepEqual(calls,["two"]);
});
it("an open popover or focus in a workflow dialog never moves the hidden queue",async()=>{
  const calls=await mount();const dialog=document.createElement("div");dialog.setAttribute("role","dialog");dialog.setAttribute("data-state","open");document.body.append(dialog);
  key(dialog,"j");key(window,"n");assert.deepEqual(calls,[]);
  dialog.remove();key(window,"n");assert.deepEqual(calls,["two"]);
});
