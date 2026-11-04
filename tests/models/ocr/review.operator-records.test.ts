import assert from "node:assert/strict";
import { it } from "vitest";
import { blankOperatorOcrFields, initialOcrReviewRecords, operatorOcrFields, operatorOcrRecordId, OcrReviewRevisionSchema, rebuildOcrReviewRecords } from "../../../src/models/ocr/review.js";
import { ocrForm } from "../../../src/models/ocr/form-registry.js";
import { OcrOperatorPagesSchema } from "../../../src/models/ocr/review-record.js";
import { accountOcrPages } from "../../../src/models/workflows/ocr/page-accounting.js";
import { buildOcrReviewSeed } from "../../../src/models/workflows/ocr/review-seed.js";
import { ocrReviewPageFixture } from "../../support/fixtures/dashboard/ocr-review.js";
import { sourceFixture, donePage, READING_ID, READ_AT } from "../../support/fixtures/ocr/source-pages.js";

const commandId = "00000000-0000-4000-8000-000000000901";
it.each(["oath", "emergency-contact", "i9"] as const)("admits a complete operator-added %s shape and preserves its provenance across refresh", formType => {
  const source = sourceFixture(2, formType), form = ocrForm(formType);
  const seed = { review: buildOcrReviewSeed({ roster: null, accounting: accountOcrPages(source.manifest, READING_ID,
    source.inputs.map((input, index) => donePage(input, undefined, form.pageKinds[index % form.pageKinds.length])), formType) }), identities: [] };
  const pages = OcrOperatorPagesSchema.parse(form.pageKinds.map((pageKind, index) => ({ pageKind, sourcePage: index + 1 })));
  const fields = blankOperatorOcrFields(seed, pages, READ_AT);
  assert.deepEqual(fields.answers.map(answer => answer.path).sort(), form.fields.map(field => field.path).sort());
  assert.ok(fields.blockingPaths.length > 0);
  const original = ocrReviewPageFixture().ocr?.revision; assert.ok(original);
  const manual = { recordId: operatorOcrRecordId(seed, commandId), fields, assertedEid: null, discarded: true,
    provenance: { kind: "operator-added", commandId, createdAt: READ_AT, pages } };
  const revision = OcrReviewRevisionSchema.parse({ ...original, revision: 2, id: `${original.sourceRunId}#2`, seed,
    records: [...initialOcrReviewRecords(seed), manual], origin: { kind: "command", commandId } });
  assert.deepEqual(rebuildOcrReviewRecords(seed, revision).records, revision.records);
  assert.deepEqual(rebuildOcrReviewRecords(seed, revision).invalidatedCorrections, []);
  assert.throws(() => OcrReviewRevisionSchema.parse({ ...revision, records: [...revision.records, manual] }));
  assert.throws(() => OcrReviewRevisionSchema.parse({ ...revision, records: [...revision.records.slice(0, -1), { ...manual, provenance: undefined }] }));
  assert.throws(() => OcrReviewRevisionSchema.parse({ ...revision, records: [...revision.records.slice(0, -1), { ...manual,
    provenance: { ...manual.provenance, commandId: "00000000-0000-4000-8000-000000000902" } }] }));
  const values = Object.fromEntries(fields.answers.map(answer => [answer.path, answer.state === "absent"
    ? { state: "absent" as const, reason: answer.reason } : { state: "read" as const, raw: answer.raw, confidence: answer.confidence }]));
  assert.deepEqual(operatorOcrFields(seed, pages, values, READ_AT), fields);
  assert.throws(() => operatorOcrFields(seed, OcrOperatorPagesSchema.parse(pages.map(page => ({ ...page, sourcePage: 99 }))), values, READ_AT), /ocr-operator-record-source-invalid/u);
  assert.throws(() => operatorOcrFields(seed, pages, { ...values, foreign: { state: "absent", reason: "blank" } }, READ_AT));
  assert.throws(() => OcrReviewRevisionSchema.parse({ ...revision, records: [...revision.records.slice(0, -1), { ...manual,
    fields: { ...fields, blockingPaths: [] } }] }));
});
