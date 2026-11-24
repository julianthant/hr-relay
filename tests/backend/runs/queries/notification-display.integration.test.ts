import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { notificationDisplayContext } from "../../../../src/backend/runs/queries/notification-display.js";
import { notificationWireOf } from "../../../../src/models/dashboard/projection.js";
import { NotificationRecordSchema } from "../../../../src/models/notifications/notifications.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { projectNotificationTrigger } from "../../../../src/rules/notifications/notification-triggers.js";
import { onboardingModule } from "../../../support/helpers/registered-workflows.js";
import { makeWorld, notificationRecordOf, queuedEventOf, runRecordOf, uuidOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

const worlds: DashboardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.dispose(); });
const descriptor = onboardingModule.descriptor;

it.each([
  { name: "top-level", shape: "single", parentSeed: undefined },
  { name: "member", shape: "operation-member", parentSeed: 100 },
  { name: "child", shape: "single", parentSeed: 2 },
] as const)("serves workflow and catalog reason for a failed $name run with a retired checkpoint node", async ({ shape, parentSeed }) => {
  const world = await makeWorld({ descriptors: { resolve: () => descriptor } });
  worlds.push(world);
  if (parentSeed !== undefined) queuedEventOf(world, { seed: 100, workflow: descriptor.id, descriptor, shape: "operation", title: "Synthetic group" });
  if (parentSeed === 2) queuedEventOf(world, { seed: 2, workflow: descriptor.id, descriptor, shape: "operation-member", parentSeed: 100, title: "Synthetic member" });
  queuedEventOf(world, { seed: 1, workflow: descriptor.id, descriptor, shape, parentSeed, title: "Synthetic run" });
  const base = runRecordOf({ seed: 1, workflow: descriptor.id, descriptor, shape, parentSeed, lifecycle: {
    state: "terminal", outcome: "failed", failureId: uuidOf(9001), endedAt: world.clock.now().toISOString(),
  } });
  const current = RunRecordSchema.parse({
    ...base, envelope: { ...base.envelope, descriptorVersion: descriptor.version - 1 },
  });
  world.authority.put(current);
  world.authority.putCheckpoint(RunCheckpointRecordSchema.parse({
    workflowId: descriptor.id, itemId: current.envelope.itemId, nodeId: "retired-step", attempt: current.envelope.attempt,
    runId: current.envelope.runId, claimGeneration: current.claimGeneration,
    descriptorVersion: current.envelope.descriptorVersion, contractFingerprint: current.envelope.contractFingerprint,
    implFingerprint: current.envelope.contractFingerprint, output: { schemaHash: current.input.parsed.schemaHash, value: {} },
    provenance: [], writtenAt: current.updatedAt,
  }));
  const record = NotificationRecordSchema.parse({
    ...notificationRecordOf({ seed: 1, title: "Run failed", lastSeenAt: current.updatedAt }),
    ...projectNotificationTrigger({ kind: "run-failed", runId: current.envelope.runId, workflowId: descriptor.id,
      failureId: uuidOf(9001), failureFingerprint: "a".repeat(64), code: "UCPATH_UNAVAILABLE" }),
  });
  const deps: Parameters<typeof notificationDisplayContext>[1] = {
    read: id => world.runReader.read(id), descriptor: () => descriptor, receipt: () => undefined,
    checkpoints: { listByAttempt: (workflow, item, node, attempt) => world.authority.listNotificationCheckpoints(workflow, item, node, attempt) },
    presentation: world, command: () => undefined,
  };
  assert.equal(world.runReader.read(current.envelope.runId).state, "present");
  assert.deepEqual(notificationDisplayContext(record, { ...deps, descriptor: () => ({ ...descriptor, version: current.envelope.descriptorVersion }) }),
    { state: "available", workflow: "Onboarding", subject: "Synthetic run" });
  const context = notificationDisplayContext(record, deps);
  assert.deepEqual(context, { state: "workflow-only", workflow: "Onboarding" });
  const wire = notificationWireOf(record, world.clock.nowMs(), context);
  assert(wire.kind === "notification");
  assert.equal(wire.title, "Run failed");
  assert.deepEqual(wire.context, { state: "workflow-only", workflow: "Onboarding" });
  // The notice carries the first sentence; the whole failure text stays on the record and the run.
  assert.equal(record.summary, "UCPath could not be reached. Check the connection.");
  assert.equal(wire.summary, "UCPath could not be reached.");
  world.authority.records.delete(current.envelope.runId);
  assert.deepEqual(notificationDisplayContext(record, deps), { state: "unavailable" });
});
