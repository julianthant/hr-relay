// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { VirtuosoMockContext } from "react-virtuoso";
import { it } from "vitest";
import { RunDecisionWireSchema } from "../../../../../src/models/dashboard/run-decision.js";
import { LogFeed } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed.js";
import type { LogStep } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const served = RunDecisionWireSchema.parse({ type: "write-parked", title: "Enter the EID", options: [{ id: "retry-with-value", label: "Enter EID", hint: "Start again.",
  send: { via: "start-plan" }, input: { kind: "text", label: "Employee ID", pattern: "^10\\d{6}$" } }] });
const steps: readonly LogStep[] = Array.from({ length: 300 }, (_, index) => ({ id: `step-${index}`, time: "10:00 AM", title: `Step ${index}`,
  entries: index === 0
    ? [{ kind: "decision", id: "decision", time: "10:00 AM", decision: { title: "Enter the EID", state: "parked", served } }]
    : [{ kind: "note", id: `note-${index}`, time: "10:00 AM", message: `Action ${index}` }] }));

/** jsdom has no layout: keep scrollTop as written and tell the list it moved. */
const scrollTo = async (scroller: HTMLElement, top: number) => {
  await act(async () => { scroller.scrollTop = top; scroller.dispatchEvent(new Event("scroll")); });
};

it("mounts only the steps near the viewport and keeps a decision draft scrolled away and back", async () => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(VirtuosoMockContext.Provider, { value: { viewportHeight: 400, itemHeight: 100 } },
      createElement(LogFeed, { steps, onDecision: () => undefined }))));
    const scroller = host.querySelector<HTMLElement>('[role="region"][aria-label="Run logs"]');
    if (!scroller) throw new Error("log region missing");
    assert.ok(host.querySelectorAll("section").length < 30, "a long log mounts a window, not every step");

    const input = host.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("decision input missing");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "1001234");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await scrollTo(scroller, 20_000);
    assert.equal(host.textContent?.includes("Enter the EID"), false, "the decision step left the window");
    assert.ok(host.textContent?.includes("Action 200"));

    await scrollTo(scroller, 0);
    assert.equal(host.querySelector<HTMLInputElement>("input")?.value, "1001234", "the draft returns with the step");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
