import { default as assert_m0, default as assert_m1 } from "node:assert/strict";
import { createHash as createHash_m1 } from "node:crypto";
import { describe as describe_m0, describe as describe_m1, it as it_m0, it as it_m1 } from "vitest";
import { buildRunEvidenceReceipt as buildRunEvidenceReceipt_m0 } from "../../../src/backend/runs/provenance/evidence-receipt.js";
import { manualClock as manualClock_m1 } from "../../../src/rules/time/clock.js";
import { canonicalJsonStringify as canonicalJsonStringify_m1 } from "../../../src/rules/validation/canonical-json.js";
import { deriveIdempotencyKeyDigest as deriveIdempotencyKeyDigest_m0, deriveIdempotencyKeyDigest as deriveIdempotencyKeyDigest_m1, deriveWriteBindingProofDigest as deriveWriteBindingProofDigest_m1, evaluateNegativeSettlement as evaluateNegativeSettlement_m1, NegativeSettlementEvaluationInputSchema as NegativeSettlementEvaluationInputSchema_m1, RecoveryProbeVerdictSchema as RecoveryProbeVerdictSchema_m1, SubjectProofSchema as SubjectProofSchema_m1, UnscopedBindingProofSchema as UnscopedBindingProofSchema_m1, WriteAttemptRecordSchema as WriteAttemptRecordSchema_m1, WriteBindingProofSchema as WriteBindingProofSchema_m1, WriteIntentRecordSchema as WriteIntentRecordSchema_m1 } from "../../../src/rules/write-safety/write-safety.js";
import { ABSENCE_1 as ABSENCE_1_m1, ABSENCE_2 as ABSENCE_2_m1, HASH_A as HASH_A_m1, HASH_B as HASH_B_m1, LATER as LATER_m1, NOW as NOW_m1, SUBJECT_PROOF as SUBJECT_PROOF_m1, UNSCOPED_PROOF as UNSCOPED_PROOF_m1, UUID_1 as UUID_1_m1, WRITE_ATTEMPT as WRITE_ATTEMPT_m1, WRITE_INTENT_ATTEMPTING as WRITE_INTENT_ATTEMPTING_m1 } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { KUALI_IDEMPOTENCY_KEY as KUALI_IDEMPOTENCY_KEY_m0, kualiReceiptEvidence as kualiReceiptEvidence_m0 } from "../../support/fixtures/receipt-run-fixtures.js";
import { separationsKualiFinalizationDescriptor as separationsKualiFinalizationDescriptor_m0 } from "../../support/helpers/registered-workflows.js";

{

describe_m0("current receipt — the commit action carries what proved the write", () => {
  const evidence = kualiReceiptEvidence_m0();
  const receipt = buildRunEvidenceReceipt_m0({
    descriptor: separationsKualiFinalizationDescriptor_m0,
    run: evidence.run,
    result: evidence.result,
    checkpoints: evidence.checkpoints,
    writes: evidence.writes,
  }, 5);

  it_m0("retains the current transaction digest and exact private fence identity", () => {
    const commit = receipt.actions.find((action) => action.kind === "commit");
    assert_m0.ok(commit, "the kuali run derives exactly one commit action");
    const proved = commit.proved;
    assert_m0.ok(proved, "the settled kuali commit must carry its proof");
    assert_m0.equal(proved.system, "kuali");
    assert_m0.equal(
      proved.idempotencyKeyDigest,
      deriveIdempotencyKeyDigest_m0("kuali", KUALI_IDEMPOTENCY_KEY_m0),
    );
    assert_m0.equal(evidence.writes[0]?.intent.idempotencyKeyDigest, deriveIdempotencyKeyDigest_m0("kuali", KUALI_IDEMPOTENCY_KEY_m0));
    assert_m0.ok(
      !JSON.stringify(proved).includes(KUALI_IDEMPOTENCY_KEY_m0),
      "the raw idempotency key embeds identifiers and stays in authority",
    );
  });
});
}

{

const POLICY = {
  kind: "stabilized",
  minSinceFenceMs: 60_000,
  consistentReads: 2,
  minBetweenReadsMs: 60_000,
  requireSameSourceState: true,
} as const;

const CLOCK = manualClock_m1(new Date("2026-07-31T17:03:00.000Z"));
const evaluation = (verdicts: readonly unknown[], policy: unknown = POLICY) => ({
  writeIntentId: UUID_1_m1,
  generation: 1,
  idempotencyKeyDigest: ABSENCE_1_m1.idempotencyKeyDigest,
  authoritativeSource: ABSENCE_1_m1.source,
  authoritativeSourceState: ABSENCE_1_m1.sourceState,
  queryDigest: ABSENCE_1_m1.queryDigest,
  fencedAt: NOW_m1,
  policy,
  verdicts,
});

describe_m1("write-safety schema and negative-settlement rules", () => {
  it_m1("preserves the exact SHA-256 identities of permanent keys and binding proofs", () => {
    for (const key of ["fixture:write", "fixture:résumé:東京:🧭", "fixture:\ud800"]) {
      const expected = createHash_m1("sha256").update("hrauto:permanent-write-key:v1\0").update("ucpath").update("\0").update(key).digest("hex");
      assert_m1.equal(deriveIdempotencyKeyDigest_m1("ucpath", key), expected);
    }
    for (const proof of [SUBJECT_PROOF_m1, UNSCOPED_PROOF_m1]) {
      const expected = createHash_m1("sha256").update("hrauto:write-binding-proof:v1\0").update(canonicalJsonStringify_m1(WriteBindingProofSchema_m1.parse(proof))).digest("hex");
      assert_m1.equal(deriveWriteBindingProofDigest_m1(proof), expected);
    }
  });

  it_m1("requires evidence-qualified probe verdicts and closed binding proofs", () => {
    assert_m1.equal(RecoveryProbeVerdictSchema_m1.safeParse({ state: "absent", evidence: ABSENCE_1_m1 }).success, true);
    assert_m1.equal(RecoveryProbeVerdictSchema_m1.safeParse({ state: "absent" }).success, false);
    assert_m1.equal(RecoveryProbeVerdictSchema_m1.safeParse({ state: "absent", evidence: { observedAt: LATER_m1 } }).success, false);
    assert_m1.equal(RecoveryProbeVerdictSchema_m1.safeParse({ state: "present", proof: true }).success, false);
    assert_m1.equal(RecoveryProbeVerdictSchema_m1.safeParse({ state: "ambiguous", matches: 1, observedAt: LATER_m1, queryDigest: HASH_B_m1, evidence: [] }).success, false);

    assert_m1.equal(SubjectProofSchema_m1.safeParse(SUBJECT_PROOF_m1).success, true);
    assert_m1.equal(UnscopedBindingProofSchema_m1.safeParse(UNSCOPED_PROOF_m1).success, true);
    assert_m1.equal(WriteBindingProofSchema_m1.safeParse({ kind: "subject-match", runId: UUID_1_m1 }).success, false);
    assert_m1.equal(SubjectProofSchema_m1.safeParse({
      ...SUBJECT_PROOF_m1,
      observed: { ...SUBJECT_PROOF_m1.observed, bindingDigest: HASH_B_m1 },
    }).success, false);
    assert_m1.equal(UnscopedBindingProofSchema_m1.safeParse({ ...UNSCOPED_PROOF_m1, reviewedReasonId: "because-none" }).success, false);
  });

  it_m1("unlocks retry only after two post-window, consistently spaced negative observations", () => {
    const safe = evaluateNegativeSettlement_m1(evaluation([
      { state: "absent", evidence: ABSENCE_1_m1 },
      { state: "absent", evidence: ABSENCE_2_m1 },
    ]), CLOCK);
    assert_m1.equal(safe.state, "safe-to-retry");

    const single = evaluateNegativeSettlement_m1(evaluation([{ state: "absent", evidence: ABSENCE_1_m1 }]), CLOCK);
    assert_m1.deepEqual({ state: single.state, observationsNeeded: "observationsNeeded" in single ? single.observationsNeeded : 0 }, { state: "wait", observationsNeeded: 1 });

    const early = { ...ABSENCE_1_m1, observedAt: "2026-07-31T17:00:30.000Z" };
    const preWindow = evaluateNegativeSettlement_m1(evaluation([
      { state: "absent", evidence: early },
      { state: "absent", evidence: ABSENCE_1_m1 },
    ]), CLOCK);
    assert_m1.equal(preWindow.state, "wait");
  });

  it_m1("parks ambiguous, unknown, present, inconsistent, and operator-only settlements", () => {
    const ambiguous = evaluateNegativeSettlement_m1(evaluation([{
      state: "ambiguous", matches: 2, observedAt: LATER_m1, queryDigest: HASH_B_m1,
      evidence: [`observation:${UUID_1_m1}`, "observation:22222222-2222-4222-8222-222222222222"],
    }]), CLOCK);
    assert_m1.deepEqual({ state: ambiguous.state, code: "code" in ambiguous ? ambiguous.code : "" }, { state: "parked", code: "ambiguous" });

    const unknown = evaluateNegativeSettlement_m1(evaluation([{ state: "unknown", reason: "probe timed out", observedAt: LATER_m1 }]), CLOCK);
    assert_m1.deepEqual({ state: unknown.state, code: "code" in unknown ? unknown.code : "" }, { state: "parked", code: "unknown" });

    const present = evaluateNegativeSettlement_m1(evaluation([{ state: "present", proof: { proofSchemaHash: HASH_A_m1, proofFingerprint: HASH_B_m1, evidenceRef: `observation:${UUID_1_m1}` } }]), CLOCK);
    assert_m1.deepEqual({ state: present.state, code: "code" in present ? present.code : "" }, { state: "parked", code: "present" });

    const wrongKey = evaluateNegativeSettlement_m1(evaluation([{ state: "absent", evidence: { ...ABSENCE_1_m1, idempotencyKeyDigest: HASH_A_m1 } }]), CLOCK);
    assert_m1.deepEqual({ state: wrongKey.state, code: "code" in wrongKey ? wrongKey.code : "" }, { state: "parked", code: "inconsistent-evidence" });

    const inconsistent = evaluateNegativeSettlement_m1(evaluation([
      { state: "absent", evidence: ABSENCE_1_m1 },
      { state: "absent", evidence: { ...ABSENCE_2_m1, queryDigest: HASH_A_m1 } },
    ]), CLOCK);
    assert_m1.deepEqual({ state: inconsistent.state, code: "code" in inconsistent ? inconsistent.code : "" }, { state: "parked", code: "inconsistent-evidence" });

    const operatorOnly = evaluateNegativeSettlement_m1(evaluation([], { kind: "operator-only", reason: "no trustworthy negative read" }), CLOCK);
    assert_m1.deepEqual({ state: operatorOnly.state, code: "code" in operatorOnly ? operatorOnly.code : "" }, { state: "parked", code: "operator-only" });
  });

  it_m1("keeps permanent intent and attempt records strict and proof-carrying", () => {
    assert_m1.equal(WriteIntentRecordSchema_m1.safeParse(WRITE_INTENT_ATTEMPTING_m1).success, true);
    assert_m1.equal(WriteAttemptRecordSchema_m1.safeParse(WRITE_ATTEMPT_m1).success, true);
    assert_m1.equal(WriteIntentRecordSchema_m1.safeParse({ ...WRITE_INTENT_ATTEMPTING_m1, bindingProof: {} }).success, false);
    assert_m1.equal(WriteAttemptRecordSchema_m1.safeParse({ ...WRITE_ATTEMPT_m1, outcome: { state: "committed" } }).success, false);
    assert_m1.equal(WriteIntentRecordSchema_m1.safeParse({ ...WRITE_INTENT_ATTEMPTING_m1, idempotencyKeyDigest: "not-a-hash" }).success, false);
    assert_m1.equal(NegativeSettlementEvaluationInputSchema_m1.safeParse({ ...evaluation([]), fencedAt: "yesterday" }).success, false);
  });
});
}
