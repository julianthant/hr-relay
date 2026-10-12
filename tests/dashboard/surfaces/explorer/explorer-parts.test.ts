// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it,vi } from "vitest";
import { DEFAULT_COMMENTS,DEFAULT_SCENARIO,type FlowStep } from "../../../../src/dashboard/surfaces/explorer/explorer-flow-model.js";
import { ExplorerParts } from "../../../../src/dashboard/surfaces/explorer/explorer-parts.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.innerHTML = ""; vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });
describe("view navigation", () => {
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
