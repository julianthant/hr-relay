// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { DecisionCard } from "../../../../../src/dashboard/surfaces/run-detail/logs/decision-card.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
let host: HTMLElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = undefined; host = undefined; });

async function draw(props: Parameters<typeof DecisionCard>[0]) {
  host ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(host);
  await act(async () => root!.render(createElement(DecisionCard, props)));
  return host;
}

describe("DecisionCard", () => {
  it("confirms on Enter, refuses while disabled, cancels only from Cancel run, and ignores Escape", async () => {
    const calls: string[] = [];
    const props = { title: "Did the termination save in UCPath?", onConfirm: () => calls.push("confirm"), onCancel: () => calls.push("stop"),
      children: createElement("input", { "aria-label": "Transaction number" }) };
    const view = await draw({ ...props, confirmDisabled: true });
    const input = view.querySelector("input")!;
    const enter = () => act(async () => { input.form!.requestSubmit(); });
    await enter();
    assert.deepEqual(calls, []);
    await draw({ ...props, confirmDisabled: false });
    await enter();
    await act(async () => { input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    const stop = [...view.querySelectorAll("button")].find(button => button.textContent === "Cancel run")!;
    await act(async () => stop.click());
    assert.deepEqual(calls, ["confirm", "stop"]);
  });

  it("collapses to one answered line and shows no actions in preview", async () => {
    const view = await draw({ title: "Read-back failed", answered: { choice: "Check again", time: "09:41", by: "assistant on behalf of Alex Rivera" } });
    assert.equal(view.textContent, "Answered: Check again · 09:41 · by assistant on behalf of Alex Rivera");
    assert.equal(view.querySelector("form"), null);
    await draw({ title: "Which Bea Morrow is this run about?", preview: true });
    assert.equal(view.querySelectorAll("button").length, 0);
  });
});
