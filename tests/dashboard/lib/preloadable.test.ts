// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, Component, createElement, Suspense, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { CodeLoading, preloadable } from "../../../src/dashboard/lib/preloadable.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; });

async function render(element: ReturnType<typeof createElement>) {
  const host = document.createElement("div");
  root ??= createRoot(host);
  await act(async () => root?.render(createElement(Suspense, { fallback: createElement("i", null, "fallback") }, element)));
  return host;
}

it("renders a preloaded page in the same commit, never through the Suspense fallback", async () => {
  const page = preloadable(async () => ({ label }: { label: string }) => createElement("b", null, label));
  await page.preload();
  const host = document.createElement("div"); root = createRoot(host);
  act(() => root?.render(createElement(Suspense, { fallback: createElement("i", null, "fallback") }, createElement(page.Component, { label: "ready" }))));
  assert.equal(host.innerHTML, "<b>ready</b>");
});

it("keeps a mount that started before the code arrived, so the page never remounts", async () => {
  let release: (() => void) | undefined;
  let mounts = 0;
  function Page({ label }: { label: string }) { useEffect(() => { mounts += 1; }, []); return createElement("b", null, label); }
  const page = preloadable(() => new Promise<typeof Page>(resolve => { release = () => resolve(Page); }));
  const host = await render(createElement(page.Component, { label: "first" }));
  assert.equal(host.textContent, "fallback");
  await act(async () => release?.());
  await render(createElement(page.Component, { label: "second" }));
  assert.equal(mounts, 1);
});

it("loads again after a failed load", async () => {
  let attempts = 0;
  const page = preloadable(async () => { attempts += 1; if (attempts === 1) throw new Error("offline"); return () => null; });
  await assert.rejects(page.preload(), /offline/);
  await page.preload();
  assert.equal(attempts, 2);
});

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override render() { return this.state.failed ? createElement("button", { onClick: () => this.setState({ failed: false }) }, "Retry") : this.props.children; }
}

it("fails code still loading at the deadline into the boundary, whose retry waits on the same load", async () => {
  vi.useFakeTimers();
  try {
    let loads = 0;
    let release: (() => void) | undefined;
    const page = preloadable(() => { loads += 1; return new Promise<() => ReturnType<typeof createElement>>(resolve => { release = () => resolve(() => createElement("b", null, "ready")); }); });
    const host = document.createElement("div"); root = createRoot(host);
    await act(async () => root?.render(createElement(Boundary, null, createElement(Suspense, { fallback: createElement(CodeLoading, { deadlineMs: 1_000 }) }, createElement(page.Component, {})))));
    assert.equal(host.innerHTML, '<span data-loading-layout=""></span>');
    await act(async () => { await vi.advanceTimersByTimeAsync(999); });
    assert.equal(host.innerHTML, '<span data-loading-layout=""></span>');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    assert.equal(host.textContent, "Retry");
    await act(async () => host.querySelector("button")?.click());
    assert.equal(host.innerHTML, '<span data-loading-layout=""></span>');
    await act(async () => release?.());
    assert.equal(host.textContent, "ready");
    assert.equal(loads, 1);
  } finally { vi.useRealTimers(); }
});
