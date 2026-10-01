import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { repeatEvidenceDigest } from "../../../../src/domain/run/rerun.js";
import { FingerprintSchema } from "../../../../src/domain/ids.js";

const bindings = [{ kind: "test-data-local", inputPath: "documentNumber",
  name: "separationsKualiFinalizationCanaryDocumentNumber", sourceId: "10000000-0000-4000-8000-000000000001" }] as const;

describe("protected rerun evidence", () => {
  it("binds safe completion facts and retained source identity instead of protected proof values", () => {
    const proof = (documentNumber: string, transactionId = "T123456") => ({ status: "committed",
      completionProof: { schemaHash: FingerprintSchema.parse("a".repeat(64)), value: { documentNumber, transactionId } } });
    assert.equal(repeatEvidenceDigest(proof("12345678"), bindings), repeatEvidenceDigest(proof("87654321"), bindings));
    assert.notEqual(repeatEvidenceDigest(proof("12345678"), bindings), repeatEvidenceDigest(proof("12345678", "T234567"), bindings));
    assert.notEqual(repeatEvidenceDigest(proof("12345678"), []), repeatEvidenceDigest(proof("87654321"), []));
    assert.notEqual(repeatEvidenceDigest(proof("12345678"), bindings), repeatEvidenceDigest(proof("12345678"),
      [{ ...bindings[0], sourceId: "10000000-0000-4000-8000-000000000002" }]));
  });
});
