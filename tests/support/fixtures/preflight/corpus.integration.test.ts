import assert from "node:assert/strict";
import { it } from "vitest";
import { executePreflightCorpus } from "./corpus.js";
it("rejects a detector that claims an injected fault is healthy", async()=>{
  await assert.rejects(executePreflightCorpus(runners=>runners.map(runner=>({...runner,async run(){return {state:"healthy" as const,check:runner.check,summary:"incorrect healthy observation"};}}))),/injected fault|terminal|Expected values/u);
});
