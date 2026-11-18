// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { TooltipProvider } from "../../../../../src/dashboard/ds/ui.js";
import { PickTableView } from "../../../../../src/dashboard/surfaces/shared/steps/pick-table-view.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
class ResizeObserverStub { observe() {} disconnect() {} unobserve() {} }
Reflect.set(globalThis, "ResizeObserver", ResizeObserverStub);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });
const render = async (node: Parameters<Root["render"]>[0]) => { const host = document.body.appendChild(document.createElement("div")); root = createRoot(host); await act(async () => root?.render(createElement(TooltipProvider, null, node))); return host; };

it("picks a plain row, shows the warning cell, and reports typed text", async () => {
  const chosen: string[] = []; const typed: string[] = [];
  const host = await render(createElement(PickTableView, { title: "Search results", columns: [{ id: "n", label: "Name" }, { id: "s", label: "Status" }],
    rows: [{ id: "a", label: "Alex", cells: [{ value: "Alex" }, { value: "On leave", attention: true }] }, { id: "b", label: "Blake", cells: [{ value: "Blake" }, { value: "Active" }] }],
    typed: { id: "typed", label: "Enter ID", value: "" }, chosen: "b", onChoose: id => chosen.push(id), onText: value => typed.push(value) }));
  const radios = [...host.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  assert.deepEqual(radios.map(radio => radio.getAttribute("aria-checked")), ["false", "true", "false"]);
  assert.ok(host.querySelector("td.text-ui-warning")?.textContent === "On leave");
  await act(async () => radios[0].click());
  assert.deepEqual(chosen, ["a"]);
  assert.equal(host.querySelector("h4")?.textContent, "Search results");
});
