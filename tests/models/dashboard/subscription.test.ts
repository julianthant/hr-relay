import { createDashboardModelFixtures } from "../../support/helpers/dashboard-model-fixtures.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import {
DashboardStreamEnvelopeSchema,
DashboardTopicPatchSchema,
DashboardTopicSnapshotSchema,
} from "../../../src/models/dashboard/subscription.js";

const { RUN_1, RUN_2, NOTE_1, RECORD_1, ARTIFACT_1, HASH_A, QUEUE, DAY, DETAIL, NOTE_PAGE, REVIEW_PAGE, PEOPLE_PAGE, ARTIFACT } = createDashboardModelFixtures();


describe("subscription snapshots, patches, and resets", () => {
  const snapshots = [
    { topic: "dashboard-day", payload: DAY },
    { topic: "run-detail", payload: DETAIL },
    { topic: "run-logs", payload: NOTE_PAGE },
    { topic: "run-review", payload: REVIEW_PAGE },
    { topic: "run-people", payload: PEOPLE_PAGE },
    { topic: "artifact", payload: ARTIFACT },
  ];
  const patches = [
    { topic: "dashboard-day", payload: { operation: "replace-queue-surface", target: { runId: RUN_1, rowRevision: 1 }, replacement: QUEUE } },
    { topic: "run-detail", payload: { operation: "replace-run-detail", target: { runId: RUN_1, rowRevision: 1 }, replacement: DETAIL } },
    { topic: "run-logs", payload: { operation: "append-note", target: { runId: RUN_1, noteId: NOTE_1 }, note: NOTE_PAGE.notes[0] } },
    { topic: "run-review", payload: { operation: "replace-review-record", target: { recordId: RECORD_1, recordRevision: 1 }, replacement: REVIEW_PAGE.records[0] } },
    { topic: "run-people", payload: { operation: "replace-person", target: { runId: RUN_2, rowRevision: 1 }, replacement: PEOPLE_PAGE.members[0] } },
    { topic: "artifact", payload: { operation: "replace-artifact-resource", target: { artifactId: ARTIFACT_1 }, replacement: ARTIFACT } },
  ];

  it("parses every correlated snapshot and patch arm", () => {
    for (const snapshot of snapshots) {
      assert.equal(DashboardTopicSnapshotSchema.safeParse(snapshot).success, true, snapshot.topic);
      assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", cursor: "pc:2", ...snapshot }).success, true, snapshot.topic);
    }
    for (const patch of patches) {
      assert.equal(DashboardTopicPatchSchema.safeParse(patch).success, true, patch.topic);
      assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "patch", cursor: "pc:2", ...patch }).success, true, patch.topic);
    }
    const hello = { type: "hello", wireVersion: 1, descriptorHash: HASH_A, projectionGeneration: 1, cursor: "pc:2" };
    assert.equal(DashboardStreamEnvelopeSchema.safeParse(hello).success, true);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse(hello).success, true, "duplicate cursor delivery remains representable and idempotent");
    for (const reason of ["cursor-expired", "generation-changed", "descriptor-changed"]) {
      assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "reset-required", reason, cursor: "pc:2" }).success, true);
    }
    for (const state of ["live", "reconnecting", "degraded"]) {
      assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "health", state }).success, true);
    }
  });

  it("rejects topic/payload mismatches, wrong arms, and identity/revision drift", () => {
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", topic: "run-detail", cursor: "pc:2", payload: DAY }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "patch", topic: "run-detail", cursor: "pc:2", payload: snapshots[1]?.payload }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "reset-required", reason: "silent-drop", cursor: "pc:2" }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", topic: "dashboard-day", payload: DAY }).success, false);
    assert.equal(DashboardTopicPatchSchema.safeParse({
      ...patches[0],
      payload: { operation: "replace-queue-surface", target: { runId: RUN_2, rowRevision: 1 }, replacement: QUEUE },
    }).success, false);
    assert.equal(DashboardTopicPatchSchema.safeParse({
      ...patches[3],
      payload: { operation: "replace-review-record", target: { recordId: RECORD_1, recordRevision: 2 }, replacement: REVIEW_PAGE.records[0] },
    }).success, false);
    assert.equal(DashboardTopicPatchSchema.safeParse({
      ...patches[2],
      payload: { operation: "append-note", target: { runId: RUN_2, noteId: NOTE_1 }, note: NOTE_PAGE.notes[0] },
    }).success, false);
    assert.equal(DashboardTopicPatchSchema.safeParse({
      ...patches[0],
      payload: { ...patches[0]?.payload, update: { runId: RUN_2 } },
    }).success, false);
  });
});
