import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, it } from "vitest";
import { createOcrReviewWorld } from "../../../support/helpers/backend/ocr-review-world.js";
import { assertOcrRecoverySnapshotCurrent, requireCurrentOcrSnapshot, readOcrReviewAuthority, readOcrSnapshotsAuthority } from "../../../../src/backend/runs/lifecycle/ocr-review-authority.js";
import { OcrApprovedSnapshotSchema, ocrReviewDigest } from "../../../../src/models/ocr/review.js";
import { OcrWorkflowResultSchema } from "../../../../src/models/workflows/ocr/result.js";
import { AuthorityDatabase } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { RunRecordService } from "../../../../src/backend/runs/lifecycle/run-record-service.js";
import { boundProfileCredentials } from "../../../support/helpers/admission-fixture.js";
import type { AuthorityRepositories } from "../../../../src/backend/storage/sqlite/authority-database.js";
import { CommandAuditRecordSchema, CommandRequestSchema, RunLifecycleCommandAuditRecordSchema } from "../../../../src/rules/commands/commands.js";
import { OcrReviewRevisionSchema } from "../../../../src/models/ocr/review.js";
import { lifecycleCommandId } from "../../../../src/rules/identity/identifiers.js";
import { ActorIdSchema } from "../../../../src/rules/identity/ids.js";
import { replaceOcrAuditRead, replaceOcrCommandRead } from "../../../support/helpers/backend/ocr-proof-reads.js";
import { terminalGateDependencyRecord } from "../../../../src/models/run/result.js";

const world = createOcrReviewWorld();
afterEach(world.cleanup);
type Fixture = Awaited<ReturnType<typeof world.fixture>>;
function approval(f: Fixture, selectedRecordIds?: readonly string[]) {
  return f.approval(selectedRecordIds);
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
  const manifests = f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId);
  const children = manifests.flatMap(manifest => manifest.children.map(child => ({
    run: f.database.authority.runs.get(child.childRunId), result: f.database.authority.runResults.get(child.childRunId),
  })));
  const resumed = await f.canonical.execute(f.run, new AbortController().signal);
  assert.ok(resumed.run?.lifecycle.state === "terminal" && resumed.run.lifecycle.outcome === "done");
  const result = f.database.authority.runResults.get(f.run.envelope.runId); assert.ok(result);
  assert.deepEqual(OcrWorkflowResultSchema.parse(result.result.value).approvedSnapshot, request.payload.result.value);
  assert.deepEqual(f.database.authority.delegationManifests.listByParentRun(f.run.envelope.runId), manifests);
  assert.deepEqual(manifests.flatMap(manifest => manifest.children.map(child => ({
    run: f.database.authority.runs.get(child.childRunId), result: f.database.authority.runResults.get(child.childRunId),
  }))), children);
  const gate = f.database.authority.gateResults.get(`${f.run.envelope.runId}:approve-records`); assert.ok(gate);
  assert.deepEqual(result.dependencies.find(dependency => dependency.nodeId === gate.nodeId), terminalGateDependencyRecord(gate.nodeId, gate));
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

it("refuses foreign, missing and altered revision command, audit, run and lifecycle proof without changing authority", async () => {
  const f = await world.fixture({ record: true });
  const correction = f.command("correct-ocr-record", 1);
  assert.equal(f.canonical.kernel.execute(correction).state, "applied");
  const repositories = f.database.authority, runId = f.run.envelope.runId;
  const current = readOcrReviewAuthority(repositories, f.canonical.lifecycle, runId); assert.ok(current);
  const command = repositories.commands.get(correction.commandId); assert.ok(command?.family === "ocr-review");
  const audit = repositories.commandAudits.findByCommand(correction.commandId); assert.ok(audit?.result.state === "applied");
  const journalId = lifecycleCommandId("operator-ocr-review", command.commandId);
  const settled = repositories.lifecycleJournal.findAuditByCommand(journalId);
  assert.ok(settled !== undefined && "kind" in settled && settled.kind === "run-lifecycle" && settled.result.kind === "run");
  const appliedVersion = settled.result.appliedVersion;
  const foreignRun = randomUUID();
  const foreignRevision = OcrReviewRevisionSchema.parse({ ...current.revision, sourceRunId: foreignRun, id: `${foreignRun}#2` });
  const variants: ReadonlyArray<readonly [string, AuthorityRepositories]> = [
    ["missing command", replaceOcrCommandRead(repositories, command.commandId, undefined)],
    ...([
      ["foreign command", { ...command, commandId: randomUUID() }],
      ["foreign actor", { ...command, requestedBy: "foreign-operator" }],
      ["foreign source", { ...command, source: "run-detail" }],
      ["foreign run", { ...command, target: { ...command.target, runId: foreignRun } }],
      ["altered revision", { ...command, target: { ...command.target, expectedRevision: 2 } }],
    ] satisfies ReadonlyArray<readonly [string, unknown]>).map(([name, candidate]) => [name, replaceOcrCommandRead(repositories, command.commandId, CommandRequestSchema.parse(candidate))] as const),
    ["missing audit", replaceOcrAuditRead(repositories, command.commandId, undefined)],
    ...([
      ["divergent audit", { ...audit, request: { ...command, requestedBy: "foreign-operator" } }],
      ["foreign audit result", { ...audit, result: { ...audit.result, commandId: randomUUID() } }],
      ["unapplied audit", { ...audit, result: { state: "rejected", commandId: command.commandId, code: "invalid-state", message: "Synthetic refusal" } }],
      ["missing revision advance", { ...audit, versionChanges: audit.versionChanges.filter(change => change.target.family !== "ocr-review") }],
      ["missing run advance", { ...audit, versionChanges: audit.versionChanges.filter(change => change.target.family !== "run") }],
    ] satisfies ReadonlyArray<readonly [string, unknown]>).map(([name, candidate]) => [name, replaceOcrAuditRead(repositories, command.commandId, CommandAuditRecordSchema.parse(candidate))] as const),
    ["foreign current run", { ...repositories, ocrReviews: { ...repositories.ocrReviews, latest: () => foreignRevision } }],
    ["missing revision", { ...repositories, ocrReviews: { ...repositories.ocrReviews,
      revision: (id, revision) => revision === 2 ? undefined : repositories.ocrReviews.revision(id, revision) } }],
    ["foreign revision run", { ...repositories, ocrReviews: { ...repositories.ocrReviews,
      revision: (id, revision) => revision === 2 ? foreignRevision : repositories.ocrReviews.revision(id, revision) } }],
    ["missing lifecycle command", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
      getCommand: id => id === journalId ? undefined : repositories.lifecycleJournal.getCommand(id) } }],
    ["missing lifecycle audit", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
      findAuditByCommand: id => id === journalId ? undefined : repositories.lifecycleJournal.findAuditByCommand(id) } }],
    ["altered lifecycle version", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
      findAuditByCommand: id => id === journalId ? RunLifecycleCommandAuditRecordSchema.parse({ ...settled,
        result: { ...settled.result, appliedVersion: appliedVersion + 1 } }) : repositories.lifecycleJournal.findAuditByCommand(id) } }],
  ];
  const generation = f.database.getMeta().authorityGeneration;
  for (const [name, altered] of variants) assert.throws(() => readOcrReviewAuthority(altered, f.canonical.lifecycle, runId), /OCR_REVIEW_REFUSED/u, name);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(readOcrReviewAuthority(repositories, f.canonical.lifecycle, runId), current);
});

it("refuses foreign, missing and altered snapshot, approval, gate and lifecycle proof without changing authority", async () => {
  const f = await world.fixture({ record: true, release: true });
  assert.equal(f.canonical.kernel.execute(f.command("correct-ocr-record", 1)).state, "applied");
  const request = approval(f);
  assert.equal(f.canonical.kernel.execute(request).state, "applied");
  const repositories = f.database.authority, runId = f.run.envelope.runId;
  const review = readOcrReviewAuthority(repositories, f.canonical.lifecycle, runId); assert.ok(review);
  const saved = readOcrSnapshotsAuthority(repositories, review); assert.equal(saved.length, 1);
  const snapshot = saved[0]; assert.ok(snapshot);
  const command = repositories.commands.get(request.commandId); assert.ok(command?.family === "gate");
  const audit = repositories.commandAudits.findByCommand(request.commandId); assert.ok(audit?.result.state === "applied");
  const journalId = lifecycleCommandId("operator-gate", command.commandId);
  const settled = repositories.lifecycleJournal.findAuditByCommand(journalId);
  assert.ok(settled !== undefined && "kind" in settled && settled.kind === "run-lifecycle" && settled.result.kind === "run");
  const appliedVersion = settled.result.appliedVersion;
  const foreign = randomUUID();
  const first = snapshot.records[0]; assert.ok(first);
  const foreignRecordId = `${"f".repeat(64)}#emergency-contact#99`;
  const variants: ReadonlyArray<readonly [string, AuthorityRepositories]> = [
    ["missing command", replaceOcrCommandRead(repositories, command.commandId, undefined)],
    ...([
      ["foreign command", { ...command, commandId: foreign }],
      ["foreign actor", { ...command, requestedBy: "foreign-operator" }],
      ["foreign source", { ...command, source: "run-detail" }],
      ["foreign run", { ...command, target: { ...command.target, runId: foreign } }],
      ["foreign gate", { ...command, target: { ...command.target, gateId: "foreign-gate" } }],
      ["missing selection", { ...command, payload: { result: command.payload.result } }],
    ] satisfies ReadonlyArray<readonly [string, unknown]>).map(([name, candidate]) => [name, replaceOcrCommandRead(repositories, command.commandId, CommandRequestSchema.parse(candidate))] as const),
    ["missing audit", replaceOcrAuditRead(repositories, command.commandId, undefined)],
    ...([
      ["divergent audit", { ...audit, request: { ...command, requestedBy: "foreign-operator" } }],
      ["foreign audit result", { ...audit, result: { ...audit.result, commandId: foreign } }],
      ["unapplied audit", { ...audit, result: { state: "rejected", commandId: command.commandId, code: "invalid-state", message: "Synthetic refusal" } }],
    ] satisfies ReadonlyArray<readonly [string, unknown]>).map(([name, candidate]) => [name, replaceOcrAuditRead(repositories, command.commandId, CommandAuditRecordSchema.parse(candidate))] as const),
    ["missing revision", { ...repositories, ocrReviews: { ...repositories.ocrReviews, revision: () => undefined } }],
    ...([
      ["foreign snapshot run", { ...snapshot, sourceRunId: foreign }],
      ["altered review digest", { ...snapshot, reviewDigest: "f".repeat(64) }],
      ["foreign selected member", { ...snapshot, selectedRecordIds: [foreignRecordId], records: [{ ...first, recordId: foreignRecordId }] }],
    ] satisfies ReadonlyArray<readonly [string, unknown]>).map(([name, candidate]) => [name, { ...repositories, ocrReviews: { ...repositories.ocrReviews,
      snapshots: () => [OcrApprovedSnapshotSchema.parse(candidate)] } }] as const),
    ["missing gate", { ...repositories, gateResults: { ...repositories.gateResults, listByRun: () => [] } }],
    ["foreign gate actor", { ...repositories, gateResults: { ...repositories.gateResults,
      listByRun: id => repositories.gateResults.listByRun(id).map(gate => "commandId" in gate
        ? { ...gate, resolvedBy: ActorIdSchema.parse("foreign-operator") } : gate) } }],
    ["missing lifecycle command", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
      getCommand: id => id === journalId ? undefined : repositories.lifecycleJournal.getCommand(id) } }],
    ["missing lifecycle audit", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
      findAuditByCommand: id => id === journalId ? undefined : repositories.lifecycleJournal.findAuditByCommand(id) } }],
    ["altered lifecycle version", { ...repositories, lifecycleJournal: { ...repositories.lifecycleJournal,
      findAuditByCommand: id => id === journalId ? RunLifecycleCommandAuditRecordSchema.parse({ ...settled,
        result: { ...settled.result, appliedVersion: appliedVersion + 1 } }) : repositories.lifecycleJournal.findAuditByCommand(id) } }],
  ];
  const generation = f.database.getMeta().authorityGeneration;
  for (const [name, altered] of variants) assert.throws(() => readOcrSnapshotsAuthority(altered, review), /OCR_REVIEW_REFUSED/u, name);
  assert.equal(f.database.getMeta().authorityGeneration, generation);
  assert.deepEqual(readOcrSnapshotsAuthority(repositories, review), saved);
});
