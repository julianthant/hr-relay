import assert from "node:assert/strict";
import { afterAll, afterEach, it } from "vitest";
import { createProfileFixtureSet } from "../../../support/helpers/admission-fixture.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { claimEventOf, instantOffsetOf, taskEventsOf, uuidOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { RunPauseSchema, type RunRecord } from "../../../../src/models/run/record.js";
import { PositiveIntSchema } from "../../../../src/rules/identity/ids.js";

const profiles = createProfileFixtureSet();
afterAll(() => profiles.close());
const { world, cleanup, queuedEventOf, runRecordOf } = createRunQueueProjectionTestWorld(profiles.create);
afterEach(cleanup);

it.each(["failed", "interrupted"] as const)("serves only the Rerun dialog for a %s dry run", async outcome => {
  const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
  queuedEventOf(w, { seed: 1, dryRun: true, descriptor: personLookupDescriptor });
  claimEventOf(w, 1);
  taskEventsOf(w, 1, "searching", "done");
  w.authority.put(runRecordOf({ seed: 1, dryRun: true, descriptor: personLookupDescriptor,
    lifecycle: outcome === "failed"
      ? { state: "terminal", outcome, endedAt: instantOffsetOf(0, 1000), failureId: uuidOf(9001) }
      : { state: "terminal", outcome, endedAt: instantOffsetOf(0, 1000) }, version: 3 }));
  w.projection.rebuildFromTimeline();
  const row = w.projection.queueSurface(uuidOf(1));
  assert.ok(row?.dryRun);
  const actions = row.actions.filter(action => action.key === "recover-run" || action.key === "rerun");
  assert.deepEqual(actions, [{ key: "rerun", label: "Rerun", icon: "retry", kind: "navigation",
    navigate: { kind: "rerun", expectedVersion: 3 }, intent: "primary", placement: ["footer", "menu", "data"] }]);
});

it("withholds cancellation and retry while an UNKNOWN write is parked", async () => {
  const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
  queuedEventOf(w, { seed: 1, descriptor: personLookupDescriptor,
    lifecycle: { state: "parked-write", writeIntentId: uuidOf(91), intentGeneration: 1,
      parkedAt: instantOffsetOf(0), code: "unknown", message: "Check whether the change was saved." } });
  const row = w.projection.queueSurface(uuidOf(1));
  assert.ok(row);
  assert.equal(row.status, "blocked");
  assert.deepEqual(row.actions.map(action => action.key), ["rename"]);
  assert.equal(row.pauseControl?.command, undefined);
});

it("serves Resume in a paused run's footer with its current revision", async () => {
  const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
  queuedEventOf(w, { seed: 1, descriptor: personLookupDescriptor });
  const run = w.authority.getRun(uuidOf(1));
  assert.ok(run);
  w.authority.put({ ...run, version: PositiveIntSchema.parse(7), pause: RunPauseSchema.parse({ state: "paused", commandId: uuidOf(90),
    requestedAt: instantOffsetOf(0), pausedAt: instantOffsetOf(0) }) });
  w.projection.rebuildFromTimeline();
  const row = w.projection.queueSurface(uuidOf(1));
  assert.ok(row);
  assert.deepEqual(row.pauseControl, { state: "paused", command: "resume", expectedVersion: 7 });
  assert.deepEqual(row.actions.find(action => action.key === "resume"), {
    key: "resume", kind: "command", command: "resume", expectedVersion: 7,
    label: "Resume", intent: "neutral", icon: "resume", placement: ["footer"],
  });
});

it("serves individual Retry only for the four admitted failures in a 58-member group", async () => {
  const w = await world({ descriptors: { resolve: () => personLookupDescriptor } });
  const admitted = new Set([2, 3, 4, 5].map(uuidOf));
  Object.assign(w.authority, { aggregateMemberRetryAvailable: (run: RunRecord) => admitted.has(run.envelope.runId) });
  queuedEventOf(w, { seed: 1, shape: "operation", descriptor: personLookupDescriptor });
  for (let seed = 2; seed <= 59; seed++) {
    queuedEventOf(w, { seed, shape: "operation-member", parentSeed: 1, descriptor: personLookupDescriptor,
      ...(seed <= 45 ? { lifecycle: { state: "terminal", outcome: seed <= 5 ? "failed" : "done",
        endedAt: instantOffsetOf(0, 1000), ...(seed <= 5 ? { failureId: uuidOf(9000 + seed) } : {}) }, version: 3 } : {}) });
  }
  const parent = w.projection.queueSurface(uuidOf(1));
  assert.ok(parent?.surfaceKind === "operation");
  assert.deepEqual(parent.memberRollup, { total: 58, terminal: 44, failed: 4 });
  assert.equal(parent.memberRollup.terminal - parent.memberRollup.failed, 40);
  const retries = parent.memberRunIds.flatMap(runId => {
    const row = w.projection.queueSurface(runId);
    assert.ok(row);
    return row.actions.filter(action => action.kind === "command" && action.command === "retry")
      .map(action => ({ runId, action }));
  });
  assert.deepEqual(retries.map(({ runId }) => runId).sort(), [...admitted].sort());
  for (const { action } of retries) {
    assert.equal(action.kind, "command");
    assert.ok(action.kind === "command" && action.expectedVersion === 3);
    assert.ok(action.placement.includes("footer"));
  }
  admitted.clear();
  assert.ok(!w.projection.queueSurface(uuidOf(2))?.actions.some(action => action.key === "retry-member"));
});
