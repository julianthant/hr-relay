import { createDashboardModelFixtures } from "../../support/helpers/dashboard-model-fixtures.js";
import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { DashboardStreamEnvelopeSchema } from "../../../src/models/dashboard/subscription.js";

const { RUN_1, RUN_2, HASH_A, QUEUE, DAY } = createDashboardModelFixtures();


describe("subscription snapshots, patches, and resets", () => {
  const snapshot = { topic: "dashboard-day", payload: DAY };
  const patch = { topic: "dashboard-day", payload: { operation: "replace-queue-surface", target: { runId: RUN_1, rowRevision: 1 }, replacement: QUEUE } };

  it("parses the dashboard-day snapshot and patch arms", () => {
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", cursor: "pc:2", ...snapshot }).success, true);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "patch", cursor: "pc:2", ...patch }).success, true);
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
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "patch", topic: "dashboard-day", cursor: "pc:2", payload: DAY }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "reset-required", reason: "silent-drop", cursor: "pc:2" }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "snapshot", topic: "dashboard-day", payload: DAY }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "patch", cursor: "pc:2", ...patch,
      payload: { operation: "replace-queue-surface", target: { runId: RUN_2, rowRevision: 1 }, replacement: QUEUE } }).success, false);
    assert.equal(DashboardStreamEnvelopeSchema.safeParse({ type: "patch", cursor: "pc:2", ...patch,
      payload: { ...patch.payload, update: { runId: RUN_2 } } }).success, false);
  });
});
