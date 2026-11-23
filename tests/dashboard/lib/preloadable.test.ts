// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement, Suspense, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { preloadable } from "../../../src/dashboard/lib/preloadable.js";

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
