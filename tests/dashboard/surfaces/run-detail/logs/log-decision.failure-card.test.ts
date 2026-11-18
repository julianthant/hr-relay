// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { RunDecisionWireSchema } from "../../../../../src/models/dashboard/run-decision.js";
import { LogDecisionBlock } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision.js";
import { failureCardFacts, type LogDecision } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision-model.js";
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const retry = RunDecisionWireSchema.parse({ type: "failed-retryable", title: "A step failed", choiceLabel: "Next step",
  options: [{ id: "retry", label: "Retry step", hint: "Nothing was written.", send: { via: "action", actionKey: "retry-failed-step" } }] });
const noRetry = RunDecisionWireSchema.parse({ type: "failed-retryable", title: "A step failed", options: [] });
const base: LogDecision = { title: "Read timecard", state: "failed", message: "The page did not load.", footer: "No changes were made.",
  ...failureCardFacts({ title: "Read timecard", observation: "x", attemptedAction: "Read timecard", lastCompleted: "Read employee ID", field: { label: "Employee ID", value: "field-value-1", outcome: "Read" } }) };

const mount = async (decision: LogDecision, handlers: { onAnswer?: () => void; onCancel?: () => void } = {}) => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(LogDecisionBlock, { decision, onAnswer: handlers.onAnswer ?? (() => undefined), onCancel: handlers.onCancel ?? (() => undefined) })));
  return { host, done: async () => { await act(async () => root.unmount()); host.remove(); } };
};
const buttons = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>("button")].map(button => button.textContent);

it("maps served failure display facts onto the card without inventing a missing one", () => {
  assert.deepEqual(failureCardFacts({ title: "T", observation: "o", attemptedAction: "Read timecard", lastCompleted: "Read employee ID", field: { label: "Employee ID", value: "1", outcome: "Read" } }),
    { attemptedAction: "Read timecard", lastCompleted: "Read employee ID", field: { label: "Employee ID", value: "1", outcome: "Read" } });
  assert.deepEqual(failureCardFacts({ title: "T", observation: "o" }), {});
  assert.deepEqual(failureCardFacts(undefined), {});
});

it("draws every served fact in the mock's order with Retry step and Cancel run", async () => {
  const sent: string[] = [];
  const { host, done } = await mount({ ...base, served: retry, unavailableCapture: "Screenshot capture is off for this run." }, { onAnswer: () => sent.push("retry"), onCancel: () => sent.push("cancel") });
  try {
    const title = host.querySelector("h4");
    assert.equal(title?.textContent, "Read timecard");
    assert.match(title?.className ?? "", /text-ui-danger/u);
    const text = host.textContent ?? "";
    const order = ["Read timecard", "The page did not load.", "While trying to", "Last completed · Read employee ID", "Employee ID", "Screenshot capture is off", "Retry step", "Cancel run"].map(part => text.indexOf(part));
    assert.ok(order.every((at, index) => at >= 0 && (index === 0 || at > order[index - 1])), `facts out of order: ${order.join(",")}`);
    assert.equal(host.querySelector(".log-failed-field strong")?.textContent, "field-value-1");
    assert.deepEqual(buttons(host), ["Retry step", "Cancel run"]);
    const cancel = [...host.querySelectorAll("button")].find(button => button.textContent === "Cancel run");
    assert.doesNotMatch(cancel?.className ?? "", /ghost|bg-transparent/u);
    await act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent === "Retry step")?.click(); });
    await act(async () => { cancel?.click(); });
    assert.deepEqual(sent, ["retry", "cancel"]);
  } finally { await done(); }
});

it("offers no Retry step, no disabled Confirm, no Note box and no Add note when the backend serves no retry", async () => {
  const { host, done } = await mount({ ...base, served: noRetry, unavailableCapture: "No screenshot was taken." });
  try {
    assert.deepEqual(buttons(host), ["Cancel run"]);
    assert.equal(host.querySelector("textarea, input"), null);
    assert.doesNotMatch(host.textContent ?? "", /Add note|Note/u);
    assert.match(host.textContent ?? "", /No screenshot was taken\./u);
  } finally { await done(); }
});

it("leaves out the rows the backend does not serve", async () => {
  const { host, done } = await mount({ title: "Read timecard", state: "failed", message: "The page did not load.", served: retry });
  try {
    assert.doesNotMatch(host.textContent ?? "", /While trying to|Last completed/u);
    assert.equal(host.querySelector(".log-failed-field"), null);
  } finally { await done(); }
});
