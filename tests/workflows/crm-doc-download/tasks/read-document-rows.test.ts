import assert from "node:assert/strict";
import { it } from "vitest";
import { ReadCrmDocumentRows } from "../../../../src/models/workflows/crm-doc-download/read-document-rows.js";
import { readCrmDocumentRowsTask } from "../../../../src/workflows/crm-doc-download/tasks/read-document-rows.js";
import { evidenceLeaves, classifyEvidenceLeaf } from "../../../../src/models/trust/evidence-classification.js";
import { redactValue } from "../../../../src/rules/redaction/redaction.js";
import { createSeparationTaskFixtures, TaskRefusal } from "../../../support/helpers/separation-task-fixtures.js";
import { CRM_DOCUMENT_RECORDS_FIXTURE, crmDocumentReferenceFixture } from "../../../support/fixtures/crm-doc-download.js";

it("records every resolved reference fact and withholds identities and names from provider disclosure", async () => {
  const f = createSeparationTaskFixtures().taskContext();
  const output = await readCrmDocumentRowsTask.impl.run({ input: ReadCrmDocumentRows.input.parse({
    records: CRM_DOCUMENT_RECORDS_FIXTURE, sources: [{ referenceDigest: "a".repeat(64), reference: crmDocumentReferenceFixture() }],
  }), ctx: f.ctx });
  assert.equal(output.state, "resolved");
  const leaves = evidenceLeaves(output);
  assert.deepEqual(f.records.map(point => [point.field, point.value]), leaves.map(leaf => [leaf.path, leaf.value]));
  const disclosed = leaves.map(leaf => {
    const declared = classifyEvidenceLeaf({ kind: "task-output", taskId: ReadCrmDocumentRows.id }, leaf.path);
    return redactValue(declared.classification, declared.transform, leaf.value);
  });
  assert.doesNotMatch(JSON.stringify(disclosed), /Fixture|example\.test|July 6|row-0/u);
});

it("retains missing rows explicitly and refuses corrupt names without successful observations", async () => {
  const reference = crmDocumentReferenceFixture(), first = reference.snapshot.rows[0]; assert.ok(first);
  first.state = "missing"; first.matches = [];
  const f = createSeparationTaskFixtures().taskContext();
  const input = ReadCrmDocumentRows.input.parse({ records: CRM_DOCUMENT_RECORDS_FIXTURE, sources: [{ referenceDigest: "a".repeat(64), reference }] });
  const output = await readCrmDocumentRowsTask.impl.run({ input, ctx: f.ctx });
  assert.equal(output.state, "resolve-required");
  assert.deepEqual(output.people[0]?.resolution, { state: "resolve-required", reason: "row-missing", candidates: [] });
  const invalid = crmDocumentReferenceFixture(), match = invalid.snapshot.rows[0]?.matches[0]; assert.ok(match);
  match.values.firstName = null;
  const bad = createSeparationTaskFixtures().taskContext();
  await assert.rejects(readCrmDocumentRowsTask.impl.run({ input: ReadCrmDocumentRows.input.parse({
    ...input, sources: [{ referenceDigest: "a".repeat(64), reference: invalid }],
  }), ctx: bad.ctx }),
    error => error instanceof TaskRefusal && error.code === "CRM_DOCUMENT_REFERENCE_UNAVAILABLE");
  assert.deepEqual(bad.records, []);
});
