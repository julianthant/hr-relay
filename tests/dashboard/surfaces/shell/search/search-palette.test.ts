// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { afterEach, it } from "vitest";
import { RailSearch } from "../../../../../src/dashboard/surfaces/shell/search/navbar-view.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Element.prototype.scrollIntoView = () => {};
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

it("reopens the search palette with an empty query", async () => {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(RailSearch, { data: { today: "2026-08-03", counts: {}, results: [] }, workflows: [], onAction: () => {}, onWorkflow: () => {}, onResult: () => {} }))));
  const trigger = () => host.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!;
  const input = () => document.querySelector<HTMLInputElement>('input[aria-label="Search Relay"]');
  await act(async () => trigger().click());
  assert.equal(input()?.value, "");
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.bind(input()!);
  await act(async () => { setValue?.("archer"); input()!.dispatchEvent(new Event("input", { bubbles: true })); });
  assert.equal(input()?.value, "archer");
  await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  assert.equal(input(), null);
  await act(async () => trigger().click());
  assert.equal(input()?.value, "");
});

it("puts the filter tabs under the input, gives workflows their rail icon and routes data destinations", async () => {
  const actions: string[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(RailSearch, { data: { today: "2026-08-03", counts: {}, results: [] }, workflows: [{ id: "separations", label: "Separations" }], startKey: "R", onAction: action => actions.push(action), onWorkflow: () => {}, onResult: () => {} }))));
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!.click());
  const palette = document.querySelector(".search-palette")!;
  const order = [...palette.querySelector("[cmdk-root]")!.children].filter(child => !child.hasAttribute("cmdk-label")).map(child => child.getAttribute("cmdk-input") !== null ? "input" : child.classList.contains("search-palette-chips") ? "tabs" : "list");
  assert.deepEqual(order, ["input", "tabs", "list"]);
  const rows = [...palette.querySelectorAll(".search-palette-row")];
  assert.deepEqual(rows.slice(0, 5).map(row => row.textContent), ["Start a runR", "Spreadsheets", "Explorer", "Analytics", "Settings"]);
  assert.equal(palette.querySelector(".search-palette-key"), null);
  assert(palette.querySelector("kbd")?.textContent === "R");
  const workflowIcon = rows.find(row => row.textContent === "Separations")!.querySelector("svg")!;
  assert(workflowIcon.classList.contains("lucide-log-out"));
  for (const label of ["Spreadsheets", "Explorer", "Analytics"]) {
    await act(async () => { [...document.querySelectorAll<HTMLElement>(".search-palette-row")].find(row => row.textContent === label)!.click(); });
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!.click());
  }
  assert.deepEqual(actions, ["spreadsheets", "explorer", "analytics"]);
});
