import { unusedWorkerPool } from "../../../support/helpers/backend/unused-worker-pool.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { createOperatorProjection } from "../../../../src/backend/app/composition/dashboard/queue.js";
import { createOperatorRunDetail } from "../../../../src/backend/app/composition/dashboard/run-detail.js";
import { composeShell } from "../../../../src/backend/app/composition/dashboard/shell.js";
import { projectWorkbookReferences } from "../../../../src/backend/workbooks/workbook-library-service.js";
import { descriptorSetHash, WORKFLOW_MODULES } from "../../../../src/backend/app/registries/workflow-registry.js";
import { createCommandKernel } from "../../../../src/backend/runs/commands/command-kernel.js";
import { buildOcrReviewSection } from "../../../../src/backend/runs/queries/ocr-review.js";
import { buildBootstrap } from "../../../../src/backend/runs/queries/bootstrap.js";
import { buildRunDetail } from "../../../../src/backend/runs/queries/run-detail.js";
import { authenticateRootRun } from "../../../../src/backend/storage/sqlite/delegation-root-authority.js";
import { createTransactionHistory } from "../../../../src/backend/storage/sqlite/transaction-history.js";
import { createDashboardClient } from "../../../../src/dashboard/client/index.js";
import { verifyOcrReviewEffect } from "../../../../src/dashboard/state/review-wiring-adapter.js";
import { correctedOcrRecord } from "../../../../src/dashboard/surfaces/run-detail/review/review-model.js";
import { CommandRequestSchema } from "../../../../src/rules/commands/commands.js";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { NO_INTAKE_PROJECTIONS, UNSTORED_CONFIG_IDENTITY, UNWIRED_INTAKE_PARSER } from "../../../support/fixtures/intake-kernel-seams.js";
import { healthyDashboardPreflightReport } from "../../../support/fixtures/preflight-seams.js";
import { WorkflowBootstrapPrimitiveSchema } from "../../../../src/models/dashboard/bootstrap.js";
import { ReviewPageSchema } from "../../../../src/models/dashboard/run-detail.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("projects editable native records, persists corrections/exclusions and freezes the exact approved view", async () => {
  const f = await world.fixture({ record: true, release: true, pageCount: 2 });
  const reader = f.canonical.lifecycle, { stateRoot } = f.harness.authority;
  const projection = createOperatorProjection({ database: f.database, stateRoot, clock: f.clock, reader, appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash([f.root.descriptor.contractFingerprint]), ledger: createTransactionHistory(f.database.authority), descriptors: { resolve: f.resolve } });
  projection.rebuildFromTimeline();
  const deps = createOperatorRunDetail({ database: f.database, stateRoot, projection, runReader: reader,
    canonical: { reader, database: f.database, descriptors: { resolve: f.resolve } } });
  const read = () => { const section = buildOcrReviewSection(deps, f.run.envelope.runId); assert.ok(section.section === "review"); return section.payload; };
  const initial = read(); assert.ok(initial.ocr?.editing?.state === "available" && initial.ocr.approval);
  assert.equal(buildRunDetail(deps, f.run.envelope.runId).ocrRecordCount, 2);
  const unused = (): never => { throw new Error("Unrequested fixture effect"); };
  const shell = composeShell({ database: f.database, projection, clock: f.clock, appVersion: "0.1.0", ids: { uuid: randomUUID },
    artifacts: f.artifacts, descriptors: { resolve: f.resolve }, descriptorSetHash: projection.descriptorSetHash(), actorLabel: () => "Fixture operator",
    preflightReport: () => healthyDashboardPreflightReport(f.clock), workbookReferences: workflows => projectWorkbookReferences(f.database.authority.workbooks, workflows),
    activity: { read: unused, readSelected: unused }, backfillGaps: { detected: unused } });
  try {
    const bootstrap = buildBootstrap(shell.bootstrap), workflows = WorkflowBootstrapPrimitiveSchema.array().parse(bootstrap.workflows);
    const ocr = workflows.find(workflow => workflow.id === "ocr");
    assert.ok(ocr);
    assert.equal(ocr.role.kind, "composition");
    assert.equal(ocr.start.inputRun, undefined);
    assert.equal(ocr.start.uploadRun, undefined);
    assert.equal(bootstrap.featureAvailability.some(feature => feature.feature === "ocr"), false);
    assert.equal(workflows.some(workflow => workflow.id === "ocr-page"), false);
    for (const { descriptor } of WORKFLOW_MODULES) assert.equal(workflows.filter(workflow => workflow.id === descriptor.id).length, 1);
  } finally { shell.hub.close(); }
  const evidence = structuredClone(initial.ocr.revision.seed);
  const record = initial.ocr.revision.records[0];
  const request = CommandRequestSchema.parse({ ...f.command("correct-ocr-record", 1), payload: correctedOcrRecord(initial, record.recordId,
    { "employee.name": "Example, Avery", "contact.name": "Served Contact", "employee.employeeId": "10800000" }) });
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async url => Response.json(
    new URL(url).pathname.endsWith("/review") ? { section: "review", payload: read() } : f.sources.commandResult(f.run.envelope.runId, request.commandId)) });
  assert.equal((await verifyOcrReviewEffect(client, request)).state, "matched");
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "conflict");
  let current = read(); assert.ok(current.ocr?.editing?.state === "available");
  assert.ok(current.ocr.editing.runVersion > initial.ocr.editing.runVersion);
  assert.equal(current.ocr.revision.revision, 2);
  assert.deepEqual(current.ocr.revision.seed, evidence);
  for (const [revision, type] of [[2, "discard-ocr-record"], [3, "restore-ocr-record"], [4, "discard-ocr-record"]] as const) {
    assert.equal(f.canonical.kernel.execute(f.command(type, revision, 1)).state, "applied");
    assert.equal(read().ocr?.revision.records[1].discarded, type === "discard-ocr-record");
  }
  const publicDescriptors = { resolve: (id: string) => id === "ocr" ? undefined : f.resolve(id) };
  const kernel = createCommandKernel({ authority: f.database, lifecycle: reader, clock: f.clock, ids: { uuid: randomUUID }, appVersion: "0.1.0",
    descriptors: publicDescriptors, readableDescriptors: { resolve: f.resolve }, configIdentity: UNSTORED_CONFIG_IDENTITY,
    intakeParser: UNWIRED_INTAKE_PARSER, intakeProjections: NO_INTAKE_PROJECTIONS, writeResolution: { recheck: unused, resolveAbsent: unused },
    workerRuntime: { pool: unusedWorkerPool(unused) } });
  const start = authenticateRootRun(f.database.authority, f.run).command;
  const refused = kernel.execute({ ...start, commandId: randomUUID() });
  assert.equal(refused.state, "rejected"); if (refused.state === "rejected") assert.equal(refused.code, "target-not-found");
  assert.equal(kernel.execute(f.approval([record.recordId])).state, "applied");
  current = read();
  assert.deepEqual(current.ocr?.editing, { state: "unavailable", reason: "approved" });
  assert.equal(current.ocr?.approval, undefined);
  assert.deepEqual(current.ocr?.revision.seed, evidence);
  assert.deepEqual(current.ocr?.approvedSnapshots[0].selectedRecordIds, [record.recordId]);
  const approved = current.ocr?.approvedSnapshots[0].records[0]; assert.ok(approved);
  const contact = approved.fields.answers.find(answer => answer.path === "contact.name"); assert.ok(contact?.state === "read");
  assert.equal(contact.value, "Served Contact");
  assert.equal(approved.assertedEid, "10800000");
});

it("authenticates an original correction after a later native revision replaces its value", async () => {
  const f = await world.fixture({ record: true, release: true });
  const reader = f.canonical.lifecycle, { stateRoot } = f.harness.authority;
  const projection = createOperatorProjection({ database: f.database, stateRoot, clock: f.clock, reader, appVersion: "0.1.0",
    descriptorSetHash: descriptorSetHash([f.root.descriptor.contractFingerprint]), ledger: createTransactionHistory(f.database.authority), descriptors: { resolve: f.resolve } });
  const deps = createOperatorRunDetail({ database: f.database, stateRoot, projection, runReader: reader,
    canonical: { reader, database: f.database, descriptors: { resolve: f.resolve } } });
  const read = () => { const section = buildOcrReviewSection(deps, f.run.envelope.runId); assert.ok(section.section === "review"); return section.payload; };
  const initial = read(); assert.ok(initial.ocr);
  const recordId = initial.ocr.revision.records[0].recordId;
  const original = CommandRequestSchema.parse({ ...f.command("correct-ocr-record", 1), payload: correctedOcrRecord(initial, recordId, { "contact.name": "Original Contact" }) });
  assert.equal(f.canonical.kernel.execute(original).state, "applied");
  const later = CommandRequestSchema.parse({ ...f.command("correct-ocr-record", 2), payload: correctedOcrRecord(read(), recordId, { "contact.name": "Later Native Edit" }) });
  assert.equal(f.canonical.kernel.execute(later).state, "applied");
  const recorded = f.sources.commandResult(f.run.envelope.runId, original.commandId); assert.ok(recorded.state === "recorded");
  assert.deepEqual(recorded.request, original);
  assert.equal(recorded.result.state, "applied");
  const client = createDashboardClient({ baseUrl: "http://fixture.test", fetchImpl: async url => Response.json(
    new URL(url).pathname.endsWith("/review") ? { section: "review", payload: read() } : f.sources.commandResult(f.run.envelope.runId, original.commandId)) });
  const verified = await verifyOcrReviewEffect(client, original);
  assert.equal(verified.state, "matched");
  const current = ReviewPageSchema.parse(verified.evidence); assert.ok(current.ocr);
  assert.equal(current.ocr.revision.revision, 3);
  const contact = current.ocr.revision.records[0].fields.answers.find(answer => answer.path === "contact.name"); assert.ok(contact?.state === "read");
  assert.equal(contact.value, "Later Native Edit");
});
