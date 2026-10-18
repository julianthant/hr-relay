import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { notificationDisplayContext } from "../../../../src/backend/runs/queries/notification-display.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { HASH_A,HASH_B } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { makeWorld, notificationRecordOf,runRecordOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

const worlds: DashboardWorld[] = [];
afterEach(() => { for (const world of worlds.splice(0)) world.dispose(); });

const run = runRecordOf({ seed: 1, attempt: 2, claimGeneration: 1, lifecycle: { state: "terminal", outcome: "failed", failureId: "22222222-2222-4222-8222-222222222222", endedAt: "2026-10-02T17:00:00.000Z" } });
const row = notificationRecordOf({ seed: 1, title: "Run failed", lastSeenAt: "2026-10-02T17:00:00.000Z" });
const checkpoint = (overrides: Record<string, unknown> = {}) => RunCheckpointRecordSchema.parse({
  workflowId: run.envelope.workflow, itemId: run.envelope.itemId, nodeId: "identify", attempt: 2,
  claimGeneration: 1, runId: run.envelope.runId, output: { schemaHash: HASH_A, value: { person: { name: "Alice" } } },
  descriptorVersion: 1, contractFingerprint: HASH_A, implFingerprint: HASH_B, provenance: [],
  writtenAt: "2026-10-02T16:59:00.000Z", ...overrides,
});
const descriptor = { label: "Person lookup", contractFingerprint: HASH_A, subjectProjection: { nodeId: "identify", fieldPath: "person.name" } };
const deps = (records: ReturnType<typeof checkpoint>[], current = descriptor) => {
  const world = makeWorld();
  worlds.push(world);
  return {
    read: () => ({ state: "present" as const, disposition: "live" as const, run }),
    descriptor: () => current,
    checkpoints: { listByAttempt: () => records },
    presentation: { timeline: world.timeline, authority: { listCheckpoints: () => records, listGateResults: () => [] } },
  };
};

it("uses only the linked run's compatible declared subject checkpoint", () => {
  assert.deepEqual(notificationDisplayContext(row, deps([checkpoint(), checkpoint({ runId: "33333333-3333-4333-8333-333333333333", output: { schemaHash: HASH_A, value: { person: { name: "Other" } } } })])),
    { state: "available", workflow: "Person lookup", subject: "Alice" });
  assert.deepEqual(notificationDisplayContext(row, deps([checkpoint({ attempt: 3, output: { schemaHash: HASH_A, value: { person: { name: "Later" } } } })])), { state: "workflow-only", workflow: "Person lookup" });
  assert.deepEqual(notificationDisplayContext(row, deps([checkpoint({ contractFingerprint: HASH_B })])), { state: "workflow-only", workflow: "Person lookup" });
  assert.deepEqual(notificationDisplayContext(row, deps([checkpoint()], { ...descriptor, contractFingerprint: HASH_B })), { state: "unavailable" });
  assert.deepEqual(notificationDisplayContext(row, deps([])), { state: "workflow-only", workflow: "Person lookup" });
});

it("does not reconstruct absent run context", () => {
  const regular = deps([checkpoint()]);
  assert.deepEqual(notificationDisplayContext(row, { ...regular, read: () => ({ state: "absent", runId: run.envelope.runId }) }), { state: "unavailable" });
});

it("withholds a future execution subject", () => {
  const future = checkpoint({ claimGeneration: run.claimGeneration + 1, output: { schemaHash: HASH_A, value: { person: { name: "Future" } } } });
  assert.deepEqual(notificationDisplayContext(row, deps([checkpoint(), future])), { state: "available", workflow: "Person lookup", subject: "Alice" });
  assert.deepEqual(notificationDisplayContext(row, deps([future])), { state: "workflow-only", workflow: "Person lookup" });
});

it("displays an older run's exact subject after a structurally compatible workflow fingerprint change", () => {
  const current = { ...descriptor, contractFingerprint: HASH_B,
    timeline: [{ key: "identity", label: "Current identity", nodes: [{ id: "identify", label: "Current identify" }] }] };
  const retained = checkpoint();
  const unrelated = checkpoint({ runId: "33333333-3333-4333-8333-333333333333",
    output: { schemaHash: HASH_A, value: { person: { name: "Other" } } } });
  const regular = deps([retained, unrelated]);
  assert.deepEqual(notificationDisplayContext(row, { ...regular, descriptor: () => current }),
    { state: "available", workflow: "Person lookup", subject: "Alice" });
});

it.each([HASH_A, HASH_B])("withholds notification display when the run's checkpoint node is absent from the live timeline (%s)", fingerprint => {
  const current = { ...descriptor, contractFingerprint: fingerprint,
    timeline: [{ key: "replacement", label: "Replacement", nodes: [{ id: "replacement", label: "Replacement" }] }] };
  const regular = deps([checkpoint()]);
  assert.deepEqual(notificationDisplayContext(row, { ...regular, descriptor: () => current }), { state: "unavailable" });
});

it("propagates evidence read failures instead of treating corruption as incompatible presentation", () => {
  const current = { ...descriptor, timeline: [{ key: "identity", label: "Identity", nodes: [{ id: "identify", label: "Identify" }] }] };
  const regular = deps([checkpoint()]);
  const failure = new Error("synthetic checkpoint read failure");
  assert.throws(() => notificationDisplayContext(row, { ...regular, descriptor: () => current,
    presentation: { ...regular.presentation, authority: { ...regular.presentation.authority, listCheckpoints: () => { throw failure; } } },
  }), error => error === failure);
});
