import assert from "node:assert/strict";
import { it } from "vitest";
import { notificationDisplayContext } from "../../../../../src/backend/runs/queries/notification-display.js";
import { RunCheckpointRecordSchema } from "../../../../../src/models/workflow/checkpoint.js";
import { HASH_A, HASH_B } from "../../../../support/fixtures/phase1c-contract-fixtures.js";
import { notificationRecordOf, runRecordOf } from "../../../../support/helpers/backend/dashboard-harness.js";

const run = runRecordOf({ seed: 1, attempt: 2, claimGeneration: 1, lifecycle: { state: "terminal", outcome: "failed", failureId: "22222222-2222-4222-8222-222222222222", endedAt: "2026-10-02T17:00:00.000Z" } });
const row = notificationRecordOf({ seed: 1, title: "Run failed", lastSeenAt: "2026-10-02T17:00:00.000Z" });
const checkpoint = (overrides: Record<string, unknown> = {}) => RunCheckpointRecordSchema.parse({
  workflowId: run.envelope.workflow, itemId: run.envelope.itemId, nodeId: "identify", attempt: 2,
  claimGeneration: 1, runId: run.envelope.runId, output: { schemaHash: HASH_A, value: { person: { name: "Alice" } } },
  descriptorVersion: 1, contractFingerprint: HASH_A, implFingerprint: HASH_B, provenance: [],
  writtenAt: "2026-10-02T16:59:00.000Z", ...overrides,
});
const descriptor = { label: "Person lookup", contractFingerprint: HASH_A, subjectProjection: { nodeId: "identify", fieldPath: "person.name" } };
const deps = (records: ReturnType<typeof checkpoint>[], current = descriptor) => ({
  read: () => ({ state: "present" as const, disposition: "live" as const, run }),
  descriptor: () => current,
  checkpoints: { listByAttempt: () => records },
});

it("uses only the linked run's compatible declared subject checkpoint", () => {
  assert.deepEqual(notificationDisplayContext(row, deps([checkpoint(), checkpoint({ runId: "33333333-3333-4333-8333-333333333333", output: { schemaHash: HASH_A, value: { person: { name: "Other" } } } })])),
    { state: "available", workflow: "Person lookup", subject: "Alice" });
  assert.deepEqual(notificationDisplayContext(row, deps([checkpoint({ attempt: 3, output: { schemaHash: HASH_A, value: { person: { name: "Later" } } } })])), { state: "workflow-only", workflow: "Person lookup" });
  assert.deepEqual(notificationDisplayContext(row, deps([checkpoint({ contractFingerprint: HASH_B })])), { state: "workflow-only", workflow: "Person lookup" });
  assert.deepEqual(notificationDisplayContext(row, deps([checkpoint()], { ...descriptor, contractFingerprint: HASH_B })), { state: "unavailable" });
  assert.deepEqual(notificationDisplayContext(row, deps([])), { state: "workflow-only", workflow: "Person lookup" });
});

it("does not reconstruct archived or absent run context", () => {
  const regular = deps([checkpoint()]);
  assert.deepEqual(notificationDisplayContext(row, { ...regular, read: () => ({ state: "present", disposition: "archived", run }) }), { state: "unavailable" });
  assert.deepEqual(notificationDisplayContext(row, { ...regular, read: () => ({ state: "absent", runId: run.envelope.runId }) }), { state: "unavailable" });
});
