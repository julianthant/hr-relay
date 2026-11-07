import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CandidateTableWireSchema, DecisionOptionWireSchema, RunDecisionWireSchema } from "../../../src/models/dashboard/run-decision.js";

const option = (id: string, actionKey = id) => ({ id, label: id, hint: `${id} hint`, send: { via: "action" as const, actionKey } });

describe("RunDecisionWireSchema", () => {
  it("accepts a served decision and rejects duplicate ids, duplicate action keys and two recommendations", () => {
    assert.ok(RunDecisionWireSchema.safeParse({ type: "paused", title: "Paused", options: [option("resume"), option("cancel-run")] }).success);
    assert.ok(!RunDecisionWireSchema.safeParse({ type: "paused", title: "Paused", options: [option("resume"), option("resume", "other")] }).success);
    assert.ok(!RunDecisionWireSchema.safeParse({ type: "paused", title: "Paused", options: [option("a", "k"), option("b", "k")] }).success);
    assert.ok(!RunDecisionWireSchema.safeParse({ type: "paused", title: "Paused", options: [{ ...option("a"), recommended: true }, { ...option("b"), recommended: true }] }).success);
    assert.ok(!RunDecisionWireSchema.safeParse({ type: "paused", title: "Paused", options: [option("a")], extra: true }).success);
  });

  it("keeps cancelling a line and an answer on a declared option", () => {
    assert.ok(!RunDecisionWireSchema.safeParse({ type: "cancelling", title: "Cancelling", options: [option("a")] }).success);
    const answer = { optionId: "resume", label: "Resume", at: "2026-11-07T10:00:00.000Z", actor: { kind: "assistant", onBehalfOf: { name: "Sam Lee" } } };
    assert.ok(RunDecisionWireSchema.safeParse({ type: "paused", title: "Paused", options: [option("resume")], answer }).success);
    assert.ok(!RunDecisionWireSchema.safeParse({ type: "paused", title: "Paused", options: [option("cancel-run")], answer }).success);
    assert.ok(!RunDecisionWireSchema.safeParse({ type: "cancelling", title: "Cancelling", options: [], answer }).success, "a line names no option to answer");
  });

  it("pairs a verification send with its verification input, and never on another option", () => {
    const send = { via: "verification", presentActionKey: "recheck-write", absentActionKey: "resolve-write-absent", transactionPattern: "^T\\d+$" };
    assert.ok(DecisionOptionWireSchema.safeParse({ id: "check-result", label: "Check result", hint: "h", send, input: { kind: "verification", question: "Was it submitted?" } }).success);
    assert.ok(!DecisionOptionWireSchema.safeParse({ id: "check-result", label: "Check result", hint: "h", send }).success);
    assert.ok(!DecisionOptionWireSchema.safeParse({ ...option("check-again"), input: { kind: "verification", question: "Was it submitted?" } }).success);
    assert.ok(!DecisionOptionWireSchema.safeParse({ id: "x", label: "x", hint: "h", send: { ...send, transactionPattern: "(" }, input: { kind: "verification", question: "q" } }).success);
  });
});

describe("CandidateTableWireSchema", () => {
  const table = { title: "Search results", columns: [{ id: "name", label: "Name" }], rows: [{ id: "a", name: "A", cells: [{ columnId: "name", value: "A", tone: "attention" }] }] };
  it("accepts unique rows on declared columns and refuses the rest", () => {
    assert.ok(CandidateTableWireSchema.safeParse(table).success);
    assert.ok(!CandidateTableWireSchema.safeParse({ ...table, rows: [table.rows[0], table.rows[0]] }).success);
    assert.ok(!CandidateTableWireSchema.safeParse({ ...table, rows: [{ ...table.rows[0], cells: [{ columnId: "other", value: "A" }] }] }).success);
    assert.ok(!CandidateTableWireSchema.safeParse({ ...table, typed: { label: "Enter row number", placeholder: "Row", pattern: "(" } }).success);
  });
});
