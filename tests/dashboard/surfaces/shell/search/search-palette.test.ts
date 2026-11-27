// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { afterEach, it, vi } from "vitest";
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
  const escape = () => act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
  await escape();
  assert.equal(input()?.value, "");
  await escape();
  assert.equal(input() === null, true);
  // Radix returns focus in a timer after the dialog unmounts. A failing assert.equal on two jsdom nodes inspects them without bound.
  await vi.waitFor(() => assert.equal(document.activeElement === trigger(), true));
  await act(async () => trigger().click());
  assert.equal(input()?.value, "");
});

it("puts the filter tabs after the results, gives workflows their rail icon and routes data destinations", async () => {
  const actions: string[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(RailSearch, { data: { today: "2026-08-03", counts: {}, results: [] }, workflows: [{ id: "separations", label: "Separations", icon: "UserMinus" }], startKey: "R", onAction: action => actions.push(action), onWorkflow: () => {}, onResult: () => {} }))));
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!.click());
  const palette = document.querySelector(".search-palette")!;
  const order = [...palette.querySelector("[cmdk-root]")!.children].filter(child => !child.hasAttribute("cmdk-label")).map(child => child.querySelector("[cmdk-input]") ? "input" : child.classList.contains("search-palette-chips") ? "tabs" : "list");
  assert.deepEqual(order, ["input", "list", "tabs"]);
  const rows = [...palette.querySelectorAll(".search-palette-row")];
  assert.deepEqual(rows.slice(0, 5).map(row => row.textContent), ["Start a runR", "Spreadsheets", "Explorer", "Analytics", "Settings"]);
  assert.equal(palette.querySelector(".search-palette-key") === null, true);
  assert(palette.querySelector("kbd")?.textContent === "R");
  const workflowIcon = rows.find(row => row.textContent === "Separations")!.querySelector("svg")!;
  assert(workflowIcon.classList.contains("lucide-user-minus"));
  for (const label of ["Spreadsheets", "Explorer", "Analytics"]) {
    await act(async () => { [...document.querySelectorAll<HTMLElement>(".search-palette-row")].find(row => row.textContent === label)!.click(); });
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!.click());
  }
  assert.deepEqual(actions, ["spreadsheets", "explorer", "analytics"]);
});

const run = (n: number) => ({ id: `run-${n}`, subject: `Subject ${n}`, workflow: "Person Lookup", day: "2026-08-03", state: "Done" });
async function openWithMore(more: () => void) {
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(RailSearch, { data: { today: "2026-08-03", counts: {}, results: [run(1), run(2), run(3)], totalMatches: 40, more }, workflows: [], onAction: () => {}, onWorkflow: () => {}, onResult: () => {} }))));
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!.click());
}

it("asks for the next page of runs when the list is scrolled near its end", async () => {
  const more = vi.fn();
  await openWithMore(more);
  const list = document.querySelector<HTMLElement>(".search-palette-list")!;
  const size = (scrollTop: number) => { for (const [key, value] of Object.entries({ scrollHeight: 1000, clientHeight: 200, scrollTop })) Object.defineProperty(list, key, { value, configurable: true }); };
  size(0);
  await act(async () => { list.dispatchEvent(new Event("scroll")); });
  assert.equal(more.mock.calls.length, 0);
  size(700);
  await act(async () => { list.dispatchEvent(new Event("scroll")); });
  assert.equal(more.mock.calls.length, 1);
});

it("asks for the next page itself when the Runs list does not overflow", async () => {
  const more = vi.fn();
  await openWithMore(more);
  assert.equal(more.mock.calls.length, 0);
  await act(async () => { [...document.querySelectorAll<HTMLButtonElement>(".search-palette-chips button")].find(button => button.textContent === "Runs")!.click(); });
  assert.equal(more.mock.calls.length, 1);
});

it("is the shared search field and still a combobox driven by the arrow keys and Enter", async () => {
  const actions: string[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(RailSearch, { data: { today: "2026-08-03", counts: {}, results: [] }, workflows: [], onAction: action => actions.push(action), onWorkflow: () => {}, onResult: () => {} }))));
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!.click());
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search Relay"]')!;
  assert(input.closest(".ds-search-field"));
  assert.equal(input.getAttribute("role"), "combobox");
  assert.equal(input.id, document.querySelector<HTMLLabelElement>("[cmdk-label]")!.htmlFor);
  assert.equal(input.getAttribute("aria-controls"), document.querySelector("[cmdk-list]")!.id);
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  assert.deepEqual(actions, ["spreadsheets"]);
});

it("keeps cmdk's query state: ArrowDown to Spreadsheets, typing s, then Enter activates the new first result", async () => {
  const actions: string[] = [];
  const host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
  await act(async () => root?.render(createElement(TooltipProvider, null, createElement(RailSearch, { data: { today: "2026-08-03", counts: {}, results: [] }, workflows: [], startKey: "R", onAction: action => actions.push(action), onWorkflow: () => {}, onResult: () => {} }))));
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Search"]')!.click());
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search Relay"]')!;
  assert.equal(input.getAttribute("aria-autocomplete"), "list");
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })); });
  assert.equal(document.getElementById(input.getAttribute("aria-activedescendant")!)?.textContent, "Spreadsheets");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "s");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  assert.equal(document.getElementById(input.getAttribute("aria-activedescendant")!)?.textContent?.startsWith("Start a run"), true);
  await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })); });
  assert.deepEqual(actions, ["start"]);
});
