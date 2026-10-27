import { FingerprintSchema } from "../../../../src/rules/identity/ids.js";
import { separationsDescriptor } from '../../../support/helpers/registered-workflows.js';
import assert from "node:assert/strict";
import { afterEach, it } from "vitest";
import { notificationDisplayContext } from "../../../../src/backend/runs/queries/notification-display.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { HASH_A as HASH_A_INPUT, HASH_B as HASH_B_INPUT } from "../../../support/fixtures/phase1c-contract-fixtures.js";
import { makeWorld, notificationRecordOf,runRecordOf, type DashboardWorld } from "../../../support/helpers/backend/dashboard-harness.js";

const HASH_A = FingerprintSchema.parse(HASH_A_INPUT), HASH_B = FingerprintSchema.parse(HASH_B_INPUT);
const worlds: DashboardWorld[] = [];
afterEach(async () => { for (const world of worlds.splice(0)) await world.dispose(); });

const run = runRecordOf({ seed: 1, workflow: separationsDescriptor.id, attempt: 2, claimGeneration: 1, lifecycle: { state: "terminal", outcome: "failed", failureId: "22222222-2222-4222-8222-222222222222", endedAt: "2026-10-02T17:00:00.000Z" } });
const row = notificationRecordOf({ seed: 1, title: "Run failed", lastSeenAt: "2026-10-02T17:00:00.000Z" });
const checkpoint = (overrides: Record<string, unknown> = {}) => RunCheckpointRecordSchema.parse({
  workflowId: run.envelope.workflow, itemId: run.envelope.itemId, nodeId: "identify", attempt: 2,
  claimGeneration: 1, runId: run.envelope.runId, output: { schemaHash: HASH_A, value: { person: { name: "Alice" } } },
  descriptorVersion: 1, contractFingerprint: HASH_A, implFingerprint: HASH_B, provenance: [],
  writtenAt: "2026-10-02T16:59:00.000Z", ...overrides,
});
const descriptor = { ...separationsDescriptor, version: run.envelope.descriptorVersion, label: "Person lookup", contractFingerprint: HASH_A, subjectProjection: { nodeId: "identify", fieldPath: "person.name" } };
const deps = async (records: ReturnType<typeof checkpoint>[], current = descriptor) => {
  const world = await makeWorld();
  worlds.push(world);
  return {
    read: () => ({ state: "present" as const, disposition: "live" as const, run }),
    descriptor: () => current,
    receipt: () => undefined,
    checkpoints: { listByAttempt: () => records },
    presentation: { timeline: world.timeline, authority: { listCheckpoints: () => records, listGateResults: () => [] } },
  };
};

it("uses only the linked run's compatible declared subject checkpoint", async () => {
  assert.deepEqual(notificationDisplayContext(row, await deps([checkpoint(), checkpoint({ runId: "33333333-3333-4333-8333-333333333333", output: { schemaHash: HASH_A, value: { person: { name: "Other" } } } })])),
    { state: "available", workflow: "Person lookup", subject: "Alice" });
  assert.deepEqual(notificationDisplayContext(row, await deps([checkpoint({ attempt: 3, output: { schemaHash: HASH_A, value: { person: { name: "Later" } } } })])), { state: "workflow-only", workflow: "Person lookup" });
  assert.deepEqual(notificationDisplayContext(row, await deps([checkpoint({ contractFingerprint: HASH_B })])), { state: "workflow-only", workflow: "Person lookup" });
  assert.deepEqual(notificationDisplayContext(row, await deps([checkpoint()], { ...descriptor, contractFingerprint: HASH_B })), { state: "unavailable" });
  assert.deepEqual(notificationDisplayContext(row, await deps([])), { state: "workflow-only", workflow: "Person lookup" });
});

it("does not reconstruct absent run context", async () => {
  const regular = await deps([checkpoint()]);
  assert.deepEqual(notificationDisplayContext(row, { ...regular, read: () => ({ state: "absent", runId: run.envelope.runId }) }), { state: "unavailable" });
});

it("withholds a future execution subject", async () => {
  const future = checkpoint({ claimGeneration: run.claimGeneration + 1, output: { schemaHash: HASH_A, value: { person: { name: "Future" } } } });
  assert.deepEqual(notificationDisplayContext(row, await deps([checkpoint(), future])), { state: "available", workflow: "Person lookup", subject: "Alice" });
  assert.deepEqual(notificationDisplayContext(row, await deps([future])), { state: "workflow-only", workflow: "Person lookup" });
});

it("displays an older run's exact subject after a structurally compatible workflow fingerprint change", async () => {
  const current = { ...descriptor, contractFingerprint: HASH_B,
    timeline: [{ key: "identity", label: "Current identity", nodes: [{ id: "identify", label: "Current identify" }] }] };
  const retained = checkpoint();
  const unrelated = checkpoint({ runId: "33333333-3333-4333-8333-333333333333",
    output: { schemaHash: HASH_A, value: { person: { name: "Other" } } } });
  const regular = await deps([retained, unrelated]);
  assert.deepEqual(notificationDisplayContext(row, { ...regular, descriptor: () => current }),
    { state: "available", workflow: "Person lookup", subject: "Alice" });
});

it.each([HASH_A, HASH_B])("withholds notification display when the run's checkpoint node is absent from the live timeline (%s)", async fingerprint => {
  const current = { ...descriptor, version: descriptor.version + 1, contractFingerprint: fingerprint,
    timeline: [{ key: "replacement", label: "Replacement", nodes: [{ id: "replacement", label: "Replacement" }] }] };
  const regular = await deps([checkpoint()]);
  assert.deepEqual(notificationDisplayContext(row, { ...regular, descriptor: () => current }), { state: "unavailable" });
});

it("propagates evidence read failures instead of treating corruption as incompatible presentation", async () => {
  const current = { ...descriptor, version: descriptor.version + 1, timeline: [{ key: "identity", label: "Identity", nodes: [{ id: "identify", label: "Identify" }] }] };
  const regular = await deps([checkpoint()]);
  const failure = new Error("synthetic checkpoint read failure");
  assert.throws(() => notificationDisplayContext(row, { ...regular, descriptor: () => current,
    presentation: { ...regular.presentation, authority: { ...regular.presentation.authority, listCheckpoints: () => { throw failure; } } },
  }), error => error === failure);
});

it("does no compatibility evidence reads for a current-version notification while retaining its declared subject read", async () => {
  const regular = await deps([checkpoint()]);
  const current = { ...descriptor, timeline: [{ key: "replacement", label: "Replacement", nodes: [{ id: "replacement", label: "Replacement" }] }] };
  let compatibilityCheckpointReads = 0;
  let timelineReads = 0;
  let subjectReads = 0;
  const display = notificationDisplayContext(row, { ...regular, descriptor: () => current,
    checkpoints: { listByAttempt: () => { subjectReads++; return [checkpoint()]; } },
    presentation: {
      timeline: { ...regular.presentation.timeline, page(input) { timelineReads++; return regular.presentation.timeline.page(input); } },
      authority: { ...regular.presentation.authority, listCheckpoints: () => { compatibilityCheckpointReads++; return []; } },
    },
  });
  assert.deepEqual(display, { state: "available", workflow: "Person lookup", subject: "Alice" });
  assert.equal(compatibilityCheckpointReads, 0);
  assert.equal(timelineReads, 0);
  assert.equal(subjectReads, 1);
});

it("withholds a version-only older notification with an unmapped checkpoint node", async () => {
  const regular = await deps([checkpoint()]);
  const current = { ...descriptor, version: descriptor.version + 1,
    timeline: [{ key: "replacement", label: "Replacement", nodes: [{ id: "replacement", label: "Replacement" }] }] };
  assert.deepEqual(notificationDisplayContext(row, { ...regular, descriptor: () => current }), { state: "unavailable" });
});
