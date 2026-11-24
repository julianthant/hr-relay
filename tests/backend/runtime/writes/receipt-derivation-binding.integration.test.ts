
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import {
deriveRunEvidenceReceipt,
type ReceiptBuildInput
} from "../../../../src/backend/runs/provenance/evidence-receipt.js";
import { evaluateReceiptRederivation } from "../../../../src/backend/runtime/writes/receipt-derivation-binding.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { type RunEvidenceReceipt } from "../../../../src/models/trust/evidence.js";
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

/* ── (c) chunk 2's shape, through the real immutable insert ──────────────── */

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
