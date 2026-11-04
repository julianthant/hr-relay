import assert from "node:assert/strict";
import { it } from "vitest";
import { predecessorKualiEvidence } from "../../../support/helpers/backend/predecessor-kuali-evidence.js";

it("persists predecessor input, completed Kuali proof, linked result and receipt, then refuses them without stopped conversion", async () => {
  const f = await predecessorKualiEvidence();
  try {
    const { buildRunEvidenceReceipt } = await import("../../../../src/backend/runs/provenance/evidence-receipt.js");
    const { separationsKualiFinalizationDescriptor: descriptor, separationsDescriptor } = await import("../../../support/helpers/registered-workflows.js");
    const { deriveSchemaHash } = await import("../../../../src/models/validation/schema-bound-value.js");
    const { KualiSavedFinalizationProofSchema } = await import("../../../../src/models/ui/kuali-separation-finalization.js");
    const proof = f.writes[0]?.intent; assert.ok(proof?.status === "committed");
    assert.equal(proof.completionProof.schemaHash, "9c8d2c765c9eb480c1b37f7e58b050edb5f907ce1392ecbdfe8489f9f875b81c");
    assert.notEqual(proof.completionProof.schemaHash, deriveSchemaHash(KualiSavedFinalizationProofSchema, "output"));
    assert.notEqual(f.run.input.parsed.schemaHash, deriveSchemaHash(descriptor.canonicalInput, "output"));
    assert.throws(() => buildRunEvidenceReceipt({ descriptor, run: f.run, result: f.result, checkpoints: f.checkpoints, writes: f.writes, gateResults: f.gates }), /canonical-input/u);
    const { collectEvidenceSchemaAdmissions } = await import("../../../../src/backend/storage/sqlite/evidence-schema-upgrade.js");
    const { evidenceSchemaSourceDigest } = await import("../../../../src/models/storage/evidence-schema-admission.js");
    const { canonicalJsonStringify } = await import("../../../../src/rules/validation/canonical-json.js");
    const admissions = collectEvidenceSchemaAdmissions({ descriptors: [descriptor, separationsDescriptor], runs: [f.run, f.separationsRun], writes: f.writes.map(write => write.intent),
      checkpoints: f.checkpoints, results: [f.result], gates: f.gates });
    const receipt = buildRunEvidenceReceipt({ descriptor, run: f.run, result: f.result, checkpoints: f.checkpoints, writes: f.writes, gateResults: f.gates,
      schemaReader(owner, source, oldHash, currentHash) {
        if (oldHash === currentHash) return oldHash;
        const proof = admissions.find(entry => canonicalJsonStringify(entry.owner) === canonicalJsonStringify(owner));
        assert.ok(proof); assert.equal(proof.sourceDigest, evidenceSchemaSourceDigest(owner, source));
        assert.equal(proof.sourceSchemaHash, oldHash); assert.equal(proof.currentSchemaHash, currentHash); return currentHash;
      } });
    assert.deepEqual(receipt, f.receipt);
    assert.equal(f.separationsRun.input.parsed.schemaHash, "66dc2f33bf56808164be764f921a1e5a2a95afd5e0a7b760fdba687ee81575dc");
    assert.ok(admissions.some(entry => entry.owner.kind === "run-input" && entry.owner.id === f.separationsRun.envelope.runId));
  } finally { await f.cleanup(); }
});
