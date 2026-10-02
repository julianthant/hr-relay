import assert from "node:assert/strict";
import { it } from "vitest";
import { RuntimeCapabilitySchema } from "../../../../../src/models/preflight/preflight-contract.js";
import { runtimeFixture } from "../../../../support/fixtures/preflight/runtime-fixture.js";
it("runs the production factory and doctor with healthy private inputs", async () => {
  const f = runtimeFixture(RuntimeCapabilitySchema.options);
  try { const report = await f.report(); assert.deepEqual(report.results.filter(result=>result.status!=="pass"), []); }
  finally {f.close();}
});
import { executePreflightCorpus, auditPreflightExecutions } from "../../../../support/fixtures/preflight/corpus.js";
it("executes every manifest, mapped dependency and restoration with production detectors", async () => {
  const results=await executePreflightCorpus();
  assert.equal(new Set(results.map(result=>result.scenario)).size,13);
  console.info("[setup-corpus]"+JSON.stringify(results.map(({scenario,dependency,variant,check,reportDigest,restored,actionCount,externalCommitCount,terminal})=>({scenario,dependency,variant,check,reportDigest,restored,actionCount,externalCommitCount,terminal}))));
  assert.doesNotMatch(JSON.stringify(results),/private-marker|setup-corpus-/u);
  assert.throws(()=>auditPreflightExecutions(results.slice(1)),/missing or extra/u);
  assert.throws(()=>auditPreflightExecutions([...results,results[0]]),/missing or extra/u);
  const mismatched=structuredClone(results);assert.ok(mismatched[0]);mismatched[0].reportDigest="0".repeat(64);
  assert.throws(()=>auditPreflightExecutions(mismatched),/mismatched detector evidence/u);
  const unknown=structuredClone(results);assert.ok(unknown[0]);Reflect.set(unknown[0],"scenario","preflight/unknown");
  assert.throws(()=>auditPreflightExecutions(unknown));
});
it("rejects a detector that claims an injected fault is healthy", async()=>{
  await assert.rejects(executePreflightCorpus(runners=>runners.map(runner=>({...runner,async run(){return {state:"healthy" as const,check:runner.check,summary:"incorrect healthy observation"};}}))),/injected fault|terminal|Expected values/u);
});
