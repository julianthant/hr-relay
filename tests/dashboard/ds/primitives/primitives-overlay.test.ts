// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement,useState } from "react";
import { createRoot } from "react-dom/client";
import { it,vi } from "vitest";
import { OverlayLayerPresence,ToastProvider,useToasts } from "../../../../src/dashboard/ds/primitives/primitives-overlay.js";
import { dsLayer } from "../../../../src/dashboard/ds/theme/tokens.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
class MeasurementFreeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }

it("keeps error cards until acknowledgment and makes the toast close control inert during overlays", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", MeasurementFreeResizeObserver);
  function Producer() {
    const { toast } = useToasts();
    const [overlay, setOverlay] = useState(false);
    return createElement("div", {},
      createElement("button", { onClick: () => toast({ tone: "danger", title: "Write parked", description: "Review the saved result." }) }, "Fail"),
      createElement("button", { onClick: () => setOverlay(value => !value) }, "Layer"),
      overlay ? createElement(OverlayLayerPresence) : null,
    );
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const button = (name: string) => { const found = [...document.querySelectorAll("button")].find(node => node.textContent === name); assert.ok(found, name); return found; };
  const dismiss = () => { const found = document.querySelector<HTMLButtonElement>('button[aria-label="Dismiss"]'); assert.ok(found); return found; };
  try {
    await act(async () => root.render(createElement(ToastProvider, { children: createElement(Producer) })));
    await act(async () => button("Fail").click());
    const toast = document.querySelector('[data-slot="toast"]');
    assert.ok(toast);
    assert.ok(toast.classList.contains(dsLayer.toastCard));
    const viewport = document.querySelector('[data-slot="toast-viewport"]');
    assert.ok(viewport?.classList.contains(dsLayer.toastViewport));
    assert.equal(toast.getAttribute("role"), "alert"); assert.equal(toast.getAttribute("data-ds-toast-state"), "full");
    assert.match(toast.textContent ?? "", /Write parked.*Review the saved result/);
    await act(async () => vi.advanceTimersByTime(10000));
    assert.equal(toast.hasAttribute("data-ending-style"), false);
    await act(async () => button("Layer").click());
    assert.equal(document.querySelector('[data-ds-toast-viewport]')?.hasAttribute("inert"), true);
    assert.equal(dismiss().disabled, true);
    await act(async () => button("Layer").click()); assert.equal(dismiss().disabled, false);
    assert.deepEqual([...toast.querySelectorAll("button")].map(node => node.getAttribute("aria-label")), ["Dismiss"]);
    await act(async () => dismiss().click());
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); }
});
