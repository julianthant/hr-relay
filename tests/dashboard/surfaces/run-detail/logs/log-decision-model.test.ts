// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, it } from "vitest";
import { logDecisionExamples } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision-fixture.js";
import { answeredRow, choiceOptions, decisionAnswerValid, recommendedOption } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision-model.js";
import { LogDecisionBlock, type DecisionAnswerHandler } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision.js";
import { type LogEntry } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";
import { RunDecisionWireSchema } from "../../../../../src/models/dashboard/run-decision.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });
function example(id: string): Extract<LogEntry, { kind: "decision" }> { const entry: LogEntry | undefined = logDecisionExamples.find(item => item.id === id)?.entry; assert.ok(entry && entry.kind === "decision"); return entry; }
function served(id: string) { const decision = example(id).decision.served; assert.ok(decision, id); return decision; }
function option(id: string, optionId: string) { const found = served(id).options.find(item => item.id === optionId); assert.ok(found, optionId); return found; }
async function mount(id: string, onAnswer?: DecisionAnswerHandler, onCancel?: () => void) {
  const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await act(async () => root?.render(createElement(LogDecisionBlock, { decision: example(id).decision, onAnswer, onCancel })));
}
const button = (label: string) => { const el = [...document.querySelectorAll("button")].find(item => item.textContent === label); assert.ok(el, label); return el; };
const type = async (input: HTMLInputElement, value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });

describe("served log decisions", () => {
  it("serves every approved example as a valid decision", () => {
    for (const { entry } of logDecisionExamples as readonly { entry: LogEntry }[]) if (entry.kind === "decision" && entry.decision.served !== undefined) RunDecisionWireSchema.parse(entry.decision.served);
  });
  it("preselects the served recommended option and keeps Cancel run out of the choices", () => {
    assert.equal(recommendedOption(served("employee-not-found"))?.id, "employee-not-found-enter");
    assert.deepEqual(choiceOptions(served("review-candidates")).map(item => item.id), ["review-candidates-0"]);
  });
  it("requires only the selected option's answer", () => {
    const check = option("parked", "parked-0");
    assert.equal(decisionAnswerValid(check, {}), false);
    assert.equal(decisionAnswerValid(check, { outcome: "present", transaction: " " }), false);
    assert.equal(decisionAnswerValid(check, { outcome: "present", transaction: "SIM-042" }), true);
    assert.equal(decisionAnswerValid(check, { outcome: "absent" }), true);
    const date = option("review-fields", "review-fields-0");
    for (const value of ["", "9/25/2026", "2026-02-30", "2026-99-99"]) assert.equal(decisionAnswerValid(date, { date: value }), false);
    assert.equal(decisionAnswerValid(date, { date: "2026-09-25" }), true);
    const eid = option("employee-not-found", "employee-not-found-enter");
    for (const value of ["", "   ", "1023456", "1023456a"]) assert.equal(decisionAnswerValid(eid, { text: value }), false);
    assert.equal(decisionAnswerValid(eid, { text: " 10873698 " }), true);
    assert.equal(decisionAnswerValid(option("employee-not-found", "employee-not-found-check"), {}), true);
  });
  it("accepts a picked row or a typed value that names a served row, never both or neither", () => {
    const pick = option("review-candidates", "review-candidates-0");
    assert.equal(decisionAnswerValid(pick, {}), false);
    assert.equal(decisionAnswerValid(pick, { candidate: "10000042" }), true);
    assert.equal(decisionAnswerValid(pick, { candidate: "unlisted" }), false);
    assert.equal(decisionAnswerValid(pick, { typed: "10000077" }), true);
    assert.equal(decisionAnswerValid(pick, { typed: "10000123" }), false);
    assert.equal(decisionAnswerValid(pick, { typed: "1000" }), false);
    assert.equal(decisionAnswerValid(pick, { candidate: "10000042", typed: "10000077" }), false);
    assert.equal(answeredRow(pick, { typed: " 10000077 " })?.name, "Morgan, Alexis");
  });
  it("never offers a submit retry while the result is unknown", () => {
    for (const id of ["parked", "verification", "park-unavailable", "failure-attempting", "failure-unknown", "transport-unknown"]) {
      assert.ok(served(id).options.every(item => !/retry/iu.test(item.label)), id);
    }
  });
  it("collects a typed value and submits only the trimmed text", async () => {
    const calls: unknown[] = [];
    await mount("employee-not-found", (picked, answer) => calls.push([picked.id, answer]));
    assert.equal(button("Confirm").disabled, true);
    assert.ok(button("Enter EID"));
    await type(document.querySelector('input[type="text"], input:not([type])') as HTMLInputElement, " 10873698 ");
    assert.equal(button("Confirm").disabled, false);
    await act(async () => button("Confirm").click());
    assert.deepEqual(calls, [["employee-not-found-enter", { text: " 10873698 " }]]);
  });
  it("opens an unselected check and submits only the needed answer", async () => {
    const calls: unknown[] = [];
    await mount("parked", (picked, answer) => calls.push([picked.id, answer]));
    assert.equal(button("Confirm").disabled, true);
    assert.equal(document.querySelector('input[type="text"]'), null);
    await act(async () => (document.querySelector('input[value="absent"]') as HTMLInputElement).click());
    assert.equal(button("Confirm").disabled, false);
    await act(async () => button("Confirm").click());
    assert.deepEqual(calls, [["parked-0", { outcome: "absent" }]]);
  });
  it("cancels the run only from Cancel run", async () => {
    const calls: string[] = [];
    await mount("failure-no-write", () => calls.push("answer"), () => calls.push("cancel"));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    await act(async () => button("Cancel run").click());
    assert.deepEqual(calls, ["cancel"]);
  });
  it("shows the failed action, last completed action and all browsers", async () => {
    await mount("failure-prepared");
    assert.match(document.body.textContent ?? "", /The date field could not be filled/u);
    assert.match(document.body.textContent ?? "", /While trying to enter last day worked/u);
    assert.match(document.body.textContent ?? "", /Last completed · Employee and employment record confirmed/u);
    assert.equal(document.querySelectorAll("figure").length, 3);
    assert.equal(button("Correct date").disabled, true);
  });
  it("draws a decision with no served options as evidence only", async () => {
    await mount("configuration", () => {});
    assert.match(document.body.textContent ?? "", /UCPath did not open. No screenshot was captured/u);
    assert.equal(document.querySelector("button"), null);
    assert.equal(document.querySelector("figure"), null);
  });
  it("keeps Confirm disabled when a served decision has no choice, and locks the date without an answer handler", async () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const base = example("failure-no-write").decision;
    await act(async () => root?.render(createElement(LogDecisionBlock, { decision: { ...base, served: { ...served("failure-no-write"), options: [] } }, onAnswer: () => undefined })));
    assert.equal(button("Confirm").disabled, true);
    await act(async () => root?.render(createElement(LogDecisionBlock, { decision: example("review-fields").decision })));
    assert.equal(document.querySelector('[role="spinbutton"]')?.getAttribute("aria-disabled"), "true");
  });
  it("collapses an answered decision to one line with who answered", async () => {
    const host = document.createElement("div"); document.body.append(host); root = createRoot(host);
    const base = example("failure-no-write").decision;
    await act(async () => root?.render(createElement(LogDecisionBlock, { decision: { ...base, answered: { optionId: "x", label: "Check again", at: "2026-08-03T16:41:05.000Z" as never, actor: { kind: "assistant", onBehalfOf: { name: "Alex Rivera" } } } } })));
    assert.match(host.textContent ?? "", /^Answered: Check again · .+ · by assistant on behalf of Alex Rivera$/u);
    assert.equal(host.querySelector("button"), null);
  });
});
