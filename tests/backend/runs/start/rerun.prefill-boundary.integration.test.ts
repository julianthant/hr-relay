import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { absentProbeEvidence, WRITE_FIXTURE_EID } from "../../../support/fixtures/write-sequencer-fixtures.js";
import { buildRerunPlan } from "../../../../src/backend/runs/start/rerun.js";
import { RerunSourceSchema } from "../../../../src/models/run/rerun.js";
import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";

import assert from "node:assert/strict";
import { describe, it } from "vitest";

describe("Rerun source and provenance boundary", () => {
  it("checks source revision, descriptor closure, node and field provenance before storing a plan", async () => {
    const h = await sourceBoundHarness();
    try {
      const initial = h.start(h.proposal());
      h.world.probeResults.push(absentProbeEvidence(h.clock.now().toISOString()));
      assert.equal((await h.execute(initial)).state, "done");
      const source = h.fresh(initial);
      const selectedStepKeys = h.descriptor.timeline.map((step) => step.key);
      const request = { workflowId: h.descriptor.id, submissions: [{ eid: WRITE_FIXTURE_EID }], dryRun: false, selectedStepKeys,
        rerunSource: { runId: source.envelope.runId, expectedVersion: source.version, intent: "rerun", selectedStepKeys } };
      assert.ok(h.planner.plan(request).rerun, "valid source is the positive control");
      const effects = () => ({ generation: h.database.getMeta().authorityGeneration, ids: h.lifecycleIds.minted(), roots: h.queueRoots });
      const before = structuredClone(effects());
      assert.throws(() => h.planner.plan({ ...request, rerunSource: { ...request.rerunSource, expectedVersion: source.version + 1 } }), /revision changed/);
      assert.throws(() => h.planner.plan({ ...request, rerunSource: { ...request.rerunSource,
        copiedFrom: [{ nodeId: "not-in-descriptor", fieldPath: "eid", targetFieldPath: "eid" }] } }), /descriptor output/);
      assert.throws(() => h.planner.plan({ ...request, rerunSource: { ...request.rerunSource,
        copiedFrom: [{ nodeId: "submit-write", fieldPath: "missing", targetFieldPath: "eid" }] } }), /coordinates do not resolve/);
      assert.throws(() => h.planner.plan({ ...request, rerunSource: { ...request.rerunSource,
        copiedFrom: [{ nodeId: "submit-write", fieldPath: "output.value.transactionId", targetFieldPath: "eid" }] } }), /does not match/);
      assert.deepEqual(effects(), before, "every negative control leaves authority and publication unchanged");
      const changedDescriptor = { ...h.descriptor, contractFingerprint: FingerprintSchema.parse("f".repeat(64)) };
      assert.throws(() => buildRerunPlan(h.database.authority, changedDescriptor, RerunSourceSchema.parse(request.rerunSource), []),
        /workflow runtime nodes require the exact object returned by defineWorkflowDescriptor/u);
      assert.deepEqual(h.fresh(source), source);
    } finally { await h.dispose(); }
  });
});
