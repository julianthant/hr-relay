import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { it } from "vitest";
import { searchDocumentRecordsTask } from "../../../../../src/backend/systems/crm/tasks/search-document-records.js";
import { readIdocsTask } from "../../../../../src/backend/systems/crm/tasks/read-idocs.js";
import { createDeterministicCrmOnboardingDriver } from "../../../../../src/backend/systems/crm/driver/fake.js";
import { CrmSearchDocumentRecords } from "../../../../../src/models/systems/crm/search-document-records.js";
import { CrmReadIdocs } from "../../../../../src/models/systems/crm/read-idocs.js";
import { CrmLocatedPersonSchema, CrmIdocsBytesSchema } from "../../../../../src/models/systems/crm/documents.js";
import { CrmReadOnboardingRecord } from "../../../../../src/models/systems/crm/read-onboarding-record.js";
import { CrmReadOnboardingDates } from "../../../../../src/models/systems/crm/read-onboarding-dates.js";
import { ArtifactRefSchema } from "../../../../../src/models/artifacts/artifacts.js";
import type { ContentAddressedArtifactWriter } from "../../../../../src/workflow-kit/artifacts.js";
import { classifyEvidenceLeaf, evidenceLeaves, redactEvidenceLeaf } from "../../../../../src/models/trust/evidence-classification.js";
import { redactValue } from "../../../../../src/rules/redaction/redaction.js";
import { DataPointSchema, type DataPoint } from "../../../../../src/rules/workflow/task-provenance.js";
import { TaskRefusal } from "../../../../support/helpers/separation-task-fixtures.js";

const located = CrmLocatedPersonSchema.parse({ subject: { kind: "email", value: "fixture@example.test" }, identity: {
  recordId: "fixture-record", eid: null, workEmail: "fixture@example.test", personalEmail: null,
} });
const idocs = CrmIdocsBytesSchema.parse({ identity: located.identity, totalDocuments: 1,
  documents: [{ index: 0, fileName: "Signed Offer Letter.pdf", bytes: new TextEncoder().encode("%PDF-1.7 fixture") }] });

function fixture() {
  const records: DataPoint[] = [], causes: unknown[] = [], controller = new AbortController(); let puts = 0;
  const artifacts: ContentAddressedArtifactWriter = {
    async put(bytes, metadata) { assert.ok(bytes instanceof Uint8Array); puts += 1;
      return ArtifactRefSchema.parse({ id: randomUUID(), sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.byteLength, mediaType: metadata.mediaType }); },
    async open() { throw new Error("document acquisition must not read stored artifacts"); },
  };
  const ctx = { driver: createDeterministicCrmOnboardingDriver({ record: CrmReadOnboardingRecord.example, dates: CrmReadOnboardingDates.example,
      documents: [idocs] }), signal: controller.signal, artifacts,
    captureScreenshot: async () => { throw new Error("fixture has no capture surface"); },
    log: { debug() {}, info() {}, warn() {} },
    fail(this: void, code: string, message: string, options?: Readonly<{ cause?: unknown }>): never {
      causes.push(options?.cause); throw new TaskRefusal(code, message);
    },
    recordData(this: void, batch: DataPoint | readonly DataPoint[]) { for (const point of Array.isArray(batch) ? batch : [batch]) records.push(DataPointSchema.parse(point)); },
  };
  return { ctx, records, causes, controller, puts: () => puts, recordCtx: () => ({ driver: ctx.driver, signal: ctx.signal,
    captureScreenshot: ctx.captureScreenshot, log: ctx.log, fail: ctx.fail, recordData: ctx.recordData }) };
}

it("retains complete typed record and PDF evidence while provider disclosure digests person populations", async () => {
  const f = fixture();
  const records = await searchDocumentRecordsTask.impl.run({ input: { subjects: [located.subject] }, ctx: f.recordCtx() });
  assert.deepEqual(records, { records: [located] });
  const output = await readIdocsTask.impl.run({ input: records, ctx: f.ctx });
  assert.equal(output.people[0]?.documents[0]?.artifact.mediaType, "application/pdf"); assert.equal(f.puts(), 1);
  for (const [contract, value] of [[CrmSearchDocumentRecords, records], [CrmReadIdocs, output]] as const) {
    const scope = { kind: "task-output", taskId: contract.id } as const;
    const redacted = evidenceLeaves(value).map(leaf => {
      const declared = classifyEvidenceLeaf(scope, leaf.path);
      assert.equal(declared.transform, "digest");
      assert.equal(JSON.stringify(redactEvidenceLeaf(scope, leaf)).includes("fixture@example.test"), true);
      return redactValue(declared.classification, declared.transform, leaf.value);
    });
    assert.equal(JSON.stringify(redacted).includes("fixture@example.test"), false);
  }
  assert.deepEqual(f.records.map(point => point.field), ["records", "people"]);
});

it("keeps private iDocs request tokens out of durable failure causes", async () => {
  const f = fixture();
  f.ctx.driver = { ...f.ctx.driver, readIdocs: async () => { throw new Error("request failed: https://example.test/document?h=private-document-token"); } };
  await assert.rejects(readIdocsTask.impl.run({ input: { records: [located] }, ctx: f.ctx }), error =>
    error instanceof TaskRefusal && error.code === "CRM_DOCUMENT_DOWNLOAD_FAILED" && !error.message.includes("private-document-token"));
  assert.deepEqual(f.causes, [undefined]); assert.deepEqual(f.records, []); assert.equal(f.puts(), 0);
});

it("refuses completion if cancellation arrives while the driver returns a record", async () => {
  const f = fixture(), failure = new Error("fixture cancelled during read");
  f.ctx.driver = { ...f.ctx.driver, findDocumentRecord: async () => { f.controller.abort(failure); return located.identity; } };
  await assert.rejects(searchDocumentRecordsTask.impl.run({ input: { subjects: [located.subject] }, ctx: f.recordCtx() }), error => error === failure);
  assert.deepEqual(f.records, []); assert.equal(f.puts(), 0);
});

it("refuses an incorrect discovered identity before recording any task output", async () => {
  const f = fixture();
  f.ctx.driver = { ...f.ctx.driver, findDocumentRecord: async () => ({ ...located.identity, workEmail: "other@example.test" }) };
  await assert.rejects(searchDocumentRecordsTask.impl.run({ input: { subjects: [located.subject] }, ctx: f.recordCtx() }), error => error instanceof TaskRefusal && error.code === "CRM_DOCUMENT_SOURCE_UNAVAILABLE");
  assert.deepEqual(f.records, []); assert.equal(f.puts(), 0);
});

it.each(["identity", "selection", "bytes"] as const)("refuses inconsistent downloaded %s without recording a successful result", async kind => {
  const f = fixture();
  const read = kind === "identity" ? { ...idocs, identity: { ...idocs.identity, recordId: "different-record" } }
    : kind === "selection" ? { ...idocs, totalDocuments: 9 }
    : { ...idocs, documents: [{ ...idocs.documents[0], index: 0, fileName: "Signed Offer Letter.pdf", bytes: new TextEncoder().encode("not a PDF") }] };
  f.ctx.driver = { ...f.ctx.driver, readIdocs: async () => CrmIdocsBytesSchema.parse(read) };
  await assert.rejects(readIdocsTask.impl.run({ input: { records: [located] }, ctx: f.ctx }), error => error instanceof TaskRefusal && error.code === "CRM_DOCUMENT_DOWNLOAD_FAILED");
  assert.deepEqual(f.records, []); assert.equal(f.puts(), 0);
});

it("propagates cancellation before browser or artifact effects", async () => {
  const f = fixture(), failure = new Error("fixture cancelled"); f.controller.abort(failure);
  await assert.rejects(searchDocumentRecordsTask.impl.run({ input: { subjects: [located.subject] }, ctx: f.recordCtx() }), error => error === failure);
  await assert.rejects(readIdocsTask.impl.run({ input: { records: [located] }, ctx: f.ctx }), error => error === failure);
  assert.deepEqual(f.records, []); assert.equal(f.puts(), 0);
});
