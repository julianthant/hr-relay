import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../src/models/trust/preflight-scenarios.js";
import { auditPreflightExecutions,executePreflightCase,preflightFaultCases,type CorpusExecution } from "../../support/fixtures/preflight/corpus.js";
describe.sequential("preflight fault cases", () => {
  const results: CorpusExecution[] = [];
  for (const entry of preflightFaultCases()) {
    it(`detects ${entry.dependency.id} / ${entry.variant} and restores healthy state`, async () => {
      results.push(await executePreflightCase(entry));
    });
  }

  it("executes every manifest, mapped dependency and restoration with production detectors", () => {
    auditPreflightExecutions(results);
    assert.equal(new Set(results.map(result=>result.scenario)).size,PREFLIGHT_SCENARIO_MANIFESTS.length);
    console.info("[setup-corpus]"+JSON.stringify(results.map(({scenario,dependency,variant,check,reportDigest,restored,actionCount,externalCommitCount,terminal})=>({scenario,dependency,variant,check,reportDigest,restored,actionCount,externalCommitCount,terminal}))));
    assert.doesNotMatch(JSON.stringify(results),/private-marker|setup-corpus-/u);
    assert.throws(()=>auditPreflightExecutions(results.slice(1)),/missing or extra/u);
    assert.throws(()=>auditPreflightExecutions([...results,results[0]]),/missing or extra/u);
    const mismatched=structuredClone(results);assert.ok(mismatched[0]);mismatched[0].reportDigest="0".repeat(64);
    assert.throws(()=>auditPreflightExecutions(mismatched),/mismatched detector evidence/u);
    const unknown=structuredClone(results);assert.ok(unknown[0]);Reflect.set(unknown[0],"scenario","preflight/unknown");
    assert.throws(()=>auditPreflightExecutions(unknown));
  });
});
