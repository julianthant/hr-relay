import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { planRuntimeVersionTransition } from "../../../../../src/models/archive/runtime-version.js";
import { RuntimeVersionReviewSchema, reviewRuntimeVersionTransition } from "../../../../../src/models/archive/runtime-version-review.js";
import { RunRecordSchema } from "../../../../../src/models/run/record.js";
import { QUEUED_RUN, WORKFLOW_ID } from "../../../../support/fixtures/phase1f-run-fixtures.js";
import { NOW } from "../../../../support/fixtures/phase1c-contract-fixtures.js";

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
    assert.ok(Object.isFrozen(review));
    assert.ok(Object.isFrozen(review.members));
    assert.ok(Object.isFrozen(review.candidates));
    assert.ok(Object.isFrozen(review.blockers));
    assert.equal(RuntimeVersionReviewSchema.safeParse({ ...review, unexpected: true }).success, false);
    assert.equal(RuntimeVersionReviewSchema.safeParse({ ...review, membershipDigest: "not-a-digest" }).success, false);
    assert.equal(RuntimeVersionReviewSchema.safeParse({ ...review, members: [{ ...review.members[0], unexpected: true }] }).success, false);
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

  it("keeps candidates, blockers, and the membership digest on one strict schema boundary", () => {
    const terminal = RunRecordSchema.parse({ ...QUEUED_RUN,
      envelope: { ...QUEUED_RUN.envelope, runId: "10000000-0000-4000-8000-000000000013" },
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, runtimeVersion: stamp,
    });
    const review = reviewRuntimeVersionTransition({
      transition: planRuntimeVersionTransition(state, { kind: "workflows", workflowIds: [WORKFLOW_ID] }),
      runs: [terminal], adoption: () => undefined,
    });
    assert.equal(RuntimeVersionReviewSchema.safeParse(review).success, true);
    assert.equal(RuntimeVersionReviewSchema.safeParse({ ...review, blockers: review.candidates }).success, false);
    assert.equal(RuntimeVersionReviewSchema.safeParse({ ...review, membershipDigest: "0".repeat(64) }).success, false);
  });
});
