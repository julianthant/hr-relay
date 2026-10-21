// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it, vi } from "vitest";
import { useHubMotion } from "../../../../src/dashboard/ds/theme/motion.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
it("synchronizes mounted consumers, survives remount and exposes failed persistence", async () => {
  localStorage.clear();
  const values: ReturnType<typeof useHubMotion>[] = [];
  function Probe({ index }: { index: number }) { values[index] = useHubMotion(); return null; }
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement("div", null, createElement(Probe, { index: 0 }), createElement(Probe, { index: 1 }))));
    assert.equal(values[0]?.enabled, true);
    const button = document.createElement("button"); host.append(button); button.focus();
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    assert.equal(document.activeElement === button, false);
    assert.equal(document.documentElement.dataset.hubInput, "pointer");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    assert.equal(document.documentElement.dataset.hubInput, "keyboard");
    await act(async () => values[0].change(false));
    assert.equal(document.documentElement.dataset.motion, "off");
    assert.equal(values[1]?.enabled, false);
    assert.equal(localStorage.getItem("relay.animations"), "off");
    await act(async () => root.render(createElement(Probe, { index: 2 })));
    assert.equal(values[2]?.enabled, false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    await act(async () => values[2].change(true));
    assert.equal(document.documentElement.dataset.motion, "on");
    assert.match(values[2]?.problem ?? "", /changed for this session/);
  } finally { vi.restoreAllMocks(); await act(async () => root.unmount()); host.remove(); localStorage.clear(); }
});
