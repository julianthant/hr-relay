// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { SKELETON_WAIT_MS } from "../../../../src/dashboard/ds/primitives/skeleton-wait-model.js";
import { SettingsSectionSkeleton } from "../../../../src/dashboard/surfaces/settings/settings-loading.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterEach(() => vi.useRealTimers());
it("keeps the heading immediate and holds the section's space while the read is still fast", () => {
  vi.useFakeTimers();
  const host = document.createElement("div"); const root = createRoot(host);
  try {
    act(() => root.render(createElement(SettingsSectionSkeleton, { section: "performance" })));
    assert.match(host.textContent ?? "", /Performance/);
    const region = host.querySelector<HTMLElement>('[aria-busy="true"]');
    assert.ok(region);
    assert.ok(region.classList.contains("invisible"));
    act(() => { vi.advanceTimersByTime(SKELETON_WAIT_MS); });
    assert.ok(!region.classList.contains("invisible"));
  } finally { act(() => root.unmount()); }
});
