import assert from "node:assert/strict";
import { it } from "vitest";
import { collectEvidenceSchemaAdmissions, predecessorEvidenceSchemaHash } from "../../../../src/backend/storage/sqlite/evidence-schema-upgrade.js";
import { KualiSavedFinalizationProofSchema, KualiFinalizationTargetSchema } from "../../../../src/models/ui/kuali-separation-finalization.js";
import { KualiSaveSeparationFinalizationOutputSchema } from "../../../../src/models/systems/kuali/save-separation-finalization.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { TransactionOutcomeSchema } from "../../../../src/rules/write-safety/write-safety-primitives.js";
import { WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { SeparationsCanonicalInput } from "../../../../src/workflows/separations/workflow.js";
import { kualiReceiptEvidence } from "../../../support/fixtures/receipt-run-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";

it("derives the exact stopped predecessor selectors without changing the current schemas", () => {
  assert.equal(predecessorEvidenceSchemaHash(SeparationsCanonicalInput), "66dc2f33bf56808164be764f921a1e5a2a95afd5e0a7b760fdba687ee81575dc");
  assert.equal(predecessorEvidenceSchemaHash(KualiSavedFinalizationProofSchema), "9c8d2c765c9eb480c1b37f7e58b050edb5f907ce1392ecbdfe8489f9f875b81c");
  assert.equal(predecessorEvidenceSchemaHash(KualiFinalizationTargetSchema), "8b312e596b81243994b26160e226d0f39c6548154fb85f55d0aaf3efbfe16810");
});

function predecessor() {
  const evidence = kualiReceiptEvidence(), run = RunRecordSchema.parse(evidence.run);
  const schema = separationsKualiFinalizationDescriptor.canonicalInput;
  const retained = RunRecordSchema.parse({ ...run, input: { ...run.input, parsed: { ...run.input.parsed, schemaHash: predecessorEvidenceSchemaHash(schema) } } });
  const checkpoints = evidence.checkpoints.map(value => {
    const checkpoint = RunCheckpointRecordSchema.parse(value), outcome = TransactionOutcomeSchema.safeParse(checkpoint.output.value);
    if (!outcome.success) return checkpoint;
    return RunCheckpointRecordSchema.parse({ ...checkpoint, output: { ...checkpoint.output, value: { ...outcome.data,
      proof: { ...outcome.data.proof, schemaHash: predecessorEvidenceSchemaHash(KualiSavedFinalizationProofSchema) },
      output: { ...outcome.data.output, schemaHash: predecessorEvidenceSchemaHash(KualiSaveSeparationFinalizationOutputSchema) } } } });
  });
  const writes = evidence.writes.map(({ intent }) => {
    assert.ok(intent.status === "committed");
    return WriteIntentRecordSchema.parse({ ...intent, completionProof: { ...intent.completionProof, schemaHash: predecessorEvidenceSchemaHash(KualiSavedFinalizationProofSchema) } });
  });
  return { runs: [retained], checkpoints, writes, descriptors: [separationsKualiFinalizationDescriptor] };
}

it("certifies exact frozen inputs and completed proof/output owners without rewriting evidence", () => {
  const source = predecessor(), before = canonicalJsonStringify(source.runs);
  const proofs = canonicalJsonStringify({ checkpoints: source.checkpoints, writes: source.writes });
  const admissions = collectEvidenceSchemaAdmissions(source);
  assert.deepEqual(admissions.map(entry => entry.owner.kind).sort(), ["checkpoint-output", "checkpoint-proof", "run-input", "write-proof"]);
  assert.equal(new Set(admissions.map(entry => entry.sourceDigest)).size, 4);
  assert.equal(canonicalJsonStringify(source.runs), before);
  assert.equal(canonicalJsonStringify({ checkpoints: source.checkpoints, writes: source.writes }), proofs);
});

it("refuses unknown selectors and a wider-domain value forged under a predecessor selector", () => {
  for (const patch of [{ schemaHash: "f".repeat(64) }, { value: { ...predecessor().runs[0].input.parsed.value as object, timekeeperName: "André José" } }]) {
    const source = predecessor(), run = source.runs[0]; assert.ok(run);
    source.runs[0] = RunRecordSchema.parse({ ...run, input: { ...run.input, parsed: { ...run.input.parsed, ...patch } } });
    assert.throws(() => collectEvidenceSchemaAdmissions(source));
  }
});
