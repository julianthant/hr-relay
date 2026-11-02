import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { admitOcrExtraction, type AdmittedExtraction } from "../../../../src/models/ocr/extraction.js";
import { sourceFixture, submittedPage } from "../ocr/source-pages.js";

type OcrExtractionFault = "artifact-id" | "source-column" | "payload";

export function insertUnboundOcrExtraction(database: DatabaseSync, extraction: AdmittedExtraction, legacy = false, fault?: OcrExtractionFault) {
  const extractionId = `${extraction.sourceSha256}#${extraction.sourcePage}#${extraction.formType}`;
  const stored = { binding: "unbound-source", extractionId, extraction } as const;
  database.prepare(`INSERT INTO artifacts(id,kind,version,form_type,source_sha256,source_page,page_kind,page_fingerprint,source_kind,payload_json,created_at)
    VALUES(?,'extracted',1,?,?,?,?,?,?,?,?)`).run(fault === "artifact-id" ? "mismatched-artifact-id" : extractionId, extraction.formType,
    fault === "source-column" ? "f".repeat(64) : extraction.sourceSha256, extraction.sourcePage,
    extraction.pageKind, extraction.pageFingerprint, extraction.source.kind, JSON.stringify(fault === "payload" ? {} : legacy ? extraction : stored), extraction.readAt);
  return stored;
}

export function insertMalformedLegacyOcrExtraction(database: DatabaseSync, fault: OcrExtractionFault) {
  return insertUnboundOcrExtraction(database, { ...historicalOcrExtractions()[0], sourcePage: 6 }, true, fault);
}

export function historicalOcrExtractions(): AdmittedExtraction[] {
  const page = submittedPage(sourceFixture(1).inputs[0]);
  assert.ok(page.record);
  return [
    page,
    { ...page, sourcePage: 2, source: { kind: "local-agent", agentId: "fixture-reader", invocation: "fixture-invocation" } },
    { ...page, sourcePage: 3, source: { kind: "operator", actorId: "fixture-operator" } },
    { ...page, sourcePage: 4, pageKind: "blank", record: null },
    { ...page, sourcePage: 5, record: { answers: { ...page.record.answers,
      "contact.cellPhone": { state: "read", raw: "unreadable phone", confidence: 0.2 } } } },
  ].map(candidate => {
    const admitted = admitOcrExtraction(candidate);
    if (!admitted.admitted) throw new Error(admitted.problems.join("; "));
    return admitted.extraction;
  });
}
