
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { afterEach,describe,it } from "vitest";
import {
buildRunEvidenceReceipt,
type ReceiptBuildInput
} from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { RunRecordSchema } from "../../../src/models/run/record.js";
import { deriveTerminalDependencyDigest } from "../../../src/models/run/result.js";
import { type RunEvidenceReceipt } from "../../../src/models/trust/evidence.js";
import { kualiReceiptEvidence } from "../../support/fixtures/receipt-run-fixtures.js";
import { separationsKualiFinalizationDescriptor } from "../../support/helpers/registered-workflows.js";
import { AuthorityDatabase } from "../../support/helpers/synthetic-storage-admission.js";


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
  return buildRunEvidenceReceipt({ descriptor, ...kualiReceiptEvidence(), ...overrides });
}

function refusalFor(overrides: Partial<ReceiptBuildInput>): string {
  try {
    receiptFrom(overrides);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error("the derivation was expected to refuse and did not");
}

/* ── (b) a genuinely moved surface refuses, naming it ────────────────────── */

describe("receipt derivation binding — a moved surface refuses by name", () => {

  it("refuses when the terminal dependency set the stored result was built from has moved", () => {
    const evidence = kualiReceiptEvidence();
    assert.ok(evidence.result !== null && typeof evidence.result === "object");
    // The record self-checks its own digest, so the digest is recomputed here:
    // the row stays internally consistent and only the SET moves.
    const message = refusalFor({
      run: runUnderMovedClosure(),
      result: {
        ...evidence.result,
        dependencies: [],
        dependencyDigest: deriveTerminalDependencyDigest([]),
      },
    });
    assert.match(message, /terminal-dependency-set moved/);
    assert.match(message, /the mandatory-evidence set would move/);
  });
});

/* ── (c) chunk 2's shape, through the real immutable insert ──────────────── */

const roots: string[] = [];
const databases: AuthorityDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
