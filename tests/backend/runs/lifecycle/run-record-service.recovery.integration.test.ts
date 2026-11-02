import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { sourceBoundHarness } from "../../../support/fixtures/integration/source-bound-fixtures.js";
import { failedSourceReadDescriptor, sourceBoundReadStores } from "../../../support/fixtures/source-bound-read-fixtures.js";
import { canonicalJsonStringify } from "../../../../src/rules/validation/canonical-json.js";
import { validateRunContinuation } from "../../../../src/backend/storage/sqlite/run-continuation.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanups.splice(0).reverse()) await close(); });
it("recovers through exact product and lifecycle journals after equivalent runtime reactivation and replays without another run", async () => {
  const h = await sourceBoundHarness(failedSourceReadDescriptor, world => sourceBoundReadStores(world, [2, 3])); cleanups.push(h.dispose);
  const queued = h.start(h.proposal());
  assert.equal((await h.execute(queued)).state, "failed");
  const source = h.fresh(queued), original = canonicalJsonStringify(source);
  const checkpoint = h.database.authority.runCheckpoints.listByItem(h.descriptor.id, source.envelope.itemId)[0]; assert.ok(checkpoint);
  const originalCheckpoint = canonicalJsonStringify(checkpoint);
  const active = h.database.authority.runtimeConfig.get(); assert.ok(active);
  const snapshot = h.database.authority.configSnapshots.get(active.configSnapshotId); assert.ok(snapshot);
  const nextSnapshotId = randomUUID();
  h.database.withAuthorityTransaction(repositories => {
    repositories.configSnapshots.insert({ ...snapshot, configSnapshotId: nextSnapshotId });
    repositories.runtimeConfig.activate({ settingsRevision: active.settingsRevision, settingsFingerprint: active.settingsFingerprint,
      configSnapshotId: nextSnapshotId, configFingerprint: active.configFingerprint, activatedAt: h.clock.now().toISOString() });
  });
  const command = (run: typeof source) => ({ commandId: randomUUID(), requestedAt: h.clock.now().toISOString(), requestedBy: "local-operator",
    source: "dashboard", family: "run", type: "recover-run", target: { runId: run.envelope.runId, expectedVersion: run.version } });
  const firstCommand = command(source), applied = h.kernel.execute(firstCommand);
  assert.equal(applied.state, "applied"); assert.ok(applied.state === "applied");
  const firstTarget = applied.affectedTargets[0]; assert.ok(firstTarget?.family === "run");
  const first = h.database.authority.runs.get(firstTarget.runId); assert.ok(first);
  assert.equal(first.envelope.configSnapshotId, nextSnapshotId);
  assert.equal(first.envelope.configFingerprint, source.envelope.configFingerprint);
  assert.equal(first.envelope.sourceBound, undefined);
  assert.ok(first.envelope.continuation);
  assert.deepEqual(validateRunContinuation(h.database.authority, first.envelope), [source]);
  assert.equal(h.database.authority.lifecycleJournal.findRunOrigin(first.envelope.runId)?.operation, "recover");
  assert.equal((await h.execute(first)).state, "failed");
  const failed = h.fresh(first), next = h.kernel.execute(command(failed));
  assert.equal(next.state, "applied"); assert.ok(next.state === "applied");
  const target = next.affectedTargets[0]; assert.ok(target?.family === "run");
  const continued = h.database.authority.runs.get(target.runId); assert.ok(continued);
  assert.equal((await h.execute(continued)).state, "done");
  const count = h.database.authority.runs.listByItem({ workflow: h.descriptor.id, itemId: source.envelope.itemId }).length;
  const replay = h.kernel.execute(firstCommand); assert.equal(replay.state, "already-applied");
  assert.deepEqual(replay.affectedTargets, applied.affectedTargets);
  assert.equal(h.database.authority.runs.listByItem({ workflow: h.descriptor.id, itemId: source.envelope.itemId }).length, count);
  assert.equal(canonicalJsonStringify(h.fresh(source)), original);
  assert.equal(canonicalJsonStringify(h.database.authority.runCheckpoints.get(checkpoint.workflowId, checkpoint.itemId, checkpoint.nodeId,
    checkpoint.attempt, checkpoint.claimGeneration)), originalCheckpoint);
  assert.deepEqual(h.world.events, ["read:absent", "read:absent"]);
});
