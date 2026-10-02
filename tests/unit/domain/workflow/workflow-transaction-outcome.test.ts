import { describe, expect, it } from "vitest";
import { projectTransactionOutcome } from "../../../../src/domain/workflow/graph.js";
import { deriveSchemaHash } from "../../../../src/domain/schema-bound-value.js";
import {
  TransactionOutcomeSchema,
  type TransactionOutcome,
} from "../../../../src/domain/write-safety-primitives.js";
import {
  WriteFixtureCommit,
  WriteFixtureProofSchema,
} from "../../../fixtures/write-sequencer-fixtures.js";

const OUTPUT_SCHEMA_HASH = deriveSchemaHash(WriteFixtureCommit.output, "output");
const PROOF_SCHEMA_HASH = deriveSchemaHash(WriteFixtureProofSchema, "output");
const OTHER_SCHEMA_HASH = "a".repeat(64);

function storedOutcome(
  overrides: Readonly<{
    disposition?: TransactionOutcome["disposition"];
    proofSource?: TransactionOutcome["proofSource"];
    outputSchemaHash?: string;
    output?: unknown;
    proofSchemaHash?: string;
    proof?: unknown;
  }> = {},
): TransactionOutcome {
  return TransactionOutcomeSchema.parse({
    disposition: overrides.disposition ?? "committed",
    proofSource: overrides.proofSource ?? "normal-output",
    output: {
      schemaHash: overrides.outputSchemaHash ?? OUTPUT_SCHEMA_HASH,
      value: overrides.output ?? { transactionId: "T123456" },
    },
    proof: {
      schemaHash: overrides.proofSchemaHash ?? PROOF_SCHEMA_HASH,
      value: overrides.proof ?? { transactionId: "T123456" },
    },
    ...((overrides.disposition ?? "committed") === "committed"
      ? { confirmedAt: "2026-08-04T18:00:00.000Z" }
      : { observedAt: "2026-08-04T17:59:00.000Z" }),
  });
}

describe("transaction outcome graph projection", () => {
  it("projects a schema-bound committed outcome without defaulting or re-deriving its fields", () => {
    expect(projectTransactionOutcome(
      WriteFixtureCommit,
      storedOutcome({
        output: { transactionId: "T654321" },
        proof: { transactionId: "T456789" },
      }),
      "fixture transaction",
    )).toEqual({
      disposition: "committed",
      proofSource: "normal-output",
      output: { transactionId: "T654321" },
      proof: { transactionId: "T456789" },
    });
  });

  it("preserves the already-present disposition and live-probe proof source", () => {
    expect(projectTransactionOutcome(
      WriteFixtureCommit,
      storedOutcome({ disposition: "already-present", proofSource: "live-probe" }),
      "fixture transaction",
    )).toEqual({
      disposition: "already-present",
      proofSource: "live-probe",
      output: { transactionId: "T123456" },
      proof: { transactionId: "T123456" },
    });
  });

  it("refuses an outcome bound to a different commit-output schema before parsing its value", () => {
    expect(() => projectTransactionOutcome(
      WriteFixtureCommit,
      storedOutcome({ outputSchemaHash: OTHER_SCHEMA_HASH, output: { transactionId: "not-a-transaction" } }),
      "fixture transaction",
    )).toThrow(
      `fixture transaction: stored transaction outcome binds commit output schema ${OTHER_SCHEMA_HASH}, `
      + `and ucpath/submit-write-fixture now declares ${OUTPUT_SCHEMA_HASH}`,
    );
  });

  it("refuses an outcome bound to a different completion-proof schema before parsing its proof", () => {
    expect(() => projectTransactionOutcome(
      WriteFixtureCommit,
      storedOutcome({ proofSchemaHash: OTHER_SCHEMA_HASH, proof: { transactionId: "not-a-transaction" } }),
      "fixture transaction",
    )).toThrow(
      `fixture transaction: stored transaction outcome binds completion proof schema ${OTHER_SCHEMA_HASH}, `
      + `and ucpath/submit-write-fixture now declares ${PROOF_SCHEMA_HASH}`,
    );
  });

  it("refuses malformed output and proof values even when their stored schema hashes match", () => {
    expect(() => projectTransactionOutcome(
      WriteFixtureCommit,
      storedOutcome({ output: { transactionId: "not-a-transaction" } }),
      "fixture transaction output",
    )).toThrow(/transactionId/u);

    expect(() => projectTransactionOutcome(
      WriteFixtureCommit,
      storedOutcome({ proof: { transactionId: "not-a-transaction" } }),
      "fixture transaction proof",
    )).toThrow(/transactionId/u);
  });
});
