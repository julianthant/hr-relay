import assert from "node:assert/strict";
import { describe,it,vi } from "vitest";
import { applyDashboardDayPatch } from "../../../../src/dashboard/client/queries/day-state.js";
import { lookupBatchId, queueBatches, queueItemKey } from "../../../../src/dashboard/surfaces/queue/queue-model.js";
import { RunSessionRecordSchema } from "../../../../src/models/run/session.js";
import { workflowQueueCapabilities } from "../../../../src/backend/app/registries/workflow-registry.js";
import { declareProjectionWorker, instantOffsetOf,makeWorld,DAY as PROJECTION_DAY,queuedEventOf,runRecordOf,uuidOf as runUuidOf,taskEventsOf, workerMemberOf } from "../../../support/helpers/backend/dashboard-harness.js";


describe("session origin projection", () => {
  it.each([
    { name: "grouped Lookup root", workflow: "person-lookup", grouped: true, shape: "single", itemScope: "session", layout: "batch" },
    { name: "ungrouped Lookup root", workflow: "person-lookup", grouped: false, shape: "single", itemScope: "session", layout: "items" },
    { name: "other workflow", workflow: "separations", grouped: true, shape: "single", itemScope: "workflow", layout: "items" },
    { name: "Lookup child", workflow: "person-lookup", grouped: true, shape: "operation-member", itemScope: "workflow", layout: "items", parentSeed: 9 },
    { name: "native operation", workflow: "person-lookup", grouped: true, shape: "operation", itemScope: "session", layout: "items" },
    { name: "presented operation", workflow: "person-lookup", grouped: true, shape: "single", itemScope: "session", layout: "items", child: true },
  ] as const)("serves item identity and layout for $name", async (input) => {
    const w = await makeWorld({ queueCapabilities: workflowQueueCapabilities });
    try {
      const batch = RunSessionRecordSchema.parse({ sessionId: runUuidOf(70), workflow: input.workflow,
        origin: { kind: "start-plan", startPlanId: runUuidOf(71), actorId: "local-operator" },
        startedAt: instantOffsetOf(0), createdAt: instantOffsetOf(0), groupInQueue: input.grouped, version: 1 });
      w.authority.batches.set(batch.sessionId, batch);
      if ("parentSeed" in input && input.parentSeed !== undefined) queuedEventOf(w, { seed: input.parentSeed });
      queuedEventOf(w, { seed: 1, workflow: input.workflow, shape: input.shape, sessionId: batch.sessionId,
        ...("parentSeed" in input ? { parentSeed: input.parentSeed } : {}) });
      if ("child" in input) queuedEventOf(w, { seed: 2, shape: "operation-member", parentSeed: 1 });

      const row = w.projection.queueSurface(runUuidOf(1));
      assert.ok(row?.session.state === "present");
      assert.equal(row.session.itemScope, input.itemScope);
      assert.equal(row.session.presentation?.layout, input.layout);
      assert.equal(row.session.presentation?.groupInQueue, input.grouped);
      assert.equal(lookupBatchId(row), input.layout === "batch" ? batch.sessionId : undefined);
      assert.equal(queueItemKey(row), JSON.stringify([input.workflow, row.itemId, input.itemScope === "session" ? batch.sessionId : null]));
    } finally { await w.dispose(); }
  });

  it.each([
    { kind: "start-plan", startPlanId: runUuidOf(71), actorId: "local-operator" },
    { kind: "intake-manifest", intakeManifestId: runUuidOf(72), actorId: "local-operator" },
  ] as const)("round trips the $kind origin", async (origin) => {
    const w = await makeWorld({ queueCapabilities: workflowQueueCapabilities });
    try {
      const batch = RunSessionRecordSchema.parse({ sessionId: runUuidOf(70), workflow: "person-lookup", origin,
        startedAt: instantOffsetOf(0), createdAt: instantOffsetOf(0), groupInQueue: true, version: 1 });
      w.authority.batches.set(batch.sessionId, batch);
      queuedEventOf(w, { seed: 1, sessionId: batch.sessionId });

      const row = w.projection.buildDashboardDayWire(PROJECTION_DAY).queueSurfaces[0];
      assert.deepEqual(row?.session, {
        state: "present",
        sessionId: batch.sessionId,
        itemScope: "session",
        origin,
        presentation: { layout: "batch", groupInQueue: true, version: 1, startedAt: instantOffsetOf(0) },
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

describe("idle authority reconcile", () => {
  it("skips the live-run read while the store key is unchanged and still notices memory and later run changes", async () => {
    const w = await makeWorld();
    try {
      const list = w.runReader.list.bind(w.runReader);
      let lists = 0;
      w.runReader.list = (query) => { lists += 1; return list(query); };
      const workerId = "person-lookup-worker-1";
      declareProjectionWorker(w.authority, workerId, 1);
      w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId, version: 1 }));
      const claimedAt = instantOffsetOf(0);
      w.authority.put(runRecordOf({ seed: 1, claimGeneration: 1, lifecycle: { state: "running", workerId, claimedAt, heartbeatAt: claimedAt, currentNodeId: "lookup" } }));
      let flying = false;
      const key = { authorityGeneration: 1, dataVersion: 1, totalChanges: 1 };
      Object.assign(w.authority, { changeKey: () => key, writeInFlight: () => flying });
      w.projection.reconcileWorkerAuthority();
      lists = 0;
      w.changes.length = 0;
      w.projection.reconcileWorkerAuthority();
      assert.equal(lists, 0, "an unchanged key does not read live runs");
      assert.equal(w.changes.length, 0);
      w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId, version: 2 }));
      w.projection.reconcileWorkerAuthority();
      assert.equal(lists, 1, "a member change notifies from the snapshot, not a second live-run read");
      assert.ok(w.changes.length > 0);
      lists = 0;
      w.changes.length = 0;
      flying = true;
      w.projection.reconcileWorkerAuthority();
      assert.equal(lists, 1, "a write fence change notifies without a second live-run read");
      assert.ok(w.changes.length > 0);
      lists = 0;
      w.changes.length = 0;
      key.totalChanges += 1;
      w.authority.put(runRecordOf({ seed: 2 }));
      w.projection.reconcileWorkerAuthority();
      assert.equal(lists, 2, "a changed key reads the live runs, and the notice reads them once more");
      assert.ok(w.changes.length > 0);
    } finally { await w.dispose(); }
  });

  it("does not serialize the runs again while the store key is unchanged", async () => {
    const w = await makeWorld();
    try {
      const workerId = "person-lookup-worker-1";
      declareProjectionWorker(w.authority, workerId, 1);
      w.authority.putWorkerMember(workerMemberOf(w.authority, { workerId, version: 1 }));
      const claimedAt = instantOffsetOf(0);
      w.authority.put(runRecordOf({ seed: 1, claimGeneration: 1, lifecycle: { state: "running", workerId, claimedAt, heartbeatAt: claimedAt, currentNodeId: "lookup" } }));
      let flying = false;
      Object.assign(w.authority, { changeKey: () => ({ authorityGeneration: 1, dataVersion: 1, totalChanges: 1 }), writeInFlight: () => flying });
      w.projection.reconcileWorkerAuthority();
      const stringify = vi.spyOn(JSON, "stringify");
      try {
        w.changes.length = 0;
        w.projection.reconcileWorkerAuthority();
        assert.equal(stringify.mock.results.filter(r => typeof r.value === "string" && r.value.includes('"displayName"')).length, 0, "idle tick reuses the serialized runs");
        assert.equal(w.changes.length, 0);
        flying = true;
        w.projection.reconcileWorkerAuthority();
        assert.ok(w.changes.length > 0, "a write fence change on a claimed run still notifies");
      } finally { stringify.mockRestore(); }
    } finally { await w.dispose(); }
  });
});
