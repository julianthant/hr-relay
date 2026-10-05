// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it, vi } from "vitest";
import { RailSearch } from "../../../src/dashboard/surfaces/shell/search/navbar-view.js";
import { NAVBAR_SAMPLE } from "../../../src/dashboard/surfaces/shell/search/navbar-fixture.js";
import type { NavbarSearchResult } from "../../../src/dashboard/surfaces/shell/search/navbar-view-model.js";

class MeasurementFreeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value() {} });
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => { if (root) await act(async () => root?.unmount()); host?.remove(); root = undefined; host = undefined; vi.unstubAllGlobals(); });
const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); };
const button = (label: string) => { const target = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.getAttribute("aria-label") === label); assert.ok(target, label); return target; };
async function mount(refuse = false) {
  const fetch = vi.fn(() => { throw new Error("unexpected-search-transport"); });
  vi.stubGlobal("fetch", fetch);
  const picks: NavbarSearchResult[] = [];
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(RailSearch, { data: NAVBAR_SAMPLE, onResult: (result, opened, refused) => { picks.push(result); if (refuse) refused("The selected run is unavailable."); else opened(); } })));
  return { fetch, picks };
}
async function query(value: string) {
  const input = document.querySelector<HTMLInputElement>('input[cmdk-input]'); assert.ok(input);
  await act(async () => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value"); if (descriptor === undefined || typeof descriptor.set !== "function") throw new Error("input-value-setter-missing");
    descriptor.set.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
describe("canonical local search control", () => {
  it("updates immediately and keeps only matching results without corpus requests", async () => {
    const { fetch } = await mount();
    await act(async () => button("Search runs").click()); await settle();
    await query("Jordan"); assert.equal(document.querySelectorAll("[cmdk-item]").length, 1); assert.match(document.body.textContent ?? "", /Jordan Lee/);
    await query("Casey"); assert.equal(document.querySelectorAll("[cmdk-item]").length, 1); assert.match(document.body.textContent ?? "", /Casey Rivera/); assert.doesNotMatch(document.body.textContent ?? "", /Jordan Lee/);
    assert.equal(fetch.mock.calls.length, 0);
  });
  it("shows a distinct empty result and restores all results when cleared", async () => {
    const { fetch } = await mount(); await act(async () => button("Search runs").click()); await settle();
    await query("unknown subject"); assert.equal(document.querySelectorAll("[cmdk-item]").length, 0); assert.match(document.body.textContent ?? "", /No runs match your search/);
    await query(""); assert.equal(document.querySelectorAll("[cmdk-item]").length, 3); assert.equal(fetch.mock.calls.length, 0);
  });
  it("opens with slash, focuses the input and moves to the result by keyboard", async () => {
    const { picks, fetch } = await mount();
    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true }))); await settle();
    const input = document.querySelector<HTMLInputElement>('input[cmdk-input]'); assert.ok(input); assert.equal(document.activeElement, input);
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })));
    const selectedId = input.getAttribute("aria-activedescendant"); assert.ok(selectedId);
    const selected = document.getElementById(selectedId); assert.ok(selected); assert.equal(document.activeElement, input);
    assert.match(selected.textContent ?? "", /Jordan Lee/);
    await act(async () => selected.click()); assert.equal(picks[0].id, "sample-jordan"); assert.equal(document.querySelector('[role="dialog"]'), null); assert.equal(fetch.mock.calls.length, 0);

  });
  it("retains the search and explains a refused destination without a request", async () => {
    const { picks, fetch } = await mount(true);
    await act(async () => button("Search runs").click()); await settle();
    await query("Jordan");
    const item = document.querySelector<HTMLElement>("[cmdk-item]"); assert.ok(item);
    await act(async () => item.click());
    assert.equal(picks[0].id, "sample-jordan");
    assert.ok(document.querySelector('[role="dialog"]'));
    assert.match(document.body.textContent ?? "", /The selected run is unavailable/);
    assert.equal(document.querySelector<HTMLInputElement>("input[cmdk-input]")?.value, "Jordan");
    assert.equal(fetch.mock.calls.length, 0);
  });
  it("closes and reopens without export or backend command controls", async () => {
    const { fetch } = await mount(); await act(async () => button("Search runs").click()); await settle(); await query("Jordan");
    await act(async () => button("Close").click()); assert.equal(document.querySelector('[role="dialog"]'), null);
    await act(async () => button("Search runs").click()); await settle(); assert.equal(document.querySelectorAll("[cmdk-item]").length, 1); assert.doesNotMatch(document.body.textContent ?? "", /Export|Refresh search|Load more/); assert.equal(fetch.mock.calls.length, 0);
  });
});
