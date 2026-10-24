import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { notificationDisplayContext } from "../../../../src/backend/runs/queries/notification-display.js";
import { notificationWireOf } from "../../../../src/models/dashboard/projection.js";
import { NotificationRecordSchema } from "../../../../src/models/notifications/notifications.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { RunEvidenceReceiptSchema } from "../../../../src/models/trust/evidence.js";
import { personLookupDescriptor } from "../../../support/helpers/registered-workflows.js";
import { RunCheckpointRecordSchema } from "../../../../src/models/workflow/checkpoint.js";
import { notificationRecordOf, traceOf } from "../../../support/helpers/backend/dashboard-harness.js";
import { createRunQueueProjectionTestWorld } from "../../../support/helpers/backend/run-queue-projection-world.js";
import { FICTIONAL_PERSON, seedPersonLookupPresentation } from "../../../support/fixtures/person-lookup-presentation.js";

const { world, cleanup } = createRunQueueProjectionTestWorld();
afterEach(cleanup);

function scenario(options: Parameters<typeof seedPersonLookupPresentation>[1] = {}) {
  const w = world({ descriptors: { resolve: () => personLookupDescriptor } });
  const { run, row } = seedPersonLookupPresentation(w, options);
  const record = NotificationRecordSchema.parse({
    ...notificationRecordOf({ seed: 1, title: "Synthetic notice", lastSeenAt: run.updatedAt }),
    links: [{ kind: "run", runId: run.envelope.runId }],
  });
  w.authority.notifications.push(record);
  const deps = {
    read: (id: string) => w.runReader.read(id),
    descriptor: () => personLookupDescriptor,
    receipt: (id: string) => w.authority.getReceipt(id),
    presentation: w,
    checkpoints: { listByAttempt: () => { throw new Error("result-title-must-not-read-subject-checkpoint"); } },
  } satisfies Parameters<typeof notificationDisplayContext>[1];
  return { w, run, row, record, deps, context: () => notificationDisplayContext(record, deps) };
}

it.each(["active", "not-found"] as const)("uses the same declared Person Lookup title as Queue for %s", state => {
  const f = scenario({ state, protectedInput: true });
  const display = f.context();
  assert.ok(display.state === "available");
  const row = f.row();
  assert.ok(row);
  assert.equal(display.subject, row.title);
  assert.equal(display.workflow, personLookupDescriptor.label);
  const projected = f.w.projection.buildDashboardDayWire(f.run.envelope.enqueuedAt.slice(0, 10)).notifications[0];
  assert.ok(projected && "context" in projected);
  assert.deepEqual(projected.context, display);
});

it("keeps canonical input-title behavior when a receipt is absent or unverified without reading a subject checkpoint", () => {
  const f = scenario(), receipt = f.w.authority.getReceipt(f.run.envelope.runId);
  assert.ok(receipt);
  f.w.authority.receipts.delete(f.run.envelope.runId);
  assert.deepEqual(f.context(), { state: "available", workflow: personLookupDescriptor.label, subject: FICTIONAL_PERSON.eid });
  f.w.authority.receipts.set(f.run.envelope.runId, RunEvidenceReceiptSchema.parse({ ...receipt, verification: [] }));
  assert.deepEqual(f.context(), { state: "available", workflow: personLookupDescriptor.label, subject: FICTIONAL_PERSON.eid });
});

it("refuses each foreign receipt identity without falling back to typed input or a checkpoint", () => {
  const f = scenario(), receipt = f.w.authority.getReceipt(f.run.envelope.runId);
  assert.ok(receipt);
  for (const replacement of [
    { runId: randomUUID() }, { traceId: traceOf(999) }, { attempt: f.run.envelope.attempt + 1 },
    { workflowId: "synthetic-other-workflow" }, { descriptorFingerprint: "f".repeat(64) }, { configFingerprint: "f".repeat(64) },
  ]) {
    f.w.authority.receipts.set(f.run.envelope.runId, RunEvidenceReceiptSchema.parse({ ...receipt, ...replacement }));
    assert.deepEqual(f.context(), { state: "unavailable" });
  }
});

it("keeps forbidden protected input unavailable even when a matching result receipt exists", () => {
  const f = scenario({ protectedInput: true });
  const value = f.run.input.parsed.value;
  assert.ok(value !== null && typeof value === "object" && !Array.isArray(value));
  f.w.authority.put(RunRecordSchema.parse({ ...f.run, input: { ...f.run.input, parsed: { ...f.run.input.parsed,
    value: { ...value, documentNumber: f.run.envelope.runId },
    protectedBindings: [{ kind: "test-data-local", inputPath: "documentNumber", name: "separationsKualiFinalizationCanaryDocumentNumber", sourceId: f.run.envelope.runId }],
  } } }));
  assert.deepEqual(f.context(), { state: "unavailable" });
});

it("preserves descriptor compatibility refusal before receipt access and propagates unrelated read failures", () => {
  const f = scenario();
  f.w.authority.put(RunRecordSchema.parse({ ...f.run, envelope: { ...f.run.envelope,
    descriptorVersion: f.run.envelope.descriptorVersion + 1,
  } }));
  f.w.authority.putCheckpoint(RunCheckpointRecordSchema.parse({
    workflowId: f.run.envelope.workflow, itemId: f.run.envelope.itemId,
    nodeId: "retired-notification-fixture-node", runId: f.run.envelope.runId,
    attempt: f.run.envelope.attempt, claimGeneration: f.run.claimGeneration,
    descriptorVersion: f.run.envelope.descriptorVersion + 1,
    contractFingerprint: f.run.envelope.contractFingerprint,
    implFingerprint: f.run.envelope.contractFingerprint,
    output: { schemaHash: f.run.input.parsed.schemaHash, value: {} },
    provenance: [], writtenAt: f.run.updatedAt,
  }));
  let receiptReads = 0;
  assert.deepEqual(notificationDisplayContext(f.record, { ...f.deps,
    receipt: () => { receiptReads++; return f.w.authority.getReceipt(f.run.envelope.runId); },
  }), { state: "unavailable" });
  assert.equal(receiptReads, 0);
  f.w.authority.put(f.run);
  const failure = new Error("synthetic-receipt-read-failure");
  assert.throws(() => notificationDisplayContext(f.record, { ...f.deps, receipt: () => { throw failure; } }), error => error === failure);
});

it.each(["failed", "verified-done"] as const)("keeps resolved-person display out of the durable %s delivery payload", trigger => {
  const f = scenario(), record = NotificationRecordSchema.parse({
    ...notificationRecordOf({ seed: 1, trigger, title: f.record.title, lastSeenAt: f.run.updatedAt }),
    links: f.record.links,
  });
  const before = JSON.stringify(record), display = notificationDisplayContext(record, f.deps);
  assert.ok(display.state === "available");
  assert.notEqual(display.subject, FICTIONAL_PERSON.eid);
  const wire = notificationWireOf(record, f.w.clock.nowMs(), display);
  assert.ok("context" in wire);
  assert.deepEqual(wire.context, display);
  assert.equal(JSON.stringify(record), before);
  assert.equal(before.includes(FICTIONAL_PERSON.name), false);
  assert.throws(() => NotificationRecordSchema.parse({ ...record, context: display }));
  assert.equal(wire.channel, record.channel);
  assert.equal(wire.summary, record.summary);
});
