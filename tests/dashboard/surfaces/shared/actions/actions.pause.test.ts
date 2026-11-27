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
  const sent: string[] = []; let settle: (confirmed: boolean) => void = () => undefined;
  const draw = (runId: string, command: "pause" | "resume", version: number) => act(async () => root?.render(createElement(FooterActions, {
    actions: [control(command, version)], target: { runId, expectedVersion: version },
    onAction: (action) => { sent.push(action.kind === "command" ? `${action.command}@${action.expectedVersion}` : action.key); return new Promise<boolean>(resolve => { settle = resolve; }); } })));
  const button = () => host.querySelector("button");
  const click = () => act(async () => button()?.click());
  return { host, sent, draw, button, click, settle: (confirmed: boolean) => act(async () => settle(confirmed)) };
}

it("Pause shows an enabled Resume on the next render", async () => {
  const m = mount(); await m.draw("a", "pause", 7);
  assert.equal(m.button()?.getAttribute("aria-label"), "Pause");
  await m.click();
  assert.equal(m.button()?.getAttribute("aria-label"), "Resume");
  assert.equal(m.button()?.disabled, false);
  assert.doesNotMatch(m.host.innerHTML, /animate-spin|after this step/);
});

it("keeps Resume after the command confirms before the stream moves, and sends a pressed Resume once against the fresh descriptor", async () => {
  const m = mount(); await m.draw("a", "pause", 7);
  await m.click();
  await m.click();
  assert.deepEqual(m.sent, ["pause@7"]);
  await m.settle(true);
  assert.equal(m.button()?.getAttribute("aria-label"), "Resume");
  assert.deepEqual(m.sent, ["pause@7"]);
  await m.draw("a", "resume", 8);
  assert.deepEqual(m.sent, ["pause@7", "resume@8"]);
  await m.draw("a", "resume", 8);
  assert.deepEqual(m.sent, ["pause@7", "resume@8"]);
});

it("holds a queued Resume until the Pause confirms when the stream arrives first", async () => {
  const m = mount(); await m.draw("a", "pause", 7);
  await m.click(); await m.click();
  await m.draw("a", "resume", 8);
  assert.deepEqual(m.sent, ["pause@7"]);
  await m.settle(true);
  assert.deepEqual(m.sent, ["pause@7", "resume@8"]);
});

it("queues a Resume clicked after the stream update until the Pause confirms, then sends it once", async () => {
  const m = mount(); await m.draw("a", "pause", 7);
  await m.click();
  await m.draw("a", "resume", 8);
  assert.equal(m.button()?.getAttribute("aria-label"), "Resume");
  await m.click();
  assert.deepEqual(m.sent, ["pause@7"]);
  await m.settle(true);
  assert.deepEqual(m.sent, ["pause@7", "resume@8"]);
  await m.draw("a", "resume", 8);
  assert.deepEqual(m.sent, ["pause@7", "resume@8"]);
});

it("drops a queued Resume when the stream arrives first and the Pause is then refused", async () => {
  const m = mount(); await m.draw("a", "pause", 7);
  await m.click(); await m.click();
  await m.draw("a", "resume", 8);
  await m.settle(false);
  assert.deepEqual(m.sent, ["pause@7"]);
});

it("sends nothing extra when Resume was not pressed during the interval", async () => {
  const m = mount(); await m.draw("a", "pause", 7);
  await m.click(); await m.settle(true); await m.draw("a", "resume", 8);
  assert.deepEqual(m.sent, ["pause@7"]);
  assert.equal(m.button()?.getAttribute("aria-label"), "Resume");
});

it("restores Pause and drops a queued Resume when the Pause is refused", async () => {
  const m = mount(); await m.draw("a", "pause", 7);
  await m.click(); await m.click();
  await m.settle(false);
  assert.equal(m.button()?.getAttribute("aria-label"), "Pause");
  assert.deepEqual(m.sent, ["pause@7"]);
});

it("does not show Resume on another run at the same revision", async () => {
  const m = mount(); await m.draw("a", "pause", 7);
  await m.click();
  await m.draw("b", "pause", 7);
  assert.equal(m.button()?.getAttribute("aria-label"), "Pause");
});
