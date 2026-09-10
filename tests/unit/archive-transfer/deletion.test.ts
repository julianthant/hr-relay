import assert from "node:assert/strict";
import { it } from "vitest";
import { existsSync, writeFileSync, unlinkSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { archiveFixture, attachFile } from "./fixtures.js";
import { NOW, id } from "../database-foundation/fixtures.js";
import { createRunLifecycleStorage } from "../../../src/core/run-lifecycle-storage.js";
import { projectArchiveReport, queryArchiveReports } from "../../../src/server/dashboard/queries/archive-reports.js";
import { captureArchiveReport } from "../../../src/services/archive/report-capture.js";
import { transferArchiveReport } from "../../../src/services/archive/archive-transfer.js";

it("authenticates public references, resumes a failed final audit after reopening, and never resurrects a deleted transfer", () => {
  const f = archiveFixture();
  try {
    f.terminal();
    const file = attachFile(f.database, f.base.root, f.base.run.envelope.runId, 9900);
    const apply = f.applyRequest(f.plan());
    assert.equal(f.kernel.execute(apply).state, "applied");
    let storage = createRunLifecycleStorage(f.database);
    const report = storage.readReport(f.base.run.envelope.runId); assert.ok(report);
    const view = projectArchiveReport(report); assert.ok(view.state === "available");
    const request = { commandId: id(9903), requestedBy: "local-operator", requestedAt: NOW, family: "version-archive", source: "archive", type: "delete-archived-run",
      target: { archivedRunId: report.content.runId, archiveFingerprint: view.archiveFingerprint } };
    const wrong = f.kernel.execute({ ...request, target: { ...request.target, archiveFingerprint: report.digest } });
    assert.equal(wrong.state, "rejected");
    assert.ok(storage.readReport(report.content.runId));
    f.failAfter("audit"); assert.throws(() => f.kernel.execute(request), /injected-audit/u);
    f.reopen(); storage = createRunLifecycleStorage(f.database);
    assert.equal(f.kernel.execute(request).state, "applied");
    assert.equal(f.kernel.execute(request).state, "already-applied");
    assert.equal(storage.readReport(report.content.runId), undefined);
    assert.throws(() => transferArchiveReport(storage, report, 1), /deleted/u);
    assert.equal(f.kernel.execute(apply).state, "already-applied");
    assert.deepEqual(queryArchiveReports(storage, { limit: 10 }).items, []);
    assert.equal(existsSync(join(f.base.root, "archive-files", file.file.digest)), false);
    assert.equal(f.database.authority.deletedRuns.get(report.content.runId)?.runNumber, report.content.runNumber);
  } finally { f.dispose(); }
});

it("retains shared live and archive file owners and pages equal timestamps without gaps", () => {
  const f = archiveFixture();
  try {
    f.terminal();
    const second = f.base.createRun(id(9910));
    const firstFile = attachFile(f.database, f.base.root, f.base.run.envelope.runId, 9920);
    attachFile(f.database, f.base.root, second.envelope.runId, 9930, firstFile.bytes);
    const storage = createRunLifecycleStorage(f.database);
    const first = storage.capture(f.base.run.envelope.runId);
    const report1 = captureArchiveReport({ snapshot: first, transferId: id(9940), capturedAt: NOW, files: [firstFile.file], sections: [] });
    storage.retainFile(firstFile.file, storage.readSourceFile(firstFile.file));
    transferArchiveReport(storage, report1, first.run.version);
    assert.deepEqual(storage.readSourceFile(firstFile.file), firstFile.bytes);
    assert.equal(f.database.authority.diagnosticBundles.listByRun(second.envelope.runId).length, 1);
    f.database.authority.runs.transition({ runId: second.envelope.runId, expectedVersion: second.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW });
    const snapshot = storage.capture(second.envelope.runId);
    const report2 = captureArchiveReport({ snapshot, transferId: id(9941), capturedAt: NOW, files: [firstFile.file], sections: [] });
    transferArchiveReport(storage, report2, snapshot.run.version);
    const page = queryArchiveReports(storage, { limit: 1 }); assert.ok(page.next);
    const next = queryArchiveReports(storage, { limit: 1, after: page.next });
    assert.deepEqual([...page.items, ...next.items].map(value => value.state === "available" ? value.runId : "missing").sort(), [report1.content.runId, report2.content.runId].sort());
    assert.equal(storage.deleteArchive({ commandId: id(9942), runId: report1.content.runId, archiveFingerprint: report1.digest }).state, "deleted");
    assert.deepEqual(storage.readFile(report2.content.runId, firstFile.file.digest).bytes, firstFile.bytes);
    assert.equal(storage.deleteArchive({ commandId: id(9943), runId: report2.content.runId, archiveFingerprint: report2.digest }).state, "deleted");
    assert.equal(existsSync(join(f.base.root, "archive-files", firstFile.file.digest)), false);
  } finally { f.dispose(); }
});

it("refuses missing, changed and symlinked source bytes before transfer; restored bytes permit the same review", () => {
  const f = archiveFixture();
  try {
    f.terminal(); const { file, bytes } = attachFile(f.database, f.base.root, f.base.run.envelope.runId, 9950);
    const path = join(f.base.root, "artifacts", `${file.digest}.artifact`);
    const request = f.applyRequest(f.plan());
    unlinkSync(path); assert.throws(() => f.kernel.execute(request), /ENOENT/u);
    writeFileSync(path, "{}"); assert.throws(() => f.kernel.execute(request));
    unlinkSync(path); symlinkSync(f.base.path, path); assert.throws(() => f.kernel.execute(request), /ELOOP/u);
    assert.ok(f.database.authority.runs.get(f.base.run.envelope.runId));
    assert.equal(f.database.transferredRun(f.base.run.envelope.runId), undefined);
    unlinkSync(path);
    attachFile(f.database, f.base.root, f.base.run.envelope.runId, 9950, bytes);
    assert.equal(f.kernel.execute(request).state, "applied");
  } finally { f.dispose(); }
});

import { backupLifecyclePair, restoreLifecyclePair, verifyLifecyclePair } from "../../../src/core/run-lifecycle-storage.js";
import { RecoveryStopProofStore } from "../../../src/infra/sqlite/recovery-stop-proof.js";
import { observeRuntimeLockSnapshot } from "../../../src/infra/sqlite/runtime-process-locks.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";
import { mkdirSync } from "node:fs";
it("backs up and restores explicit deletion with reserved numbering and no report resurrection", async () => {
  const f = archiveFixture(); let restored: AuthorityDatabase | undefined;
  try {
    f.terminal();
    assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state, "applied");
    const storage = createRunLifecycleStorage(f.database), report = storage.readReport(f.base.run.envelope.runId); assert.ok(report);
    assert.equal(storage.deleteArchive({ commandId: id(9960), runId: report.content.runId, archiveFingerprint: report.digest }).state, "deleted");
    const receipt = f.database.authority.deletedRuns.get(report.content.runId); assert.ok(receipt);
    const backup = await backupLifecyclePair(f.database, f.base.root, f.base.clock);
    assert.ok("pairedManifestPath" in backup); await verifyLifecyclePair(backup.pairedManifestPath);
    const processLockRoot = join(f.base.root, "locks"); mkdirSync(processLockRoot);
    const sourceDatabaseIdentity = AuthorityDatabase.sourceDatabaseIdentity(f.base.path);
    const proofStore = new RecoveryStopProofStore({ processLockRoot, maxProofAgeMs: 60000 }, f.base.clock);
    proofStore.recordRuntimeState(observeRuntimeLockSnapshot({ processLockRoot, sourceDatabaseIdentity }, f.base.clock));
    const proof = proofStore.issue({ observedBy: "local-operator", sourceDatabaseIdentity });
    f.database.close();
    await restoreLifecyclePair({ authorityPath: f.base.path, suspectDirectory: join(f.base.root, "suspects"), busyTimeoutMs: 250, processLockRoot, stoppedProofMaxAgeMs: 60000 },
      { manifestPath: backup.pairedManifestPath, stoppedSystemProof: proof }, async () => {}, f.base.clock);
    restored = AuthorityDatabase.open({ path: f.base.path, busyTimeoutMs: 250, migrationOwner: "archive-delete-restore" }, f.base.clock);
    assert.deepEqual(restored.authority.deletedRuns.get(report.content.runId), receipt);
    assert.equal(createRunLifecycleStorage(restored).readReport(report.content.runId), undefined);
    assert.equal(restored.authority.runs.get(report.content.runId), undefined);
    assert.throws(() => transferArchiveReport(createRunLifecycleStorage(restored!), report, 1), /deleted/u);
  } finally { restored?.close(); f.dispose(); }
});

it("serializes independent deletion connections and preserves exact replay", () => {
  const f = archiveFixture(); let peer: AuthorityDatabase | undefined;
  try {
    f.terminal(); assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state, "applied");
    const storage = createRunLifecycleStorage(f.database), report = storage.readReport(f.base.run.envelope.runId); assert.ok(report);
    peer = AuthorityDatabase.open({ path: f.base.path, busyTimeoutMs: 10, migrationOwner: "delete-peer" }, f.base.clock);
    const peerStorage = createRunLifecycleStorage(peer);
    const request = { commandId: id(9970), runId: report.content.runId, archiveFingerprint: report.digest };
    f.database.withAuthorityTransaction(() => {
      assert.throws(() => peerStorage.deleteArchive(request), /locked|busy/iu);
      assert.ok(storage.readReport(report.content.runId));
    });
    assert.equal(peerStorage.deleteArchive(request).state, "deleted");
    assert.equal(storage.deleteArchive(request).state, "applied-already");
    assert.equal(storage.readReport(report.content.runId), undefined);
    assert.equal(peerStorage.readReport(report.content.runId), undefined);
  } finally { peer?.close(); f.dispose(); }
});

import { RunRecordSchema } from "../../../src/domain/run/record.js";
it("combines bounded workflow pages with exact filters and deterministic ties", () => {
  const f = archiveFixture();
  try {
    f.terminal();
    const storage = createRunLifecycleStorage(f.database);
    const records = [f.base.run.envelope.runId];
    for (const [index, workflow] of ["retired-workflow", "retired-workflow", "person-lookup"].entries()) {
      const run = RunRecordSchema.parse({ ...f.base.run, envelope: { ...f.base.run.envelope, workflow, runId: id(9980 + index), itemId: id(9980 + index) },
        lifecycle: { state: "queued" }, version: 1, claimGeneration: 0, displayName: index === 1 ? "Outside selection" : "Selected report" });
      f.database.authority.runs.enqueue(run);
      f.database.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: 1, now: NOW, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
      records.push(run.envelope.runId);
    }
    for (const [index, runId] of records.entries()) {
      const snapshot = storage.capture(runId);
      const report = captureArchiveReport({ snapshot, transferId: id(9990 + index), capturedAt: NOW, files: [], sections: [] });
      transferArchiveReport(storage, report, snapshot.run.version);
    }
    const calls: number[] = [];
    const bounded = { archiveWorkflows: storage.archiveWorkflows, listReports: (query: Parameters<typeof storage.listReports>[0]) => { const page = storage.listReports(query); calls.push(page.items.length); return page; } };
    const first = queryArchiveReports(bounded, { limit: 1, title: "Selected report", outcome: "cancelled", descriptorVersion: "1", from: NOW, to: NOW }); assert.ok(first.next);
    const second = queryArchiveReports(bounded, { limit: 1, title: "Selected report", outcome: "cancelled", descriptorVersion: "1", from: NOW, to: NOW, after: first.next });
    assert.deepEqual([...first.items, ...second.items].map(value => value.state === "available" ? value.runId : "missing"), [id(9980), id(9982)]);
    assert.ok(calls.every(count => count <= 1));
    assert.equal(calls.length, 4);
    assert.deepEqual(queryArchiveReports(storage, { limit: 5, workflow: "missing-workflow" }).items, []);
    assert.throws(() => queryArchiveReports(storage, { limit: 0 }));
  } finally { f.dispose(); }
});

it("rejects divergent operator identity before deleting a second valid report after an audit interruption", () => {
  const f = archiveFixture();
  try {
    f.terminal(); const other = f.base.createRun(id(9995));
    f.database.authority.runs.transition({ runId: other.envelope.runId, expectedVersion: other.version, now: NOW, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state, "applied");
    const storage = createRunLifecycleStorage(f.database);
    const first = projectArchiveReport(storage.readReport(f.base.run.envelope.runId)), second = projectArchiveReport(storage.readReport(other.envelope.runId));
    assert.ok(first.state === "available" && second.state === "available");
    const request = { commandId: id(9996), requestedBy: "local-operator", requestedAt: NOW, family: "version-archive", source: "archive", type: "delete-archived-run",
      target: { archivedRunId: first.runId, archiveFingerprint: first.archiveFingerprint } };
    f.failAfter("audit"); assert.throws(() => f.kernel.execute(request), /injected-audit/u);
    f.reopen();
    const changed = f.kernel.execute({ ...request, target: { archivedRunId: second.runId, archiveFingerprint: second.archiveFingerprint } });
    assert.equal(changed.state, "rejected");
    if (changed.state === "rejected") assert.equal(changed.code, "command-divergent");
    assert.ok(createRunLifecycleStorage(f.database).readReport(second.runId));
    assert.equal(f.kernel.execute(request).state, "applied");
    assert.equal(f.kernel.execute({ ...request, commandId: id(9997), target: { archivedRunId: second.runId, archiveFingerprint: second.archiveFingerprint } }).state, "applied");
  } finally { f.dispose(); }
});

import { lifecycleCommandId } from "../../../src/domain/identifiers.js";
it("resumes interrupted file settlement before recording the final operator audit", () => {
  const f = archiveFixture();
  try {
    f.terminal(); const file = attachFile(f.database, f.base.root, f.base.run.envelope.runId, 10010);
    assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state, "applied");
    const view = projectArchiveReport(createRunLifecycleStorage(f.database).readReport(f.base.run.envelope.runId)); assert.ok(view.state === "available");
    const request = { commandId: id(10012), requestedBy: "local-operator", requestedAt: NOW, family: "version-archive", source: "archive", type: "delete-archived-run",
      target: { archivedRunId: view.runId, archiveFingerprint: view.archiveFingerprint } };
    f.failAfter("settlement"); assert.throws(() => f.kernel.execute(request), /injected-settlement/u);
    assert.equal(f.database.authority.commands.get(request.commandId), undefined);
    assert.equal(existsSync(join(f.base.root, "archive-files", file.file.digest)), true);
    assert.equal(f.kernel.execute({ ...request, reason: "Changed intent" }).state, "rejected");
    const foreign = f.kernel.execute({ ...request, family: "version-archive", type: "plan-version-bump", target: { scope: { kind: "application", applicationVersion: "0.1.0" } },
      payload: { targetVersion: "0.2.0", changeFingerprint: "a".repeat(64), changeRecord: { kind: "minor", what: "Different command", why: "identity control", commit: { state: "absent", reason: "fixture" } } } });
    assert.equal(foreign.state, "rejected");
    if (foreign.state === "rejected") assert.equal(foreign.code, "command-divergent");
    assert.equal(f.kernel.execute(request).state, "applied");
    assert.equal(existsSync(join(f.base.root, "archive-files", file.file.digest)), false);
    assert.ok(f.database.authority.commandAudits.findByCommand(request.commandId));
  } finally { f.dispose(); }
});

it("refuses forged canonical operator bindings and references before deletion", () => {
  const f = archiveFixture();
  try {
    f.terminal(); assert.equal(f.kernel.execute(f.applyRequest(f.plan())).state, "applied");
    const storage = createRunLifecycleStorage(f.database), report = storage.readReport(f.base.run.envelope.runId); assert.ok(report);
    const view = projectArchiveReport(report); assert.ok(view.state === "available");
    const operatorRequest = { commandId: id(10020), requestedBy: "local-operator", requestedAt: NOW, family: "version-archive", source: "archive", type: "delete-archived-run",
      target: { archivedRunId: view.runId, archiveFingerprint: view.archiveFingerprint } };
    const request = { commandId: lifecycleCommandId("operator-delete-archive", operatorRequest.commandId), runId: view.runId, archiveFingerprint: report.digest, operatorRequest };
    assert.throws(() => storage.deleteArchive({ ...request, commandId: id(10021) }), /binding-mismatch/u);
    assert.throws(() => storage.deleteArchive({ ...request, runId: id(10022) }), /binding-mismatch/u);
    const stale = storage.deleteArchive({ ...request, operatorRequest: { ...operatorRequest, target: { ...operatorRequest.target, archiveFingerprint: "a".repeat(64) } } });
    assert.equal(stale.state, "refused");
    assert.ok(storage.readReport(view.runId));
    assert.equal(storage.deleteArchive(request).state, "deleted");
    assert.equal(f.kernel.execute(operatorRequest).state, "applied");
  } finally { f.dispose(); }
});
