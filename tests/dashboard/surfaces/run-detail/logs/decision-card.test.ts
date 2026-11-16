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

  it("keeps the card when answered and swaps the actions for one outcome line; preview shows no actions", async () => {
    const view = await draw({ title: "Read-back failed", context: "UCPath did not answer.", answered: { outcome: "Retried", kind: "retry", time: "09:41", by: "assistant on behalf of Alex Rivera" } });
    assert.equal(view.querySelector("h4")?.textContent, "Read-back failed");
    assert.equal(view.querySelector("p[data-answered]")?.textContent, "Retried · 09:41 · assistant on behalf of Alex Rivera");
    assert.equal(view.querySelectorAll("button").length, 0);
    await draw({ title: "Which Bea Morrow is this run about?", preview: true });
    assert.equal(view.querySelectorAll("button").length, 0);
  });

  it("draws an inline pick without a box, puts the question after the control and hides Cancel run when the run cannot be cancelled", async () => {
    const view = await draw({ title: "Which Bea Morrow is this run about?", context: "UCPath found 3 people.", inline: true, children: createElement("table", { "aria-label": "Search results" }) });
    assert.equal(view.querySelector("form")?.className.includes("border"), false);
    assert.match(view.querySelector("form")?.textContent ?? "", /^Which Bea Morrow is this run about\? UCPath found 3 people\.Confirm$/u);
    assert.equal(view.querySelector("form")?.firstElementChild?.tagName, "TABLE");
    assert.deepEqual([...view.querySelectorAll("button")].map(button => button.textContent), ["Confirm"]);
  });
});
