import { createStepOmissionTestWorld } from "../../../support/helpers/backend/step-omission-world.js";
import assert from "node:assert/strict";

import { afterEach, describe, it } from "vitest";
import { buildExplainRunView, renderExplainRun } from "../../../../src/backend/runs/explain/explain-run.js";
import { RunLifecycleSchema, RunPauseSchema, RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { timelineCheckpointReference, TimelineCheckpointReferenceSchema } from "../../../../src/models/events/timeline.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";

const {STEP, TYPED_FACT, omittedStepFixture, cleanup } = createStepOmissionTestWorld();


afterEach(cleanup);

describe("explain run checkpoint attribution", () => {
  function checkpointEvidence() {
    const run = RunRecordSchema.parse({ ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, runId: "bbbbbbbb-0000-4000-8000-000000000001", attempt: 2 },
      claimGeneration: 1 });
    const earlier = RunCheckpointRecordSchema.parse({
      workflowId: run.envelope.workflow, itemId: run.envelope.itemId, nodeId: "searching",
      runId: QUEUED_RUN.envelope.runId, attempt: 1, claimGeneration: 1,
      descriptorVersion: run.envelope.descriptorVersion, contractFingerprint: run.envelope.contractFingerprint,
      implFingerprint: "c".repeat(64), output: { schemaHash: "a".repeat(64), value: { found: true } },
      provenance: [], writtenAt: run.createdAt,
    });
    const observed = RunCheckpointRecordSchema.parse({ ...earlier, runId: run.envelope.runId, attempt: 2 });
    const unreached = RunCheckpointRecordSchema.parse({ ...earlier, nodeId: "cross-verify" });
    return { run, earlier, observed, unreached };
  }

  it("shows no record for an unreached step even when an earlier run wrote its checkpoint", () => {
    const { run, earlier, unreached, observed } = checkpointEvidence();
    const view = buildExplainRunView({ run, checkpoints: [earlier, unreached, observed], writes: [],
      nodeIds: ["searching", "cross-verify"], dependencies: [] });

    assert.deepEqual(view.timeline.map(entry => [entry.nodeId, entry.disposition]), [
      ["searching", "observed-this-attempt"], ["cross-verify", "no-record"],
    ]);
  });

  it("names the exact checkpoint a Retry replayed even when another run wrote a newer row", () => {
    const { run, earlier, unreached } = checkpointEvidence();
    const newer = RunCheckpointRecordSchema.parse({ ...earlier,
      runId: "cccccccc-0000-4000-8000-000000000001", attempt: 3 });
    const evidence = { run: { ...run, envelope: { ...run.envelope, retryOf: earlier.runId } },
      checkpoints: [earlier, unreached, newer], replayedCheckpoints: [TimelineCheckpointReferenceSchema.parse(timelineCheckpointReference(earlier))],
      writes: [], nodeIds: ["searching", "cross-verify"], dependencies: [] };
    const view = buildExplainRunView(evidence);

    assert.equal(view.timeline[0]?.disposition, "replayed-from-checkpoint");
    assert.match(view.timeline[0]?.detail ?? "", new RegExp(`run ${earlier.runId} attempt 1`, "u"));
    assert.equal(view.timeline[1]?.disposition, "no-record");
  });

  it.each([
    { runId: "cccccccc-0000-4000-8000-000000000001" },
    { attempt: 2 },
    { claimGeneration: 2 },
    { writtenAt: "2026-08-04T00:00:00.000Z" },
    { outputDigest: "d".repeat(64) },
    { itemId: "dddddddd-0000-4000-8000-000000000001" },
    { workflowId: "separations" },
    { nodeId: "cross-verify" },
  ])("requires an exact replay reference, including %j", (changed) => {
    const { run, earlier } = checkpointEvidence();
    const view = buildExplainRunView({ run, checkpoints: [earlier], writes: [], dependencies: [],
      nodeIds: ["searching"], replayedCheckpoints: [TimelineCheckpointReferenceSchema.parse({ ...timelineCheckpointReference(earlier), ...changed })] });

    assert.equal(view.timeline[0]?.disposition, "no-record");
  });

  it("keeps earlier claims and gate answers inside the same run attributed as before", () => {
    const { run, observed, unreached } = checkpointEvidence();
    const gate = RunCheckpointRecordSchema.parse({ ...observed, nodeId: "review", claimGeneration: 2 });
    const view = buildExplainRunView({ run: RunRecordSchema.parse({ ...run, claimGeneration: 2 }),
      checkpoints: [unreached, observed, gate], writes: [], nodeIds: ["searching", "review", "cross-verify"],
      dependencies: [{ nodeId: "cross-verify", state: "condition-false" }] });

    assert.deepEqual(view.timeline.map(entry => [entry.nodeId, entry.disposition]), [
      ["searching", "replayed-from-checkpoint"], ["review", "observed-this-attempt"], ["cross-verify", "not-run"],
    ]);
    assert.equal(view.timeline[2]?.detail, "closed reason: condition-false");
  });
});

describe("explain run under step omission", () => {
  async function explainView() {
    const fixture = await omittedStepFixture();
    return buildExplainRunView({
      run: fixture.run,
      checkpoints: fixture.checkpoints,
      writes: [],
      nodeIds: fixture.result.dependencies.map((dependency) => String(dependency.nodeId)),
      dependencies: fixture.result.dependencies.map((dependency) => ({
        nodeId: String(dependency.nodeId),
        state: dependency.state === "not-run" ? dependency.reason : dependency.state,
      })),
    });
  }

  it("lists the omitted step keys and renders them as their own section", async () => {
    const view = await explainView();
    assert.deepEqual(view.omittedSteps, [STEP]);
    const rendered = renderExplainRun(view);
    assert.match(rendered, /omitted steps\n\s+crm-read — omitted at start/u);
    assert.equal(rendered.includes(TYPED_FACT), false);
  });
});

describe("explain run next safe action", () => {
  it("explains a run that is both pausing and stopping by its stop, as every other reader does", async () => {
    const fixture = await omittedStepFixture();
    const at = fixture.run.lifecycle.state === "terminal" ? fixture.run.lifecycle.endedAt : fixture.run.updatedAt;
    const { completion: _completion, ...unsettled } = fixture.run;
    const running = { ...unsettled, lifecycle: RunLifecycleSchema.parse({ state: "running", workerId: "person-lookup-worker-1", claimedAt: at, heartbeatAt: at }) };
    const pause = RunPauseSchema.parse({ state: "requested", commandId: "a1000000-0000-4000-8000-000000000090", requestedAt: at });
    const nextOf = (run: typeof running) => buildExplainRunView({ run, checkpoints: fixture.checkpoints, writes: [],
      nodeIds: [], dependencies: [] }).nextSafeAction;
    assert.match(nextOf({ ...running, pause }), /A pause is requested/u);
    assert.equal(nextOf({ ...running, pause, cancelRequested: true }), nextOf({ ...running, cancelRequested: true }));
    assert.doesNotMatch(nextOf({ ...running, pause, cancelRequested: true }), /pause/u);
  });
});
