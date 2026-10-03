// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it, vi } from "vitest";
import { ToastProvider, useToasts } from "../../../../../src/dashboard/ds/ui.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let controls!: ReturnType<typeof useToasts>;
function Probe() { controls = useToasts(); return null; }
async function mount() {
  host = document.createElement("div"); document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(createElement(ToastProvider, null, createElement(Probe))));
}
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined; host?.remove(); host = undefined; vi.useRealTimers();
});

it("keeps an approved danger chip until dismissal and restores focus after expand", async () => {
  await mount();
  vi.useFakeTimers();
  await act(async () => { controls.toast({ tone: "danger", title: "Run failed", description: "A run failed." }); });
  await act(async () => { vi.advanceTimersByTime(10_000); });
  const chip = document.querySelector('[data-ds-toast-state="chip"]');
  assert.equal(chip?.getAttribute("role"), "alert");
  const expand = chip?.querySelector("button");
  assert.ok(expand);
  await act(async () => { expand.click(); });
  assert.ok(document.querySelector('[data-ds-toast-state="full"]'));
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Collapse this alert to one line");
  const dismiss = document.querySelector<HTMLButtonElement>('[data-ds-toast-state="full"] [aria-label="Dismiss"]');
  assert.ok(dismiss);
  await act(async () => { dismiss.click(); });
  assert.equal(document.querySelector('[data-ds-toast-state]'), null);
});

it("runs one recovery action and dismisses its card", async () => {
  await mount();
  const action = vi.fn();
  await act(async () => { controls.toast({ tone: "danger", title: "Run failed", action: { label: "Open failure", onAction: action } }); });
  const expand = document.querySelector<HTMLButtonElement>('[data-ds-toast-state="chip"] button');
  assert.ok(expand);
  await act(async () => { expand.click(); });
  const open = [...document.querySelectorAll<HTMLButtonElement>('[data-ds-toast-state="full"] button')].find(button => button.textContent === "Open failure");
  assert.ok(open);
  await act(async () => { open.click(); });
  assert.equal(action.mock.calls.length, 1);
  assert.equal(document.querySelector('[data-ds-toast-state]'), null);
});
