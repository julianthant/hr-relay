import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { admitOcrExtraction, type AdmittedExtraction } from "../../../../src/models/ocr/extraction.js";
import { sourceFixture, submittedPage } from "../ocr/source-pages.js";

export function insertUnboundOcrExtraction(database: DatabaseSync, extraction: AdmittedExtraction, legacy = false) {
  const extractionId = `${extraction.sourceSha256}#${extraction.sourcePage}#${extraction.formType}`;
  const stored = { binding: "unbound-source", extractionId, extraction } as const;
  database.prepare(`INSERT INTO artifacts(id,kind,version,form_type,source_sha256,source_page,page_kind,page_fingerprint,source_kind,payload_json,created_at)
    VALUES(?,'extracted',1,?,?,?,?,?,?,?,?)`).run(extractionId, extraction.formType, extraction.sourceSha256, extraction.sourcePage,
    extraction.pageKind, extraction.pageFingerprint, extraction.source.kind, JSON.stringify(legacy ? extraction : stored), extraction.readAt);
  return stored;
}

export function corruptLegacyOcrExtraction(database: DatabaseSync, fault: "artifact-id" | "source-column" | "payload") {
  const trigger = database.prepare("SELECT sql FROM sqlite_master WHERE name='artifacts_extracted_immutable'").get()?.sql;
  assert.ok(typeof trigger === "string");
  database.exec("DROP TRIGGER artifacts_extracted_immutable");
  try {
    const column = fault === "artifact-id" ? "id" : fault === "source-column" ? "source_sha256" : "payload_json";
    const value = fault === "artifact-id" ? "mismatched-artifact-id" : fault === "source-column" ? "f".repeat(64) : "{}";
    database.prepare(`UPDATE artifacts SET ${column}=? WHERE kind='extracted' AND source_page=1`).run(value);
  } finally { database.exec(trigger); }
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
