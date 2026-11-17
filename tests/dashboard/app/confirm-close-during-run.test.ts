// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { closeNeedsConfirmation,useConfirmCloseDuringRun,type BeforeUnloadTarget } from "../../../src/dashboard/app/confirm-close-during-run.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
function fakeWindow() {
  const listeners = new Set<(event: BeforeUnloadEvent) => void>();
  const target: BeforeUnloadTarget = { addEventListener: (_type, listener) => { listeners.add(listener); }, removeEventListener: (_type, listener) => { listeners.delete(listener); } };
  const unload = () => { const event = new Event("beforeunload", { cancelable: true }); for (const listener of listeners) listener(event); return event.defaultPrevented; };
  return { target, unload, count: () => listeners.size };
}
function Probe(props: { mode: "active-run" | "always" | "never"; active: boolean; target: BeforeUnloadTarget }) { useConfirmCloseDuringRun(props.mode, props.active, props.target); return null; }

it("asks only for the modes and run states that call for it", () => {
  assert.deepEqual([["active-run", true], ["active-run", false], ["always", false], ["never", true]].map(([mode, active]) => closeNeedsConfirmation(mode as "always", active as boolean)), [true, false, true, false]);
});
it("registers the before-unload prompt only while the setting is on and a run is active", () => {
  const win = fakeWindow(); const root = createRoot(document.createElement("div"));
  const render = (mode: "active-run" | "always" | "never", active: boolean) => act(() => root.render(createElement(Probe, { mode, active, target: win.target })));
  render("active-run", false); assert.equal(win.unload(), false);
  render("active-run", true); assert.equal(win.unload(), true); assert.equal(win.count(), 1);
  render("never", true); assert.equal(win.unload(), false); assert.equal(win.count(), 0);
  render("active-run", true); render("active-run", false); assert.equal(win.count(), 0);
  render("always", false); assert.equal(win.unload(), true);
  act(() => root.unmount()); assert.equal(win.count(), 0);
});
