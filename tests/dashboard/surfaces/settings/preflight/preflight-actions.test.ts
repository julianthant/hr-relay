// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,it,vi } from "vitest";
import { PreflightActionsProvider } from "../../../../../src/dashboard/surfaces/settings/preflight/preflight-actions.js";
import { usePreflightActions } from "../../../../../src/dashboard/surfaces/settings/preflight/preflight-actions-model.js";

Reflect.set(globalThis,"IS_REACT_ACT_ENVIRONMENT",true);
let root:Root|undefined, host:HTMLElement|undefined;
afterEach(()=>{if(root!==undefined)act(()=>root?.unmount());host?.remove();root=undefined;host=undefined;vi.useRealTimers();});
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
