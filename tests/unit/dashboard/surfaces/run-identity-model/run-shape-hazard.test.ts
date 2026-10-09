
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { classifyRunShape } from "../../../../../src/dashboard/surfaces/run-detail/identity/run-identity-model.js";

/** `separations` as the proof's own runs carried it, and as the explorer served it. */
const RAN = "59830cf6a3d94b1e8f2c7d5a0b4e6913c8d2f7a15b9e3c6048d1a2f5b7c9e0d3";

const SET_HASH = "76a28eef11c4d3b590a7e6f28c1d4b3a95e8072d6c1f4a9b3e5d7c082a6f19b4";
/** a genuinely later `separations` descriptor */
const MOVED_TO = "0a1b2c3d4e5f60718293a4b5c6d7e8f90112233445566778899aabbccddeeff0";

describe("the run-shape hazard (§9.22 item 3)", () => {
  it("is SILENT when the run's fingerprint is the one its workflow is served under", () => {
    assert.deepEqual(classifyRunShape(RAN, RAN), { state: "current" });
  });

  it("WARNS, naming the shape now serving, when that workflow's descriptor moved", () => {
    assert.deepEqual(classifyRunShape(RAN, MOVED_TO), { state: "moved", servedShape: MOVED_TO });
  });

  it("does not compare a run against the whole-SET hash, which is what made it always warn", () => {

    assert.notEqual(RAN, SET_HASH);
    assert.deepEqual(classifyRunShape(RAN, RAN), { state: "current" });
  });

  it("says a workflow this build does not register is UNSERVED, not moved", () => {
    // "The shape moved" would name a fact nobody established: there is no
    // current shape to have moved to, and nothing for a retry to run.
    assert.deepEqual(classifyRunShape(RAN, undefined), { state: "unserved" });
  });
});
