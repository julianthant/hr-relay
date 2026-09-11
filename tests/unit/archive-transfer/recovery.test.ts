import { createRunLifecycleStorage } from "../helpers/lifecycle-storage.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { foundationFixture, NOW, HASH, id } from "../database-foundation/fixtures.js";
import { RunRecordSchema } from "../../../src/domain/run/record.js";
import { captureArchiveReport } from "../../../src/services/archive/report-capture.js";
import { transferArchiveReport } from "../../../src/services/archive/archive-transfer.js";

it.each([false, true])("transfers a frozen terminal parent/child tree; dependency evidence=%s", (withDependency) => {
  const f = foundationFixture();
  try {
    const parentId = f.run.envelope.runId;
    const childId = id(9101);
    const child = RunRecordSchema.parse({ ...f.run,
      envelope: { ...f.run.envelope, runId: childId, itemId: childId, shape: "operation-member",
        parent: { runId: parentId, tracePrefix: f.run.envelope.traceId, edgeId: "archive-child" } },
      lifecycle: { state: "queued" }, version: 1, claimGeneration: 0,
    });
    f.db.authority.runs.enqueue(child);
    for (const run of [f.run, child]) {
      const result = f.db.authority.runs.transition({ runId: run.envelope.runId, expectedVersion: run.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW });
      assert.equal(result.state, "applied");
    }
    if (withDependency) {
      const policy = { onChildFailed: "fail-parent", cascadeCancel: "cascade", afterChildRetry: "resume-parent", visibility: "inline" } as const;
      f.db.authority.delegationManifests.insert({ manifestId: id(9102), parentRunId: parentId, edgeId: "archive-child",
        inputSchemaHash: HASH, resultSchemaHash: HASH, cardinality: "one", join: "one", policy,
        children: [{ dependencyId: id(9103), childRunId: childId, childItemId: childId, canonicalInputFingerprint: HASH }],
        createdAt: NOW, manifestFingerprint: HASH });
      f.db.authority.dependencies.insert({ dependencyId: id(9103), manifestId: id(9102), edgeId: "archive-child",
        parentRunId: parentId, childRunId: childId, childItemId: childId, policy,
        state: "cancelled", version: 1, createdAt: NOW, updatedAt: NOW });
    }
    const storage = createRunLifecycleStorage(f.db);
    const snapshots = [storage.capture(parentId), storage.capture(childId)];
    const reports = snapshots.map((snapshot, index) => captureArchiveReport({ snapshot, transferId: id(9104 + index), capturedAt: NOW, sections: [], files: [] }));
    for (const report of reports) { storage.saveReport(report); storage.verifyReport(report.content.runId, report.digest); }
    assert.throws(() => storage.transfer({ runId: parentId, digest: reports[0].digest, expectedVersion: snapshots[0].run.version }), /archive-transfer-children-retained/u);
    assert.deepEqual(transferArchiveReport(storage, reports[1], snapshots[1].run.version), reports[1]);
    assert.equal(f.db.authority.runs.get(childId), undefined);
    assert.equal(f.db.authority.deletedRuns.get(childId), undefined);
    // Both reports were already verified. The shared cleanup must preserve the
    // frozen parent's evidence rather than require a divergent recapture.

    assert.deepEqual(transferArchiveReport(storage, reports[0], snapshots[0].run.version), reports[0]);
    assert.equal(f.db.authority.runs.get(parentId), undefined);
    assert.equal(f.db.authority.deletedRuns.get(parentId), undefined);
  } finally { f.dispose(); }
});

import { archiveFixture } from "./fixtures.js";
import { CommandRequestSchema } from "../../../src/domain/commands.js";

for (const step of ["saveReport", "verifyReport", "transfer", "publishReport", "writeVersionChange", "audit"]) {
  it(`production apply resumes after ${step} with reopened connections and exact command identity`, () => {
    const f = archiveFixture();
    try {
      f.terminal(); const row = f.plan(); const request = f.applyRequest(row);
      f.failAfter(step);
      assert.throws(() => f.kernel.execute(request), /injected-/u);
      f.reopen();
      const changed = CommandRequestSchema.parse({ ...request, reason: "Different request under same identity" });
      const refused = f.kernel.execute(changed);
      assert.equal(refused.state, "rejected");
      if (refused.state === "rejected") assert.equal(refused.code, "command-divergent");
      assert.equal(f.kernel.execute(request).state, "applied");
      assert.equal(f.kernel.execute(request).state, "already-applied");
      assert.equal(f.database.authority.runs.get(f.base.run.envelope.runId), undefined);
      assert.equal(f.database.authority.deletedRuns.get(f.base.run.envelope.runId), undefined);
      assert.equal(f.database.readVersionChange(row.changeId)?.state, "applied");
    } finally { f.dispose(); }
  });
}

it("requires a new review after a blocker clears and cannot use the old confirmation", () => {
  const f = archiveFixture();
  try {
    const row = f.plan(); const request = f.applyRequest(row);
    f.terminal();
    const result = f.kernel.execute(request);
    assert.equal(result.state, "rejected");
    if (result.state === "rejected") assert.equal(result.code, "replan-required");
    const old = f.database.readVersionChange(row.changeId); assert.equal(old?.state, "superseded");
    assert.ok(old?.supersededBy);
    const next = f.database.readVersionChange(old.supersededBy); assert.ok(next);
    assert.equal(next.supersedes, row.changeId);
    assert.equal(f.database.transferredRun(f.base.run.envelope.runId), undefined);
    assert.equal(f.kernel.execute(request).state, "rejected");
    assert.equal(f.kernel.execute(f.applyRequest(next)).state, "applied");
  } finally { f.dispose(); }
});

it("preserves a mixed published/unpublished batch and refuses a competing apply after restart", () => {
  const f = archiveFixture();
  try {
    f.terminal();
    const other = f.base.createRun(id(9600));
    f.database.authority.runs.transition({ runId: other.envelope.runId, expectedVersion: other.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW });
    const row = f.plan(), request = f.applyRequest(row);
    assert.equal(row.members.length, 2);
    f.failAfter("transfer", 2);
    assert.throws(() => f.kernel.execute(request), /injected-transfer/u);
    const before = f.database.readVersionChange(row.changeId); assert.equal(before?.state, "applying");
    assert.equal(before.completedRunIds.length, 1);
    f.reopen();
    const competing = f.kernel.execute({ ...request, commandId: id(9601) });
    assert.equal(competing.state, "rejected");
    if (competing.state === "rejected") assert.equal(competing.code, "command-divergent");
    assert.equal(f.database.readVersionChange(row.changeId)?.state, "applying");
    assert.equal(f.kernel.execute(request).state, "applied");
    const storage = createRunLifecycleStorage(f.database);
    for (const member of row.members) { assert.ok(storage.readReport(member.runId)); assert.equal(f.database.authority.runs.get(member.runId), undefined); }
    assert.equal(f.database.readVersionChange(row.changeId)?.completedRunIds.length, 2);
  } finally { f.dispose(); }
});

it("admits global identity before any archive effect with a valid positive control", () => {
  const f = archiveFixture();
  try {
    f.terminal(); const row = f.plan(), request = f.applyRequest(row);
    // The successful apply reserves this command durably before the final audit.
    f.failAfter("saveReport"); assert.throws(() => f.kernel.execute(request), /injected-saveReport/u);
    const result = f.kernel.execute({ ...request, source: "dashboard" });
    assert.equal(result.state, "rejected");
    assert.equal(f.database.transferredRun(f.base.run.envelope.runId), undefined);
    assert.equal(f.kernel.execute(request).state, "applied");
  } finally { f.dispose(); }
});

it("cannot resurrect an explicitly deleted member while resuming a partially published batch", () => {
  const f = archiveFixture();
  try {
    f.terminal(); const other = f.base.createRun(id(9650));
    f.database.authority.runs.transition({ runId: other.envelope.runId, expectedVersion: other.version, now: NOW, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW } });
    const row = f.plan(), request = f.applyRequest(row);
    f.failAfter("transfer", 2); assert.throws(() => f.kernel.execute(request), /injected-transfer/u);
    const storage = createRunLifecycleStorage(f.database);
    const completed = f.database.readVersionChange(row.changeId)?.completedRunIds[0]; assert.ok(completed);
    const report = storage.readReport(completed); assert.ok(report);
    assert.equal(storage.deleteArchive({ commandId: id(9651), runId: completed, archiveFingerprint: report.digest }).state, "deleted");
    f.reopen();
    assert.throws(() => f.kernel.execute(request), /archive-report-deleted/u);
    assert.equal(f.database.readVersionChange(row.changeId)?.state, "applying");
    assert.equal(createRunLifecycleStorage(f.database).readReport(completed), undefined);
    assert.equal(f.database.authority.runs.get(completed), undefined);
    assert.ok(f.database.authority.deletedRuns.get(completed));
  } finally { f.dispose(); }
});
