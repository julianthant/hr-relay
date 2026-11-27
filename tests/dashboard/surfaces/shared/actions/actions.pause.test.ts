// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { FooterActions } from "../../../../../src/dashboard/surfaces/shared/actions/actions.js";
import { ActionDescriptorWireSchema } from "../../../../../src/models/dashboard/actions.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); document.body.replaceChildren(); });

const control = (command: "pause" | "resume", expectedVersion: number) => ActionDescriptorWireSchema.parse({
  key: command, kind: "command", command, expectedVersion, label: command === "pause" ? "Pause" : "Resume",
  intent: "neutral", icon: command, placement: ["footer"] });

function mount() {
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  const sent: unknown[] = []; let settle: () => void = () => undefined;
  const draw = (runId: string, command: "pause" | "resume", version: number) => act(async () => root?.render(createElement(FooterActions, {
    actions: [control(command, version)], target: { runId, expectedVersion: version },
    onAction: (action) => { sent.push(action.kind === "command" && action.command); return new Promise<void>(resolve => { settle = resolve; }); } })));
  const button = () => host.querySelector("button");
  return { host, sent, draw, button, settle: () => act(async () => settle()) };
}

it("Pause shows an enabled Resume on the next render, and a second click sends nothing stale", async () => {
  const m = mount(); await m.draw("a", "pause", 7);
  assert.equal(m.button()?.getAttribute("aria-label"), "Pause");
  await act(async () => m.button()?.click());
  assert.equal(m.button()?.getAttribute("aria-label"), "Resume");
  assert.equal(m.button()?.disabled, false);
  assert.doesNotMatch(m.host.innerHTML, /animate-spin|after this step/);
  await act(async () => m.button()?.click());
  assert.deepEqual(m.sent, ["pause"]);
  await m.draw("a", "resume", 8);
  assert.equal(m.button()?.getAttribute("aria-label"), "Resume");
});

it("restores the served Pause when the press settles without the row moving", async () => {
  const m = mount(); await m.draw("a", "pause", 7);
  await act(async () => m.button()?.click());
  await m.settle();
  assert.equal(m.button()?.getAttribute("aria-label"), "Pause");
});

it("does not show Resume on another run at the same revision", async () => {
  const m = mount(); await m.draw("a", "pause", 7);
  await act(async () => m.button()?.click());
  await m.draw("b", "pause", 7);
  assert.equal(m.button()?.getAttribute("aria-label"), "Pause");
});
