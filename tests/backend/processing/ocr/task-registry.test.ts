import assert from "node:assert/strict";
import { describe,it } from "vitest";
import { z } from "zod";
import { OCR_EXTRACTION_RESPONSE_HASH } from "../../../../src/models/processing/ocr/extract-form-page.js";
import { extractFormPageTask } from "../../../../src/backend/processing/ocr/task-registry.js";
import { ArtifactRefSchema } from "../../../../src/models/artifacts/artifacts.js";
import { AdmittedExtractionSchema,type AdmittedExtraction } from "../../../../src/models/ocr/extraction.js";
import { sha256Hex } from "../../../../src/rules/validation/sha256.js";
import { OCR_FORM_TYPES, fieldOnPageKind, ocrForm, type OcrFormType } from "../../../../src/models/ocr/form-registry.js";

const PAGE_SHA = sha256Hex("fixture-oath-page");
const PAGE = ArtifactRefSchema.parse({
  id: "11111111-2222-4333-8444-555555555555",
  sha256: PAGE_SHA,
  bytes: 4096,
  mediaType: "image/png",
});
const RESPONSE_HASH = OCR_EXTRACTION_RESPONSE_HASH;
const OcrProviderRequestSchema = z.strictObject({
  schemaHash: z.string().min(1),
  value: z.strictObject({
    formType: z.literal("oath"),
    instruction: z.string().min(1),
    page: ArtifactRefSchema,
    sourcePage: z.number().int().positive(),
  }),
});
type TaskResult<Output, Metadata extends object> =
  | (Readonly<{ outcome: "success"; output: Output }> & Metadata)
  | (Readonly<{ outcome: "failure"; failure: Readonly<{ code: string; message: string }> }> & Metadata);

function completeAnswers() {
  return {
    formType: "oath",
    source: { kind: "provider", providerId: "chatgpt-subscription", modelId: "fixture-1" },
    readAt: "2026-08-06T09:00:00.000Z",
    sourceSha256: PAGE_SHA,
    sourcePage: 4,
    pageKind: "oath",
    record: {
      answers: {
        printedName: { state: "read", raw: "Example, Avery", confidence: 0.97 },
        employeeId: { state: "read", raw: "10800000", confidence: 0.93 },
        signatureDate: { state: "read", raw: "07/21/2026", confidence: 0.95 },
        employeeSigned: { state: "read", raw: "yes", confidence: 0.99 },
        officerSigned: { state: "read", raw: "yes", confidence: 0.98 },
      },
    },
  };
}

function taskCtx(response: unknown, sent: unknown[], recorded: unknown[]) {
  return {
    providers: {
      "ocr.extract": {
        capability: "ocr.extract",
        call: (payload: unknown) => {
          sent.push(payload);
          return Promise.resolve(response);
        },
      },
    },
    recordData: (point: unknown) => { recorded.push(point); },
    fail: (code: string, message: string) => {
      throw Object.assign(new Error(message), { code });
    },
  };
}

async function run(response: unknown, formType: OcrFormType = "oath"): Promise<TaskResult<AdmittedExtraction, Readonly<{ sent: unknown[]; recorded: unknown[] }>>> {
  const sent: unknown[] = [];
  const recorded: unknown[] = [];
  try {
    const output = AdmittedExtractionSchema.parse(await extractFormPageTask.impl.run({
      input: { formType, page: PAGE, sourcePage: 4 },
      ctx: taskCtx(response, sent, recorded) as never,
    }));
    return { outcome: "success" as const, output, sent, recorded };
  } catch (error) {
    const caught = error as Error & { code?: string };
    if (caught.code === undefined) throw error;
    return { outcome: "failure" as const, failure: { code: caught.code, message: caught.message }, sent, recorded };
  }
}

describe("OCR provider task wrapper", () => {
  it("sends the page request and returns a strictly admitted extraction with public facts", async () => {
    const result = await run({
      state: "produced",
      value: { schemaHash: RESPONSE_HASH, value: completeAnswers() },
    });
    if (result.outcome !== "success") throw new Error(`expected admitted extraction, received ${result.failure.code}`);

    assert.equal(result.sent.length, 1);
    const request = OcrProviderRequestSchema.parse(result.sent[0]);
    assert.equal(request.value.formType, "oath");
    assert.deepEqual(request.value.page, PAGE);
    assert.equal(request.value.sourcePage, 4);
    assert.match(request.value.instruction, /^# Extract: /u);
    assert.match(request.value.instruction, /`employeeId`/u);
    assert.match(request.value.instruction, /`signatureDate`/u);
    assert.equal(result.output.formType, "oath");
    assert.equal(result.output.source.kind, "provider");
    assert.equal(result.output.sourcePage, 4);
    assert.deepEqual(result.recorded, [[
      { direction: "read", field: "formType", value: "oath" },
      { direction: "read", field: "sourcePage", value: 4 },
      { direction: "read", field: "pageKind", value: "oath" },
      { direction: "read", field: "pageFingerprint", value: result.output.pageFingerprint },
      { direction: "read", field: "record", value: result.output.record },
      { direction: "read", field: "source", value: result.output.source },
      { direction: "read", field: "readAt", value: result.output.readAt },
      { direction: "read", field: "sourceSha256", value: result.output.sourceSha256 },
    ]]);
  });

  it("names an unreadable provider response without recording successful facts", async () => {
    const unreadable = await run({ state: "invalid-response", reason: "not JSON" });
    if (unreadable.outcome !== "failure") throw new Error("expected unreadable-page refusal");
    assert.equal(unreadable.failure.code, "unreadable-page");
    assert.deepEqual(unreadable.recorded, []);
  });

  it("names a partial answer as incomplete without recording successful facts", async () => {
    const complete = completeAnswers();
    const { signatureDate, ...answers } = complete.record.answers;
    assert.equal(signatureDate.state, "read");
    const partial = { ...complete, record: { ...complete.record, answers } };
    const incomplete = await run({
      state: "produced",
      value: { schemaHash: RESPONSE_HASH, value: partial },
    });
    if (incomplete.outcome !== "failure") throw new Error("expected incomplete-extraction refusal");
    assert.equal(incomplete.failure.code, "incomplete-extraction");
    assert.match(incomplete.failure.message, /every declared field/u);
    assert.deepEqual(incomplete.recorded, []);
  });
});

for (const formType of OCR_FORM_TYPES) {
  const form = ocrForm(formType);
  for (const pageKind of [...form.pageKinds, "boilerplate", "unrelated", "blank"] as const) {
    it(`records the complete admitted ${formType}/${pageKind} output`, async () => {
      const result = await run({
        state: "produced",
        value: { schemaHash: RESPONSE_HASH, value: {
          ...completeAnswers(), formType, pageKind,
          record: form.pageKinds.includes(pageKind) ? { answers: Object.fromEntries(form.fields.map(field => [field.path,
            { state: "absent", reason: fieldOnPageKind(field, pageKind) ? "blank" : "not-on-form" },
          ])) } : null,
        } },
      }, formType);
      assert.equal(result.outcome, "success");
      if (result.outcome !== "success") throw new Error("expected admitted form page");
      assert.equal(result.output.formType, formType);
      assert.equal(result.output.pageKind, pageKind);
      assert.equal(result.output.record === null, !form.pageKinds.includes(pageKind));
      const fields = ["formType", "sourcePage", "pageKind", "pageFingerprint", "record", "source", "readAt", "sourceSha256"] as const;
      assert.deepEqual(result.recorded, [fields.map(field => ({ direction: "read", field, value: result.output[field] }))]);
    });
  }
}

it("propagates the disconnected OCR result through the extraction task without evidence", async () => {
  const result = await run({ state: "unavailable", reason: { code: "adapter-unavailable", message: "OCR provider not connected" } });
  assert.equal(result.outcome, "failure");
  if (result.outcome !== "failure") throw new Error("expected disconnected extraction");
  assert.deepEqual(result.failure, { code: "provider-unavailable", message: "the ocr.extract provider is unavailable (adapter-unavailable): OCR provider not connected" });
  assert.deepEqual(result.recorded, []);
});

for (const field of ["formType", "sourcePage", "sourceSha256", "source", "schemaHash"] as const) it(`refuses a provider result with a different ${field}`, async () => {
  const candidate = completeAnswers();
  const value = field === "formType" ? { ...candidate, formType: "emergency-contact", pageKind: "blank", record: null }
    : field === "sourcePage" ? { ...candidate, sourcePage: 1 }
    : field === "sourceSha256" ? { ...candidate, sourceSha256: "b".repeat(64) }
    : field === "source" ? { ...candidate, source: { kind: "provider", providerId: "other", modelId: "other" } } : candidate;
  const result = await run({ state: "produced", value: { schemaHash: field === "schemaHash" ? "b".repeat(64) : RESPONSE_HASH, value } });
  assert.equal(result.outcome, "failure");
  if (result.outcome !== "failure") throw new Error("expected identity refusal");
  assert.equal(result.failure.code, "unreadable-page"); assert.deepEqual(result.recorded, []);
});
