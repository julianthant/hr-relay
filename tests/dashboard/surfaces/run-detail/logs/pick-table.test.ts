// @vitest-environment jsdom
import assert from "node:assert/strict";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, it } from "vitest";
import { logDecisionExamples } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision-fixture.js";
import { LogDecisionBlock, type DecisionAnswerHandler } from "../../../../../src/dashboard/surfaces/run-detail/logs/log-decision.js";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined;
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren(); });

const entry = logDecisionExamples.find(item => item.id === "review-candidates")?.entry;
const radios = () => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const confirm = () => [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Confirm")!;
const typed = () => document.querySelector<HTMLInputElement>('input[aria-label="Enter employee ID"]')!;
const type = (value: string) => act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(typed(), value); typed().dispatchEvent(new Event("input", { bubbles: true })); });

it("picks one served row, ends in the typed row, and confirms only a valid answer", async () => {
  assert.ok(entry?.kind === "decision");
  const answers: unknown[] = [];
  const onAnswer: DecisionAnswerHandler = (_option, answer) => answers.push(answer);
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root?.render(createElement(LogDecisionBlock, { decision: entry.decision, onAnswer })));
  assert.equal(radios().length, 4);
  assert.equal(radios().at(-1)?.getAttribute("aria-label"), "Enter employee ID");
  assert.equal(radios().every(radio => radio.getAttribute("aria-checked") === "false"), true);
  assert.equal(confirm().disabled, true);
  assert.match(host.textContent ?? "", /On leave/u);
  await act(async () => radios()[1].click());
  assert.equal(radios()[1].getAttribute("aria-checked"), "true"); assert.equal(confirm().disabled, false);
  await type("10000123");
  assert.equal(radios()[1].getAttribute("aria-checked"), "false"); assert.equal(radios().at(-1)?.getAttribute("aria-checked"), "true");
  assert.equal(confirm().disabled, true);
  await type("10000077");
  assert.equal(confirm().disabled, false);
  await act(async () => radios()[0].click());
  assert.equal(typed().value, "");
  await act(async () => radios().at(-1)!.click());
  assert.equal(confirm().disabled, true);
  await type("10000077");
  await act(async () => confirm().click());
  assert.deepEqual(answers, [{ typed: "10000077" }]);
});

it("locks the table without an answer handler and resets the pick when the served decision changes", async () => {
  assert.ok(entry?.kind === "decision");
  const host = document.body.appendChild(document.createElement("div")); root = createRoot(host);
  await act(async () => root?.render(createElement(LogDecisionBlock, { decision: entry.decision, onAnswer: () => undefined })));
  await act(async () => radios()[0].click());
  assert.equal(confirm().disabled, false);
  const served = entry.decision.served;
  const changed = { ...entry.decision, served: { ...served, title: "Which Alex Morgan is this run about? (revised)" } };
  await act(async () => root?.render(createElement(LogDecisionBlock, { decision: changed, onAnswer: () => undefined })));
  assert.equal(radios()[0].getAttribute("aria-checked"), "false");
  await act(async () => root?.render(createElement(LogDecisionBlock, { decision: changed })));
  assert.equal(radios().every(radio => radio.disabled), true); assert.equal(confirm().disabled, true);
});
