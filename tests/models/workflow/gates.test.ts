import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import { GateResultRecordSchema,gateResultRecordSchema } from "../../../src/models/workflow/gates.js";
import { FingerprintSchema } from "../../../src/rules/identity/ids.js";
import {
GATE_RESULT,
HASH_A
} from "../../support/fixtures/phase1c-contract-fixtures.js";

describe("durable control and outbox records", () => {

  it("binds generic gate values to their declared schema hash", () => {
    assert.equal(GateResultRecordSchema.safeParse(GATE_RESULT).success, true);
    const exact = gateResultRecordSchema(
      z.strictObject({ decision: z.enum(["approve", "reject"]) }),
      FingerprintSchema.parse(HASH_A),
    );
    const value = { ...GATE_RESULT, result: { schemaHash: HASH_A, value: { decision: "approve" } } };
    assert.equal(exact.safeParse(value).success, true);
    assert.equal(exact.safeParse({ ...value, result: { ...value.result, schemaHash: "b".repeat(64) } }).success, false);
    assert.equal(exact.safeParse({ ...value, result: { schemaHash: HASH_A, value: { decision: "approve", note: "untyped" } } }).success, false);
    assert.equal(GateResultRecordSchema.safeParse({ ...GATE_RESULT, result: "approved" }).success, false);
  });
});
