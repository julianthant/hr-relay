import assert_m0 from "node:assert/strict";
import { describe as describe_m0,it as it_m0 } from "vitest";
import { RunEvidenceReceiptSchema as RunEvidenceReceiptSchema_m0 } from "../../../src/models/trust/evidence.js";

import assert_m1 from "node:assert/strict";
import { describe as describe_m1,it as it_m1 } from "vitest";
import type { AnyTaskContract as AnyTaskContract_m1 } from "../../../src/models/task/task-contract.js";
import {
ActionEvidenceSchema as ActionEvidenceSchema_m1,
RunEvidenceReceiptSchema as RunEvidenceReceiptSchema_m1,
projectReceiptForOperator as projectReceiptForOperator_m1
} from "../../../src/models/trust/evidence.js";
import { descriptorRuntimeNodes as descriptorRuntimeNodes_m1 } from "../../../src/workflow-kit/workflow.js";
import { WORKFLOW_DESCRIPTORS as WORKFLOW_DESCRIPTORS_m1 } from "../../../src/workflows/descriptor-registry.js";

import { describe as describe_m2,expect as expect_m2,it as it_m2 } from "vitest";
import { RunEvidenceReceiptSchema as RunEvidenceReceiptSchema_m2 } from "../../../src/models/trust/evidence.js";


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

describe_m0("strict trust records", () => {

  it_m0("enforces terminal receipt evidence and uncertainty invariants", () => {
    assert_m0.equal(RunEvidenceReceiptSchema_m0.safeParse(RECEIPT).success, true);
    assert_m0.equal(RunEvidenceReceiptSchema_m0.safeParse({
      ...RECEIPT,
      input: [{ ...SATISFIED_FACT, id: "ucpath.person-search.employee-eid" }],
    }).success, false);
    assert_m0.equal(RunEvidenceReceiptSchema_m0.safeParse({
      ...RECEIPT,
      input: [{
        ...SATISFIED_FACT,
        source: { kind: "operator-correction", supersedes: "ucpath.person-search.employee-eid" },
      }],
    }).success, false);
    assert_m0.equal(RunEvidenceReceiptSchema_m0.safeParse({
      ...RECEIPT,
      input: [{ ...SATISFIED_FACT, source: { kind: "operator-correction", supersedes: UUID_5 } }],
    }).success, true);
    assert_m0.equal(RunEvidenceReceiptSchema_m0.safeParse({ ...RECEIPT, confidence: "partial" }).success, false);
    assert_m0.equal(RunEvidenceReceiptSchema_m0.safeParse({
      ...RECEIPT,
      input: [{ ...SATISFIED_FACT, state: "unresolved", reason: "not observed", value: undefined }],
    }).success, false);
    assert_m0.equal(RunEvidenceReceiptSchema_m0.safeParse({ ...RECEIPT, result: "failed" }).success, false);
    assert_m0.equal(RunEvidenceReceiptSchema_m0.safeParse({
      ...RECEIPT,
      result: "done-with-warnings",
      confidence: "partial",
      warnings: [{ id: UUID_4, code: "OPTIONAL_FACT_MISSING", summary: "Optional note missing", loadBearing: true, evidence: [] }],
    }).success, false);
    assert_m0.equal(RunEvidenceReceiptSchema_m0.safeParse({
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

describe_m1("ActionEvidenceSchema.proved", () => {
  it_m1("a commit action carries what proved the write — system, key digest, completion arm, proof source, redacted values, instant", () => {
    const parsed = ActionEvidenceSchema_m1.parse({ ...COMMIT_ACTION, proved: PROVED });
    assert_m1.equal(parsed.proved?.system, "kuali");
    assert_m1.equal(parsed.proved?.completion, "save-verify");
    assert_m1.equal(parsed.proved?.proofSource, "normal-output");
    assert_m1.equal(parsed.proved?.values[0]?.key, "documentNumber");
    assert_m1.equal(parsed.proved?.recordedAt, AT);
  });

  it_m1("a commit action can omit optional proof metadata", () => {
    const parsed = ActionEvidenceSchema_m1.parse(COMMIT_ACTION);
    assert_m1.equal(parsed.proved, undefined);
  });

  it_m1("refuses `proved` on an action that is not a commit — a read proves no write", () => {
    for (const kind of ["external-read", "prepare", "local-projection"] as const) {
      assert_m1.throws(
        () => ActionEvidenceSchema_m1.parse({
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

  it_m1("refuses an empty values list — a proof with no recorded values is not a proof", () => {
    assert_m1.throws(() => ActionEvidenceSchema_m1.parse({
      ...COMMIT_ACTION,
      proved: { ...PROVED, values: [] },
    }));
  });

  it_m1("refuses an unknown proof source and an unknown completion arm by name", () => {
    assert_m1.throws(() => ActionEvidenceSchema_m1.parse({
      ...COMMIT_ACTION,
      proved: { ...PROVED, proofSource: "invented" },
    }));
    assert_m1.throws(() => ActionEvidenceSchema_m1.parse({
      ...COMMIT_ACTION,
      proved: { ...PROVED, completion: "guessed" },
    }));
  });
});

describe_m1("RunEvidenceReceiptSchema.composition", () => {
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

  it_m1("composition 5 — the current composition — reaches the operator projection", () => {
    const parsed = RunEvidenceReceiptSchema_m1.parse({ ...RECEIPT_IDENTITY, composition: 5 });
    assert_m1.equal(parsed.composition, 5);
    assert_m1.equal(projectReceiptForOperator_m1(parsed).state, "available");
  });

  it_m1("refuses a composition this builder never produced", () => {
    assert_m1.throws(() => RunEvidenceReceiptSchema_m1.parse({ ...RECEIPT_IDENTITY, composition: 1 }));
    // No builder has produced 6: a value past the current composition is refused forward.
    assert_m1.throws(() => RunEvidenceReceiptSchema_m1.parse({ ...RECEIPT_IDENTITY, composition: 6 }));
    assert_m1.throws(() => RunEvidenceReceiptSchema_m1.parse({ ...RECEIPT_IDENTITY, composition: 0 }));
  });
});

/* ── the write-proof redaction table is total over every commit contract ─── */

interface CommitLike {
  readonly contract: AnyTaskContract_m1 & {
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
  for (const descriptor of WORKFLOW_DESCRIPTORS_m1) {
    for (const node of descriptorRuntimeNodes_m1(descriptor)) {
      if (node.kind !== "transaction") continue;
      const commit = node.commit.uses as CommitLike["contract"];
      contracts.set(String(commit.id), commit);
    }
  }
  return [...contracts.values()];
}

describe_m1("the write-proof redaction table (declared, never guessed)", () => {
  it_m1("covers at least the three production commit contracts", () => {
    const ids = registeredCommitContracts().map((contract) => String(contract.id)).sort();
    assert_m1.deepEqual(ids, [
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

/** A receipt that PASSES — the control every case below mutates by one clause. */
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

describe_m2("the receipt invariant is unrepresentable, so the demo's banner cannot fire", () => {
  it_m2("admits a receipt that meets the invariant — the control", () => {
    expect_m2(RunEvidenceReceiptSchema_m2.safeParse(VERIFIED_DONE).success).toBe(true);
  });

  it_m2("refuses `verified-done` on anything but verified confidence", () => {
    for (const confidence of ["partial", "unknown"]) {
      expect_m2(RunEvidenceReceiptSchema_m2.safeParse({ ...VERIFIED_DONE, confidence }).success).toBe(false);
    }
  });

  it_m2("refuses `verified-done` over an unresolved MANDATORY fact", () => {
    const unresolved = { id: UUID_3, field: "employeeId", mandatory: true, state: "unresolved", reason: "not observed" };
    expect_m2(RunEvidenceReceiptSchema_m2.safeParse({ ...VERIFIED_DONE, input: [unresolved] }).success).toBe(false);
  });

  it_m2("refuses `verified-done` over a mandatory obligation whose verdict answered nothing", () => {
    for (const verdict of ["unknown", "ambiguous"]) {
      const verification = [{ id: UUID_4, obligation: "ucpath.person-verified", mandatory: true, verdict, evidence: [] }];
      expect_m2(RunEvidenceReceiptSchema_m2.safeParse({ ...VERIFIED_DONE, verification }).success).toBe(false);
    }
  });

  it_m2("refuses `verified-done` carrying any warning at all", () => {
    const warnings = [{ id: UUID_4, code: "OPTIONAL_FACT_MISSING", summary: "Optional note missing", loadBearing: false, evidence: [] }];
    expect_m2(RunEvidenceReceiptSchema_m2.safeParse({ ...VERIFIED_DONE, warnings }).success).toBe(false);
  });

  it_m2("refuses `verified-done` carrying a failure id", () => {
    expect_m2(RunEvidenceReceiptSchema_m2.safeParse({
      ...VERIFIED_DONE,
      failure: { state: "present", value: UUID_4 },
    }).success).toBe(false);
  });

  it_m2("refuses a `verified` obligation that cites no evidence — the read-back is what earns the word", () => {
    const verification = [{ id: UUID_4, obligation: "ucpath.person-verified", mandatory: true, verdict: "verified", evidence: [] }];
    expect_m2(RunEvidenceReceiptSchema_m2.safeParse({ ...VERIFIED_DONE, verification }).success).toBe(false);
  });
});
}
