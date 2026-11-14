import { describe, expect, it } from "vitest";
import { WRITE_PARK_CODES } from "../../../src/rules/write-safety/write-safety-primitives.js";
import {
  transitionWrite,
  WRITE_EVENT_TYPES,
  WRITE_STATES,
  WRITE_TRANSITIONS,
  type WriteEvent,
  type WriteEventType,
  type WriteStateKey,
} from "../../../src/rules/write-safety/write-transitions.js";
import { ParkedWriteResolutionBindingSchema, WriteAttemptRecordSchema, WriteIntentRecordSchema } from "../../../src/rules/write-safety/write-safety.js";
import { LATER, UUID_5, UUID_6, WRITE_ATTEMPT, WRITE_INTENT_ATTEMPTING } from "../../support/fixtures/phase1c-contract-fixtures.js";

const binding = {
  commandId: UUID_5, auditId: UUID_6, writeIntentId: WRITE_ATTEMPT.writeIntentId, writeAttemptId: WRITE_ATTEMPT.writeAttemptId,
  generation: WRITE_ATTEMPT.generation, bindingProofDigest: WRITE_ATTEMPT.bindingProofDigest,
  idempotencyKeyDigest: WRITE_INTENT_ATTEMPTING.idempotencyKeyDigest, runId: WRITE_ATTEMPT.runId, runAttempt: WRITE_ATTEMPT.runAttempt,
  expectedRunVersion: 4, resolvedAt: LATER,
};
const present = { ...ParkedWriteResolutionBindingSchema.parse({ ...binding, decision: "present" }), decision: "present" as const };
const absent = { ...ParkedWriteResolutionBindingSchema.parse({ ...binding, decision: "absent" }), decision: "absent" as const };

const events: Record<WriteEventType, WriteEvent> = {
  commit: { type: "commit" },
  "settle-safe-to-retry": { type: "settle-safe-to-retry" },
  park: { type: "park", code: "unknown" },
  "resolve-present": { type: "resolve-present", resolution: present },
  "resolve-absent": { type: "resolve-absent", resolution: absent },
  refence: { type: "refence" },
};

/** Written by hand from the authority database's guards; it is the specification the table must reproduce. */
const SETTLED = { refused: "write-settled-present" } as const;
const OPERATOR = { refused: "operator-resolution-required" } as const;
const NOT_ATTEMPTING = { refused: "not-attempting" } as const;
const NOT_PARKED = { refused: "not-parked" } as const;
const NOT_RETRYABLE = { refused: "not-retryable" } as const;
const expected: Record<WriteStateKey, Record<WriteEventType, unknown>> = {
  "observed-present": {
    commit: SETTLED, "settle-safe-to-retry": SETTLED, park: SETTLED, "resolve-present": SETTLED, "resolve-absent": SETTLED, refence: SETTLED,
  },
  "attempting/attempting": {
    commit: { state: "committed/committed" }, "settle-safe-to-retry": { state: "retryable/safe-to-retry" }, park: { state: "parked/parked" },
    "resolve-present": NOT_PARKED, "resolve-absent": NOT_PARKED, refence: NOT_RETRYABLE,
  },
  "committed/committed": {
    commit: SETTLED, "settle-safe-to-retry": SETTLED, park: SETTLED, "resolve-present": SETTLED, "resolve-absent": SETTLED, refence: SETTLED,
  },
  "committed/parked": {
    commit: SETTLED, "settle-safe-to-retry": SETTLED, park: SETTLED, "resolve-present": SETTLED, "resolve-absent": SETTLED, refence: SETTLED,
  },
  "retryable/safe-to-retry": {
    commit: NOT_ATTEMPTING, "settle-safe-to-retry": NOT_ATTEMPTING, park: NOT_ATTEMPTING,
    "resolve-present": NOT_PARKED, "resolve-absent": NOT_PARKED, refence: { state: "attempting/attempting" },
  },
  "retryable/parked": {
    commit: NOT_ATTEMPTING, "settle-safe-to-retry": NOT_ATTEMPTING, park: NOT_ATTEMPTING,
    "resolve-present": NOT_PARKED, "resolve-absent": NOT_PARKED, refence: { state: "attempting/attempting" },
  },
  "parked/parked": {
    commit: OPERATOR, "settle-safe-to-retry": OPERATOR, park: OPERATOR,
    "resolve-present": { state: "committed/parked" }, "resolve-absent": { state: "retryable/parked" }, refence: OPERATOR,
  },
};

describe("write intent and attempt transition table", () => {
  it("covers every intent status and attempt outcome the durable schemas declare", () => {
    const intentStatuses = new Set(WRITE_STATES.map((state) => state.split("/")[0]));
    const attemptStates = new Set(WRITE_STATES.flatMap((state) => state.split("/").slice(1)));
    expect([...intentStatuses].sort()).toEqual(WriteIntentRecordSchema.options.map((option) => option.shape.status.value).sort());
    expect([...attemptStates].sort()).toEqual(WriteAttemptRecordSchema.shape.outcome.options.map((option) => option.shape.state.value).sort());
    expect(Object.keys(WRITE_TRANSITIONS).sort()).toEqual([...WRITE_STATES].sort());
    expect(Object.keys(expected).sort()).toEqual([...WRITE_STATES].sort());
  });

  for (const state of WRITE_STATES) {
    for (const type of WRITE_EVENT_TYPES) {
      it(`${state} on ${type}`, () => {
        expect(transitionWrite(state, events[type])).toEqual(expected[state][type]);
      });
    }
  }

  it("never retries an unknown outcome: no path leaves parked/parked for attempting without a resolution", () => {
    expect(transitionWrite("parked/parked", { type: "refence" })).toEqual(OPERATOR);
    const resolved = transitionWrite("parked/parked", { type: "resolve-absent", resolution: absent });
    expect(resolved).toEqual({ state: "retryable/parked" });
    expect(transitionWrite("retryable/parked", { type: "refence" })).toEqual({ state: "attempting/attempting" });
  });

  it("refuses a resolution without a valid binding or with the wrong decision", () => {
    // @ts-expect-error the resolution binding is a required argument of the parked-to-retryable edge
    expect(transitionWrite("parked/parked", { type: "resolve-absent" })).toEqual({ refused: "resolution-binding-required" });
    // @ts-expect-error an absent edge cannot take a present decision
    expect(transitionWrite("parked/parked", { type: "resolve-absent", resolution: present })).toEqual({ refused: "resolution-binding-required" });
    // @ts-expect-error a present edge cannot take an absent decision
    expect(transitionWrite("parked/parked", { type: "resolve-present", resolution: absent })).toEqual({ refused: "resolution-binding-required" });
    // @ts-expect-error a binding that fails its schema is refused at runtime as well
    expect(transitionWrite("parked/parked", { type: "resolve-absent", resolution: { ...absent, generation: 0 } })).toEqual({ refused: "resolution-binding-required" });
  });

  it("keeps the registry frozen so a returned result cannot change later answers", () => {
    for (const registry of [WRITE_STATES, WRITE_EVENT_TYPES, WRITE_TRANSITIONS, WRITE_PARK_CODES]) expect(Object.isFrozen(registry)).toBe(true);
    for (const state of WRITE_STATES) {
      expect(Object.isFrozen(WRITE_TRANSITIONS[state])).toBe(true);
      for (const type of WRITE_EVENT_TYPES) expect(Object.isFrozen(WRITE_TRANSITIONS[state][type])).toBe(true);
    }
    const parked = transitionWrite("attempting/attempting", { type: "park", code: "unknown" });
    expect(Reflect.set(parked, "state", "retryable/parked")).toBe(false);
    // @ts-expect-error a schema-invalid binding takes the runtime refusal path
    const refused = transitionWrite("parked/parked", { type: "resolve-absent", resolution: { ...absent, generation: 0 } });
    expect(Object.isFrozen(refused)).toBe(true);
    expect(transitionWrite("attempting/attempting", { type: "park", code: "unknown" })).toEqual({ state: "parked/parked" });
    expect(transitionWrite("parked/parked", { type: "refence" })).toEqual(OPERATOR);
  });

  it("parks only with a declared park code", () => {
    expect(WRITE_PARK_CODES).toEqual(["unknown", "ambiguous", "present-proof-invalid", "binding-invalid", "operator-required"]);
    const parked = WriteIntentRecordSchema.options.find((option) => option.shape.status.value === "parked");
    expect(parked && "parkedCode" in parked.shape ? parked.shape.parkedCode.options : undefined).toEqual(WRITE_PARK_CODES);
    for (const code of WRITE_PARK_CODES) expect(transitionWrite("attempting/attempting", { type: "park", code })).toEqual({ state: "parked/parked" });
    // @ts-expect-error park codes come from the one declared list
    expect(transitionWrite("attempting/attempting", { type: "park", code: "timeout" })).toEqual({ refused: "park-code-unknown" });
  });
});
