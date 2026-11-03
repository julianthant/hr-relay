import { createOcrReviewAdapter } from "../../../../src/backend/processing/providers/ocr-review-adapter.js";
import { ReadApprovedOcrRecords } from "../../../../src/models/processing/ocr/read-approved-records.js";
import { createApprovedOcrRecordReader } from "../../../../src/backend/runs/lifecycle/approved-ocr-records.js";
import { z } from "zod";
import assert from "node:assert/strict";
import { afterEach, it, vi } from "vitest";
import { createRunExecutorTestWorld } from "../../../support/helpers/backend/run-executor-world.js";
import { QUEUED_RUN } from "../../../support/fixtures/phase1f-run-fixtures.js";
import { RunRecordSchema } from "../../../../src/models/run/record.js";
import { createOcrApprovedSnapshotAdapter } from "../../../../src/backend/processing/providers/ocr-approved-snapshot-adapter.js";
import { OcrApprovalReadRequestSchema, OcrApprovalReadResultSchema } from "../../../../src/models/processing/ocr/read-approved-snapshot.js";
import { EMERGENCY_CONTACT_MEMBER_EXAMPLE } from "../../../../src/models/workflows/emergency-contact-member/input.js";
import { deriveSchemaHash, schemaBoundValueSchema } from "../../../../src/models/validation/schema-bound-value.js";
const world = createRunExecutorTestWorld();
afterEach(world.cleanup);
it("distinguishes expected authority refusal and unavailable custody from DB failure and abort", async () => {
  const h = await world.executorHarness(), { database, clock } = h.authority;
  const base = { database, clock, run: RunRecordSchema.parse(QUEUED_RUN), assertCurrent() {}, resolveDescriptor: () => undefined };
  const request = { capability: "ocr.approved-snapshot" as const, payload: { schemaHash: deriveSchemaHash(OcrApprovalReadRequestSchema, "output"),
    value: { kind: "snapshot", approval: EMERGENCY_CONTACT_MEMBER_EXAMPLE.approval } } };
  const options = { signal: world.SIGNAL, deadlineMonotonicMs: 10_000, requestId: "snapshot-control" };
  const value = (response: Awaited<ReturnType<ReturnType<typeof createOcrApprovedSnapshotAdapter>["invoke"]>>) => {
    assert.equal(response.response.state, "produced");
    assert.ok(response.response.state === "produced");
    return schemaBoundValueSchema(OcrApprovalReadResultSchema, deriveSchemaHash(OcrApprovalReadResultSchema, "output")).parse(response.response.value).value;
  };
  assert.equal(value(await createOcrApprovedSnapshotAdapter(base).invoke(request, options)).state, "unavailable");
  const adapter = createOcrApprovedSnapshotAdapter({ clock, reader: createApprovedOcrRecordReader({ ...base, reader: { read: () => ({ state: "absent", runId: base.run.envelope.runId }) } }) });
  assert.equal(value(await adapter.invoke(request, options)).state, "refused");
  const invalid = z.string().safeParse(123); assert.ok(!invalid.success);
  for (const failure of [new Error("synthetic-authority-database-failure"), invalid.error]) {
    const reader = { read: () => { throw failure; } };
    await assert.rejects(createOcrApprovedSnapshotAdapter({ clock, reader: createApprovedOcrRecordReader({ ...base, reader }) }).invoke(request, options), error => error === failure);
    const spy = vi.spyOn(database, "withAuthorityReadSnapshot").mockImplementationOnce(() => { throw failure; });
    try { await assert.rejects(adapter.invoke(request, options), error => error === failure); }
    finally { spy.mockRestore(); }
  }
  const controller = new AbortController(), abort = new Error("synthetic-provider-abort");
  controller.abort(abort);
  await assert.rejects(adapter.invoke(request, { ...options, signal: controller.signal }), error => error === abort);
});

it("propagates database, parser, profile and abort errors through every approved OCR projection", async () => {
  const h = await world.executorHarness(), { database, clock } = h.authority;
  const run = RunRecordSchema.parse(QUEUED_RUN);
  const invalid = z.string().safeParse(123); assert.ok(!invalid.success);
  const bulkInput = ReadApprovedOcrRecords.input.parse({ delegationNodeId: "read-documents", outcomes: [{
    state: "cancelled", runId: run.envelope.runId, itemId: run.envelope.itemId, reason: "fixture", cancelledBy: "operator",
  }] });
  for (const operation of ["snapshot", "record", "sources"] as const) {
    const make = (failure?: Error, assertCurrent = () => {}) => {
      const reader = createApprovedOcrRecordReader({ database, run, assertCurrent, resolveDescriptor: () => undefined,
        reader: { read: () => { if (failure !== undefined) throw failure; return { state: "absent", runId: run.envelope.runId }; } } });
      return operation === "sources"
        ? () => createOcrReviewAdapter({ clock, reader }).invoke({ capability: "ocr.review", payload: {
          schemaHash: deriveSchemaHash(ReadApprovedOcrRecords.input, "output"), value: bulkInput,
        } }, options)
        : () => createOcrApprovedSnapshotAdapter({ clock, reader }).invoke({ capability: "ocr.approved-snapshot", payload: {
          schemaHash: deriveSchemaHash(OcrApprovalReadRequestSchema, "output"), value: operation === "snapshot"
            ? { kind: "snapshot", approval: EMERGENCY_CONTACT_MEMBER_EXAMPLE.approval }
            : { kind: "record", approval: EMERGENCY_CONTACT_MEMBER_EXAMPLE.approval, recordId: EMERGENCY_CONTACT_MEMBER_EXAMPLE.record.recordId },
        } }, options);
    };
    const controller = new AbortController();
    const options = { signal: controller.signal, deadlineMonotonicMs: 10_000, requestId: `sentinel-${operation}` };
    for (const failure of [new Error("direct-database-failure"), invalid.error]) {
      await assert.rejects(make(failure)(), error => error === failure);
      const spy = vi.spyOn(database, "withAuthorityReadSnapshot").mockImplementationOnce(() => { throw failure; });
      try { await assert.rejects(make()(), error => error === failure); }
      finally { spy.mockRestore(); }
    }
    const profile = new Error("profile-custody-lost");
    await assert.rejects(make(undefined, () => { throw profile; })(), error => error === profile);
    const abort = new Error("abort-projection"); controller.abort(abort);
    await assert.rejects(make()(), error => error === abort);
  }
});
