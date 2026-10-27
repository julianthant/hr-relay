import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { applyDashboardDayPatch } from "../../../../src/dashboard/client/queries/day-state.js";
import { queueBatches } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { RunSessionRecordSchema } from "../../../../src/models/run/session.js";
import { instantOffsetOf,makeWorld,DAY as PROJECTION_DAY,queuedEventOf,runRecordOf,uuidOf as runUuidOf,taskEventsOf } from "../../../support/helpers/backend/dashboard-harness.js";


describe("session origin projection", () => {
  it.each([
    { kind: "start-plan", startPlanId: runUuidOf(71), actorId: "local-operator" },
    { kind: "intake-manifest", intakeManifestId: runUuidOf(72), actorId: "local-operator" },
  ] as const)("round trips the $kind origin", async (origin) => {
    const w = await makeWorld();
    try {
      const batch = RunSessionRecordSchema.parse({ sessionId: runUuidOf(70), workflow: "person-lookup", origin,
        startedAt: instantOffsetOf(0), createdAt: instantOffsetOf(0), groupInQueue: true, version: 1 });
      w.authority.batches.set(batch.sessionId, batch);
      queuedEventOf(w, { seed: 1, sessionId: batch.sessionId });

      const row = w.projection.buildDashboardDayWire(PROJECTION_DAY).queueSurfaces[0];
      assert.deepEqual(row?.session, {
        state: "present",
        sessionId: batch.sessionId,
        origin,
        presentation: { groupInQueue: true, version: 1, startedAt: instantOffsetOf(0) },
      });
    } finally { await w.dispose(); }
  });

  it.each(["missing", "mismatched workflow"] as const)("fails loudly for a %s session", async (problem) => {
    const w = await makeWorld();
    try {
      const batch = RunSessionRecordSchema.parse({ sessionId: runUuidOf(70), workflow: "person-lookup",
        origin: { kind: "start-plan", startPlanId: runUuidOf(71), actorId: "local-operator" },
        startedAt: instantOffsetOf(0), createdAt: instantOffsetOf(0), groupInQueue: true, version: 1 });
      w.authority.batches.set(batch.sessionId, problem === "mismatched workflow"
        ? RunSessionRecordSchema.parse({ ...batch, workflow: "separations" })
        : batch);
      queuedEventOf(w, { seed: 1, sessionId: batch.sessionId });
      if (problem === "missing") w.authority.batches.delete(batch.sessionId);

      assert.throws(
        () => w.projection.buildDashboardDayWire(PROJECTION_DAY),
        /workflow batch .* is missing or belongs to another workflow/,
      );
    } finally { await w.dispose(); }
  });
});


describe("batch presentation publication", () => {
  it.each(["command", "span"] as const)("keeps every rendered batch consistent when a %s update beats the poll", async (trigger) => {
    const w = await makeWorld();
    try {
      const batch = RunSessionRecordSchema.parse({ sessionId: runUuidOf(70), workflow: "person-lookup",
        origin: { kind: "start-plan", startPlanId: runUuidOf(71), actorId: "local-operator" },
        startedAt: instantOffsetOf(0), createdAt: instantOffsetOf(0), groupInQueue: true, version: 1 });
      w.authority.batches.set(batch.sessionId, batch);
      queuedEventOf(w, { seed: 1, sessionId: batch.sessionId });
      queuedEventOf(w, { seed: 2, sessionId: batch.sessionId });
      w.projection.reconcileWorkerAuthority();
      let wire = w.projection.buildDashboardDayWire(PROJECTION_DAY);
      w.changes.length = 0;
      w.authority.batches.set(batch.sessionId, RunSessionRecordSchema.parse({ ...batch, groupInQueue: false, version: 2 }));
      if (trigger === "command") {
        w.authority.put(runRecordOf({ seed: 1, sessionId: batch.sessionId, displayName: "Renamed run", version: 2 }));
        w.projection.refreshRun(runUuidOf(1));
      } else taskEventsOf(w, 1, "searching");
      assert.ok(w.changes.length > 0);
      for (const change of w.changes) {
        if (change.kind === "patch") wire = applyDashboardDayPatch(wire, change.patch);
        else if (change.kind === "snapshot") wire = w.projection.buildDashboardDayWire(PROJECTION_DAY);
        // Every intermediate client state must render, not merely the final snapshot.
        assert.doesNotThrow(() => queueBatches(wire.queueSurfaces));
      }
      assert.deepEqual(w.changes.map((change) => change.kind), ["snapshot"]);
      assert.deepEqual(queueBatches(wire.queueSurfaces).map(({ groupInQueue, version }) => ({ groupInQueue, version })), [{ groupInQueue: false, version: 2 }]);
      assert.deepEqual(wire, w.projection.buildDashboardDayWire(PROJECTION_DAY));
      w.changes.length = 0;
      w.projection.reconcileWorkerAuthority();
      assert.equal(w.changes.length, 0, "the poll must not duplicate an already published batch change");
      const listBatches = w.authority.listRunBatches.bind(w.authority);
      let batchScans = 0;
      w.authority.listRunBatches = () => { batchScans++; return listBatches(); };
      w.projection.refreshRun(runUuidOf(2));
      assert.equal(batchScans, 0, "ordinary row patches must not scan all retained batches");
      assert.deepEqual(w.changes.map((change) => change.kind), ["patch"], "unchanged batch presentation retains granular row updates");
    } finally { await w.dispose(); }
  });
});
