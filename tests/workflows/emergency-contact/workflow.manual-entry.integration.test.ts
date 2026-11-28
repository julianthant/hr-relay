import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { afterEach, it } from "vitest";
import { childWorkflowModuleOf, DESCRIPTORS } from "../../../src/backend/app/registries/workflow-registry.js";
import { readOcrReviewAuthority } from "../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { RunRecordService } from "../../../src/backend/runs/lifecycle/run-record-service.js";
import { AuthorityDatabase } from "../../../src/backend/storage/sqlite/authority-database.js";
import { createDeterministicContactPersistence } from "../../../src/backend/systems/ucpath/driver/contact-fake.js";
import { createDeterministicUcpathPersonOrgDriver } from "../../../src/backend/systems/ucpath/driver/fake.js";
import { ocrReviewDigest, operatorOcrFields } from "../../../src/models/ocr/review.js";
import { OcrOperatorPagesSchema } from "../../../src/models/ocr/review-record.js";
import { RunDelegatedDryRunPreviewResultSchema } from "../../../src/models/run/result.js";
import { deriveSchemaHash } from "../../../src/models/validation/schema-bound-value.js";
import { UcpathContactPageSnapshotSchema } from "../../../src/models/ui/ucpath-emergency-contact.js";
import { EmergencyContactMemberInputSchema } from "../../../src/models/workflows/emergency-contact-member/input.js";
import { EmergencyContactInputSchema } from "../../../src/models/workflows/emergency-contact/input.js";
import { OcrInputSchema } from "../../../src/models/workflows/ocr/input.js";
import { accountOcrPages, OcrPageAccountingSchema, ocrExtractionItemId } from "../../../src/models/workflows/ocr/page-accounting.js";
import { OcrApprovalReferenceSchema } from "../../../src/models/workflows/ocr/result.js";
import { hydrateOcrReviewSeed, OcrReviewCheckpointSchema, OcrReviewSeedSchema } from "../../../src/models/workflows/ocr/review-seed.js";
import { boundProfileCredentials } from "../../support/helpers/admission-fixture.js";
import { createOcrReviewWorld } from "../../support/helpers/backend/ocr-review-world.js";
import { healthyCrmDriver, sessionFactoryHarness } from "../../support/helpers/phase1f-executor-harness.js";
import { READING_ID, SOURCE_RUN_ID, sourceFixture, submittedPage } from "../../support/fixtures/ocr/source-pages.js";
import contactPage from "../../support/fixtures/ui/ucpath/emergency-contact.fixture.json";

const world = createOcrReviewWorld();
afterEach(world.cleanup);

it("parses the existing stored review and checkpoint unchanged and keeps reading accounting strict", () => {
  const { manifest, inputs } = sourceFixture(1);
  const stored = { sourceRunId: SOURCE_RUN_ID, formType: "emergency-contact",
    accounting: { formType: "emergency-contact", manifest, readingId: READING_ID, outcomes: [{ state: "failed",
      runId: "00000000-0000-4000-8000-000000000301", itemId: ocrExtractionItemId(inputs[0]),
      failureId: "00000000-0000-4000-8000-000000000777" }] },
    roster: null, pages: [{ sourcePage: 1, disposition: "failed" }],
    grouping: { formType: "emergency-contact", subjects: [], unidentified: [], otherForms: [], dataless: [] }, records: [] };
  const storedInput = { document: manifest.document, readingId: READING_ID, formType: "emergency-contact", roster: null,
    approval: "review-only", reading: { kind: "subscription" } };
  assert.deepEqual(OcrInputSchema.parse(storedInput), storedInput);
  assert.deepEqual(OcrPageAccountingSchema.parse(stored.accounting), stored.accounting);
  assert.deepEqual(OcrReviewSeedSchema.parse(stored), stored);
  const checkpoint = OcrReviewCheckpointSchema.parse(stored);
  assert.deepEqual(checkpoint, stored);
  assert.deepEqual(hydrateOcrReviewSeed(checkpoint, () => assert.fail("A failed page has no reading"), null), stored);
  assert.throws(() => accountOcrPages(manifest, READING_ID, []));
  assert.equal(OcrPageAccountingSchema.safeParse({ ...stored.accounting, manifest: sourceFixture(2).manifest }).success, false);
  assert.equal(OcrPageAccountingSchema.safeParse({ ...stored.accounting, manualEntry: true }).success, false);
  assert.equal(OcrPageAccountingSchema.safeParse({ ...stored.accounting, formType: "i9", manualEntry: true, outcomes: [] }).success, false);
});

it.each([undefined, true])("keeps page readings and their records when Extract with OCR is %s", async extractWithOcr => {
  const f = await world.fixture({ coordinator: true, pageCount: 2, record: true, onbaseFiling: "skip",
    ...(extractWithOcr === undefined ? {} : { extractWithOcr }) });
  const review = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(review);
  assert.equal("manualEntry" in review.seed.review.accounting, false);
  assert.equal(review.seed.review.accounting.outcomes.length, 2);
  assert.equal(review.records.length, 2);
  assert.deepEqual(f.pageReads.toSorted(), [1, 2]);
  assert.equal(f.database.authority.runs.listChildren(f.run.envelope.runId).filter(run => run.envelope.workflow === "ocr-page").length, 2);
});

it("retains a failed reading without switching to manual-entry review", async () => {
  const f = await world.fixture({ coordinator: true, record: true, extractWithOcr: true, pageCount: 2, failManualPageOnce: 2, onbaseFiling: "skip" });
  const review = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(review);
  assert.equal("manualEntry" in review.seed.review.accounting, false);
  assert.deepEqual(review.seed.review.pages, [{ sourcePage: 1, disposition: "record" }, { sourcePage: 2, disposition: "failed" }]);
  assert.equal(review.seed.review.accounting.outcomes.length, 2);
  assert.deepEqual(f.pageReads.toSorted(), [1, 2]);
});

it("keeps hand-entered records after refused Retry at the gate and a database restart", async () => {
  const f = await world.fixture({ coordinator: true, extractWithOcr: false, onbaseFiling: "skip" });
  const command = { commandId: randomUUID(), requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator",
    source: "dashboard", family: "ocr-review", type: "add-ocr-record",
    target: { runId: f.run.envelope.runId, expectedRevision: 1 },
    payload: { pages: [{ pageKind: "emergency-contact", sourcePage: 1 }] } };
  assert.equal(f.canonical.kernel.execute(command).state, "applied");
  const review = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(review);
  assert.equal(review.records.length, 1);
  const current = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(current?.lifecycle.state === "parked-gate");
  assert.equal(f.canonical.kernel.execute({ commandId: randomUUID(), requestedAt: f.clock.now().toISOString(),
    requestedBy: "local-operator", source: "run-detail", family: "run", type: "retry",
    target: { runId: current.envelope.runId, expectedVersion: current.version } }).state, "rejected");
  assert.deepEqual(f.database.authority.ocrReviews.latest(f.run.envelope.runId), review);
  assert.equal(f.canonical.kernel.execute(command).state, "already-applied");
  await f.harness.manager.closeAll("worker-stop");
  f.database.close();
  const reopened = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 500, migrationOwner: "ocr-manual-entry-restart" },
    f.clock, undefined, undefined, undefined, boundProfileCredentials(f.admission));
  f.harness.authority.replaceClosedDatabase(reopened);
  const reader = new RunRecordService({ database: reopened, clock: f.clock, ids: { uuid: randomUUID },
    publishQueued: () => assert.fail("Restart must not enqueue a run") });
  const retained = readOcrReviewAuthority(reopened.authority, reader, f.run.envelope.runId); assert.ok(retained);
  assert.deepEqual(retained.revision, review);
  assert.deepEqual(retained.run.lifecycle, current.lifecycle);
  assert.equal(f.ocrCalls(), 0);
});

it("refuses empty approval with a plain sentence and keeps the manual-entry review open", async () => {
  const f = await world.fixture({ coordinator: true, extractWithOcr: false, onbaseFiling: "skip" });
  const review = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(review);
  const current = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(current);
  const commandId = randomUUID();
  assert.throws(() => f.canonical.kernel.execute({ commandId, requestedAt: f.clock.now().toISOString(),
    requestedBy: "local-operator", source: "dashboard", family: "gate", type: "resolve-gate",
    target: { runId: current.envelope.runId, gateId: "approve-records", expectedVersion: current.version },
    payload: { result: { schemaHash: deriveSchemaHash(OcrApprovalReferenceSchema, "output"), value: {
      snapshotId: commandId, sourceRunId: current.envelope.runId, revision: review.revision, digest: "a".repeat(64),
    } }, ocrApproval: { expectedRevision: review.revision, reviewDigest: ocrReviewDigest(review), selectedRecordIds: [] } },
  }), /Select at least one record to approve\./u);
  assert.deepEqual(f.database.authority.ocrReviews.latest(f.run.envelope.runId), review);
  assert.deepEqual(f.database.authority.runs.get(f.run.envelope.runId), current);
  assert.deepEqual(f.database.authority.ocrReviews.snapshots(f.run.envelope.runId), []);
});

it.each([false, true])("starts Emergency Contact without OCR, reviews every page and releases a hand-entered member (dryRun=%s)", async dryRun => {
  let ticks = Date.parse(contactPage.page.observedAt);
  const persistence = createDeterministicContactPersistence(UcpathContactPageSnapshotSchema.parse({ ...contactPage.page,
    displayedEid: "10800001", displayedName: "Example, Manual" }), () => new Date(++ticks).toISOString());
  const sessions = sessionFactoryHarness({ ucpath: () => {
    const session = persistence.session();
    return createDeterministicUcpathPersonOrgDriver(undefined, undefined, session.port, session.save);
  }, crm: healthyCrmDriver });
  const f = await world.fixture({ coordinator: true, extractWithOcr: false, pageCount: 2, onbaseFiling: "skip", dryRun, fileName: "source.pdf",
    sessions, operatorEvidence: true, member: childWorkflowModuleOf("emergency-contact", "emergency-contact-member") });
  assert.equal(EmergencyContactInputSchema.parse(f.parentRun.input.parsed.value).extractWithOcr, false);
  assert.equal(OcrInputSchema.parse(f.run.input.parsed.value).extractWithOcr, false);
  const current = f.database.authority.runs.get(f.run.envelope.runId);
  assert.ok(current?.lifecycle.state === "parked-gate" && current.lifecycle.gateId === "approve-records");
  const review = f.database.authority.ocrReviews.latest(f.run.envelope.runId);
  assert.ok(review);
  assert.deepEqual(review.records, []);
  assert.deepEqual(review.seed.review.accounting.outcomes, []);
  assert.ok("manualEntry" in review.seed.review.accounting && review.seed.review.accounting.manualEntry);
  assert.deepEqual(review.seed.review.pages, [{ sourcePage: 1, disposition: "manual-entry" }, { sourcePage: 2, disposition: "manual-entry" }]);
  assert.deepEqual(review.seed.review.accounting.manifest.pages.map(page => page.sourcePage), [1, 2]);
  assert.deepEqual(f.database.authority.runs.listChildren(f.run.envelope.runId), []);
  for (const sourcePage of [1, 2]) {
    const page = await f.sources.page(f.run.envelope.runId, review.revision, sourcePage);
    await page.dispose();
  }
  assert.equal(f.ocrCalls(), 0);
  assert.deepEqual(f.pageReads, []);
  const pages = OcrOperatorPagesSchema.parse([{ pageKind: "emergency-contact", sourcePage: 2 }]);
  const envelope = { requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard", family: "ocr-review" };
  assert.equal(f.canonical.kernel.execute({ ...envelope, commandId: randomUUID(), type: "add-ocr-record",
    target: { runId: f.run.envelope.runId, expectedRevision: 1 }, payload: { pages } }).state, "applied");
  const added = f.database.authority.ocrReviews.latest(f.run.envelope.runId)?.records[0]; assert.ok(added);
  const sample = submittedPage(f.reading.input); assert.ok(sample.record);
  const fields = operatorOcrFields(review.seed, pages, { ...sample.record.answers,
    "employee.name": { state: "read", raw: "Example, Manual", confidence: 1 },
    "employee.employeeId": { state: "read", raw: "10800001", confidence: 1 },
    "contact.name": { state: "read", raw: "Manual Contact", confidence: 1 },
    "contact.cellPhone": { state: "read", raw: "2025550111", confidence: 1 },
  }, f.clock.now().toISOString());
  assert.equal(f.canonical.kernel.execute({ ...envelope, commandId: randomUUID(), type: "correct-ocr-record",
    target: { runId: f.run.envelope.runId, expectedRevision: 2 }, payload: { recordId: added.recordId, fields, assertedEid: "10800001" } }).state, "applied");
  assert.equal(f.canonical.kernel.execute({ ...envelope, commandId: randomUUID(), type: "restore-ocr-record",
    target: { runId: f.run.envelope.runId, expectedRevision: 3 }, payload: { recordId: added.recordId } }).state, "applied");
  assert.equal(f.canonical.kernel.execute(f.approval([added.recordId])).state, "applied");
  const completed = await f.canonical.execute(f.parentRun, new AbortController().signal);
  assert.ok(completed.run?.lifecycle.state === "terminal" && completed.run.lifecycle.outcome === "done", JSON.stringify(completed.outcomes));
  const members = f.database.authority.runs.listChildren(f.parentRun.envelope.runId).filter(run => run.envelope.workflow === "emergency-contact-member");
  assert.equal(members.length, 1);
  const member = members[0]; assert.ok(member);
  const input = EmergencyContactMemberInputSchema.parse(member.input.parsed.value);
  assert.equal(input.record.recordId, added.recordId);
  assert.equal(input.record.assertedEid, "10800001");
  assert.equal(input.sourcePage, 2);
  assert.deepEqual(input.record.fields, fields);
  assert.equal(persistence.submissions.length, dryRun ? 0 : 1);
  if (dryRun) {
    const result = f.database.authority.runResults.get(f.parentRun.envelope.runId); assert.ok(result);
    assert.equal(RunDelegatedDryRunPreviewResultSchema.parse(result.result.value).externalCommit, "none");
    assert.deepEqual(f.database.authority.writeIntents.listByRun(member.envelope.runId), []);
    // The rerun resubmits the original PDF (same stored document, new reading) and the OCR child is admitted past its first checkpoint.
    const descriptor = DESCRIPTORS.find(entry => entry.id === "emergency-contact"); assert.ok(descriptor);
    const original = EmergencyContactInputSchema.parse(f.parentRun.input.parsed.value);
    assert.equal(original.fileName, "source.pdf");
    const source = f.database.authority.runs.get(f.parentRun.envelope.runId); assert.ok(source);
    const rerun = f.canonical.start(descriptor, { ...original, roster: null, readingId: randomUUID() }, { dryRun: true,
      ...(f.workbookReferences === undefined ? {} : { workbookReferences: f.workbookReferences }),
      rerunSource: { runId: source.envelope.runId, expectedVersion: source.version, intent: "rerun", selectedStepKeys: descriptor.timeline.map(step => step.key) } });
    await f.canonical.execute(rerun, new AbortController().signal);
    const child = f.database.authority.runs.listChildren(rerun.envelope.runId).find(run => run.envelope.workflow === "ocr"); assert.ok(child);
    assert.deepEqual(OcrInputSchema.parse(child.input.parsed.value).document, original.document);
    assert.ok(child.lifecycle.state === "parked-gate" && child.lifecycle.gateId === "approve-records", JSON.stringify(child.lifecycle));
    assert.deepEqual(f.database.authority.runs.get(source.envelope.runId), source);
  }
  assert.equal(f.ocrCalls(), 0);
});
