import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { extractFormPageTask } from "../../../../src/backend/processing/ocr/tasks/extract-form-page.js";
import { OCR_EXTRACTION_RESPONSE_HASH } from "../../../../src/models/processing/ocr/extract-form-page.js";
import { accountOcrPages, bindManualOcrPageReading, bindOcrPageReading, ocrExtractionItemId, OcrPageAccountingSchema, OcrPageOutcomeSchema, OcrPageReadingSchema } from "../../../../src/models/workflows/ocr/page-accounting.js";
import { buildOcrReviewSeed } from "../../../../src/models/workflows/ocr/review-seed.js";
import { type OcrPageInput } from "../../../../src/models/workflows/ocr/source-manifest.js";
import { admittedPage, donePage, READ_AT, READING_ID, SOURCE_RUN_ID, sourceFixture, submittedPage } from "../../../support/fixtures/ocr/source-pages.js";

async function fakeProviderPage(input: OcrPageInput, response: unknown, requests: unknown[] = [], observations: unknown[] = []) {
  return extractFormPageTask.impl.run({ input: { formType: input.formType, sourcePage: input.sourcePage, page: input.image },
    ctx: { providers: { "ocr.extract": { call: (payload: unknown) => { requests.push(payload); return Promise.resolve(response); } } },
      recordData: (points: unknown) => { observations.push(points); },
      fail: (code: string) => { throw Object.assign(new Error(code), { code }); },
    } as never });
}

describe("OCR source-bound page processing", () => {
  it("processes a valid multi-page positive control through the real OCR task using a fake provider", async () => {
    const { manifest, inputs } = sourceFixture(3);
    const kinds = ["emergency-contact", "blank", "oath"] as const;
    const requests: unknown[] = [], observations: unknown[] = [];
    const outcomes = [];
    for (const [index, input] of inputs.entries()) {
      const extraction = await fakeProviderPage(input, { state: "produced", value: {
        schemaHash: OCR_EXTRACTION_RESPONSE_HASH, value: submittedPage(input, "Example, Avery", kinds[index]),
      } }, requests, observations);
      outcomes.push(OcrPageOutcomeSchema.parse({ ...donePage(input), output: bindOcrPageReading(input, extraction) }));
    }
    const seed = buildOcrReviewSeed({ sourceRunId: SOURCE_RUN_ID, accounting: accountOcrPages(manifest, READING_ID, outcomes), roster: null });
    assert.equal(requests.length, 3);
    assert.equal(observations.length, 3);
    assert.deepEqual(seed.pages.map(page => page.disposition), ["record", "blank", "wrong-form"]);
    assert.equal(seed.records.length, 1);
    assert.equal(seed.accounting.outcomes[1].state, "done");
    assert.equal(seed.records[0].sourcePage, 1);
    assert.equal(seed.records[0].assertedEid, null);
    assert.deepEqual(seed.records[0].issues, ["identity-unverified"]);
  });

  it("refuses provider errors, incomplete fields and mismatched response metadata without successful observations", async () => {
    const { inputs } = sourceFixture();
    const input = inputs[0];
    const complete = submittedPage(input);
    const variants = [
      { response: { state: "unavailable", reason: { code: "adapter-unavailable", message: "OCR provider not connected" } }, code: "provider-unavailable" },
      { response: { state: "invalid-response", reason: "malformed" }, code: "unreadable-page" },
      ...[
        { value: { ...complete, sourcePage: 9 }, code: "unreadable-page" },
        { value: { ...complete, sourceSha256: inputs[1].image.sha256 }, code: "unreadable-page" },
        { value: { ...complete, record: { answers: {} } }, code: "incomplete-extraction" },
      ].map(variant => ({ response: { state: "produced", value: { schemaHash: OCR_EXTRACTION_RESPONSE_HASH, value: variant.value } }, code: variant.code })),
    ];
    for (const { response, code } of variants) {
      const observations: unknown[] = [];
      await assert.rejects(() => fakeProviderPage(input, response, [], observations), error => error instanceof Error && error.message === code);
      assert.deepEqual(observations, []);
    }
  });

  it("retains failure, cancellation and blocked child provenance for the original pages", () => {
    const { manifest, inputs } = sourceFixture(4);
    const outcomes = [donePage(inputs[0]), ...["failed", "cancelled", "blocked"].map((state, index) => OcrPageOutcomeSchema.parse({
      state, itemId: ocrExtractionItemId(inputs[index + 1]), runId: `00000000-0000-4000-8000-00000000040${index}`,
      ...(state === "cancelled" ? { reason: "operator cancelled", cancelledBy: "operator" }
        : { failureId: "00000000-0000-4000-8000-000000000501", ...(state === "blocked" ? { reason: "awaiting resolution" } : {}) }),
    }))];
    const seed = buildOcrReviewSeed({ sourceRunId: SOURCE_RUN_ID, accounting: accountOcrPages(manifest, READING_ID, outcomes), roster: null });
    assert.deepEqual(seed.pages.map(page => page.disposition), ["record", "failed", "cancelled", "blocked"]);
    assert.deepEqual(seed.accounting.outcomes, outcomes);
    assert.equal(seed.records.length, 1);
  });

  it("refuses missing, repeated, reordered, foreign or rebound child results", () => {
    const { manifest, inputs } = sourceFixture();
    const outcomes = inputs.map(input => donePage(input));
    for (const wrong of [[outcomes[0]], [outcomes[0], outcomes[0]], [...outcomes].reverse(),
      [outcomes[0], { ...outcomes[1], runId: outcomes[0].runId }],
      [outcomes[0], { ...outcomes[1], output: outcomes[0].state === "done" ? outcomes[0].output : null }]]) {
      assert.equal(OcrPageAccountingSchema.safeParse({ manifest, readingId: READING_ID, outcomes: wrong }).success, false);
    }
    assert.throws(() => bindOcrPageReading(inputs[1], admittedPage(inputs[0])), /exact source request/);
  });

  it("validates canonical admitted fields and fingerprints at the reading boundary", () => {
    const { manifest, inputs } = sourceFixture();
    const reading = bindOcrPageReading(inputs[0], admittedPage(inputs[0]));
    assert.throws(() => bindOcrPageReading(inputs[0], { ...reading.extraction, pageFingerprint: "f".repeat(64) }), /canonical admitted/);
    assert.equal(OcrPageReadingSchema.safeParse({ ...reading, extractionId: "f".repeat(64) }).success, false);
    assert.equal(OcrPageReadingSchema.safeParse({ ...reading, input: { ...reading.input, sourcePage: 0 } }).success, false);
    assert.equal(OcrPageAccountingSchema.safeParse({ manifest: { ...manifest, fingerprint: "f".repeat(64) },
      readingId: READING_ID, outcomes: inputs.map(input => donePage(input)) }).success, false);
    assert.equal(OcrPageAccountingSchema.safeParse({ manifest, readingId: "invalid", outcomes: inputs.map(input => donePage(input)) }).success, false);
    assert.throws(() => bindOcrPageReading(inputs[0], { ...reading.extraction,
      record: { ...reading.extraction.record, answers: [] } }));
    assert.equal(reading.extraction.readAt, READ_AT);
  });

  it("admits manual assertions without provider inference and refuses foreign operator or page bindings", () => {
    const { inputs } = sourceFixture();
    const manual = { ...submittedPage(inputs[0]), source: { kind: "operator", actorId: "local-operator" } };
    const reading = bindManualOcrPageReading(inputs[0], "local-operator", manual);
    assert.deepEqual(reading.extraction.source, manual.source);
    assert.equal(reading.extraction.record?.answers.find(answer => answer.path === "contact.address1")?.state, "absent");
    assert.throws(() => bindManualOcrPageReading(inputs[0], "another-operator", manual), /asserting operator/);
    assert.throws(() => bindManualOcrPageReading(inputs[1], "local-operator", manual), /exact source request/);
    assert.throws(() => bindManualOcrPageReading(inputs[0], "local-operator", submittedPage(inputs[0])), /asserting operator/);
    assert.throws(() => bindOcrPageReading(inputs[0], reading.extraction), /subscription provider/);
  });
});
