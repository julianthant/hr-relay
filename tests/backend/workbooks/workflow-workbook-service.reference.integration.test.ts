import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { createWorkbookLibraryRepository, WORKBOOK_LIBRARY_MIGRATION, WORKBOOK_MASTER_MIGRATION, WORKBOOK_LIBRARY_CATALOG_MIGRATION } from "../../../src/backend/storage/sqlite/workbook-library-repository.js";
import { createWorkbookLibraryService, readRetainedWorkbookReference } from "../../../src/backend/workbooks/workbook-library-service.js";
import { createWorkbookLibraryAdapter } from "../../../src/backend/processing/providers/workbook-library-adapter.js";
import { createProviderClient } from "../../../src/backend/processing/providers/provider-client.js";
import { readWorkbookReferenceTask } from "../../../src/backend/processing/workbooks/tasks/read-reference.js";
import { ReadWorkbookReference, WorkbookReferenceReadRequestSchema, decodeWorkbookReference } from "../../../src/models/processing/workbooks/read-reference.js";
import { RunWorkbookNamedReferenceSchema } from "../../../src/models/dashboard/workbooks.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { ONBOARDING_ROSTER_TYPE_ID } from "../../../src/models/workflows/onboarding/roster.js";
import { CRM_DOCUMENT_ROSTER_FIELDS } from "../../../src/models/workflows/crm-doc-download/documents.js";
import { crmDocumentReferenceKeys, resolveCrmDocumentRows } from "../../../src/rules/crm-doc-download/reference.js";
import { manualClock } from "../../../src/rules/time/clock.js";
import { createTaskProvenanceCollector } from "../../../src/backend/runs/provenance/task-provenance.js";
import { classifyEvidenceLeaf, evidenceLeaves } from "../../../src/models/trust/evidence-classification.js";
import { compileFixtureWorkflow } from "../../support/fixtures/workflow-definition-fixtures.js";
import { createSearchWorkflowDefinitionFixtures } from "../../support/helpers/search-workflow-definition-fixtures.js";
import { CONFIG_SNAPSHOT } from "../../support/fixtures/phase1c-contract-fixtures.js";
import { unexpectedWorkbookSync } from "../../support/helpers/backend/workbook-sync.js";
import { CRM_DOCUMENT_RECORDS_FIXTURE, crmDocumentReferenceFixture, crmDocumentWorkbookFixture } from "../../support/fixtures/crm-doc-download.js";

const databases: DatabaseSync[] = [];
afterEach(() => { for (const database of databases.splice(0)) database.close(); });
const runId = "00000000-0000-4000-8000-000000000001", signal = new AbortController().signal;

async function fixture(duplicate = false) {
  const database = new DatabaseSync(":memory:"); databases.push(database);
  for (const sql of [...WORKBOOK_LIBRARY_MIGRATION.statements, ...WORKBOOK_MASTER_MIGRATION.statements, ...WORKBOOK_LIBRARY_CATALOG_MIGRATION.statements]) database.exec(sql);
  database.exec("CREATE TABLE runs (id TEXT PRIMARY KEY,state TEXT NOT NULL,lifecycle_json TEXT NOT NULL); CREATE TABLE run_requests (id TEXT PRIMARY KEY,payload_json TEXT NOT NULL)");
  const transaction = <T>(work: () => T) => { database.exec("BEGIN IMMEDIATE");
    try { const result = work(); database.exec("COMMIT"); return result; } catch (cause) { database.exec("ROLLBACK"); throw cause; } };
  const repository = createWorkbookLibraryRepository({ database, read: transaction, mutate: work => transaction(() => work().result) });
  const clock = manualClock(new Date("2026-11-03T00:00:00Z"));
  const service = createWorkbookLibraryService({ repository, clock, sync: unexpectedWorkbookSync });
  const reference = crmDocumentReferenceFixture();
  const workbook = service.create(crmDocumentWorkbookFixture(duplicate));
  service.putType({ ...reference.snapshot.type, defaultWorkbookId: null });
  service.operatorOperation(workbook.libraryId, "type", { kind: "metadata", expectedVersion: 1, metadata: { typeId: ONBOARDING_ROSTER_TYPE_ID, sharePoint: null } });
  service.putType({ ...reference.snapshot.type, defaultWorkbookId: workbook.libraryId });
  await service.libraryAction(workbook.libraryId, { operationId: "older", expectedRevision: repository.libraryState(workbook.libraryId).revision,
    expectedVersion: service.read(workbook.libraryId).version, change: { kind: "create-version", name: "Earlier named roster", from: { kind: "version", versionId: "original" }, useNow: false } }, signal);
  const request = { typeId: ONBOARDING_ROSTER_TYPE_ID, libraryId: workbook.libraryId, versionId: "older", keys: ["two@example.test"], fields: [...CRM_DOCUMENT_ROSTER_FIELDS] };
  const bound = { schemaHash: deriveSchemaHash(RunWorkbookNamedReferenceSchema, "output"), value: RunWorkbookNamedReferenceSchema.parse({ request, snapshot: repository.snapshot(request) }) };
  const command = { typeId: ONBOARDING_ROSTER_TYPE_ID, keys: crmDocumentReferenceKeys(CRM_DOCUMENT_RECORDS_FIXTURE) };
  return { database, repository, clock, service, workbook, bound, command };
}

it("reads EID-learned emails from an explicit older version after editable-head changes without changing the captured selection", async () => {
  const f = await fixture(), edited = structuredClone(f.workbook.workbook);
  const firstName = edited.sheets[0]?.rows[1]?.cells[1]; assert.ok(firstName); firstName.value = "Editable head";
  f.service.save(f.workbook.libraryId, f.service.read(f.workbook.libraryId).version, edited);
  assert.notEqual(f.repository.libraryState(f.workbook.libraryId).selectedVersionId, "older");
  const output = readRetainedWorkbookReference(f.repository, f.bound, f.command), reference = decodeWorkbookReference(output.reference);
  assert.equal(reference.snapshot.versionId, "older"); assert.equal(reference.snapshot.versionName, "Earlier named roster");
  assert.deepEqual(reference.snapshot.rows.map(row => [row.key, row.state]), [["one@example.test", "matched"], ["two@example.test", "matched"], ["other@example.test", "missing"]]);
  assert.equal(reference.snapshot.rows[0]?.matches[0]?.values.firstName, "Legal");
  assert.equal(output.sources.length, 1);
  assert.equal(output.sources[0]?.referenceDigest, output.referenceDigest);
  assert.deepEqual(resolveCrmDocumentRows(CRM_DOCUMENT_RECORDS_FIXTURE, [{ referenceDigest: output.referenceDigest, reference }]).map(person => person.resolution.state), ["resolved", "resolved"]);
  assert.deepEqual(f.bound.value.snapshot.rows.map(row => row.key), ["two@example.test"]);
});

it("preserves duplicate and missing row states and refuses unavailable or corrupted retained versions", async () => {
  const f = await fixture(true), reference = decodeWorkbookReference(readRetainedWorkbookReference(f.repository, f.bound, f.command).reference);
  assert.equal(reference.snapshot.rows[0]?.state, "ambiguous"); assert.equal(reference.snapshot.rows[2]?.state, "missing");
  const corrupted = structuredClone(f.bound), sheet = corrupted.value.snapshot.worksheets[0]; assert.ok(sheet); sheet.name = "Changed";
  assert.throws(() => readRetainedWorkbookReference(f.repository, corrupted, f.command), error => error instanceof Error && "code" in error && error.code === "WORKBOOK_STORAGE_CORRUPT");
  await f.service.libraryAction(f.workbook.libraryId, { operationId: "delete", expectedRevision: f.repository.libraryState(f.workbook.libraryId).revision,
    expectedVersion: f.service.read(f.workbook.libraryId).version, change: { kind: "delete-version", versionId: "older" } }, signal);
  assert.throws(() => readRetainedWorkbookReference(f.repository, f.bound, f.command), error => error instanceof Error && "code" in error && error.code === "WORKBOOK_REVISION_UNAVAILABLE");
  for (const extra of [{ libraryId: "caller" }, { versionId: "original" }, { fields: ["email"] }]) assert.equal(WorkbookReferenceReadRequestSchema.safeParse({ ...f.command, ...extra }).success, false);
});

it("workbooks/read-reference — executes the real provider client/task and records every immutable reference leaf", async () => {
  const f = await fixture(), { fixtureWorkflow } = createSearchWorkflowDefinitionFixtures();
  const { descriptor } = compileFixtureWorkflow(fixtureWorkflow("reference-fixture", ({ task, result }) => {
    const read = task({ id: "reference", contract: ReadWorkbookReference, replay: "checkpoint" }, [], () => f.command);
    return { steps: [[{ key: "reference", label: "Reference" }, [read]]], result: result(ReadWorkbookReference.output, [read], ({ outputs }) => outputs.reference) };
  }));
  const adapter = createWorkbookLibraryAdapter({ ...f, runId, references: { runId, read: command => readRetainedWorkbookReference(f.repository, f.bound, command),
    write: () => { throw new Error("read proof must not write workbook cells"); } } });
  const client = createProviderClient("workbooks.library", { execution: { runId, attempt: 1, nodeId: "reference", taskId: ReadWorkbookReference.id }, configSnapshot: CONFIG_SNAPSHOT,
    configSnapshotId: CONFIG_SNAPSHOT.configSnapshotId, configFingerprint: CONFIG_SNAPSHOT.fingerprint, runSignal: signal, adapters: { "workbooks.library": adapter }, clock: f.clock,
    idFactory: { next: randomUUID }, deadlineScheduler: { schedule: () => ({ cancel: () => undefined }) } });
  const collector = createTaskProvenanceCollector({ descriptor, execution: { runId, traceId: "fx-000000-0001", attempt: 1, workflowId: descriptor.id, nodeId: "reference", taskId: ReadWorkbookReference.id },
    upstreamEvidence: { checkpoints: [] }, clock: f.clock, onRecord: () => undefined });
  const output = await readWorkbookReferenceTask.impl.run({ input: f.command, ctx: { signal, providers: { "workbooks.library": client },
    log: { debug() {}, info() {}, warn() {} }, fail: (code, message): never => { throw new Error(`${code}: ${message}`); }, recordData: collector.recordData } });
  assert.equal(output.reference.snapshot.versionId, "older");
  for (const leaf of evidenceLeaves(output)) classifyEvidenceLeaf({ kind: "task-output", taskId: ReadWorkbookReference.id }, leaf.path);
  assert.ok(collector.finalizeRead(output).provenance.every(field => field.source === "live"));
});
