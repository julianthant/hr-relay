// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { it } from "vitest";
import { RunDecisionWireSchema } from "../../../../../src/models/dashboard/run-decision.js";
import { LogDecisionBlock } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision.js";
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

const send = (actionKey: string) => ({ via: "action" as const, actionKey });
const served = (extra: Record<string, unknown>, options: unknown[]) => RunDecisionWireSchema.parse({ type: "write-parked", title: "Did it save?", options, ...extra });
const render = async (decision: ReturnType<typeof served>, message?: string) => {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(createElement(LogDecisionBlock, { decision: { title: decision.title, state: "parked", ...(message === undefined ? {} : { message }), served: decision }, onAnswer: () => undefined })));
  return { host, done: async () => { await act(async () => root.unmount()); host.remove(); } };
};

it("shows the served context line instead of the step message, and the served dropdown label", async () => {
  const { host, done } = await render(served({ context: "UCPath did not confirm the save.", choiceLabel: "Answer" },
    [{ id: "check-again", label: "Check again", hint: "Read it again.", send: send("a") }, { id: "didnt-land", label: "It didn't land", hint: "Nothing was sent.", send: send("b") }]), "Write intent 1 is parked");
  try {
    assert.match(host.textContent ?? "", /UCPath did not confirm the save\./u);
    assert.doesNotMatch(host.textContent ?? "", /Write intent/u);
    assert.match(host.textContent ?? "", /Answer/u);
    assert.doesNotMatch(host.textContent ?? "", /Next step/u);
  } finally { await done(); }
});

it("shows the hire review's split legal and preferred names before approval", async () => {
  const context = "Legal name: first Jonathan, middle Michael, last Smith. Preferred name: first Jon, no middle name, last Smith.";
  const { host, done } = await render(RunDecisionWireSchema.parse({ type: "review-before-write", title: "Review before write", context,
    options: [{ id: "new-hire", label: "Approve new hire", hint: "File a new hire.", send: { via: "gate-arm", gateNodeId: "hire-review", expectedVersion: 7, arm: "new-hire" } }] }));
  try { assert.match(host.textContent ?? "", new RegExp(context.replaceAll(".", "\\."), "u")); } finally { await done(); }
});

it("prefills a served text input with the rejected value", async () => {
  const { host, done } = await render(served({}, [{ id: "retry-with-value", label: "Enter EID", hint: "Start again.", send: { via: "start-plan" },
    input: { kind: "text", label: "Employee ID", pattern: "^10\\d{6}$", prefill: "1003187" } }]));
  try {
    assert.equal(host.querySelector<HTMLInputElement>("input")?.value, "1003187");
    assert.equal([...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Enter EID")?.disabled, true, "the rejected value does not match the pattern");
  } finally { await done(); }
});
