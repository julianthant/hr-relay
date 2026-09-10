import { ledgerCommitFixture } from "../fixtures/ledger-projection-fixtures.js";
import { atomicWriteCheckpoint } from "../helpers/timeline-write-fixture.js";
import assert from "node:assert/strict";
import { it } from "vitest";
import { foundationFixture, NOW } from "../database-foundation/fixtures.js";
import { ARCHIVED_RUN, ARCHIVE_RELAUNCH, VERSION_PLAN_ROW, VERSION_BUMP_APPLICATION } from "../../fixtures/archive-fixtures.js";
import { createRunLifecycleStorage } from "../../../src/core/run-lifecycle-storage.js";
import { convertHistoricalArchives } from "../../../src/services/archive/archive-transfer.js";
import { canonicalJsonStringify } from "../../../src/domain/canonical-json.js";
import { sha256Hex } from "../../../src/domain/sha256.js";
import { attachFile } from "./fixtures.js";
import { AuthorityDatabase } from "../../../src/infra/sqlite/authority-database.js";

function historicalFixture() {
  const f = foundationFixture();
  f.db.authority.runs.transition({ runId: f.run.envelope.runId, expectedVersion: f.run.version, lifecycle: { state: "terminal", outcome: "cancelled", endedAt: NOW }, now: NOW });
  const file = attachFile(f.db, f.root, f.run.envelope.runId, 9800);
  const transaction = ledgerCommitFixture(75, { runId: f.run.envelope.runId, workflowId: f.run.envelope.workflow,
    itemId: f.run.envelope.itemId, traceId: f.run.envelope.traceId, configFingerprint: f.run.envelope.configFingerprint, confirmedAt: NOW });
  assert.equal(f.db.authority.writeIntents.fenceAttempt({ intent: transaction.intent, attempt: transaction.attempt }).state, "fenced");
  f.db.commitWriteAttempt(transaction.commit, atomicWriteCheckpoint(transaction.commit));
  f.createRun(ARCHIVE_RELAUNCH.runId);
  f.db.withAuthorityTransaction(repos => {
    repos.versionPlans.insert(VERSION_PLAN_ROW);
    repos.versionPlans.consume({ versionPlanId: VERSION_PLAN_ROW.versionPlanId, expectedVersion: 1, planFingerprint: VERSION_PLAN_ROW.planFingerprint, now: NOW });
    repos.versionBumpApplications.insert(VERSION_BUMP_APPLICATION);
    repos.archivedRuns.insert(ARCHIVED_RUN);
    repos.archiveRelaunches.insert(ARCHIVE_RELAUNCH);
  });
  return { ...f, file };
}

for (const step of ["captured", "verified", "cleaned", "published"] as const) it(`converts populated historical sources and resumes ${step} with original identities and custody`, () => {
  const f = historicalFixture(); let database = f.db;
  try {
    let storage = createRunLifecycleStorage(database);
    const bundle = storage.historicalArchiveSource();
    const original = canonicalJsonStringify(bundle);
    const transactions = bundle.source.archives[0].source.records.find(group => group.table === "archive_transactions");
    assert.ok(transactions?.rows.length);
    assert.ok(transactions.rows[0].json.includes("ucpath"), "populated immutable transaction supplement survives inspection");
    assert.ok(bundle.source.archives[0].source.records.find(group => group.table === "archive_relaunches")?.rows.length);
    assert.throws(() => convertHistoricalArchives(storage, bundle, NOW, (_runId, at) => { if (at === step) throw new Error("conversion-interrupted"); }), /conversion-interrupted/u);
    database.close(); database = AuthorityDatabase.open({ path: f.path, busyTimeoutMs: 250, migrationOwner: "historical-replay" }, f.clock);
    storage = createRunLifecycleStorage(database);
    const result = convertHistoricalArchives(storage, bundle, NOW);
    assert.equal(canonicalJsonStringify(bundle), original);
    assert.deepEqual(result.retainedVersionSources, { plans: bundle.source.plans, applications: bundle.source.applications });
    assert.deepEqual(convertHistoricalArchives(storage, bundle, NOW), result);
    const report = storage.readReport(f.run.envelope.runId); assert.ok(report);
    assert.equal(report.content.sources[0].json, canonicalJsonStringify(bundle.source.archives[0].source));
    assert.deepEqual(storage.readFile(f.run.envelope.runId, f.file.file.digest).bytes, f.file.bytes);
    assert.equal(database.authority.runs.get(f.run.envelope.runId), undefined);
    assert.equal(database.authority.deletedRuns.get(f.run.envelope.runId), undefined);
    assert.deepEqual(database.authority.archiveRelaunches.listByArchivedRun(f.run.envelope.runId), [ARCHIVE_RELAUNCH]);
    assert.ok(result.dispositions.some(value => value.includes("L")));
  } finally { database.close(); f.dispose(); }
});

it("refuses corrupted bundles and inconsistent historical pairs before source removal, then converts the valid bundle", () => {
  const f = historicalFixture();
  try {
    const storage = createRunLifecycleStorage(f.db), bundle = storage.historicalArchiveSource();
    assert.throws(() => convertHistoricalArchives(storage, { ...bundle, digest: "0".repeat(64) }, NOW), /source-digest-mismatch/u);
    const source = { ...bundle.source, applications: bundle.source.applications.map(value => ({ ...value, targetVersion: "9.0.0" })) };
    assert.throws(() => convertHistoricalArchives(storage, { source, digest: sha256Hex(canonicalJsonStringify(source)) }, NOW), /pair-mismatch/u);
    assert.ok(f.db.authority.runs.get(f.run.envelope.runId));
    assert.equal(f.db.transferredRun(f.run.envelope.runId), undefined);
    assert.equal(convertHistoricalArchives(storage, bundle, NOW).reports.length, 1);
  } finally { f.dispose(); }
});
