
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import {
deriveRunEvidenceReceipt,
type ReceiptBuildInput
} from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { assertRetainedReceiptDependencies, evaluateReceiptRederivation } from "../../../../src/backend/runtime/writes/receipt-derivation-binding.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunResultRecordSchema } from "../../../../src/models/run/result.js";
import { type RunEvidenceReceipt } from "../../../../src/models/trust/evidence.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { kualiReceiptEvidence } from "../../../support/fixtures/receipt-run-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../../support/helpers/synthetic-storage-admission.js";


const MOVED_CLOSURE = "9".repeat(64);

const descriptor = separationsKualiFinalizationDescriptor;


function runUnderMovedClosure(patch: Readonly<{
  envelope?: Record<string, unknown>;
  inputParsed?: Record<string, unknown>;
}> = {}): unknown {
  const run = RunRecordSchema.parse(kualiReceiptEvidence().run);
  return {
    ...run,
    envelope: { ...run.envelope, contractFingerprint: MOVED_CLOSURE, ...(patch.envelope ?? {}) },
    input: { ...run.input, parsed: { ...run.input.parsed, ...(patch.inputParsed ?? {}) } },
  };
}

function receiptFrom(overrides: Partial<ReceiptBuildInput> = {}): RunEvidenceReceipt {
  return deriveRunEvidenceReceipt({ descriptor, ...kualiReceiptEvidence(), ...overrides }).receipt;
}

/* ── (a) the stranded receipt: a moved closure re-derives byte-identically ── */

describe("receipt derivation binding — a moved closure does not strand a receipt", () => {

  it("attributes the only changed path to the run identity", () => {
    const run = RunRecordSchema.parse(runUnderMovedClosure());
    const binding = evaluateReceiptRederivation({
      run, descriptor, stored: receiptFrom(), derived: receiptFrom({ run }), checks: [],
    });
    assert.equal(binding.state, "incompatible");
    assert.equal(binding.moved, "declared-evidence");
    assert.match(binding.checks[0]?.detail ?? "", /1 path\(s\) moved, owned by run-identity \(1 path\(s\), e\.g\. descriptorFingerprint:/u);
  });
});

it("refuses to verify a citation with an unhandled dependency state", () => {
  const evidence = kualiReceiptEvidence();
  const run = RunRecordSchema.parse(evidence.run);
  const result = RunResultRecordSchema.parse(evidence.result);
  const checkpoints = evidence.checkpoints.map((row) => RunCheckpointRecordSchema.parse(row));
  const futureDependency = { ...result.dependencies[0], state: "future-state" };
  assert.throws(() => assertRetainedReceiptDependencies({ descriptor, run, checkpoints }, {
    ...result,
    // @ts-expect-error Exercise the reader with a dependency state outside its current contract.
    dependencies: [futureDependency],
  }), /unhandled receipt dependency state: future-state/u);
});

/* ── (c) chunk 2's shape, through the real immutable insert ──────────────── */

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
