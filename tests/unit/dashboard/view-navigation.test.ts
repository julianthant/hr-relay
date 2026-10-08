// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, vi } from "vitest";
import { ExplorerParts } from "../../../src/dashboard/surfaces/explorer/explorer-parts.js";
import { DEFAULT_COMMENTS, DEFAULT_SCENARIO, type FlowStep } from "../../../src/dashboard/surfaces/explorer/explorer-flow-model.js";
import { parseRoute, routeToSearch } from "../../../src/dashboard/app/navigation/url-state.js";
import { useRoute, type PopstateRouteHandler } from "../../../src/dashboard/app/navigation/route-history-model.js";
import { ViewNavigationProvider } from "../../../src/dashboard/app/navigation/view-navigation.js";
import { parseViewRoute, useViewState, ViewRouteSchema } from "../../../src/dashboard/app/navigation/view-route-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });
function Controls() {
  const [tab, setTab] = useViewState("spreadsheetTab", "registered");
  const [stage, setStage] = useViewState("launchStage", "Input");
  const [query, setQuery] = useViewState("searchQuery", "", "replace");
  const [draft, setDraft] = useState("private employee draft");
  return createElement("div", null,
    createElement("output", null, `${tab}/${stage}/${query}/${draft}`),
    createElement("button", { onClick: () => { setTab("types"); setStage("Options"); } }, "Next"),
    createElement("button", { onClick: () => setQuery("exact run") }, "Find"),
    createElement("button", { onClick: () => setDraft("edited private draft") }, "Edit"));
}
async function mount() {
  function Harness() {
    const handler = useRef<PopstateRouteHandler | undefined>(undefined);
    const [route, setRoute] = useRoute(handler);
    return createElement(ViewNavigationProvider, { route, setRoute, children: createElement(Controls) });
  }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(Harness)));
}
async function click(label: string) { const button = [...document.querySelectorAll("button")].find(node => node.textContent === label); assert.ok(button); await act(async () => button.click()); }
async function move(method: "back" | "forward") {
  await act(async () => { const popped = new Promise<void>(resolve => window.addEventListener("popstate", () => resolve(), { once: true })); window.history[method](); await popped; });
}
describe("view navigation", () => {
  it("round-trips only bounded navigation metadata and refuses corrupt/private payloads", () => {
    const route = { start: true, settings: "spreadsheets", view: ViewRouteSchema.parse({ spreadsheetTab: "types", launchStage: "Confirm", notifications: true, reviewPages: { "record-1": 1 }, launchRerun: { runId: "00000000-0000-4000-8000-000000000001", expectedVersion: 1 }, queueOpen: ["batch-1"] }) };
    assert.deepEqual(parseRoute(routeToSearch(route)), route);
    for (const raw of ['{"draft":"secret"}', '{"launchStage":"Unknown"}', '{"spreadsheetPage":-1}', "{", "x".repeat(16001)]) assert.equal(parseViewRoute(raw), null);
    assert.equal(parseRoute("?view=%7B").viewInvalid, true);
    assert.deepEqual(parseViewRoute(null), {});
  });
  it("batches one gesture into one history entry, restores views, and retains private edits", async () => {
    await mount(); const push = vi.spyOn(window.history, "pushState");
    await click("Next"); assert.equal(push.mock.calls.length, 1);
    assert.match(document.querySelector("output")?.textContent ?? "", /types\/Options/);
    await click("Edit"); assert.doesNotMatch(location.search, /private|employee|draft/);
    await move("back"); assert.match(document.querySelector("output")?.textContent ?? "", /registered\/Input\/\/edited private draft/);
    await move("forward"); assert.match(document.querySelector("output")?.textContent ?? "", /types\/Options\/\/edited private draft/);
    assert.equal(push.mock.calls.length, 1, "traversal must not create another entry");
  });
  it("replaces typed search state without adding a character-by-character history trail", async () => {
    await mount(); await click("Next"); const push = vi.spyOn(window.history, "pushState");
    await click("Find"); assert.equal(push.mock.calls.length, 0);
    assert.equal(parseRoute(location.search).view?.searchQuery, "exact run");
    await move("back"); assert.match(document.querySelector("output")?.textContent ?? "", /registered\/Input\/\//);
  });
  it("does not route disclosure mount or history restoration, but routes a user toggle", async () => {
    const toggle = vi.fn();
    const step: FlowStep = { number: 1, title: "Example", parts: [{ kind: "form", id: "form", title: "Form", mode: "Read", parts: [] }] };
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    await act(async () => root?.render(createElement(ExplorerParts, { parts: step.parts, step, scenario: DEFAULT_SCENARIO, onScenario: () => {}, open: {}, onToggle: toggle, onSource: () => {}, onStep: () => {}, disabled: false, comments: DEFAULT_COMMENTS, onComments: () => {} })));
    const disclosure = host.querySelector("details"); assert.ok(disclosure);
    await act(async () => disclosure.dispatchEvent(new Event("toggle")));
    assert.equal(toggle.mock.calls.length, 0);
    await act(async () => { disclosure.open = false; disclosure.dispatchEvent(new Event("toggle")); });
    assert.deepEqual(toggle.mock.calls[0], ["1-form", false]);
  });

});
