// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, it, vi } from "vitest";
import { Skeleton } from "../../../../src/dashboard/ds/primitives/primitives-core.js";
import { SKELETON_WAIT_MS } from "../../../../src/dashboard/ds/primitives/skeleton-wait-model.js";
import { LoadingRegion } from "../../../../src/dashboard/surfaces/shared/loading/loading.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
afterEach(() => vi.useRealTimers());

function mount(node: Parameters<ReturnType<typeof createRoot>["render"]>[0]) {
  const host = document.createElement("div"); const root = createRoot(host);
  act(() => root.render(node));
  return { host, unmount: () => act(() => root.unmount()) };
}

describe("a placeholder waits before it shows", () => {
  it("waits about 300 ms, the point where a read stops feeling instant", () => {
    assert.equal(SKELETON_WAIT_MS, 300);
  });

  it("mounts a skeleton bar at once but keeps it invisible until the wait has passed", () => {
    vi.useFakeTimers();
    const view = mount(createElement(Skeleton, { className: "h-4 w-20" }));
    try {
      const bar = view.host.querySelector<HTMLElement>('[data-slot="skeleton"]');
      assert.ok(bar, "the bar holds its space from the first frame");
      assert.ok(bar.classList.contains("invisible"));
      act(() => { vi.advanceTimersByTime(SKELETON_WAIT_MS - 1); });
      assert.ok(bar.classList.contains("invisible"), "a read that settles inside the wait never shows a bar");
      act(() => { vi.advanceTimersByTime(1); });
      assert.ok(!bar.classList.contains("invisible"));
      assert.ok(bar.classList.contains("h-4") && bar.classList.contains("w-20"), "the bar keeps its settled size");
    } finally { view.unmount(); }
  });

  it("keeps a loading region busy for startup while it is invisible, then shows it", () => {
    vi.useFakeTimers();
    const view = mount(createElement(LoadingRegion, { label: "Loading spreadsheets", className: "min-h-10", children: "rows" }));
    try {
      const region = view.host.querySelector<HTMLElement>('[role="status"][aria-busy="true"]');
      assert.ok(region, "startup still counts the waiting region as loading");
      assert.ok(region.classList.contains("invisible") && region.classList.contains("min-h-10"));
      act(() => { vi.advanceTimersByTime(SKELETON_WAIT_MS); });
      assert.ok(!region.classList.contains("invisible"));
    } finally { view.unmount(); }
  });
});
