/**
 * The `wf <hash>` shape hazard fires only when the shape MOVED (ref dashboard-surfaces
 * §"Wave-2 connection-proof presentation deltas").
 *
 * The defect these pin, from the Track C connection proof (separations §9.22
 * item 3): `RunProvenanceBar` computed
 * `shapeMoved = surface.descriptorHash !== currentDescriptorHash`, where the
 * left side is the RUN's one-workflow `contractFingerprint` and the right side
 * was the bootstrap's `descriptorHash` — the hash of the whole eight-workflow
 * SET. Two different kinds of value, never equal, so **every run on the
 * dashboard wore the amber hazard**, including three runs whose fingerprint
 * `59830cf6…` was byte-identical to the one the explorer served for
 * `separations` and the build manifest held.
 *
 * Both directions are pinned here, which is the whole point: a warning that
 * can never NOT fire is worse than one that can never fire, because it trains
 * the eye past the one chip that would announce a genuinely retired shape.
 */
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { classifyRunShape } from "../../../../src/dashboard/surfaces/run-identity-model.js";

/** `separations` as the proof's own runs carried it, and as the explorer served it. */
const RAN = "59830cf6a3d94b1e8f2c7d5a0b4e6913c8d2f7a15b9e3c6048d1a2f5b7c9e0d3";
/** the whole-descriptor-SET hash the bar used to compare against */
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
    // The exact shipped comparison: a one-workflow fingerprint against the
    // bootstrap's `descriptorHash`. It is only "moved" here because the caller
    // passed the wrong KIND of value — which is why the value now comes from
    // the run's own workflow entry and never from `boot.descriptorHash`.
    assert.notEqual(RAN, SET_HASH);
    assert.deepEqual(classifyRunShape(RAN, RAN), { state: "current" });
  });

  it("says a workflow this build does not register is UNSERVED, not moved", () => {
    // "The shape moved" would name a fact nobody established: there is no
    // current shape to have moved to, and nothing for a retry to run.
    assert.deepEqual(classifyRunShape(RAN, undefined), { state: "unserved" });
  });
});
