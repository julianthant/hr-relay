// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot } from "react-dom/client";
import { it,vi } from "vitest";
import { ToastProvider,useToasts } from "../../../../src/dashboard/ds/primitives/primitives-overlay.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
class MeasurementFreeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }

it("a toast is text only and times out unless sticky", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", MeasurementFreeResizeObserver);
  function Producer() {
    const { toast } = useToasts();
    return createElement("div", {},
      createElement("button", { onClick: () => toast({ tone: "warning", title: "Needs attention in Settings: Network ports." }) }, "Plain"),
      createElement("button", { onClick: () => toast({ tone: "danger", sticky: true, title: "Your disk is full." }) }, "Sticky"));
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const press = async (name: string) => { const found = [...document.querySelectorAll("button")].find(node => node.textContent === name); assert.ok(found, name); await act(async () => found.click()); };
  const cards = () => [...document.querySelectorAll('[data-slot="toast"]')].filter(card => !card.hasAttribute("data-ending-style"));
  try {
    await act(async () => root.render(createElement(ToastProvider, { children: createElement(Producer) })));
    await press("Plain");
    assert.equal(cards().length, 1);
    assert.equal(document.querySelector('[data-slot="toast"]')?.querySelector("button") === null, true);
    await act(async () => vi.advanceTimersByTime(3_500));
    assert.equal(cards().length, 0);
    await press("Sticky");
    await act(async () => vi.advanceTimersByTime(120_000));
    assert.equal(cards().length, 1);
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); }
});
