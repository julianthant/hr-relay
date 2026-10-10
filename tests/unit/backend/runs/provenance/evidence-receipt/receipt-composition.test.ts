import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildRunEvidenceReceipt } from "../../../../../../src/backend/runs/provenance/evidence-receipt.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { kualiReceiptEvidence } from "../../../../../support/fixtures/receipt-run-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../../../../../support/helpers/registered-workflows.js";

describe("receipt composition", () => {
  it("derives complete current classified facts and stable evidence references from exact admitted evidence", () => {
    const evidence = kualiReceiptEvidence();
    const input = { descriptor: separationsKualiFinalizationDescriptor, run: evidence.run,
      result: evidence.result, checkpoints: evidence.checkpoints, writes: evidence.writes };
    const current = buildRunEvidenceReceipt(input);
    assert.equal(current.composition, 5);
    assert.equal(canonicalJsonStringify(buildRunEvidenceReceipt(input)), canonicalJsonStringify(current));
    assert.ok(current.observations.length > 0);
    const valued = current.observations.filter(fact => fact.state === "satisfied");
    assert.ok(valued.length > 0);
    for (const fact of valued) {
      assert.ok(fact.state === "satisfied");
      assert.equal(fact.value.state, "allowed");
      assert.equal(fact.value.transform, "allow");
      assert.ok(fact.value.state === "allowed");
      assert.ok(fact.value.value !== undefined);
      assert.ok(!Object.hasOwn(fact.value, "rawValue"));
      assert.ok(fact.source.kind.length > 0);
    }
    const proof = current.actions.find(action => action.kind === "commit")?.proved;
    assert.ok(proof);
    assert.notEqual(proof.idempotencyKeyDigest, "withheld-protected-input");
    assert.ok(proof.values.every(value => value.state === "allowed" && value.transform === "allow"));
  });
});
