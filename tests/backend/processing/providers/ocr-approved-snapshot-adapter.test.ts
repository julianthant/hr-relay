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
  const adapter = createOcrApprovedSnapshotAdapter({ ...base, reader: { read: () => ({ state: "absent", runId: base.run.envelope.runId }) } });
  assert.equal(value(await adapter.invoke(request, options)).state, "refused");
  const invalid = z.string().safeParse(123); assert.ok(!invalid.success);
  for (const failure of [new Error("synthetic-authority-database-failure"), invalid.error]) {
    const reader = { read: () => { throw failure; } };
    await assert.rejects(createOcrApprovedSnapshotAdapter({ ...base, reader }).invoke(request, options), error => error === failure);
    const spy = vi.spyOn(database, "withAuthorityReadSnapshot").mockImplementationOnce(() => { throw failure; });
    try { await assert.rejects(adapter.invoke(request, options), error => error === failure); }
    finally { spy.mockRestore(); }
  }
  const controller = new AbortController(), abort = new Error("synthetic-provider-abort");
  controller.abort(abort);
  await assert.rejects(adapter.invoke(request, { ...options, signal: controller.signal }), error => error === abort);
});
