// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { FooterActions } from "../../../../../src/dashboard/surfaces/shared/actions/actions.js";
import { ActionDescriptorWireSchema } from "../../../../../src/models/dashboard/actions.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
it("Pause shows an enabled Resume on the next render", async () => {
  const pause = ActionDescriptorWireSchema.parse({ key: "pause", kind: "command", command: "pause", expectedVersion: 7,
    label: "Pause", intent: "neutral", icon: "pause", placement: ["footer"] });
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host);
  await act(async () => root.render(createElement(FooterActions, { actions: [pause], target: { runId: "r", expectedVersion: 7 }, onAction: () => new Promise<void>(() => {}) })));
  const button = () => host.querySelector("button");
  assert.equal(button()?.getAttribute("aria-label"), "Pause");
  await act(async () => { button()?.click(); });
  assert.equal(button()?.getAttribute("aria-label"), "Resume");
  assert.equal(button()?.disabled, false);
  assert.doesNotMatch(host.innerHTML, /animate-spin|after this step/);
  await act(async () => root.unmount());
});
