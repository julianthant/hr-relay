import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { CapabilityAvailabilitySchema, explicitValueSchema } from "../../src/domain/absence.js";
import { BoundaryFailureSchema } from "../../src/domain/boundary-failure.js";
import { canonicalJsonStringify, JsonValueSchema } from "../../src/domain/canonical-json.js";
import { manualClock } from "../../src/domain/clock.js";
import {
  ActorIdSchema,
  EidSchema,
  FingerprintSchema,
  ProjectionCursorSchema,
  RunIdSchema,
  TaskIdSchema,
} from "../../src/domain/ids.js";

describe("strict domain primitives", () => {
  it("brands identifiers and rejects neighboring string shapes", () => {
    assert.equal(RunIdSchema.parse("018f47fb-40a0-7b7e-8c2a-5ba0186d8479").length, 36);
    assert.equal(ActorIdSchema.parse("local-operator"), "local-operator");
    assert.equal(EidSchema.parse("10123456"), "10123456");
    assert.equal(TaskIdSchema.parse("ucpath/search-person-org"), "ucpath/search-person-org");
    assert.equal(FingerprintSchema.safeParse("f".repeat(63)).success, false);
    assert.equal(ProjectionCursorSchema.safeParse("1").success, false);
    assert.equal(ProjectionCursorSchema.safeParse("pc:0").success, false);
    assert.equal(TaskIdSchema.safeParse("ucpath/search_person").success, false);
  });

  it("accepts canonical JSON only and serializes object keys deterministically", () => {
    assert.equal(canonicalJsonStringify({ z: 1, a: { y: true, x: null } }), '{"a":{"x":null,"y":true},"z":1}');
    assert.equal(JsonValueSchema.safeParse({ invalid: undefined }).success, false);
    assert.equal(JsonValueSchema.safeParse(Number.NaN).success, false);
    assert.equal(JsonValueSchema.safeParse(new Map()).success, false);
  });

  it("makes absence and uncertainty explicit and recursively strict", () => {
    const schema = explicitValueSchema(EidSchema);
    assert.equal(schema.parse({ state: "absent", code: "not-observed", reason: "page unavailable" }).state, "absent");
    assert.equal(schema.safeParse({ state: "present", value: "10123456", extra: true }).success, false);
    assert.equal(schema.safeParse({ state: "ambiguous", reason: "two matches", candidates: ["10123456"] }).success, false);
    assert.equal(CapabilityAvailabilitySchema.safeParse({ state: "missing", reason: "x" }).success, false);
  });

  it("keeps boundary issue objects closed", () => {
    const failure = {
      kind: "boundary-failure",
      source: "config",
      summary: "invalid value",
      issues: [{ path: ["timeouts", "taskMs"], code: "too_small", message: "must be positive" }],
    };
    assert.equal(BoundaryFailureSchema.safeParse(failure).success, true);
    assert.equal(BoundaryFailureSchema.safeParse({
      ...failure,
      issues: [{ ...failure.issues[0], leaked: true }],
    }).success, false);
  });
});

describe("Clock", () => {
  it("separates wall and monotonic time and computes the UC fiscal boundary", () => {
    const clock = manualClock(new Date("2026-06-30T23:59:59-07:00"), 25);
    assert.equal(clock.todayLocal(), "2026-06-30");
    assert.equal(clock.timeOfDayCode(), "235959");
    assert.equal(clock.fiscalYear(), 2026);
    clock.advanceMonotonic(75);
    assert.equal(clock.monotonicMs(), 100);
    assert.equal(clock.now().toISOString(), "2026-07-01T06:59:59.000Z");
    clock.advanceWall(1_000);
    assert.equal(clock.todayLocal(), "2026-07-01");
    assert.equal(clock.fiscalYear(), 2027);
    assert.equal(clock.monotonicMs(), 100);
  });
});
