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
    const { admissions, retirements } = collectEvidenceSchemaAdmissions({ descriptors: [descriptor, separationsDescriptor], runs: [f.run, f.separationsRun], writes: f.writes.map(write => write.intent),
      checkpoints: f.checkpoints, results: [f.result], gates: f.gates });
    const schemaReader: import("../../../../src/models/storage/evidence-schema-admission.js").EvidenceSchemaReader = (owner, source, oldHash, currentHash) => {
      if (oldHash === currentHash) return oldHash;
      const proof = admissions.find(entry => canonicalJsonStringify(entry.owner) === canonicalJsonStringify(owner));
      assert.ok(proof); assert.equal(proof.sourceDigest, evidenceSchemaSourceDigest(owner, source));
      assert.equal(proof.sourceSchemaHash, oldHash); assert.equal(proof.currentSchemaHash, currentHash); return currentHash;
    };
    const receipt = buildRunEvidenceReceipt({ descriptor, run: f.run, result: f.result, checkpoints: f.checkpoints, writes: f.writes, gateResults: f.gates,
      schemaReader });
    assert.deepEqual(receipt, f.receipt);
    const { descriptorRuntimeNodes, workflowTerminalResultExecution } = await import("../../../../src/workflow-kit/workflow.js");
    const { loadCheckpoint, CheckpointExpectationSchema } = await import("../../../../src/models/workflow/checkpoint.js");
    const { manualClock } = await import("../../../../src/rules/time/clock.js");
    const task = descriptorRuntimeNodes(descriptor).find(node => node.kind === "task" && f.checkpoints.some(checkpoint => checkpoint.nodeId === node.id && checkpoint.output.schemaHash !== deriveSchemaHash(node.uses.output, "output")));
    assert.ok(task?.kind === "task");
    const checkpoint = f.checkpoints.find(checkpoint => checkpoint.nodeId === task.id); assert.ok(checkpoint);
    const expectation = CheckpointExpectationSchema.parse({ descriptorVersion: descriptor.version, contractFingerprint: descriptor.contractFingerprint,
      implFingerprint: checkpoint.implFingerprint, outputSchemaHash: deriveSchemaHash(task.uses.output, "output") });
    const strictLoad = loadCheckpoint(checkpoint, expectation, task.uses.output);
    assert.equal(strictLoad.found, false);
    if (!strictLoad.found) assert.equal(strictLoad.reason, "contract-fingerprint-mismatch");
    const { parseCanonicalInputSnapshot } = await import("../../../../src/models/workflow/canonical-input.js");
    assert.deepEqual(parseCanonicalInputSnapshot(descriptor.canonicalInput, f.run.input.parsed,
      { owner: { kind: "run-input", id: f.run.envelope.runId }, source: f.run.input, schemaReader }), f.run.input.parsed.value);
    assert.throws(() => parseCanonicalInputSnapshot(descriptor.canonicalInput, { ...f.run.input.parsed, value: {} },
      { owner: { kind: "run-input", id: f.run.envelope.runId }, source: f.run.input, schemaReader }), /canonical-input-source-changed/u);
    const terminal = workflowTerminalResultExecution(descriptor);
    const evidence = f.result.dependencies.map(dependency => {
      if (dependency.state === "resolved") {
        const checkpoint = f.checkpoints.find(checkpoint => checkpoint.nodeId === dependency.nodeId); assert.ok(checkpoint);
        return { state: "resolved", nodeId: dependency.nodeId, checkpoint };
      }
      if (dependency.state === "gate-resolved") {
        const gate = f.gates.find(gate => String(gate.gateId) === String(dependency.nodeId)); assert.ok(gate);
        return { state: "gate-resolved", nodeId: dependency.nodeId, gate };
      }
      return dependency;
    });
    const running = { ...f.run, lifecycle: { state: "running" } }, clock = manualClock(new Date(f.result.createdAt));
    assert.throws(() => terminal.build(running, evidence, clock), /not bound/u);
    assert.throws(() => terminal.build(running, evidence, clock, schemaReader), /not bound/u);

    assert.equal(f.separationsRun.input.parsed.schemaHash, "66dc2f33bf56808164be764f921a1e5a2a95afd5e0a7b760fdba687ee81575dc");
    // The Separations input moved on since generation 1, so that run is retired history, never admitted under the current schema.
    assert.ok(retirements.some(entry => entry.owner.id === f.separationsRun.envelope.runId && entry.sourceSchemaHash === f.separationsRun.input.parsed.schemaHash));
    assert.ok(!admissions.some(entry => entry.owner.kind === "run-input" && entry.owner.id === f.separationsRun.envelope.runId));
  } finally { await f.cleanup(); }
});
