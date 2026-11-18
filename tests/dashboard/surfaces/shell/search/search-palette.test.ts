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
