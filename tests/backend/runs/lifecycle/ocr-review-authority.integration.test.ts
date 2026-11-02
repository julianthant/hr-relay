import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { assertOcrRecoverySnapshotCurrent, requireCurrentOcrSnapshot, readOcrReviewAuthority, readOcrSnapshotsAuthority } from "../../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { OcrApprovedSnapshotSchema, ocrReviewDigest, ocrSnapshotDigest } from "../../../../src/models/ocr/review.js";
import { OcrApprovalReferenceSchema, OcrWorkflowResultSchema } from "../../../../src/models/workflows/ocr/result.js";
import { deriveSchemaHash } from "../../../../src/models/validation/schema-bound-value.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);
type Fixture = Awaited<ReturnType<typeof world.fixture>>;
function approval(f: Fixture, selectedRecordIds?: readonly string[]) {
  const review = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(review);
  const run = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(run);
  const commandId = randomUUID();
  const snapshot = OcrApprovedSnapshotSchema.parse({ snapshotId: commandId, sourceRunId: run.envelope.runId,
    revision: review.revision, reviewDigest: ocrReviewDigest(review), selectedRecordIds: selectedRecordIds ?? review.records.map(record => record.recordId),
    records: selectedRecordIds === undefined ? review.records : selectedRecordIds.map(id => review.records.find(record => record.recordId === id)),
    approvedBy: "local-operator", approvedAt: f.clock.now().toISOString() });
  return { commandId, requestedAt: f.clock.now().toISOString(), requestedBy: "local-operator", source: "dashboard",
    family: "gate", type: "resolve-gate", target: { runId: run.envelope.runId, gateId: "approve-records", expectedVersion: run.version },
    payload: { result: { schemaHash: deriveSchemaHash(OcrApprovalReferenceSchema, "output"), value: {
      snapshotId: commandId, sourceRunId: run.envelope.runId, revision: review.revision, digest: ocrSnapshotDigest(snapshot),
    } }, ocrApproval: { expectedRevision: review.revision, reviewDigest: ocrReviewDigest(review), selectedRecordIds: snapshot.selectedRecordIds } } };
}

it("appends journal-bound corrections, discards and restores with revision CAS and exact command replay", async () => {
  const f = await world.fixture({ record: true });
  const original = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(original);
  const correction = f.command("correct-ocr-record", 1);
  const runVersion = f.database.authority.runs.get(f.run.envelope.runId)?.version; assert.ok(runVersion);
  assert.equal(f.canonical.kernel.execute(correction).state, "applied");
  assert.equal(f.canonical.kernel.execute(correction).state, "already-applied");
  const divergent = f.canonical.kernel.execute({ ...correction, requestedAt: "2026-11-03T00:00:00.000Z" });
  assert.ok(divergent.state === "rejected" && divergent.code === "command-divergent");
  assert.equal(f.database.authority.ocrReviews.latest(f.run.envelope.runId)?.revision, 2);
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.version, runVersion + 1);
  assert.equal(f.canonical.kernel.execute(f.command("discard-ocr-record", 1)).state, "conflict");
  assert.equal(f.canonical.kernel.execute(f.command("discard-ocr-record", 2)).state, "applied");
  assert.equal(f.database.authority.ocrReviews.latest(f.run.envelope.runId)?.records[0]?.discarded, true);
  assert.equal(f.canonical.kernel.execute(f.command("restore-ocr-record", 3)).state, "applied");
  const read = readOcrReviewAuthority(f.database.authority, f.canonical.lifecycle, f.run.envelope.runId); assert.ok(read);
  assert.equal(read.revision.revision, 4);
  assert.equal(read.revision.records[0]?.discarded, false);
  assert.deepEqual(f.database.authority.ocrReviews.revision(f.run.envelope.runId, 1), original);
  assert.deepEqual(f.database.authority.ocrExtractions.get(f.reading.extractionId), { ...f.reading, binding: "source-bound" });
  const foreign = f.canonical.kernel.execute({ ...f.command("discard-ocr-record", 4), target: { runId: randomUUID(), expectedRevision: 4 } });
  assert.ok(foreign.state === "rejected" && foreign.code === "OCR_REVIEW_REFUSED");
});

it("rolls snapshot creation back with gate failure, then replays the original approved snapshot through parent resume", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.result.run?.lifecycle.state, "parked-gate");
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const request = approval(f);
  const transact = f.database.withAuthorityTransaction.bind(f.database);
  const generation = f.database.getMeta().authorityGeneration;
  f.database.withAuthorityTransaction = work => transact(repositories => work({ ...repositories,
    gateResults: { ...repositories.gateResults, insert: () => { throw new Error("injected-gate-insert-failure"); } } }));
  try { assert.throws(() => f.canonical.kernel.execute(request), /injected-gate-insert-failure/u); }
  finally { f.database.withAuthorityTransaction = transact; }
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(f.database.authority.ocrReviews.snapshots(f.run.envelope.runId), []);
  assert.equal(f.database.authority.commands.get(request.commandId), undefined);
  assert.equal(f.database.authority.runs.get(f.run.envelope.runId)?.lifecycle.state, "parked-gate");
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  assert.equal(f.canonical.kernel.execute(request).state, "already-applied");
  const snapshot = f.database.authority.ocrReviews.snapshot(request.commandId); assert.ok(snapshot);
  const resumed = await f.canonical.execute(f.run, new AbortController().signal);
  assert.ok(resumed.run?.lifecycle.state === "terminal" && resumed.run.lifecycle.outcome === "done");
  const result = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(result);
  assert.deepEqual(OcrWorkflowResultSchema.parse(result.result.value).approvedSnapshot, request.payload.result.value);
  const review = readOcrReviewAuthority(f.database.authority, f.canonical.lifecycle, f.run.envelope.runId); assert.ok(review);
  assert.deepEqual(readOcrSnapshotsAuthority(f.database.authority, review), [snapshot]);
});

it("refuses stale approval and retains an immutable snapshot after a later draft revision and database restart", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const stale = approval(f);
  assert.equal(f.canonical.kernel.execute(f.command("discard-ocr-record", 2)).state, "applied");
  const currentRun = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(currentRun);
  const refused = f.canonical.kernel.execute({ ...stale, target: { ...stale.target, expectedVersion: currentRun.version } });
  assert.ok(refused.state === "rejected" && refused.code === "invalid-state");
  assert.deepEqual(f.database.authority.ocrReviews.snapshots(f.run.envelope.runId), []);
  assert.equal(f.canonical.kernel.execute(f.command("restore-ocr-record", 3)).state, "applied");
  const request = approval(f);
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  const saved = f.database.authority.ocrReviews.snapshot(request.commandId); assert.ok(saved);
  assert.deepEqual(requireCurrentOcrSnapshot(f.database.authority, f.canonical.lifecycle, request.payload.result.value), saved);
  assert.equal(f.canonical.kernel.execute(f.command("discard-ocr-record", 4)).state, "applied");
  assert.deepEqual(f.database.authority.ocrReviews.snapshot(request.commandId), saved);
  assert.throws(() => requireCurrentOcrSnapshot(f.database.authority, f.canonical.lifecycle, request.payload.result.value), /OCR_REVIEW_REFUSED/u);
  const current = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(current);
  assert.throws(() => assertOcrRecoverySnapshotCurrent(f.database.authority, f.canonical.lifecycle, current), /ocr-approved-snapshot-recovery-refused/u);
  await f.harness.manager.closeAll("worker-stop");
  f.database.close();
  const reopened = AuthorityDatabase.open(f.admission, { path: f.path, busyTimeoutMs: 500, migrationOwner: "ocr-review-restart" }, f.clock,
    undefined, undefined, undefined, boundProfileCredentials(f.admission));
  f.harness.authority.replaceClosedDatabase(reopened);
  const reader = new RunRecordService({ database: reopened, clock: f.clock, ids: { uuid: randomUUID }, publishQueued: () => { throw new Error("unexpected enqueue"); } });
  const read = readOcrReviewAuthority(reopened.authority, reader, f.run.envelope.runId); assert.ok(read);
  assert.equal(read.revision.revision, 5);
  assert.deepEqual(readOcrSnapshotsAuthority(reopened.authority, read), [saved]);
  assert.equal(reopened.authority.runs.get(f.run.envelope.runId)?.lifecycle.state, "queued");
});

it("freezes only the explicit selected subset and refuses unknown or discarded members", async () => {
  const f = await world.fixture({ record: true, release: true, pageCount: 2 });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const review = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(review);
  assert.equal(review.records.length, 2);
  const first = review.records[0]; assert.ok(first);
  const candidate = approval(f, [first.recordId]);
  const foreign = { ...candidate, commandId: randomUUID(), payload: { ...candidate.payload,
    ocrApproval: { ...candidate.payload.ocrApproval, selectedRecordIds: [`${"f".repeat(64)}#emergency-contact#99`] } } };
  assert.equal(f.canonical.kernel.execute(foreign).state, "rejected");
  assert.deepEqual(f.database.authority.ocrReviews.snapshots(f.run.envelope.runId), []);
  assert.equal(f.canonical.kernel.execute(f.command("discard-ocr-record", 2)).state, "applied");
  const discarded = f.database.authority.ocrReviews.latest(f.run.envelope.runId); assert.ok(discarded);
  const currentRun = f.database.authority.runs.get(f.run.envelope.runId); assert.ok(currentRun);
  assert.equal(f.canonical.kernel.execute({ ...candidate, commandId: randomUUID(), target: { ...candidate.target, expectedVersion: currentRun.version }, payload: { ...candidate.payload,
    ocrApproval: { ...candidate.payload.ocrApproval, expectedRevision: 3, reviewDigest: ocrReviewDigest(discarded) } } }).state, "rejected");
  assert.deepEqual(f.database.authority.ocrReviews.snapshots(f.run.envelope.runId), []);
  assert.equal(f.canonical.kernel.execute(f.command("restore-ocr-record", 3)).state, "applied");
  const request = approval(f, [first.recordId]);
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  const snapshot = f.database.authority.ocrReviews.snapshot(request.commandId); assert.ok(snapshot);
  assert.deepEqual(snapshot.selectedRecordIds, [first.recordId]);
  assert.equal(snapshot.records.length, 1);
});

it("refuses native overwrite, replacement and deletion of source, review and approval evidence", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  assert.equal(f.canonical.kernel.execute(approval(f)).state, "applied");
  const raw = new DatabaseSync(f.path);
  try {
    for (const table of ["ocr_source_uploads", "ocr_review_revisions", "ocr_approved_snapshots"]) {
      assert.throws(() => raw.exec(`UPDATE ${table} SET payload_json='{}'`), /ocr-evidence-immutable/u);
      assert.throws(() => raw.exec(`DELETE FROM ${table}`), /ocr-evidence-retained/u);
      assert.throws(() => raw.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`), /ocr-evidence-replace-refused/u);
    }
    assert.throws(() => raw.exec(`INSERT OR REPLACE INTO ocr_review_revisions
      SELECT id||':foreign',run_id,revision,command_id,payload_json,created_at FROM ocr_review_revisions WHERE revision=1`), /ocr-evidence-replace-refused/u);
    assert.throws(() => raw.exec(`INSERT OR REPLACE INTO ocr_review_revisions
      SELECT id||':foreign',run_id,revision+10,command_id,payload_json,created_at FROM ocr_review_revisions WHERE command_id IS NOT NULL`), /ocr-evidence-replace-refused/u);
  } finally { raw.close(); }
});
