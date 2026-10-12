import { default as assert } from "node:assert/strict";
import { describe } from "vitest";
import { it } from "vitest";
import { RunEvidenceReceiptSchema } from "../../../src/models/trust/evidence.js";
import type { AnyTaskContract } from "../../../src/models/task/task-contract.js";
import { ActionEvidenceSchema } from "../../../src/models/trust/evidence.js";
import { projectReceiptForOperator } from "../../../src/models/trust/evidence.js";
import { descriptorRuntimeNodes } from "../../../src/workflow-kit/workflow.js";
import { WORKFLOW_DESCRIPTORS } from "../../../src/workflows/descriptor-registry.js";
import { expect } from "vitest";

{

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const UUID_3 = "33333333-3333-4333-8333-333333333333";
const UUID_4 = "44444444-4444-4444-8444-444444444444";
const UUID_5 = "55555555-5555-4555-8555-555555555555";
const FINGERPRINT = "a".repeat(64);
const INSTANT = "2026-07-31T17:00:00.000Z";
const EVIDENCE_REF = `observation:${UUID_2}`;

const SATISFIED_FACT = {
  id: UUID_1,
  field: "employeeId",
  mandatory: true,
  state: "satisfied",
  source: { kind: "system", taskId: "ucpath/search-person", observedAt: INSTANT },
  value: { state: "transformed", key: "employeeId", classification: "direct-identifier", transform: "last4", value: "1234" },
};

const RECEIPT = {
  composition: 5,
  receiptId: UUID_1,
  runId: UUID_2,
  traceId: "on-120000-2222",
  workflowId: "onboarding",
  attempt: 1,
  generatedAt: INSTANT,
  descriptorFingerprint: FINGERPRINT,
  configFingerprint: FINGERPRINT,
  retryOf: { state: "absent" },
  failure: { state: "absent" },
  input: [SATISFIED_FACT],
  observations: [],
  decisions: [],
  actions: [],
  verification: [{ id: UUID_3, obligation: "person.match", mandatory: true, verdict: "verified", evidence: [EVIDENCE_REF] }],
  output: [],
  reuse: [],
  warnings: [],
  confidence: "verified",
  result: "verified-done",
};

describe("strict trust records", () => {

  it("enforces terminal receipt evidence and uncertainty invariants", () => {
    assert.equal(RunEvidenceReceiptSchema.safeParse(RECEIPT).success, true);
    assert.equal(RunEvidenceReceiptSchema.safeParse({
      ...RECEIPT,
      input: [{ ...SATISFIED_FACT, id: "ucpath.person-search.employee-eid" }],
    }).success, false);
    assert.equal(RunEvidenceReceiptSchema.safeParse({
      ...RECEIPT,
      input: [{
        ...SATISFIED_FACT,
        source: { kind: "operator-correction", supersedes: "ucpath.person-search.employee-eid" },
      }],
    }).success, false);
    assert.equal(RunEvidenceReceiptSchema.safeParse({
      ...RECEIPT,
      input: [{ ...SATISFIED_FACT, source: { kind: "operator-correction", supersedes: UUID_5 } }],
    }).success, true);
    assert.equal(RunEvidenceReceiptSchema.safeParse({ ...RECEIPT, confidence: "partial" }).success, false);
    assert.equal(RunEvidenceReceiptSchema.safeParse({
      ...RECEIPT,
      input: [{ ...SATISFIED_FACT, state: "unresolved", reason: "not observed", value: undefined }],
    }).success, false);
    assert.equal(RunEvidenceReceiptSchema.safeParse({ ...RECEIPT, result: "failed" }).success, false);
    assert.equal(RunEvidenceReceiptSchema.safeParse({
      ...RECEIPT,
      result: "done-with-warnings",
      confidence: "partial",
      warnings: [{ id: UUID_4, code: "OPTIONAL_FACT_MISSING", summary: "Optional note missing", loadBearing: true, evidence: [] }],
    }).success, false);
    assert.equal(RunEvidenceReceiptSchema.safeParse({
      ...RECEIPT,
      verification: [{ ...RECEIPT.verification[0], id: UUID_1 }],
    }).success, false);
  });
});
}

{

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

describe("ActionEvidenceSchema.proved", () => {
  it("a commit action carries what proved the write — system, key digest, completion arm, proof source, redacted values, instant", () => {
    const parsed = ActionEvidenceSchema.parse({ ...COMMIT_ACTION, proved: PROVED });
    assert.equal(parsed.proved?.system, "kuali");
    assert.equal(parsed.proved?.completion, "save-verify");
    assert.equal(parsed.proved?.proofSource, "normal-output");
    assert.equal(parsed.proved?.values[0]?.key, "documentNumber");
    assert.equal(parsed.proved?.recordedAt, AT);
  });

  it("a commit action can omit optional proof metadata", () => {
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

  it("composition 5 — the current composition — reaches the operator projection", () => {
    const parsed = RunEvidenceReceiptSchema.parse({ ...RECEIPT_IDENTITY, composition: 5 });
    assert.equal(parsed.composition, 5);
    assert.equal(projectReceiptForOperator(parsed).state, "available");
  });

  it("refuses a composition this builder never produced", () => {
    assert.throws(() => RunEvidenceReceiptSchema.parse({ ...RECEIPT_IDENTITY, composition: 1 }));

    assert.throws(() => RunEvidenceReceiptSchema.parse({ ...RECEIPT_IDENTITY, composition: 6 }));
    assert.throws(() => RunEvidenceReceiptSchema.parse({ ...RECEIPT_IDENTITY, composition: 0 }));
  });
});

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
});
}

{

const UUID_1 = "11111111-1111-4111-8111-111111111111";
const UUID_2 = "22222222-2222-4222-8222-222222222222";
const UUID_3 = "33333333-3333-4333-8333-333333333333";
const UUID_4 = "44444444-4444-4444-8444-444444444444";
const FINGERPRINT = "a".repeat(64);
const INSTANT = "2026-08-26T17:00:00.000Z";

const MANDATORY_FACT = {
  id: UUID_3,
  field: "employeeId",
  mandatory: true,
  state: "satisfied",
  source: { kind: "system", taskId: "ucpath/search-person", observedAt: INSTANT },
  value: {
    state: "transformed",
    key: "employeeId",
    classification: "direct-identifier",
    transform: "last4",
    value: "1234",
  },
} as const;

const VERIFIED_DONE = {
  composition: 5,
  receiptId: UUID_1,
  runId: UUID_2,
  traceId: "on-120000-2222",
  workflowId: "onboarding",
  attempt: 1,
  generatedAt: INSTANT,
  descriptorFingerprint: FINGERPRINT,
  configFingerprint: FINGERPRINT,
  retryOf: { state: "absent" },
  failure: { state: "absent" },
  input: [MANDATORY_FACT],
  observations: [],
  decisions: [],
  actions: [],
  verification: [],
  output: [],
  reuse: [],
  warnings: [],
  confidence: "verified",
  result: "verified-done",
} as const;

describe("the receipt invariant is unrepresentable, so the demo's banner cannot fire", () => {
  it("admits a receipt that meets the invariant — the control", () => {
    expect(RunEvidenceReceiptSchema.safeParse(VERIFIED_DONE).success).toBe(true);
  });

  it("refuses `verified-done` on anything but verified confidence", () => {
    for (const confidence of ["partial", "unknown"]) {
      expect(RunEvidenceReceiptSchema.safeParse({ ...VERIFIED_DONE, confidence }).success).toBe(false);
    }
  });

  it("refuses `verified-done` over an unresolved MANDATORY fact", () => {
    const unresolved = { id: UUID_3, field: "employeeId", mandatory: true, state: "unresolved", reason: "not observed" };
    expect(RunEvidenceReceiptSchema.safeParse({ ...VERIFIED_DONE, input: [unresolved] }).success).toBe(false);
  });

  it("refuses `verified-done` over a mandatory obligation whose verdict answered nothing", () => {
    for (const verdict of ["unknown", "ambiguous"]) {
      const verification = [{ id: UUID_4, obligation: "ucpath.person-verified", mandatory: true, verdict, evidence: [] }];
      expect(RunEvidenceReceiptSchema.safeParse({ ...VERIFIED_DONE, verification }).success).toBe(false);
    }
  });

  it("refuses `verified-done` carrying any warning at all", () => {
    const warnings = [{ id: UUID_4, code: "OPTIONAL_FACT_MISSING", summary: "Optional note missing", loadBearing: false, evidence: [] }];
    expect(RunEvidenceReceiptSchema.safeParse({ ...VERIFIED_DONE, warnings }).success).toBe(false);
  });

  it("refuses `verified-done` carrying a failure id", () => {
    expect(RunEvidenceReceiptSchema.safeParse({
      ...VERIFIED_DONE,
      failure: { state: "present", value: UUID_4 },
    }).success).toBe(false);
  });

  it("refuses a `verified` obligation that cites no evidence — the read-back is what earns the word", () => {
    const verification = [{ id: UUID_4, obligation: "ucpath.person-verified", mandatory: true, verdict: "verified", evidence: [] }];
    expect(RunEvidenceReceiptSchema.safeParse({ ...VERIFIED_DONE, verification }).success).toBe(false);
  });
});
}
