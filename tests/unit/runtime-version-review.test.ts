import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { planRuntimeVersionTransition } from "../../src/domain/archive/runtime-version.js";
import { reviewRuntimeVersionTransition } from "../../src/domain/archive/runtime-version-review.js";
import { RunRecordSchema } from "../../src/domain/run/record.js";
import { QUEUED_RUN, WORKFLOW_ID } from "../fixtures/phase1f-run-fixtures.js";
import { NOW } from "../fixtures/phase1c-contract-fixtures.js";

const state = {
  dashboard: { major: 1, minor: 0 },
  workflows: [
    { workflowId: WORKFLOW_ID, version: { major: 1, minor: 0 } },
    { workflowId: "other-workflow", version: { major: 1, minor: 0 } },
  ],
};
const stamp = { dashboard: { major: 1, minor: 0 }, workflow: { major: 1, minor: 0 } };

describe("runtime version review", () => {
  it("separates terminal candidates from blockers for selected workflows", () => {
    const queued = RunRecordSchema.parse({ ...QUEUED_RUN, runtimeVersion: stamp });
    const terminal = RunRecordSchema.parse({ ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, runId: "10000000-0000-4000-8000-000000000012" },
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, runtimeVersion: stamp,
    });
    const review = reviewRuntimeVersionTransition({
      transition: planRuntimeVersionTransition(state, { kind: "workflows", workflowIds: [WORKFLOW_ID] }),
      runs: [queued, terminal], adoption: () => undefined,
    });
    assert.deepEqual(review.candidates.map(row => row.runId), [terminal.envelope.runId]);
    assert.deepEqual(review.blockers.map(row => row.runId), [queued.envelope.runId]);
    assert.equal(review.membershipDigest.length, 64);
  });

  it("uses explicit baseline adoption and rejects missing or conflicting attribution", () => {
    const historical = RunRecordSchema.parse(QUEUED_RUN);
    const transition = planRuntimeVersionTransition(state, { kind: "workflows", workflowIds: [WORKFLOW_ID] });
    assert.throws(() => reviewRuntimeVersionTransition({ transition, runs: [historical], adoption: () => undefined }));
    const adopted = { workflowId: WORKFLOW_ID, ...stamp };
    const review = reviewRuntimeVersionTransition({ transition, runs: [historical], adoption: () => adopted });
    assert.equal(review.members[0]?.attribution, "adopted");
    assert.throws(() => reviewRuntimeVersionTransition({ transition,
      runs: [RunRecordSchema.parse({ ...QUEUED_RUN, runtimeVersion: stamp })], adoption: () => adopted,
    }), /attribution-conflict/u);
  });
});
