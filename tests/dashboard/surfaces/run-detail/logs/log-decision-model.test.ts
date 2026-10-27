// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act,createElement } from "react";
import { createRoot,type Root } from "react-dom/client";
import { afterEach,describe,it } from "vitest";
import { logDecisionExamples } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision-fixture.js";
import { decisionActionResult,decisionAnswerValid } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision-model.js";
import { LogDecisionBlock } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision.js";
import { type LogEntry } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-feed-model.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });
function example(id: string): Extract<LogEntry, { kind: "decision" }> { const entry = logDecisionExamples.find(item => item.id === id)?.entry; assert.ok(entry && entry.kind === "decision"); return entry; }
async function mount(id: string, onAction?: Parameters<typeof LogDecisionBlock>[0]["onAction"]) { const host = document.createElement("div"); document.body.append(host); root = createRoot(host); await act(async () => root?.render(createElement(LogDecisionBlock, { decision: example(id).decision, onAction }))); }
function button(label: string) { const el = [...document.querySelectorAll("button")].find(item => item.textContent === label); assert.ok(el, label); return el; }

describe("approved log decisions", () => {
  it("requires only the selected continuation answer", () => {
    const action = example("parked").decision.actions?.find(item => item.id === "parked-0"); assert.ok(action);
    assert.equal(decisionAnswerValid(action, {}), false);
    assert.equal(decisionAnswerValid(action, { outcome: "present", transaction: " " }), false);
    assert.equal(decisionAnswerValid(action, { outcome: "absent" }), true);
    assert.throws(() => decisionActionResult(action, { outcome: "present" }), /answer-incomplete/u);
    assert.match(decisionActionResult(action, { outcome: "present", transaction: " SIM-042 " }).message, /Transaction SIM-042 is present/u);
    const date = example("review-fields").decision.actions?.[0]; assert.ok(date);
    for (const value of ["", "9/25/2026", "2026-02-30", "2026-99-99"]) assert.equal(decisionAnswerValid(date, { date: value }), false);
    assert.equal(decisionAnswerValid(date, { date: "2026-09-25" }), true);
    const candidate = example("review-candidates").decision.actions?.[0]; assert.ok(candidate);
    assert.equal(decisionAnswerValid(candidate, { candidate: "DEMO-unlisted" }), false);
    assert.equal(decisionAnswerValid(candidate, { candidate: "DEMO-2196" }), true);
    const eid = example("employee-not-found").decision.actions?.find(item => item.input?.kind === "text"); assert.ok(eid);
    for (const value of ["", "   ", "1023456", "1023456a"]) assert.equal(decisionAnswerValid(eid, { text: value }), false);
    assert.equal(decisionAnswerValid(eid, { text: " 10000002 " }), true);
    assert.match(decisionActionResult(eid, { text: " 10000002 " }).message, /^Employee ID: 10000002\. /u);
  });
  it("offers Check again beside every manual entry when Relay cannot find something", () => {
    for (const id of ["parked", "employee-not-found", "document-not-found"]) {
      assert.deepEqual(example(id).decision.actions?.map(action => action.label).slice(0, 1), ["Check again"], id);
    }
  });
  it("collects a typed value with its hint and submits only the trimmed text", async () => {
    const calls: unknown[] = [];
    await mount("employee-not-found", (action, answer) => calls.push([action.id, answer]));
    await act(async () => button("Enter EID").click());
    assert.equal(button("Continue run").disabled, true);
    assert.match(document.body.textContent ?? "", /Employee ID required/u);
    const input = document.querySelector('[role="dialog"] input') as HTMLInputElement;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "10000002"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    assert.equal(button("Continue run").disabled, false);
    assert.match(document.body.textContent ?? "", /Relay reads this EID in UCPath before continuing/u);
    await act(async () => button("Continue run").click());
    assert.deepEqual(calls, [["employee-not-found-enter", { text: "10000002" }]]);
  });
  it("never offers a submit retry while the result is unknown", () => {
    for (const id of ["parked", "verification", "park-unavailable", "failure-attempting", "failure-unknown", "failure-unavailable", "screenshot-unavailable"]) {
      assert.ok(example(id).decision.actions?.every(action => !/retry/iu.test(action.label)), id);
    }
  });
  it("shows the failed action, last completed action and all browsers without duplicate time", async () => {
    await mount("failure-prepared");
    assert.equal(document.querySelector("time"), null);
    assert.match(document.body.textContent ?? "", /The date field could not be filled/u);
    assert.match(document.body.textContent ?? "", /While trying to enter last day worked/u);
    assert.match(document.body.textContent ?? "", /Last completed · Employee and employment record confirmed/u);
    assert.equal(document.querySelectorAll("figure").length, 3);
    assert.equal(button("Correct date").disabled, true);
    assert.equal(document.querySelector("details"), null);
  });
  it("opens an unselected result form and submits only the needed answer", async () => {
    const calls: unknown[] = [];
    await mount("parked", (action, answer) => calls.push([action.id, answer]));
    await act(async () => button("Check result").click());
    assert.equal(button("Continue run").disabled, true);
    assert.equal(document.querySelector('input[type="text"]'), null);
    const absent = document.querySelector('input[value="absent"]') as HTMLInputElement;
    await act(async () => absent.click());
    assert.equal(button("Continue run").disabled, false);
    await act(async () => button("Continue run").click());
    assert.deepEqual(calls, [["parked-0", { outcome: "absent" }]]);
  });
  it("keeps browser-open failures concise and offers no external action", async () => {
    await mount("configuration", () => {});
    assert.match(document.body.textContent ?? "", /UCPath did not open. No screenshot was captured/u);
    assert.equal(document.querySelector("button"), null);
    assert.equal(document.querySelector("figure"), null);
  });
});
