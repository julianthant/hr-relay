import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "vitest";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { manualClock } from "../../../../src/rules/time/clock.js";
import {
  NegativeSettlementEvaluationInputSchema,
  RecoveryProbeVerdictSchema,
  SubjectProofSchema,
  UnscopedBindingProofSchema,
  WriteAttemptRecordSchema,
  WriteBindingProofSchema,
  WriteIntentRecordSchema,
  evaluateNegativeSettlement,
  deriveIdempotencyKeyDigest,
  deriveWriteBindingProofDigest,
} from "../../../../src/rules/write-safety/write-safety.js";
import {
  ABSENCE_1,
  ABSENCE_2,
  HASH_A,
  HASH_B,
  LATER,
  NOW,
  SUBJECT_PROOF,
  UNSCOPED_PROOF,
  UUID_1,
  WRITE_ATTEMPT,
  WRITE_INTENT_ATTEMPTING,
} from "../../../support/fixtures/phase1c-contract-fixtures.js";

const POLICY = {
  kind: "stabilized",
  minSinceFenceMs: 60_000,
  consistentReads: 2,
  minBetweenReadsMs: 60_000,
  requireSameSourceState: true,
} as const;

const CLOCK = manualClock(new Date("2026-07-31T17:03:00.000Z"));
const evaluation = (verdicts: readonly unknown[], policy: unknown = POLICY) => ({
  writeIntentId: UUID_1,
  generation: 1,
  idempotencyKeyDigest: ABSENCE_1.idempotencyKeyDigest,
  authoritativeSource: ABSENCE_1.source,
  authoritativeSourceState: ABSENCE_1.sourceState,
  queryDigest: ABSENCE_1.queryDigest,
  fencedAt: NOW,
  policy,
  verdicts,
});

describe("write-safety schema and negative-settlement rules", () => {
  it("preserves the exact SHA-256 identities of permanent keys and binding proofs", () => {
    for (const key of ["fixture:write", "fixture:résumé:東京:🧭", "fixture:\ud800"]) {
      const expected = createHash("sha256").update("hrauto:permanent-write-key:v1\0").update("ucpath").update("\0").update(key).digest("hex");
      assert.equal(deriveIdempotencyKeyDigest("ucpath", key), expected);
    }
    for (const proof of [SUBJECT_PROOF, UNSCOPED_PROOF]) {
      const expected = createHash("sha256").update("hrauto:write-binding-proof:v1\0").update(canonicalJsonStringify(WriteBindingProofSchema.parse(proof))).digest("hex");
      assert.equal(deriveWriteBindingProofDigest(proof), expected);
    }
  });

  it("requires evidence-qualified probe verdicts and closed binding proofs", () => {
    assert.equal(RecoveryProbeVerdictSchema.safeParse({ state: "absent", evidence: ABSENCE_1 }).success, true);
    assert.equal(RecoveryProbeVerdictSchema.safeParse({ state: "absent" }).success, false);
    assert.equal(RecoveryProbeVerdictSchema.safeParse({ state: "absent", evidence: { observedAt: LATER } }).success, false);
    assert.equal(RecoveryProbeVerdictSchema.safeParse({ state: "present", proof: true }).success, false);
    assert.equal(RecoveryProbeVerdictSchema.safeParse({ state: "ambiguous", matches: 1, observedAt: LATER, queryDigest: HASH_B, evidence: [] }).success, false);

    assert.equal(SubjectProofSchema.safeParse(SUBJECT_PROOF).success, true);
    assert.equal(UnscopedBindingProofSchema.safeParse(UNSCOPED_PROOF).success, true);
    assert.equal(WriteBindingProofSchema.safeParse({ kind: "subject-match", runId: UUID_1 }).success, false);
    assert.equal(SubjectProofSchema.safeParse({
      ...SUBJECT_PROOF,
      observed: { ...SUBJECT_PROOF.observed, bindingDigest: HASH_B },
    }).success, false);
    assert.equal(UnscopedBindingProofSchema.safeParse({ ...UNSCOPED_PROOF, reviewedReasonId: "because-none" }).success, false);
  });

  it("unlocks retry only after two post-window, consistently spaced negative observations", () => {
    const safe = evaluateNegativeSettlement(evaluation([
      { state: "absent", evidence: ABSENCE_1 },
      { state: "absent", evidence: ABSENCE_2 },
    ]), CLOCK);
    assert.equal(safe.state, "safe-to-retry");

    const single = evaluateNegativeSettlement(evaluation([{ state: "absent", evidence: ABSENCE_1 }]), CLOCK);
    assert.deepEqual({ state: single.state, observationsNeeded: "observationsNeeded" in single ? single.observationsNeeded : 0 }, { state: "wait", observationsNeeded: 1 });

    const early = { ...ABSENCE_1, observedAt: "2026-07-31T17:00:30.000Z" };
    const preWindow = evaluateNegativeSettlement(evaluation([
      { state: "absent", evidence: early },
      { state: "absent", evidence: ABSENCE_1 },
    ]), CLOCK);
    assert.equal(preWindow.state, "wait");
  });

  it("parks ambiguous, unknown, present, inconsistent, and operator-only settlements", () => {
    const ambiguous = evaluateNegativeSettlement(evaluation([{
      state: "ambiguous", matches: 2, observedAt: LATER, queryDigest: HASH_B,
      evidence: [`observation:${UUID_1}`, "observation:22222222-2222-4222-8222-222222222222"],
    }]), CLOCK);
    assert.deepEqual({ state: ambiguous.state, code: "code" in ambiguous ? ambiguous.code : "" }, { state: "parked", code: "ambiguous" });

    const unknown = evaluateNegativeSettlement(evaluation([{ state: "unknown", reason: "probe timed out", observedAt: LATER }]), CLOCK);
    assert.deepEqual({ state: unknown.state, code: "code" in unknown ? unknown.code : "" }, { state: "parked", code: "unknown" });

    const present = evaluateNegativeSettlement(evaluation([{ state: "present", proof: { proofSchemaHash: HASH_A, proofFingerprint: HASH_B, evidenceRef: `observation:${UUID_1}` } }]), CLOCK);
    assert.deepEqual({ state: present.state, code: "code" in present ? present.code : "" }, { state: "parked", code: "present" });

    const wrongKey = evaluateNegativeSettlement(evaluation([{ state: "absent", evidence: { ...ABSENCE_1, idempotencyKeyDigest: HASH_A } }]), CLOCK);
    assert.deepEqual({ state: wrongKey.state, code: "code" in wrongKey ? wrongKey.code : "" }, { state: "parked", code: "inconsistent-evidence" });

    const inconsistent = evaluateNegativeSettlement(evaluation([
      { state: "absent", evidence: ABSENCE_1 },
      { state: "absent", evidence: { ...ABSENCE_2, queryDigest: HASH_A } },
    ]), CLOCK);
    assert.deepEqual({ state: inconsistent.state, code: "code" in inconsistent ? inconsistent.code : "" }, { state: "parked", code: "inconsistent-evidence" });

    const operatorOnly = evaluateNegativeSettlement(evaluation([], { kind: "operator-only", reason: "no trustworthy negative read" }), CLOCK);
    assert.deepEqual({ state: operatorOnly.state, code: "code" in operatorOnly ? operatorOnly.code : "" }, { state: "parked", code: "operator-only" });
  });

  it("keeps permanent intent and attempt records strict and proof-carrying", () => {
    assert.equal(WriteIntentRecordSchema.safeParse(WRITE_INTENT_ATTEMPTING).success, true);
    assert.equal(WriteAttemptRecordSchema.safeParse(WRITE_ATTEMPT).success, true);
    assert.equal(WriteIntentRecordSchema.safeParse({ ...WRITE_INTENT_ATTEMPTING, bindingProof: {} }).success, false);
    assert.equal(WriteAttemptRecordSchema.safeParse({ ...WRITE_ATTEMPT, outcome: { state: "committed" } }).success, false);
    assert.equal(WriteIntentRecordSchema.safeParse({ ...WRITE_INTENT_ATTEMPTING, idempotencyKeyDigest: "not-a-hash" }).success, false);
    assert.equal(NegativeSettlementEvaluationInputSchema.safeParse({ ...evaluation([]), fencedAt: "yesterday" }).success, false);
  });
});
