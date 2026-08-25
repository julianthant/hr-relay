import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { DryRunScenarioResultSchema } from "../../src/domain/trust/dry-run-scenario-result.js";

const NOW = "2026-08-25T12:00:00.000Z";
const HASH = "a".repeat(64);
const STARTED_MET_RESULT = {
  resultId: "11111111-1111-4111-8111-111111111111",
  scenarioId: "separations-kuali-finalization/dry-run",
  workflow: "separations-kuali-finalization",
  subjectLabel: "finalization-canary",
  manifestDigest: HASH,
  verdict: "met",
  assertions: [
    { assertionId: "nodes-reached", verdict: "met", reason: "reached-declared-nodes" },
    { assertionId: "write-deltas-zero", verdict: "met", reason: "write-deltas-unchanged" },
  ],
  wallTimeMs: 12_345,
  recordedAt: NOW,
  execution: {
    state: "started",
    runId: "22222222-2222-4222-8222-222222222222",
    traceId: "sep-120000-2222",
  },
};

describe("durable dry-run scenario results", () => {
  it("accepts a started scenario that met its ordered assertions", () => {
    const result = DryRunScenarioResultSchema.parse(STARTED_MET_RESULT);

    assert.equal(result.execution.state, "started");
    assert.deepEqual(result.assertions.map(({ assertionId }) => assertionId), [
      "nodes-reached",
      "write-deltas-zero",
    ]);
  });

  it("accepts a started scenario whose assertion failed", () => {
    const result = DryRunScenarioResultSchema.parse({
      ...STARTED_MET_RESULT,
      resultId: "33333333-3333-4333-8333-333333333333",
      verdict: "failed",
      assertions: [
        { assertionId: "nodes-reached", verdict: "failed", reason: "stopped-before-finalize-kuali" },
      ],
    });

    assert.equal(result.verdict, "failed");
  });

  it("records a missing subject as not-started blocked without run or trace ids", () => {
    const result = DryRunScenarioResultSchema.parse({
      ...STARTED_MET_RESULT,
      resultId: "44444444-4444-4444-8444-444444444444",
      verdict: "blocked",
      assertions: [
        { assertionId: "subject-available", verdict: "blocked", reason: "subject-unavailable" },
      ],
      wallTimeMs: 0,
      execution: { state: "not-started", reason: "subject-unavailable" },
    });

    assert.deepEqual(result.execution, { state: "not-started", reason: "subject-unavailable" });
  });

  it("rejects duplicate assertion identities in the ordered outcome ledger", () => {
    assert.equal(DryRunScenarioResultSchema.safeParse({
      ...STARTED_MET_RESULT,
      assertions: [STARTED_MET_RESULT.assertions[0], STARTED_MET_RESULT.assertions[0]],
    }).success, false);
  });

  it("rejects a met verdict when any assertion did not meet", () => {
    assert.equal(DryRunScenarioResultSchema.safeParse({
      ...STARTED_MET_RESULT,
      assertions: [
        { assertionId: "nodes-reached", verdict: "failed", reason: "stopped-before-finalize-kuali" },
      ],
    }).success, false);
  });

  it("rejects subject values and leaky or open fields at every result boundary", () => {
    const leaky = [
      { ...STARTED_MET_RESULT, subjectLabel: "10873698" },
      { ...STARTED_MET_RESULT, subjectValue: "10873698" },
      {
        ...STARTED_MET_RESULT,
        assertions: [{ ...STARTED_MET_RESULT.assertions[0], resolvedValue: "10873698" }],
      },
      {
        ...STARTED_MET_RESULT,
        assertions: [{ ...STARTED_MET_RESULT.assertions[0], detail: "resolved EID 10873698" }],
      },
      {
        ...STARTED_MET_RESULT,
        assertions: [{ ...STARTED_MET_RESULT.assertions[0], reason: "10873698" }],
      },
      { ...STARTED_MET_RESULT, execution: { ...STARTED_MET_RESULT.execution, subjectValue: "10873698" } },
    ];

    for (const candidate of leaky) {
      assert.equal(DryRunScenarioResultSchema.safeParse(candidate).success, false);
    }
  });

  it("rejects a not-started result with any verdict except blocked", () => {
    assert.equal(DryRunScenarioResultSchema.safeParse({
      ...STARTED_MET_RESULT,
      execution: { state: "not-started", reason: "subject-unavailable" },
    }).success, false);
  });

  it("accepts only a structured reason code for an assertion outcome", () => {
    const result = DryRunScenarioResultSchema.parse({
      ...STARTED_MET_RESULT,
      assertions: [
        { assertionId: "nodes-reached", verdict: "met", reason: "reached-declared-nodes" },
      ],
    });

    assert.equal(result.assertions[0]?.reason, "reached-declared-nodes");
  });
});
