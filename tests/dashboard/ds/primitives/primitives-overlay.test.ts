// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement,useState } from "react";
import { createRoot } from "react-dom/client";
import { it,vi } from "vitest";
import { OverlayLayerPresence,ToastProvider,useToasts } from "../../../../src/dashboard/ds/primitives/primitives-overlay.js";
import { Select,SelectContent,SelectItem,SelectTrigger,SelectValue } from "../../../../src/dashboard/ds/primitives/base-select.js";
import { dsLayer } from "../../../../src/dashboard/ds/theme/tokens.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
class MeasurementFreeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }

it("keeps error cards until acknowledgment and makes the toast inert during overlays", async () => {
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
    assert.equal(toast.classList.contains("pointer-events-none"), true);
    await act(async () => button("Layer").click());
    assert.equal(document.querySelector('[data-ds-toast-viewport]')?.hasAttribute("inert"), false);
    assert.equal(toast.classList.contains("pointer-events-none"), false);
    assert.equal(toast.querySelectorAll("button").length, 0);
    assert.equal(toast.getAttribute("aria-label"), "Dismiss notification");
    await act(async () => (toast as HTMLElement).click());
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); }
});

it("leaves toasts reachable while a focused Select stays closed and makes them inert once it opens", async () => {
  vi.stubGlobal("ResizeObserver", MeasurementFreeResizeObserver);
  function Producer() {
    const { toast } = useToasts();
    return createElement("div", {},
      createElement("button", { onClick: () => toast({ tone: "warning", title: "Restart required", sticky: true }) }, "Notify"),
      createElement(Select, { defaultValue: "a" },
        createElement(SelectTrigger, { "aria-label": "Sound" }, createElement(SelectValue)),
        createElement(SelectContent, {}, createElement(SelectItem, { value: "a" }, "A"))),
    );
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const inert = () => document.querySelector("[data-ds-toast-viewport]")?.hasAttribute("inert");
  try {
    await act(async () => root.render(createElement(ToastProvider, { children: createElement(Producer) })));
    await act(async () => [...document.querySelectorAll("button")].find(node => node.textContent === "Notify")?.click());
    const trigger = document.querySelector<HTMLElement>('[aria-label="Sound"]');
    assert.ok(trigger);
    // Base UI mounts the closed list a tick after the trigger takes focus.
    await act(async () => { trigger.focus(); await new Promise(done => setTimeout(done, 10)); });
    assert.ok(document.querySelector('[data-slot="select-content"]'), "the closed list is mounted");
    assert.equal(inert(), false);
    await act(async () => { trigger.click(); await new Promise(done => setTimeout(done, 10)); });
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    assert.equal(inert(), true);
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
});
