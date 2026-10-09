
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ArchivedCaptureTileSchema } from "../../../../../src/models/archive/sections.js";
import { ARCHIVED_CAPTURE_ORIGIN_TONE } from "../../../../../src/dashboard/surfaces/archive/archive-model.js";

describe("ARCHIVED_CAPTURE_ORIGIN_TONE", () => {
  it("covers the served origin vocabulary exactly, both directions", () => {
    const served = [...ArchivedCaptureTileSchema.shape.origin.options].sort((a, b) => a.localeCompare(b));
    const mapped = Object.keys(ARCHIVED_CAPTURE_ORIGIN_TONE).sort((a, b) => a.localeCompare(b));
    assert.deepEqual(mapped, served);
  });

  it("spends danger only where the SUBJECT may be wrong", () => {

    assert.equal(ARCHIVED_CAPTURE_ORIGIN_TONE["subject-mismatch"], "danger");
    assert.equal(ARCHIVED_CAPTURE_ORIGIN_TONE.failure, "danger");
    assert.equal(ARCHIVED_CAPTURE_ORIGIN_TONE["operator-request"], "neutral");
    assert.equal(ARCHIVED_CAPTURE_ORIGIN_TONE["recovery-park"], "warning");
  });
});
