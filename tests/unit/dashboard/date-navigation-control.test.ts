// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { NavbarCalendar } from "../../../src/dashboard/surfaces/shell/search/navbar-view.js";
import { NAVBAR_SAMPLE } from "../../../src/dashboard/surfaces/shell/search/navbar-fixture.js";

class MeasurementFreeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }
Reflect.set(globalThis, "ResizeObserver", MeasurementFreeResizeObserver);
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
it("browses independently and retains a usable tab stop across empty months", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const fetch = vi.fn(() => { throw new Error("unexpected-calendar-transport"); }); vi.stubGlobal("fetch", fetch);
  const button = (label: string) => { const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.getAttribute("aria-label") === label || item.textContent === label); assert.ok(found, label); return found; };
  const dateCell = (label: string) => { const found = [...document.querySelectorAll<HTMLElement>('.ds-calendar [data-slot="calendar-cell"]')].find(item => item.getAttribute("aria-label")?.startsWith(label)); assert.ok(found, label); return found; };
  const calendarTabStops = () => document.querySelectorAll('.ds-calendar [data-slot="calendar-cell"][tabindex="0"]').length;
  const dateSegments = () => [...host.querySelectorAll('[role="spinbutton"]')].map(node => node.textContent);
  const settle = async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); };
  const click = async (target: HTMLElement) => { await act(async () => target.click()); await settle(); };
  try {
    await act(async () => root.render(createElement(NavbarCalendar, { data: NAVBAR_SAMPLE, nav: { canBack: false, canForward: false, onBack: () => undefined, onForward: () => undefined } })));
    assert.equal(host.querySelector('[aria-label="Back"]'), null);
    assert.equal(host.querySelector('[aria-label="Forward"]'), null);
    assert.equal(host.querySelector('[title="Run count unavailable"]'), null);
    assert.deepEqual(dateSegments(), ['9', '26', '2026']);
    await click(button("Choose date"));
    assert.match(document.activeElement?.getAttribute("aria-label") ?? "", /Saturday, September 26, 2026/);
    await act(async () => document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }))); await settle();
    assert.match(document.activeElement?.getAttribute("aria-label") ?? "", /Friday, September 25, 2026/);
    assert.equal(calendarTabStops(), 1);
    assert.equal(dateCell("Sunday, September 27, 2026").getAttribute("aria-disabled"), "true");
    await click(button("Previous month")); assert.match(document.body.textContent ?? "", /August 2026/); assert.equal(calendarTabStops(), 1);
    assert.deepEqual(dateSegments(), ['9', '26', '2026']);
    await click(dateCell("Thursday, August 20, 2026")); assert.deepEqual(dateSegments(), ['8', '20', '2026']); assert.equal(host.querySelector('[title="Run count unavailable"]'), null); assert.equal(document.querySelector('[role="dialog"]'), null);
    await click(button("Choose date")); await click(button("Today")); assert.deepEqual(dateSegments(), ['9', '26', '2026']); assert.equal(host.querySelector('[aria-label="Forward"]'), null);
    assert.equal(fetch.mock.calls.length, 0);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
