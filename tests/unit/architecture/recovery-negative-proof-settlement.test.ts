import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { manualClock } from "../../../src/domain/clock.js";
import {
  NegativeSettlementEvaluationInputSchema,
  evaluateNegativeSettlement,
} from "../../../src/domain/write-safety.js";
import {
  ABSENCE_1,
  ABSENCE_2,
  HASH_A,
  IDEMPOTENCY_KEY_DIGEST,
  LATEST,
  NOW,
  UUID_1,
  UUID_2,
} from "../../fixtures/phase1c-contract-fixtures.js";

const POLICY = {
  kind: "stabilized",
  minSinceFenceMs: 60_000,
  consistentReads: 2,
  minBetweenReadsMs: 60_000,
  requireSameSourceState: true,
} as const;
const CLOCK = manualClock(new Date(LATEST));

function evaluation(verdicts: readonly unknown[], policy: unknown = POLICY) {
  return {
    writeIntentId: UUID_1,
    generation: 1,
    idempotencyKeyDigest: IDEMPOTENCY_KEY_DIGEST,
    authoritativeSource: ABSENCE_1.source,
    authoritativeSourceState: ABSENCE_1.sourceState,
    queryDigest: ABSENCE_1.queryDigest,
    fencedAt: NOW,
    policy,
    verdicts,
  };
}

function absence(evidence: unknown) {
  return { state: "absent", evidence };
}

function decisionState(input: unknown) {
  const result = evaluateNegativeSettlement(input, CLOCK);
  return {
    state: result.state,
    code: "code" in result ? result.code : undefined,
    observationsNeeded: "observationsNeeded" in result ? result.observationsNeeded : undefined,
  };
}

describe("stabilized negative-proof settlement", () => {
  it("authorizes retry only at the exact propagation and read-spacing boundaries", () => {
    const decision = evaluateNegativeSettlement(evaluation([
      absence(ABSENCE_1),
      absence(ABSENCE_2),
    ]), CLOCK);
    assert.equal(decision.state, "safe-to-retry");
    if (decision.state !== "safe-to-retry") throw new Error("expected safe settlement");
    assert.deepEqual(decision.evidence, [ABSENCE_1, ABSENCE_2]);
    assert.equal(decision.decidedAt, LATEST);

    const oneMillisecondEarly = {
      ...ABSENCE_2,
      observedAt: "2026-07-31T17:01:59.999Z",
    };
    assert.deepEqual(decisionState(evaluation([
      absence(ABSENCE_1),
      absence(oneMillisecondEarly),
    ])), { state: "wait", code: undefined, observationsNeeded: 1 });
  });

  it("gives pre-window and single observations zero retry authority", () => {
    const early = { ...ABSENCE_1, observedAt: "2026-07-31T17:00:59.999Z" };
    assert.deepEqual(decisionState(evaluation([
      absence(early),
      absence(ABSENCE_1),
    ])), { state: "wait", code: undefined, observationsNeeded: 1 });
    assert.deepEqual(decisionState(evaluation([
      absence(ABSENCE_1),
    ])), { state: "wait", code: undefined, observationsNeeded: 1 });
  });

  it("parks every wrong key, query, authoritative source, or source-state set", () => {
    for (const evidence of [
      { ...ABSENCE_1, idempotencyKeyDigest: HASH_A },
      { ...ABSENCE_1, queryDigest: HASH_A },
      { ...ABSENCE_1, source: "ucpath.termination.other-search" },
      { ...ABSENCE_1, sourceState: "ucpath.termination-other-results" },
    ]) {
      assert.deepEqual(decisionState(evaluation([
        absence(evidence),
        absence({ ...evidence, observedAt: ABSENCE_2.observedAt, evidenceRef: ABSENCE_2.evidenceRef }),
      ])), { state: "parked", code: "inconsistent-evidence", observationsNeeded: undefined });
    }
  });

  it("parks inconsistent ordering and evidence observed after the injected Clock", () => {
    assert.deepEqual(decisionState(evaluation([
      absence(ABSENCE_2),
      absence(ABSENCE_1),
    ])), { state: "parked", code: "inconsistent-evidence", observationsNeeded: undefined });

    const future = { ...ABSENCE_2, observedAt: "2026-07-31T17:02:00.001Z" };
    assert.deepEqual(decisionState(evaluation([
      absence(ABSENCE_1),
      absence(future),
    ])), { state: "parked", code: "inconsistent-evidence", observationsNeeded: undefined });

    assert.deepEqual(decisionState(evaluation([
      absence(ABSENCE_1),
      absence({ ...ABSENCE_2, evidenceRef: ABSENCE_1.evidenceRef }),
    ])), { state: "parked", code: "inconsistent-evidence", observationsNeeded: undefined });
  });

  it("never turns malformed, present, ambiguous, unknown, or operator-only evidence into retry", () => {
    const malformed = evaluation([
      absence({ ...ABSENCE_1, evidenceRef: undefined }),
      absence(ABSENCE_2),
    ]);
    assert.equal(NegativeSettlementEvaluationInputSchema.safeParse(malformed).success, false);
    assert.throws(() => evaluateNegativeSettlement(malformed, CLOCK));

    const present = {
      state: "present",
      proof: { proofSchemaHash: HASH_A, proofFingerprint: HASH_A, evidenceRef: `observation:${UUID_2}` },
    };
    const ambiguous = {
      state: "ambiguous",
      matches: 2,
      observedAt: ABSENCE_1.observedAt,
      queryDigest: ABSENCE_1.queryDigest,
      evidence: [`observation:${UUID_1}`, `observation:${UUID_2}`],
    };
    const unknown = { state: "unknown", reason: "probe timed out", observedAt: ABSENCE_1.observedAt };
    assert.deepEqual(decisionState(evaluation([present])), { state: "parked", code: "present", observationsNeeded: undefined });
    assert.deepEqual(decisionState(evaluation([ambiguous])), { state: "parked", code: "ambiguous", observationsNeeded: undefined });
    assert.deepEqual(decisionState(evaluation([unknown])), { state: "parked", code: "unknown", observationsNeeded: undefined });
    assert.deepEqual(decisionState(evaluation([
      absence(ABSENCE_1),
      absence(ABSENCE_2),
    ], { kind: "operator-only", reason: "target has no authoritative negative read" })), {
      state: "parked",
      code: "operator-only",
      observationsNeeded: undefined,
    });
  });
});
