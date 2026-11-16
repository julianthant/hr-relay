import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { containsDryRunSample, DryRunSampleSchema, DRY_RUN_I9_PROFILE_ID, DRY_RUN_TRANSACTION_NUMBER } from "../../../src/models/workflow/dry-run.js";
import { I9RecordIdsSchema } from "../../../src/models/systems/i9/read-section2-signer.js";

describe("reserved dry-run values", () => {
  it("admits the numeric profile sample with explicit producer and field provenance", () => {
    assert.equal(I9RecordIdsSchema.shape.profileId.parse(DRY_RUN_I9_PROFILE_ID), DRY_RUN_I9_PROFILE_ID);
    for (const value of [DRY_RUN_I9_PROFILE_ID, DRY_RUN_TRANSACTION_NUMBER]) {
      assert.deepEqual(DryRunSampleSchema.parse({ label: "dry-run sample", sourceNodeId: "profile", field: "profileId", value }),
        { label: "dry-run sample", sourceNodeId: "profile", field: "profileId", value });
    }
    assert.equal(DryRunSampleSchema.safeParse({ label: "dry-run sample", sourceNodeId: "profile", field: "profileId", value: "900001" }).success, false);
  });

  it("finds reserved values in nested inputs and text without refusing longer ordinary identifiers", () => {
    for (const value of [DRY_RUN_I9_PROFILE_ID, `profile:${DRY_RUN_I9_PROFILE_ID}`, DRY_RUN_TRANSACTION_NUMBER]) {
      assert.equal(containsDryRunSample({ nested: [{ value }] }), true);
    }
    for (const value of ["10000000", "99999999", "199999990", "900001", null, 0, false]) {
      assert.equal(containsDryRunSample({ value }), false);
    }
  });
});
