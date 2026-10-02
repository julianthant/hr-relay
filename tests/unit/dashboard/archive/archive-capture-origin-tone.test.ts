/**
 * The capture tile's lead badge (unit F10c, ledger 3 AR184).
 *
 * The badge printed `tile.kind` in a tone keyed off `tile.origin`, so a
 * routine `screenshot` of a step that failed wore danger red while an
 * operator-requested one wore neutral — colour and word came from two
 * different facts. Nothing could fail on that: both halves were true, and only
 * their pairing was a lie. What is pinned here is the pairing, in both
 * directions, so a sixth origin cannot arrive with a silent default.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ArchivedCaptureTileSchema } from "../../../../src/domain/archive/sections.js";
import { ARCHIVED_CAPTURE_ORIGIN_TONE } from "../../../../src/dashboard/surfaces/archive-model.js";

describe("ARCHIVED_CAPTURE_ORIGIN_TONE", () => {
  it("covers the served origin vocabulary exactly, both directions", () => {
    const served = [...ArchivedCaptureTileSchema.shape.origin.options].sort((a, b) => a.localeCompare(b));
    const mapped = Object.keys(ARCHIVED_CAPTURE_ORIGIN_TONE).sort((a, b) => a.localeCompare(b));
    assert.deepEqual(mapped, served);
  });

  it("spends danger only where the SUBJECT may be wrong", () => {
    // A tone that is wrong in the reassuring direction is the one that can put
    // a duplicate transaction into a real system; a tone that is wrong in the
    // alarming direction trains the eye past the rows that matter. An ordinary
    // operator-requested capture is neither.
    assert.equal(ARCHIVED_CAPTURE_ORIGIN_TONE["subject-mismatch"], "danger");
    assert.equal(ARCHIVED_CAPTURE_ORIGIN_TONE.failure, "danger");
    assert.equal(ARCHIVED_CAPTURE_ORIGIN_TONE["operator-request"], "neutral");
    assert.equal(ARCHIVED_CAPTURE_ORIGIN_TONE["recovery-park"], "warning");
  });
});
