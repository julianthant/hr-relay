// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement,useEffect,useMemo,useState,type ReactNode } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,it,vi } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider, DashboardCommandBindingProvider, useDashboardCommandExecutor } from "../../../../../src/dashboard/state/client-context.js";
import { PreflightActionsProvider } from "../../../../../src/dashboard/surfaces/settings/preflight/preflight-actions.js";
import { projectPreflight,useSettingsPreflight } from "../../../../../src/dashboard/surfaces/settings/preflight/settings-preflight-model.js";
import { PreflightReportContent } from "../../../../../src/dashboard/surfaces/settings/preflight/settings-preflight.js";
import type { EditableSettingsState } from "../../../../../src/dashboard/surfaces/settings/editor/settings-editor-model.js";
import { preflightVerdict } from "../../../../../src/dashboard/surfaces/shell/preflight-popover-model.js";
import { FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { FIXTURE_EDITABLE_SETTINGS } from "../../../../parity/helpers/fixture-settings.js";
import { createPreflightHarness } from "../../../../support/fixtures/preflight-seams.js";

import type { DashboardCommandBinding } from "../../../../../src/dashboard/app/dashboard-app-model.js";
import { FIXTURE_BOOTSTRAP } from "../../../../support/fixtures/dashboard/fixture-bootstrap.js";
import { FIXTURE_DAY_WIRE } from "../../../../support/fixtures/dashboard/fixture-queue.js";
import { ViewNavigationContext } from "../../../../../src/dashboard/app/navigation/view-route-model.js";

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

function Bound({ client, actorId, nowIso, children }: { client: DashboardClient; actorId: string; nowIso: string; children: ReactNode }) {
  const executor = useDashboardCommandExecutor();
  const epoch = useMemo(() => ({ client, actorId, bootstrap: FIXTURE_BOOTSTRAP }), [client, actorId]);
  const dayRequest = useMemo(() => ({}), [epoch]);
  const binding: DashboardCommandBinding = { executor, feedback() {},
    scope: { actorId, client, authority: epoch, dayRequest },
    authority: { epoch, catalog: [], nowIso, today: FIXTURE_DAY_WIRE.day, day: FIXTURE_DAY_WIRE.day,
      dayState: { request: dayRequest, day: { state: "loaded", value: FIXTURE_DAY_WIRE }, connection: { state: "connecting" }, refresh() {} },
      selection: { route: { start: false }, workflowId: "" } } };
  return createElement(DashboardCommandBindingProvider, { binding, children });
}

it("uses served time under browser skew and expires at exactly sixty seconds", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2030-01-01T00:00:00Z"));
  const served = await report(); let latest: ReturnType<typeof useSettingsPreflight> | undefined;
  let sent: unknown;
  const client = { readPreflight: () => Promise.resolve({ state: "present", report: served }), rerunPreflight: (command: unknown) => { sent = command; return Promise.resolve({}); } } as unknown as DashboardClient;
  function Probe() { latest = useSettingsPreflight({ state: "loaded", document: FIXTURE_EDITABLE_SETTINGS }, { actorId: "local-operator", descriptorFingerprint: served.descriptorFingerprint }); return createElement("span", null, latest.preflight.state); }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const render = async (nowIso: string) => { await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(Bound, { client, actorId: "local-operator", nowIso, children: createElement(Probe) }) }))); };
  await render(now.toISOString()); assert.equal(latest?.preflight.state, "completed");
  await act(async () => latest?.rerunPreflight());
  assert.equal(Reflect.get(sent as object, "requestedAt"), now.toISOString());
  await render(new Date(now.valueOf() + 59_999).toISOString()); assert.equal(latest?.preflight.state, "completed");
  await render(new Date(now.valueOf() + 60_000).toISOString()); assert.equal(latest?.preflight.state, "historical");
});

it("refuses an unknown scope and fences old callbacks and late actor A to B to A results", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const served = await report(), pending = Promise.withResolvers<unknown>();
  let reads = 0, reruns = 0, latest: ReturnType<typeof useSettingsPreflight> | undefined;
  const client = { readPreflight: () => { reads++; return pending.promise; }, rerunPreflight: () => { reruns++; return Promise.resolve({}); } } as unknown as DashboardClient;
  let actorId = "local-operator";
  function Probe() { latest = useSettingsPreflight({ state: "loaded", document: FIXTURE_EDITABLE_SETTINGS }, { actorId, descriptorFingerprint: served.descriptorFingerprint }); return createElement("span", null, latest.preflight.state); }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const render = async (actor: string, scope = "dashboard") => { actorId = actor; await act(async () => root?.render(createElement(DashboardClientProvider, { client, children: createElement(Bound, { client, actorId, nowIso: now.toISOString(), children: createElement(ViewNavigationContext.Provider, { value: { view: { preflightScope: scope }, start: false, setStart() {}, update() {} }, children: createElement(Probe) }) }) }))); };
  await render("local-operator"); const obsolete = latest?.rerunPreflight;
  await render("another-operator"); await render("local-operator");
  await act(async () => obsolete?.()); assert.equal(reruns, 0);
  const before = reads; await render("local-operator", "missing-workflow");
  assert.equal(reads, before); assert.equal(latest?.preflight.state, "refused");
  await act(async () => { pending.resolve({ state: "present", report: served }); });
  assert.equal(latest?.preflight.state, "refused");
  await act(async () => latest?.rerunPreflight()); assert.equal(reruns, 0);
});

it("known actor A gets a new request after B and ignores the first A settlement", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const served = await report();
  const pending = Array.from({ length: 3 }, () => Promise.withResolvers<unknown>());
  let reads = 0, actorId = "first", latest: ReturnType<typeof useSettingsPreflight> | undefined;
  const client = { readPreflight: () => pending[reads++].promise } as unknown as DashboardClient;
  function Probe() { latest = useSettingsPreflight({ state: "loaded", document: FIXTURE_EDITABLE_SETTINGS }, { actorId, descriptorFingerprint: served.descriptorFingerprint }); return createElement("span", null, latest.preflight.state); }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const render = async (actor: string) => { actorId = actor; await act(async () => root?.render(createElement(DashboardClientProvider, { client,
    children: createElement(Bound, { client, actorId, nowIso: now.toISOString(), children: createElement(Probe) }) }))); };
  await render("first"); await render("second"); await render("first"); assert.equal(reads, 3);
  await act(async () => pending[0].resolve({ state: "present", report: served }));
  assert.equal(latest?.preflight.state, "running");
  await act(async () => pending[1].resolve({ state: "present", report: served }));
  assert.equal(latest?.preflight.state, "running");
  await act(async () => pending[2].resolve({ state: "present", report: served }));
  assert.equal(latest?.preflight.state, "completed");
});

it("changed-fingerprint server history is visibly historical even inside the freshness window", async () => {
  const served = await report();
  const historical = { ...served, configFingerprint: FingerprintSchema.parse("f".repeat(64)), descriptorFingerprint: FingerprintSchema.parse("e".repeat(64)) };
  const projected = projectPreflight({ state: "unavailable", reason: "Settings changed; re-check readiness.", lastCompleted: historical }, now.valueOf());
  assert.equal(projected.state, "historical");
  if (projected.state !== "historical") assert.fail("changed identity treated as current");
  assert.equal(projected.report, historical);
  assert.equal(projected.message, "Settings changed; re-check readiness.");
});

it("a delayed doctor subscriber joins Setup's selected resource and shares rerun/readback", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const served = await report();
  const settings = Promise.withResolvers<typeof FIXTURE_EDITABLE_SETTINGS>();
  const readback = Promise.withResolvers<unknown>();
  const command = Promise.withResolvers<unknown>();
  let reads = 0, commands = 0;
  let setup: ReturnType<typeof useSettingsPreflight> | undefined, doctor: ReturnType<typeof useSettingsPreflight> | undefined;
  const setupState = () => setup?.preflight;
  const doctorState = () => doctor?.preflight;
  const client = { editableSettings: () => settings.promise,
    readPreflight: () => { reads++; return commands === 0 ? Promise.resolve({ state: "present", report: served }) : readback.promise; },
    rerunPreflight: () => { commands++; return command.promise; } } as unknown as DashboardClient;
  const actions = { actorId: "local-operator", descriptorFingerprint: served.descriptorFingerprint, showSettings() {}, showSessions() {} };
  function Setup() { setup = useSettingsPreflight({ state: "loaded", document: FIXTURE_EDITABLE_SETTINGS }, actions); return null; }
  function Doctor() {
    const [editor, setEditor] = useState<EditableSettingsState>({ state: "loading" });
    useEffect(() => { void settings.promise.then(document => setEditor({ state: "loaded", document })); }, []);
    doctor = useSettingsPreflight(editor, actions);
    return null;
  }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const render = async (open: boolean) => { await act(async () => root?.render(createElement(DashboardClientProvider, { client,
    children: createElement(Bound, { client, actorId: actions.actorId, nowIso: now.toISOString(), children: createElement(PreflightActionsProvider, { actions,
      children: [createElement(Setup, { key: "setup" }), open ? createElement(Doctor, { key: "doctor" }) : null] }) }) }))); };
  await render(false); assert.equal(setupState()?.state, "completed");
  await render(true); assert.equal(setupState()?.state, "completed"); assert.equal(doctorState()?.state, "idle");
  await act(async () => settings.resolve(FIXTURE_EDITABLE_SETTINGS));
  assert.equal(setupState()?.state, "completed"); assert.equal(doctorState()?.state, "completed");
  await act(async () => doctor?.rerunPreflight());
  assert.equal(commands, 1); assert.equal(setupState()?.state, "refreshing"); assert.equal(doctorState()?.state, "refreshing");
  await act(async () => command.resolve({}));
  assert.ok(reads >= 3); assert.equal(setupState()?.state, "refreshing"); assert.equal(doctorState()?.state, "refreshing");
  const refreshed = { ...served, results: served.results.map(check => ({ ...check, summary: "Selected readback" })) };
  await act(async () => readback.resolve({ state: "present", report: refreshed }));
  const setupResult = setupState(), doctorResult = doctorState();
  assert.equal(setupResult?.state, "completed"); assert.equal(doctorResult?.state, "completed");
  if (setupResult?.state !== "completed" || doctorResult?.state !== "completed") assert.fail("shared readback missing");
  assert.equal(setupResult.report, doctorResult.report); assert.equal(setupResult.report, refreshed);
});

it("known scope A after an unknown scope ignores old A's distinct pending response", async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const served = await report();
  const pending = [Promise.withResolvers<unknown>(), Promise.withResolvers<unknown>()];
  let reads = 0, latest: ReturnType<typeof useSettingsPreflight> | undefined;
  const snapshot = () => latest?.preflight;
  const client = { readPreflight: () => pending[reads++].promise } as unknown as DashboardClient;
  const actions = { actorId: "local-operator", descriptorFingerprint: served.descriptorFingerprint };
  function Probe() { latest = useSettingsPreflight({ state: "loaded", document: FIXTURE_EDITABLE_SETTINGS }, actions); return null; }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const render = async (scope: string) => { await act(async () => root?.render(createElement(DashboardClientProvider, { client,
    children: createElement(Bound, { client, actorId: actions.actorId, nowIso: now.toISOString(), children: createElement(ViewNavigationContext.Provider, {
      value: { view: { preflightScope: scope }, start: false, setStart() {}, update() {} }, children: createElement(Probe) }) }) }))); };
  await render("dashboard"); assert.equal(reads, 1);
  await render("missing-workflow"); assert.equal(reads, 1); assert.equal(snapshot()?.state, "refused");
  await render("dashboard"); assert.equal(reads, 2); assert.equal(snapshot()?.state, "running");
  await act(async () => pending[0].resolve({ state: "present", report: served }));
  assert.equal(snapshot()?.state, "running");
  const current = { ...served, results: served.results.map(check => ({ ...check, summary: "Current scope" })) };
  await act(async () => pending[1].resolve({ state: "present", report: current }));
  const observed = snapshot();
  assert.equal(observed?.state, "completed");
  if (observed?.state !== "completed") assert.fail("current scope did not complete");
  assert.equal(observed.report, current);
});
