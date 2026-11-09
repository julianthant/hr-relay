import assert from "node:assert/strict";
import { it } from "vitest";
import { createWorkbookLibraryAdapter } from "../../../../src/backend/processing/providers/workbook-library-adapter.js";
import type { WorkbookLibraryRepository } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { WorkbookLibraryError } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { ReadWorkbookReference, WorkbookReferenceReadResponseSchema } from "../../../../src/models/processing/workbooks/read-reference.js";
import { ReadI9CheckRequests } from "../../../../src/models/workflows/i9-check-start/read-requests.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { manualClock } from "../../../../src/rules/time/clock.js";

const forbidden = (): never => { throw new Error("Unexpected live workbook or write access"); };
const repository: WorkbookLibraryRepository = { lastUsed: forbidden, rememberLastUsed: forbidden, create: forbidden, read: forbidden, revision: forbidden, list: forbidden, save: forbidden,
  history: forbidden, creation: forbidden, versions: forbidden, types: forbidden, putType: forbidden, metadata: forbidden,
  enqueue: forbidden, drain: forbidden, operation: forbidden, journal: forbidden, snapshot: forbidden, runOperations: forbidden, catalog: forbidden, libraryState: forbidden, libraryVersion: forbidden,
  libraryActionRecord: forbidden, libraryAction: forbidden };
const runId = "00000000-0000-4000-8000-000000000001";
const clock = manualClock(new Date("2026-11-01T00:00:00.000Z"));
const command = ReadWorkbookReference.input.parse({ typeId: "action-history", keys: [ReadI9CheckRequests.example.people[0].eid] });
const request = { capability: "workbooks.library" as const,
  payload: { schemaHash: deriveSchemaHash(ReadWorkbookReference.input, "output"), value: command } };
const options = { signal: new AbortController().signal, deadlineMonotonicMs: Infinity, requestId: "fixture" };

it("workbooks/read-reference — reads through the captured-run port without giving the caller a library or version selector", async () => {
  const calls: unknown[] = [];
  const adapter = createWorkbookLibraryAdapter({ repository, clock, runId, references: { runId, write: forbidden,
    read: input => { calls.push(input); return ReadWorkbookReference.output.parse({ state: "read", referenceDigest: "a".repeat(64), reference: ReadI9CheckRequests.example.reference }); } } });
  const response = await adapter.invoke(request, options);
  assert.equal(response.response.state, "produced");
  if (response.response.state !== "produced") assert.fail("Captured version read refused");
  const result = ReadWorkbookReference.output.parse(response.response.value.value);
  assert.equal(result.state, "read");
  if (result.state !== "read") assert.fail("Captured version read refused");
  assert.equal(result.reference.snapshot.versionId, "selected-version");
  assert.deepEqual(calls, [command]);
  for (const extra of [{ libraryId: "foreign" }, { versionId: "live-version" }, { fields: ["eid"] }]) {
    assert.equal(ReadWorkbookReference.input.safeParse({ ...command, ...extra }).success, false);
  }
  await assert.rejects(adapter.invoke(request, { ...options, signal: AbortSignal.abort() }));
  assert.equal(calls.length, 1);
});
it("refuses unavailable, foreign and missing captured versions without reading the live master", async () => {
  for (const { references, code } of [
    { references: undefined, code: "WORKBOOK_INVALID" },
    { references: { runId: "foreign", write: forbidden, read: forbidden }, code: "WORKBOOK_INVALID" },
    { references: { runId, write: forbidden, read: () => { throw new WorkbookLibraryError("WORKBOOK_REVISION_UNAVAILABLE"); } }, code: "WORKBOOK_REVISION_UNAVAILABLE" },
  ]) {
    const adapter = createWorkbookLibraryAdapter({ repository, clock, runId, ...(references === undefined ? {} : { references }) });
    const response = await adapter.invoke(request, options);
    assert.equal(response.response.state, "produced");
    if (response.response.state !== "produced") assert.fail("Missing typed reference refusal");
    assert.equal(response.response.value.schemaHash, deriveSchemaHash(WorkbookReferenceReadResponseSchema, "output"));
    const result = WorkbookReferenceReadResponseSchema.parse(response.response.value.value);
    assert.equal(result.state, "refused");
    if (result.state !== "refused") assert.fail("Missing typed reference refusal");
    assert.equal(result.code, code);
    assert.ok(result.message.length > 0);
  }
});
