import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { z } from "zod";
import {
  ContractFieldPathSchema,
  defineTaskContract,
} from "../../src/domain/contracts/base.js";
import { EidSchema, ObservationIdSchema, ScenarioIdSchema, TaskIdSchema } from "../../src/domain/ids.js";
import { taskFailer } from "../../src/base/task.js";
import { TaskError, wrapUnhandledTaskError } from "../../src/base/errors.js";

const INPUT = z.strictObject({ eid: EidSchema });
const READ_OUTPUT = z.strictObject({ eid: EidSchema, found: z.literal(true) });
const COMMIT_OUTPUT = z.strictObject({ transactionId: z.string().min(1) });
const PROOF = z.strictObject({ transactionId: z.string().min(1) });
const OBSERVATION = ObservationIdSchema.parse("ucpath.person-org.displayed-eid");
const SCENARIO = ScenarioIdSchema.parse("ucpath/person-org-happy");

function personSubject(requiredAt: "before-subject-read" | "after-prepare-before-fence") {
  return {
    kind: "person" as const,
    expected: {
      fromInput: ContractFieldPathSchema.parse("eid"),
      identity: "eid" as const,
    },
    observe: OBSERVATION,
    match: "normalized-exact-eid" as const,
    requiredAt,
  };
}

function readContract() {
  return defineTaskContract({
    id: TaskIdSchema.parse("ucpath/search-person-org"),
    title: "Search Person Organizational Summary",
    effect: "read",
    input: INPUT,
    output: READ_OUTPUT,
    errorCodes: ["eid-not-found", "unexpected-page-state"] as const,
    subject: personSubject("before-subject-read"),
    scenarios: [SCENARIO],
    freshness: {
      defaultMaxAgeMs: 0,
      byField: [{ path: ContractFieldPathSchema.parse("eid"), maxAgeMs: 0 }],
    },
    provenance: {
      default: "live",
      byField: [{ path: ContractFieldPathSchema.parse("eid"), source: "live" }],
    },
    example: { eid: "10800000", found: true },
  });
}

function prepareContract() {
  return defineTaskContract({
    id: TaskIdSchema.parse("ucpath/fill-person-org"),
    title: "Fill Person Organizational Summary",
    effect: "prepare",
    input: INPUT,
    output: z.strictObject({ staged: z.literal(true) }),
    errorCodes: ["unexpected-page-state"] as const,
    subject: personSubject("after-prepare-before-fence"),
    scenarios: [SCENARIO],
    checkpoint: "in-memory-only",
    example: { staged: true },
  });
}

function commitContract() {
  return defineTaskContract({
    id: TaskIdSchema.parse("ucpath/submit-person-org"),
    title: "Submit Person Organizational Summary",
    effect: "commit",
    input: INPUT,
    output: COMMIT_OUTPUT,
    errorCodes: ["submit-failed", "wrong-subject"] as const,
    subject: personSubject("after-prepare-before-fence"),
    scenarios: [SCENARIO],
    writeSafety: {
      completion: {
        kind: "receipt",
        proofSchema: PROOF,
        proofFromOutput: (output) => output,
        proofFromPresentProbe: ({ proof }) => proof,
        outputFromProof: (proof) => proof,
      },
      idempotency: {
        probe: TaskIdSchema.parse("ucpath/search-person-org"),
        key: ({ eid }) => `${eid}|person-org`,
        recoveryAbsence: {
          kind: "stabilized",
          minSinceFenceMs: 1_000,
          consistentReads: 2,
          minBetweenReadsMs: 500,
          requireSameSourceState: true,
        },
      },
    },
    example: { transactionId: "T123" },
  });
}

describe("sealed task contracts", () => {
  it("seals and freezes all three effect contracts", () => {
    for (const contract of [readContract(), prepareContract(), commitContract()]) {
      assert.equal(contract.__sealed, true);
      assert.equal(Object.isFrozen(contract), true);
      assert.equal(contract.output.safeParse(contract.example).success, true);
    }
  });

  it("rejects open schemas, effect/verb drift, and malformed examples", () => {
    assert.throws(() => defineTaskContract({
      ...readContract(),
      input: z.object({ eid: EidSchema }),
    }), /strictObject/);
    assert.throws(() => defineTaskContract({
      ...readContract(),
      id: TaskIdSchema.parse("ucpath/submit-person-org"),
    }), /verb does not agree/);
    assert.throws(() => defineTaskContract({
      ...readContract(),
      output: z.strictObject({ count: z.number().int().positive() }),
      example: { count: 0 },
    }), /too_small|Too small/);
  });

  it("rejects unknown freshness/provenance paths and cross-system subjects", () => {
    assert.throws(() => defineTaskContract({
      ...readContract(),
      freshness: {
        defaultMaxAgeMs: 0,
        byField: [{ path: ContractFieldPathSchema.parse("missing"), maxAgeMs: 0 }],
      },
    }), /unknown output field missing/);
    assert.throws(() => defineTaskContract({
      ...readContract(),
      subject: {
        ...personSubject("before-subject-read"),
        observe: ObservationIdSchema.parse("crm.person.displayed-eid"),
      },
    }), /crosses systems/);
  });

  it("rejects provider leakage and unsafe commit subject/proof wiring", () => {
    assert.throws(() => defineTaskContract({
      ...readContract(),
      providers: ["ocr.extract"],
    }), /only for service-store reads/);
    assert.throws(() => defineTaskContract({
      ...commitContract(),
      subject: personSubject("before-subject-read"),
    }), /after prepare and before fence/);
    assert.throws(() => defineTaskContract({
      ...commitContract(),
      writeSafety: {
        ...commitContract().writeSafety,
        idempotency: {
          ...commitContract().writeSafety.idempotency,
          probe: TaskIdSchema.parse("crm/search-person"),
        },
      },
    }), /probe crosses stores/);
  });

  it("emits typed task errors and wraps unknown failures without claiming transient", () => {
    const contract = readContract();
    const fail = taskFailer<typeof contract.errorCodes>(contract.id);
    assert.throws(
      () => fail("eid-not-found", "no row for EID 10800000", { subject: "10800000" }),
      (error) => error instanceof TaskError
        && error.message === "[ucpath/search-person-org] eid-not-found: no row for EID 10800000"
        && error.subject === "10800000"
        && error.transient === false,
    );
    const wrapped = wrapUnhandledTaskError(contract.id, new Error("boom"));
    assert.equal(wrapped.code, "unhandled");
    assert.equal(wrapped.transient, false);
    assert.match(wrapped.message, /\[ucpath\/search-person-org\] unhandled: boom/);
  });
});
