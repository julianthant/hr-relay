import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { buildRunEvidenceReceipt } from "../../../../../../src/backend/runs/provenance/evidence-receipt.js";
import { canonicalJsonStringify } from "../../../../../../src/rules/validation/canonical-json.js";
import { sha256Hex } from "../../../../../../src/rules/validation/sha256.js";
import { kualiReceiptEvidence } from "../../../../../support/fixtures/receipt-run-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../../../../../support/helpers/registered-workflows.js";

const historicalDigests = [
  "1d698f9f0326bef4de3f0386a9011127ee43cc0a4aecb2662f24cb941684ff38",
  "745636ecbf0b7a0671f5b9c5d8afdcd52ade1202886156495f15647290eb28cc",
  "7bcc88e2eb2b755b5dc3583ec5fb5da34fdb1b96a0f0798cde1fd5c547798eb2",
  "bbd2797e6dde6e6182b6c452b1a63fcd29f555bfb5fdd39721f7ad7abc612812",
];

function derive(composition: 1 | 2 | 3 | 4 | 5) {
  const evidence = kualiReceiptEvidence({ contractFingerprint: "30164dc81af7ded8c9d330308710f0c4af24c982c5c7ec9207f2aa336a468154" });
  return buildRunEvidenceReceipt({ descriptor: separationsKualiFinalizationDescriptor,
    run: evidence.run, result: evidence.result, checkpoints: evidence.checkpoints, writes: evidence.writes,
  }, composition);
}

describe("receipt composition", () => {
  it.each([1, 2, 3, 4] as const)("preserves exact composition %i bytes frozen from the pre-amendment source", composition => {
    assert.equal(sha256Hex(canonicalJsonStringify(derive(composition))), historicalDigests[composition - 1]);
  });

  it("derives new composition 5 with complete classified facts and stable evidence references", () => {
    const historical = derive(4);
    const current = derive(5);
    assert.equal(current.composition, 5);
    assert.equal(current.receiptId, historical.receiptId);
    assert.deepEqual(current.observations.map(fact => fact.id), historical.observations.map(fact => fact.id));
    assert.ok(current.observations.length > 0);
    const valued = current.observations.filter(fact => fact.state === "satisfied");
    assert.ok(valued.length > 0);
    for (const fact of valued) {
      assert.equal(fact.state, "satisfied");
      assert.ok(fact.state === "satisfied");
      assert.equal(fact.value.state, "allowed");
      assert.equal(fact.value.transform, "allow");
      assert.equal(fact.value.rawValue, undefined);
      const old = historical.observations.find(candidate => candidate.id === fact.id);
      assert.ok(fact.value.state === "allowed");
      assert.ok(old?.state === "satisfied");
      assert.deepEqual(fact.value.value, old.value.rawValue);
      assert.equal(fact.value.classification, old.value.classification);
    }
    const proof = current.actions.find(action => action.kind === "commit")?.proved;
    assert.ok(proof);
    assert.notEqual(proof.idempotencyKeyDigest, "withheld-protected-input");
    assert.ok(proof.values.every(value => value.state === "allowed" && value.transform === "allow"));
  });
});
