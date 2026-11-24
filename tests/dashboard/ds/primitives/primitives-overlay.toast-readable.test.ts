// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot } from "react-dom/client";
import { it,vi } from "vitest";
import { ToastProvider,useToasts } from "../../../../src/dashboard/ds/primitives/primitives-overlay.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
class MeasurementFreeResizeObserver { observe(): void {} unobserve(): void {} disconnect(): void {} }

const SENTENCE = "UCPath did not confirm the read-back, so nothing was filed. Run it again in Settings > Preflight.";

it("shows the whole sentence, dismisses a plain failure after reading time, and replaces a toast for the same action", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", MeasurementFreeResizeObserver);
  function Producer() {
    const { toast } = useToasts();
    return createElement("div", {},
      createElement("button", { onClick: () => toast({ tone: "danger", title: "Write parked", description: SENTENCE }) }, "Fail"),
      createElement("button", { onClick: () => toast({ tone: "danger", title: "Sync failed", description: "Try again.", key: "sync" }) }, "SyncFail"),
      createElement("button", { onClick: () => toast({ tone: "success", title: "Sync done", key: "sync" }) }, "SyncOk"),
    );
  }
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const press = async (name: string) => { const found = [...document.querySelectorAll("button")].find(node => node.textContent === name); assert.ok(found, name); await act(async () => found.click()); };
  const cards = () => [...document.querySelectorAll('[data-slot="toast"]')].filter(card => !card.hasAttribute("data-ending-style"));
  try {
    await act(async () => root.render(createElement(ToastProvider, { children: createElement(Producer) })));

    await press("Fail");
    const title = document.querySelector('[data-slot="toast-title"]');
    const description = document.querySelector('[data-slot="toast-description"]');
    assert.equal(title?.textContent, "Write parked");
    assert.equal(description?.textContent, SENTENCE, "the description is its own line under the title");
    assert.equal(title?.classList.contains("truncate"), false);
    assert.equal(description?.classList.contains("truncate"), false);

    await press("Fail"); await press("Fail");
    assert.equal(cards().length, 1);

    await act(async () => vi.advanceTimersByTime(12_500));
    assert.equal(cards().length, 0);

    await press("SyncFail"); await press("SyncFail");
    assert.equal(cards().length, 1);
    await press("SyncOk");
    assert.equal(cards().length, 1);
    assert.match(cards()[0]?.textContent ?? "", /Sync done/);
  } finally { await act(async () => root.unmount()); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals(); }
});
