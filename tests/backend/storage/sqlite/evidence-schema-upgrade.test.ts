import assert from "node:assert/strict";
import { it } from "vitest";
import { z } from "zod";
import { collectEvidenceSchemaAdmissions, predecessorEvidenceSchemaHash } from "../../../../src/backend/storage/sqlite/evidence-schema-upgrade.js";
import { evidenceSchemaSourceDigest, RETIRED_INPUT_GENERATIONS } from "../../../../src/models/storage/evidence-schema-admission.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { KualiSavedFinalizationProofSchema, KualiFinalizationTargetSchema } from "../../../../src/models/ui/kuali-separation-finalization.js";
import { KualiSaveSeparationFinalizationOutputSchema } from "../../../../src/models/systems/kuali/save-separation-finalization.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { TransactionOutcomeSchema } from "../../../../src/rules/write-safety/write-safety-primitives.js";
import { WriteIntentRecordSchema } from "../../../../src/rules/write-safety/write-safety.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { SeparationsCanonicalInput, SeparationsInput } from "../../../../src/workflows/separations/workflow.js";
import { kualiReceiptEvidence } from "../../../support/fixtures/receipt-run-fixtures.js";
import { compositionQueuedRun } from "../../../support/helpers/separations-composition-fixtures.js";
import { separationsDescriptor, separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";

import { NAME_DOMAIN_CANONICAL_INPUT_HASH as GENERATION_1_SELECTOR, NAME_DOMAIN_INGRESS_HASH, PRE_INITIALS_CANONICAL_INPUT_HASH as GENERATION_0_SELECTOR,
  PRE_INITIALS_INGRESS_HASH } from "../../../support/fixtures/storage/pre-initials-separations.js";

it("derives the exact stopped predecessor selectors without changing the current schemas", () => {
  assert.ok(RETIRED_INPUT_GENERATIONS.separations?.includes(GENERATION_1_SELECTOR));
  assert.notEqual(predecessorEvidenceSchemaHash(SeparationsCanonicalInput), GENERATION_1_SELECTOR);
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
  const { admissions, retirements } = collectEvidenceSchemaAdmissions(source);
  assert.deepEqual(retirements, []);
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

it("pins the retired input generations: Separations lists only earlier builds, the proof workflow its current and predecessor", () => {
  assert.deepEqual(RETIRED_INPUT_GENERATIONS.separations, [GENERATION_0_SELECTOR, GENERATION_1_SELECTOR]);
  assert.equal(RETIRED_INPUT_GENERATIONS.separations?.includes(deriveSchemaHash(SeparationsCanonicalInput, "output")), false);
  assert.equal(RETIRED_INPUT_GENERATIONS.separations?.includes(predecessorEvidenceSchemaHash(SeparationsCanonicalInput)), false);
  const proof = separationsKualiFinalizationDescriptor.canonicalInput;
  assert.deepEqual(RETIRED_INPUT_GENERATIONS[separationsKualiFinalizationDescriptor.id], [deriveSchemaHash(proof, "output"), predecessorEvidenceSchemaHash(proof)]);
  assert.ok(Object.isFrozen(RETIRED_INPUT_GENERATIONS) && Object.values(RETIRED_INPUT_GENERATIONS).every(hashes => Object.isFrozen(hashes)));
});

it("pins the pre-initials ingress hashes to the current schema without the stored initials", () => {
  const withoutInitials = SeparationsInput.omit({ timekeeperInitials: true });
  assert.equal(deriveSchemaHash(withoutInitials, "input"), PRE_INITIALS_INGRESS_HASH);
  assert.equal(predecessorEvidenceSchemaHash(withoutInitials, "input"), NAME_DOMAIN_INGRESS_HASH);
  assert.notEqual(deriveSchemaHash(SeparationsInput, "input"), PRE_INITIALS_INGRESS_HASH);
  const canonical = SeparationsCanonicalInput instanceof z.ZodObject ? SeparationsCanonicalInput.omit({ timekeeperInitials: true }) : undefined;
  assert.ok(canonical);
  assert.deepEqual([deriveSchemaHash(canonical, "output"), predecessorEvidenceSchemaHash(canonical)], RETIRED_INPUT_GENERATIONS.separations);
});

function nextGeneration() {
  const source = predecessor(), schema = separationsKualiFinalizationDescriptor.canonicalInput;
  const canonicalInput = schema.and(z.strictObject({ timekeeperInitials: z.string().regex(/^[A-Z]{1,8}$/u) }));
  // Run inputs only: a copied descriptor has no runtime graph, and checkpoints and writes keep their own certificates.
  return { runs: source.runs, checkpoints: [], writes: [], descriptors: [{ ...separationsKualiFinalizationDescriptor, canonicalInput }] };
}

it("retires a run input of a listed earlier generation without parsing it, bound to its unchanged source", () => {
  const source = nextGeneration(), run = source.runs[0]; assert.ok(run);
  const before = canonicalJsonStringify(source.runs);
  const { admissions, retirements } = collectEvidenceSchemaAdmissions(source);
  const owner = { kind: "run-input" as const, id: run.envelope.runId };
  assert.deepEqual(retirements, [{ owner, workflowId: separationsKualiFinalizationDescriptor.id, sourceSchemaHash: run.input.parsed.schemaHash,
    sourceDigest: evidenceSchemaSourceDigest(owner, run.input) }]);
  assert.deepEqual(admissions, []);
  assert.equal(canonicalJsonStringify(source.runs), before);
});

it("still parses, and so refuses, a run input under an unlisted hash when the current input generation moved", () => {
  const source = nextGeneration(), run = source.runs[0]; assert.ok(run);
  source.runs[0] = RunRecordSchema.parse({ ...run, input: { ...run.input, parsed: { ...run.input.parsed, schemaHash: "e".repeat(64) } } });
  assert.throws(() => collectEvidenceSchemaAdmissions(source), /timekeeperInitials/u);
});

it("retires, without parsing, a real Separations run input stored before the stored initials existed", () => {
  const queued = RunRecordSchema.parse(compositionQueuedRun());
  const oldShape = z.record(z.string(), z.unknown()).parse(queued.input.parsed.value);
  delete oldShape["timekeeperInitials"];
  assert.equal(Object.hasOwn(oldShape, "timekeeperInitials"), false);
  const run = RunRecordSchema.parse({ ...queued, input: { ...queued.input, parsed: { ...queued.input.parsed,
    schemaHash: GENERATION_0_SELECTOR, value: oldShape } } });
  const { admissions, retirements } = collectEvidenceSchemaAdmissions({ descriptors: [separationsDescriptor], runs: [run], writes: [], checkpoints: [] });
  const owner = { kind: "run-input" as const, id: run.envelope.runId };
  assert.deepEqual(admissions, []);
  assert.deepEqual(retirements, [{ owner, workflowId: separationsDescriptor.id, sourceSchemaHash: GENERATION_0_SELECTOR,
    sourceDigest: evidenceSchemaSourceDigest(owner, run.input) }]);
});
