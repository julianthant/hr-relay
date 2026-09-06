/**
 * The receipt action entry's write proof — 03a Track F's one open BE line
 * (ledger 2 D16–D22): the receipt's commit action carries what PROVED the
 * write — the fenced system and key digest, the completion arm, the durable
 * proof source, the proof's own redacted values and the instant they were
 * recorded — beside the write it proves.
 *
 * Three seams in this file, all pre-agreed by the dispatch brief:
 *
 * 1. **The schema arms** (`ActionEvidenceSchema.proved`,
 *    `RunEvidenceReceiptSchema.composition`). `proved` is OPTIONAL because
 *    receipts are durably persisted and immutable (D141/D199): a row derived
 *    before composition 2 carries neither field and MUST keep parsing —
 *    the D13 lesson (a required field on a durably persisted schema is a
 *    migration) applied to the one record an operator reads months later.
 * 2. **The redaction table**: every commit contract's completion proof has a
 *    declared `write-proof` classification for every leaf its example proof
 *    produces — an undeclared leaf fails receipt derivation loud, so the
 *    table must be total BEFORE any run commits through the contract.
 * 3. **Negative controls** per arm: a `proved` on a read action, an empty
 *    values list, and a forbidden classification pairing are each refused.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  ActionEvidenceSchema,
  RunEvidenceReceiptSchema,
  projectReceiptForOperator,
} from "../../src/domain/trust/evidence.js";
import {
  classifyEvidenceLeaf,
  evidenceLeaves,
} from "../../src/domain/trust/evidence-classification.js";
import { WORKFLOW_DESCRIPTORS } from "../../src/workflows/descriptor-registry.js";
import { descriptorRuntimeNodes } from "../../src/base/workflow.js";
import {
  WriteFixtureCommit,
  WriteFixtureSaveCommit,
} from "./fixtures/write-sequencer-fixtures.js";
import type { AnyTaskContract } from "../../src/domain/contracts/base.js";

const ENTRY_ID = "b0b0b0b0-b0b0-4b0b-8b0b-b0b0b0b0b0b0";
const PROOF_ID = "7f3a1c88-2e44-4b90-8a51-6d2f9c0b4e13";
const AT = "2026-08-14T17:08:54.867Z";

const COMMIT_ACTION = Object.freeze({
  id: ENTRY_ID,
  taskId: "kuali/save-separation-finalization",
  kind: "commit",
  writeState: "verified",
  proofRef: PROOF_ID,
  occurredAt: AT,
});

const PROVED = Object.freeze({
  system: "kuali",
  idempotencyKeyDigest: "d".repeat(64),
  completion: "save-verify",
  proofSource: "normal-output",
  values: [{ key: "documentNumber", state: "allowed", classification: "safe-diagnostic", transform: "allow", value: "3407919" }],
  recordedAt: AT,
});

describe("ActionEvidenceSchema.proved (ledger 2 D16–D22)", () => {
  it("a commit action carries what proved the write — system, key digest, completion arm, proof source, redacted values, instant", () => {
    const parsed = ActionEvidenceSchema.parse({ ...COMMIT_ACTION, proved: PROVED });
    assert.equal(parsed.proved?.system, "kuali");
    assert.equal(parsed.proved?.completion, "save-verify");
    assert.equal(parsed.proved?.proofSource, "normal-output");
    assert.equal(parsed.proved?.values[0]?.key, "documentNumber");
    assert.equal(parsed.proved?.recordedAt, AT);
  });

  it("a pre-composition-2 durable row — no `proved` at all — still parses (the D13 migration rule)", () => {
    const parsed = ActionEvidenceSchema.parse(COMMIT_ACTION);
    assert.equal(parsed.proved, undefined);
  });

  it("refuses `proved` on an action that is not a commit — a read proves no write", () => {
    for (const kind of ["external-read", "prepare", "local-projection"] as const) {
      assert.throws(
        () => ActionEvidenceSchema.parse({
          id: ENTRY_ID,
          taskId: "ucpath/search-person-org",
          kind,
          writeState: kind === "prepare" ? "prepared" : "not-attempted",
          occurredAt: AT,
          proved: PROVED,
        }),
        /only a commit action/u,
        `proved must be refused on kind "${kind}"`,
      );
    }
  });

  it("refuses an empty values list — a proof with no recorded values is not a proof", () => {
    assert.throws(() => ActionEvidenceSchema.parse({
      ...COMMIT_ACTION,
      proved: { ...PROVED, values: [] },
    }));
  });

  it("refuses an unknown proof source and an unknown completion arm by name", () => {
    assert.throws(() => ActionEvidenceSchema.parse({
      ...COMMIT_ACTION,
      proved: { ...PROVED, proofSource: "invented" },
    }));
    assert.throws(() => ActionEvidenceSchema.parse({
      ...COMMIT_ACTION,
      proved: { ...PROVED, completion: "guessed" },
    }));
  });
});

describe("RunEvidenceReceiptSchema.composition", () => {
  const RECEIPT_IDENTITY = Object.freeze({
    receiptId: "0d3e19b0-3629-482e-ae82-6cd7f244c4bb",
    runId: "d1254233-dd33-4bc5-afaf-c2bf52ea693f",
    traceId: "kt-170848-d125",
    workflowId: "separations-kuali-finalization",
    attempt: 1,
    generatedAt: AT,
    descriptorFingerprint: "a".repeat(64),
    configFingerprint: "b".repeat(64),
    retryOf: { state: "absent" },
    failure: { state: "absent" },
    input: [],
    observations: [],
    decisions: [],
    actions: [],
    verification: [],
    output: [],
    reuse: [],
    warnings: [],
    confidence: "unknown",
    result: "partial",
  });

  it("a stored composition-1 receipt — no `composition` field — still parses", () => {
    const parsed = RunEvidenceReceiptSchema.parse(RECEIPT_IDENTITY);
    assert.equal(parsed.composition, undefined);
  });

  it("a composition-2 receipt states its composition", () => {
    const parsed = RunEvidenceReceiptSchema.parse({ ...RECEIPT_IDENTITY, composition: 2 });
    assert.equal(parsed.composition, 2);
  });

  it("composition 4 adds the protected-value-safe operator projection", () => {
    const parsed = RunEvidenceReceiptSchema.parse({ ...RECEIPT_IDENTITY, composition: 4 });
    assert.equal(parsed.composition, 4);
    assert.equal(projectReceiptForOperator(parsed).state, "available");
  });

  it("withholds immutable composition 1/2/3 rows from operator projection without rewriting them", () => {
    const legacyRaw = "ucpath:termination|10812345|2026-08-29";
    for (const composition of [undefined, 2, 3] as const) {
      const receipt = RunEvidenceReceiptSchema.parse({
        ...RECEIPT_IDENTITY,
        ...(composition === undefined ? {} : { composition }),
        warnings: [{
          id: ENTRY_ID,
          code: "LEGACY_DIAGNOSTIC",
          summary: legacyRaw,
          loadBearing: true,
          evidence: [],
        }],
      });
      const immutableBytes = JSON.stringify(receipt);
      const projected = projectReceiptForOperator(receipt);
      assert.equal(projected.state, "withheld");
      assert.equal(JSON.stringify(projected).includes(legacyRaw), false);
      assert.equal(JSON.stringify(receipt), immutableBytes);
    }
  });

  it("refuses a composition this builder never produced", () => {
    assert.throws(() => RunEvidenceReceiptSchema.parse({ ...RECEIPT_IDENTITY, composition: 5 }));
    assert.throws(() => RunEvidenceReceiptSchema.parse({ ...RECEIPT_IDENTITY, composition: 1 }));
  });
});

/* ── the write-proof redaction table is total over every commit contract ─── */

interface CommitLike {
  readonly contract: AnyTaskContract & {
    readonly writeSafety: {
      readonly completion: {
        readonly proofSchema: { parse: (value: unknown) => unknown };
        readonly proofFromOutput: (output: unknown) => unknown;
      };
    };
    readonly output: { parse: (value: unknown) => unknown };
    readonly example: unknown;
  };
}

function registeredCommitContracts(): readonly CommitLike["contract"][] {
  const contracts = new Map<string, CommitLike["contract"]>();
  for (const descriptor of WORKFLOW_DESCRIPTORS) {
    for (const node of descriptorRuntimeNodes(descriptor)) {
      if (node.kind !== "transaction") continue;
      const commit = node.commit.uses as CommitLike["contract"];
      contracts.set(String(commit.id), commit);
    }
  }
  return [...contracts.values()];
}

describe("the write-proof redaction table (declared, never guessed)", () => {
  it("covers at least the three production commit contracts", () => {
    const ids = registeredCommitContracts().map((contract) => String(contract.id)).sort();
    assert.deepEqual(ids, [
      "kuali/save-separation-finalization",
      "ucpath/create-termination",
      "ucpath/delete-pending-terminations",
    ]);
  });

  for (const contract of registeredCommitContracts()) {
    it(`declares every leaf of ${String(contract.id)}'s example completion proof`, () => {
      const output = contract.output.parse(contract.example);
      const proof = contract.writeSafety.completion.proofSchema.parse(
        contract.writeSafety.completion.proofFromOutput(output),
      );
      const scope = { kind: "write-proof", taskId: contract.id } as const;
      for (const leaf of evidenceLeaves(proof)) {
        const declared = classifyEvidenceLeaf(scope, leaf.path);
        assert.ok(declared.classification.length > 0, `undeclared leaf ${leaf.path}`);
      }
    });
  }

  for (const fixture of [WriteFixtureCommit, WriteFixtureSaveCommit]) {
    it(`declares the sealed fixture contract ${String(fixture.id)}'s proof leaves`, () => {
      const proof = fixture.writeSafety.completion.proofSchema.parse(
        fixture.writeSafety.completion.proofFromOutput(fixture.output.parse(fixture.example)),
      );
      const scope = { kind: "write-proof", taskId: fixture.id } as const;
      for (const leaf of evidenceLeaves(proof)) {
        classifyEvidenceLeaf(scope, leaf.path);
      }
    });
  }

  it("negative control: an undeclared write-proof leaf is refused BY NAME, never dropped", () => {
    assert.throws(
      () => classifyEvidenceLeaf(
        { kind: "write-proof", taskId: "kuali/save-separation-finalization" } as never,
        "inventedLeaf",
      ),
      /no declared evidence classification for write-proof:kuali\/save-separation-finalization/u,
    );
  });
});
