// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,it,vi } from "vitest";
import type { DashboardClient } from "../../../../../src/dashboard/client/index.js";
import { DashboardClientProvider } from "../../../../../src/dashboard/state/client-context.js";
import { PreflightActionsProvider } from "../../../../../src/dashboard/surfaces/settings/preflight/preflight-actions.js";
import { PreflightReportContent } from "../../../../../src/dashboard/surfaces/settings/preflight/settings-preflight.js";
import { PreflightCheckIdSchema } from "../../../../../src/models/preflight/preflight-contract.js";
import { FingerprintSchema } from "../../../../../src/rules/identity/ids.js";
import { manualClock } from "../../../../../src/rules/time/clock.js";
import { FIXTURE_EDITABLE_SETTINGS } from "../../../../parity/helpers/fixture-settings.js";
import { createPreflightHarness } from "../../../../support/fixtures/preflight-seams.js";

import { usePreflightActions } from "../../../../../src/dashboard/surfaces/settings/preflight/preflight-actions-model.js";

Reflect.set(globalThis,"IS_REACT_ACT_ENVIRONMENT",true);
const now = new Date("2026-09-19T12:00:00.000Z");
let root:Root|undefined, host:HTMLElement|undefined;
afterEach(()=>{if(root!==undefined)act(()=>root?.unmount());host?.remove();root=undefined;host=undefined;vi.useRealTimers();});
async function report() {
  return {...await createPreflightHarness(manualClock(now), FIXTURE_EDITABLE_SETTINGS.activeConfigFingerprint).authority.refresh(new AbortController().signal), descriptorFingerprint: FingerprintSchema.parse("b".repeat(64))};
}
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

for (const presentation of ["compact", "settings"] as const) it(`${presentation} credential and route remedies use the same exact destinations`, async () => {
  const served = await report(); const destinations: string[] = [];
  const checks = ["secrets.ucpath-sso", "secrets.timekeeper", "secrets.sharepoint-roster"].map(id => ({
    id: PreflightCheckIdSchema.parse(id), label: id, verdict: "fail" as const,
    detail: "Synthetic credential unavailable", blocks: ["executor.run"], remediation: "Review configuration", checkedAt: served.checkedAt,
  }));
  const actions = { actorId: "local-operator", descriptorFingerprint: served.descriptorFingerprint,
    showSettings(section?: "storage" | "credentials" | "routes") { destinations.push(section ?? "settings"); }, showSessions() { throw new Error("wrong remedy"); } };
  const client = { preflightScopes: () => Promise.resolve([]) } as unknown as DashboardClient;
  host = document.createElement("div"); document.body.append(host);
  await act(async () => { root = createRoot(host as HTMLElement); root.render(createElement(DashboardClientProvider, { client,
    children: createElement(PreflightActionsProvider, { actions, children: createElement(PreflightReportContent, {
      presentation, preflight: { state: "completed", report: served, checks }, onRerun() { throw new Error("unexpected command"); },
    }) }) })); });
  assert.deepEqual(destinations, []);
  const remedies = [...host.querySelectorAll("button")].filter(button => button.textContent?.startsWith("Configure "));
  assert.equal(remedies.length, 3);
  for (const button of remedies) await act(async () => button.click());
  assert.deepEqual(destinations, ["credentials", "credentials", "routes"]);
});

it("a replaced remedy owner fences stale callbacks without running any repair", async () => {
  const destinations: string[] = [];
  let selected: ReturnType<typeof usePreflightActions> | undefined;
  function Probe() { selected = usePreflightActions(); return null; }
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  const render = async (actorId: string) => { await act(async () => root?.render(createElement(PreflightActionsProvider, {
    actions: { actorId, descriptorFingerprint: "a".repeat(64), showSettings: section => destinations.push(`${actorId}:${section}`), showSessions: () => destinations.push(`${actorId}:sessions`) }, children: createElement(Probe),
  }))); };
  await render("first"); const stale = selected;
  await render("second");
  stale?.showSettings("storage"); stale?.showSessions();
  assert.deepEqual(destinations, []);
  selected?.showSettings("credentials"); selected?.showSessions();
  assert.deepEqual(destinations, ["second:credentials", "second:sessions"]);
});
