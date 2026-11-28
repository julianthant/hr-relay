import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { pdfRunOcrFooter, pdfRunOfferedFields, previewPdfRun, restorePdfRun } from "../../../../src/dashboard/surfaces/run-start/run-start-pdfs.js";
import { EmergencyContactInputSchema } from "../../../../src/models/workflows/emergency-contact/input.js";
import { I9CheckStartInput } from "../../../../src/models/workflows/i9-check/start.js";
import { emergencyContactWorkflow } from "../../../../src/workflows/emergency-contact/workflow.js";
import { i9CheckStartWorkflow } from "../../../../src/workflows/i9-check-start/workflow.js";
import { compileWorkflow } from "../../../../src/workflow-kit/workflow-definition.js";
import type { OcrFormType } from "../../../../src/models/ocr/form-registry.js";

const ACTOR = "local-operator";
const READING_A = "00000000-0000-4000-8000-0000000000a1", READING_B = "00000000-0000-4000-8000-0000000000b1";
const pdf = (digit: string) => ({ id: `00000000-0000-4000-8000-00000000000${digit}`, mediaType: "application/pdf", bytes: 12, sha256: digit.repeat(64) });
const manual = (formType: OcrFormType, sha256: string, actorId = ACTOR) => ({ kind: "manual", actorId, assertions: [{ sourcePage: 1, extraction: {
  formType, source: { kind: "operator", actorId }, readAt: "2026-11-01T00:00:00.000Z", sourceSha256: sha256, sourcePage: 1, pageKind: "blank", record: null, pageFingerprint: "f".repeat(64) } }] });
function surfaceOf(workflow: Parameters<typeof compileWorkflow>[0]) {
  const surface = compileWorkflow(workflow).descriptor.surfaces.uploadRun; assert.ok(surface); return surface;
}
const i9 = surfaceOf(i9CheckStartWorkflow), contact = surfaceOf(emergencyContactWorkflow);
const i9Run = (actorId = ACTOR) => ({ asOf: "2026-10-01", reviewerName: "Example Reviewer", documents: [
  { document: pdf("1"), fileName: "one.pdf", readingId: READING_A, reading: manual("i9", "1".repeat(64), actorId) },
  { document: pdf("2"), fileName: "two.pdf", readingId: READING_B, reading: { kind: "subscription" } }] });
const contactRun = { document: pdf("3"), fileName: "three.pdf", readingId: READING_A, roster: null, onbaseFiling: "file", reading: manual("emergency-contact", "3".repeat(64)) };
function resubmit(surface: typeof i9, value: unknown, picks = {}) {
  const restored = restorePdfRun(surface, value, ACTOR); assert.ok(restored);
  const { submissions } = previewPdfRun(surface, restored.draft, { ...restored.picks, ...picks });
  assert.equal(submissions.length, 1);
  return submissions[0];
}

describe("the original PDF input of a rerun", () => {
  it("keeps each I-9 PDF's own reading, under a new reading ID", () => {
    const value = i9Run(), sent = I9CheckStartInput.parse(resubmit(i9, value));
    assert.deepEqual({ ...sent, documents: sent.documents.map(({ readingId: _readingId, ...document }) => document) },
      { ...value, documents: value.documents.map(({ readingId: _readingId, ...document }) => document) });
    const ids = sent.documents.map(({ readingId }) => readingId);
    assert.equal(new Set([...ids, READING_A, READING_B]).size, 4);
  });

  it("keeps a single PDF's reading and choices, adding no default the source left out", () => {
    const sent = resubmit(contact, contactRun);
    const { readingId } = EmergencyContactInputSchema.parse(sent);
    assert.deepEqual(sent, { ...contactRun, readingId });
    assert.notEqual(readingId, contactRun.readingId);
  });

  it("sends a choice made on the Start page over the original one", () => {
    assert.equal(EmergencyContactInputSchema.parse(resubmit(contact, contactRun, { onbaseFiling: "skip" })).onbaseFiling, "skip");
  });

  it("is not reused when another operator asserted the reading", () => {
    assert.equal(restorePdfRun(i9, i9Run("someone-else"), ACTOR), null);
    assert.equal(restorePdfRun(contact, { ...contactRun, reading: manual("emergency-contact", "3".repeat(64), "someone-else") }, ACTOR), null);
  });

  it("offers no OCR choice and names the reading when the original was read manually", () => {
    const state = (surface: typeof i9, value: unknown) => {
      const restored = restorePdfRun(surface, value, ACTOR); assert.ok(restored);
      return [pdfRunOfferedFields(surface, restored.draft).map(({ field }) => field), pdfRunOcrFooter(surface, restored.draft, restored.picks)];
    };
    assert.deepEqual(state(contact, contactRun), [["onbaseFiling"], "Manual reading"]);
    assert.deepEqual(state(contact, { ...contactRun, reading: { kind: "subscription" } }), [["onbaseFiling", "extractWithOcr"], "OCR on"]);
    assert.deepEqual(state(contact, { ...contactRun, reading: { kind: "subscription" }, extractWithOcr: false }), [["onbaseFiling", "extractWithOcr"], "OCR off"]);
    assert.equal(state(i9, i9Run())[1], "OCR on", "one of its PDFs is still read");
    assert.equal(state(i9, { ...i9Run(), documents: [i9Run().documents[0]] })[1], "Manual reading");
    assert.deepEqual([pdfRunOfferedFields(contact, null).length, pdfRunOcrFooter(contact, null, {})], [2, "OCR on"]);
  });

  it("is not reused when a manual reading was started with OCR off, which the run refuses", () => {
    assert.equal(restorePdfRun(contact, { ...contactRun, extractWithOcr: false }, ACTOR), null);
  });

  it("reads a PDF of its own afresh when no original stands behind it", () => {
    const restored = restorePdfRun(i9, i9Run(), ACTOR); assert.ok(restored);
    const added = { source: restored.draft.files[0].source, readingId: READING_B };
    const { submissions } = previewPdfRun(i9, { ...restored.draft, files: [added] });
    assert.deepEqual(I9CheckStartInput.parse(submissions[0]).documents.map(({ reading }) => reading), [{ kind: "subscription" }]);
  });
});
