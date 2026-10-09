import assert from "node:assert/strict";
import { it } from "vitest";
import { PREFLIGHT_SCENARIO_MANIFESTS } from "../../../src/models/trust/preflight-scenarios.js";
import { RUNTIME_DEPENDENCIES, auditRuntimeDependencyCoverage, RUNTIME_DEPENDENCY_REGISTRY } from "../../../src/models/runtime/runtime-dependencies.js";
import { auditPreflightExecutions, executePreflightCorpus, preflightFaultCases } from "../../support/fixtures/preflight/corpus.js";

it("executes and closes every preflight manifest and dependency against production detectors",async()=>{
  assert.deepEqual(auditRuntimeDependencyCoverage(RUNTIME_DEPENDENCY_REGISTRY),[]);
  const executions=await executePreflightCorpus();
  assert.deepEqual([...new Set(executions.map(entry=>entry.scenario))].sort(),PREFLIGHT_SCENARIO_MANIFESTS.map(entry=>entry.id).sort());
  assert.deepEqual([...new Set(executions.map(entry=>entry.dependency))].sort(),RUNTIME_DEPENDENCIES.map(entry=>entry.id).sort());
  assert.equal(executions.length,preflightFaultCases().length);
  assert.throws(()=>auditPreflightExecutions(executions.slice(1)),/missing or extra/u);
  assert.throws(()=>auditPreflightExecutions([...executions,executions[0]]),/missing or extra/u);
  const wrongEvidence=structuredClone(executions);assert.ok(wrongEvidence[0]);wrongEvidence[0].evidence=["invented proof"];
  assert.throws(()=>auditPreflightExecutions(wrongEvidence));
  const wrongDigest=structuredClone(executions);assert.ok(wrongDigest[0]);wrongDigest[0].reportDigest="0".repeat(64);
  assert.throws(()=>auditPreflightExecutions(wrongDigest),/mismatched detector evidence/u);
});
