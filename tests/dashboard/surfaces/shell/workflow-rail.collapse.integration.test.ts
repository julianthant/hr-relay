// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { useRailCollapsed } from "../../../../src/dashboard/surfaces/shell/workflow-rail-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); Reflect.deleteProperty(window, "matchMedia"); });

function installViewport(width: number): (next: number) => void {
  const listeners = new Set<() => void>();
  let current = width;
  Reflect.set(window, "matchMedia", () => ({
    get matches() { return current < 1200; },
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  }));
  return next => { current = next; for (const listener of listeners) listener(); };
}

async function mountHook(): Promise<{ collapsed: () => boolean; set: (next: boolean) => void }> {
  const state = { collapsed: false, set: (_next: boolean): void => undefined };
  function Probe() { const [collapsed, set] = useRailCollapsed(); state.collapsed = collapsed; state.set = set; return null; }
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(Probe)));
  return { collapsed: () => state.collapsed, set: next => state.set(next) };
}

it("starts collapsed below 1200px, lets the toggle expand it, and resets when the width crosses 1200px", async () => {
  const resize = installViewport(1024);
  const rail = await mountHook();
  assert.equal(rail.collapsed(), true);
  await act(async () => rail.set(false));
  assert.equal(rail.collapsed(), false);
  await act(async () => resize(1440));
  assert.equal(rail.collapsed(), false);
  await act(async () => rail.set(true));
  assert.equal(rail.collapsed(), true);
  await act(async () => resize(1100));
  assert.equal(rail.collapsed(), true);
});

it("forgets an expand choice once the width has crossed 1200px and come back below it", async () => {
  const resize = installViewport(1024);
  const rail = await mountHook();
  await act(async () => rail.set(false));
  assert.equal(rail.collapsed(), false);
  await act(async () => resize(1440));
  await act(async () => resize(1100));
  assert.equal(rail.collapsed(), true);
});

it("starts expanded at 1440px", async () => {
  installViewport(1440);
  assert.equal((await mountHook()).collapsed(), false);
});
