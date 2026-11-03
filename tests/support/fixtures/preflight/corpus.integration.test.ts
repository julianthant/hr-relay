import assert from "node:assert/strict";
import { it } from "vitest";
import { executePreflightCase, preflightFaultCases } from "./corpus.js";
it("rejects a detector that claims an injected fault is healthy", async()=>{
  const [entry] = preflightFaultCases(); assert.ok(entry);
  await assert.rejects(executePreflightCase(entry,runners=>runners.map(runner=>({...runner,async run(){return {state:"healthy" as const,check:runner.check,summary:"incorrect healthy observation"};}}))),/injected fault|terminal|Expected values/u);
});
