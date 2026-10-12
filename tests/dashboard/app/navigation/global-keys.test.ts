// @vitest-environment jsdom
import assert_m0 from "node:assert/strict";
import { act as act_m0,createElement as createElement_m0 } from "react";
import { createRoot as createRoot_m0,type Root as Root_m0 } from "react-dom/client";
import { it as it_m0 } from "vitest";
import { useGlobalKeys as useGlobalKeys_m0,type GlobalKeyBindings as GlobalKeyBindings_m0 } from "../../../../src/dashboard/app/navigation/global-keys.js";

import assert_m1 from "node:assert/strict";
import { describe as describe_m1,it as it_m1 } from "vitest";
import { nextAttention as nextAttention_m1,stepSelection as stepSelection_m1 } from "../../../../src/dashboard/app/navigation/global-keys.js";


{

Reflect.set(globalThis,"IS_REACT_ACT_ENVIRONMENT",true);
let root: Root_m0 | undefined;
const _afterEachFixture0 = async () => {await act_m0(async () => root?.unmount());document.body.innerHTML="";};
async function mount() {
  const calls: string[]=[];
  const bindings: GlobalKeyBindings_m0 = {onStartRun:()=>calls.push("run"),onCyclePanelMode:()=>calls.push("cycle"),panelMode:"icon",onMinimisePanel:()=>calls.push("minimise"),visibleRunIds:["one","two"],attentionRunIds:["two"],selectedRunId:"one",onSelectRun:id=>calls.push(id),panelTabs:["logs","receipt"],onTab:tab=>calls.push(tab)};
  function Harness() {useGlobalKeys_m0(bindings);return createElement_m0("select",{"aria-label":"Native choice"},createElement_m0("option",null,"One"));}
  const host=document.createElement("div");document.body.append(host);root=createRoot_m0(host);
  await act_m0(async () => root?.render(createElement_m0(Harness)));
  return calls;
}
function key(target: EventTarget, value: string, prevented=false) {
  const event=new KeyboardEvent("keydown",{key:value,bubbles:true,cancelable:true});
  if(prevented)event.preventDefault();target.dispatchEvent(event);return event;
}
it_m0("native selectors and already-handled keys own their interaction",async()=>{
try {


  const calls=await mount();const select=document.querySelector("select");assert_m0.ok(select);
  key(select,"ArrowDown");key(window,"j",true);assert_m0.deepEqual(calls,[]);
  key(window,"j");assert_m0.deepEqual(calls,["two"]);

} finally {
await _afterEachFixture0();
}
});
it_m0("an open popover or focus in a workflow dialog never moves the hidden queue",async()=>{
try {


  const calls=await mount();const dialog=document.createElement("div");dialog.setAttribute("role","dialog");dialog.setAttribute("data-state","open");document.body.append(dialog);
  key(dialog,"j");key(window,"n");assert_m0.deepEqual(calls,[]);
  dialog.remove();key(window,"n");assert_m0.deepEqual(calls,["two"]);

} finally {
await _afterEachFixture0();
}
});
}

{


describe_m1("stepSelection — the j/k arithmetic", () => {
  const ids = ["a", "b", "c"];

  it_m1("moves one place in each direction", () => {
    assert_m1.equal(stepSelection_m1(ids, "b", "next"), "c");
    assert_m1.equal(stepSelection_m1(ids, "b", "previous"), "a");
  });

  it_m1("CLAMPS at both ends rather than wrapping — the demo's own arithmetic", () => {
    assert_m1.equal(stepSelection_m1(ids, "c", "next"), "c");
    assert_m1.equal(stepSelection_m1(ids, "a", "previous"), "a");
  });

  it_m1("lands on the first row when nothing is selected, in EITHER direction", () => {
    // This is what makes the first keystroke of a session do something. Both
    // arms answer the same row because index -1 clamps to 0 from both sides.
    assert_m1.equal(stepSelection_m1(ids, undefined, "next"), "a");
    assert_m1.equal(stepSelection_m1(ids, undefined, "previous"), "a");
  });

  it_m1("answers nothing on an empty queue instead of an invented id", () => {
    assert_m1.equal(stepSelection_m1([], "a", "next"), undefined);
  });

  it_m1("treats a selection the list no longer holds as no selection", () => {
    // A run whose row left the view (a filter change, a day change) must not
    // freeze the keyboard: the id is simply not in the list, which is -1.
    assert_m1.equal(stepSelection_m1(ids, "gone", "next"), "a");
  });
});

describe_m1("nextAttention — the `n` binding", () => {
  const visible = ["a", "b", "c", "d"];
  const attention = ["b", "d"];

  it_m1("goes to the next attention row AFTER the selection", () => {
    assert_m1.equal(nextAttention_m1(visible, attention, "a"), "b");
    assert_m1.equal(nextAttention_m1(visible, attention, "b"), "d");
  });

  it_m1("WRAPS to the first when the selection is past the last one", () => {
    assert_m1.equal(nextAttention_m1(visible, attention, "d"), "b");
  });

  it_m1("starts at the first when nothing is selected", () => {
    assert_m1.equal(nextAttention_m1(visible, attention, undefined), "b");
  });

  it_m1("answers nothing — never a row that does not need you — when none do", () => {
    assert_m1.equal(nextAttention_m1(visible, [], "a"), undefined);
  });
});
}
