import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { it } from "vitest";

import { sealArchiveReport } from "../../../src/domain/archive/report.js";
import { ArchiveDatabase } from "../../helpers/synthetic-storage-admission.js";
import { backupStoppedAuthority, upgradeStorage } from "../../helpers/synthetic-storage-admission.js";
import { foundationFixture, id, NOW } from "../database-foundation/fixtures.js";
import { storageRecoveryFixture } from "../helpers/storage-recovery-fixture.js";

function removeRuntimeIndexes(path: string): void {
  const raw = new DatabaseSync(path);
  try {
    raw.exec("DROP INDEX archive_records_dashboard_runtime_version_idx; DROP INDEX archive_records_workflow_runtime_version_idx; DROP INDEX archive_records_runtime_version_state_idx; PRAGMA user_version=1");
  } finally { raw.close(); }
}

it("upgrades a stopped schema 1 archive to indexed runtime version queries without changing reports", () => {
  const root = mkdtempSync(join(tmpdir(), "hrauto-archive-index-"));
  const path = join(root, "archive.sqlite");
  const oldReport = sealArchiveReport({ schemaVersion: 1, runId: id(99501), transferId: id(99502),
    workflow: "person-lookup", itemId: "old", attempt: 1, runNumber: null, title: "Old report",
    descriptorVersion: "1", outcome: "done", completedAt: NOW, capturedAt: NOW,
    sourceDigest: "a".repeat(64), sources: [], sections: [], files: [] });
  try {
    const created = new ArchiveDatabase(path);
    try { created.capture(oldReport); created.verify(oldReport.content.runId, oldReport.digest); created.publish(oldReport.content.runId, oldReport.digest); }
    finally { created.close(); }
    removeRuntimeIndexes(path);
    const historical = new ArchiveDatabase(path, { readOnly: true });
    try {
      assert.equal(historical.schemaVersion, 1);
      assert.deepEqual(historical.query({ workflow: "person-lookup", limit: 5, versionState: "unrecorded" }).items, [oldReport]);
      assert.deepEqual(historical.groups({ versionState: "unrecorded" }).map(({dashboardVersion, workflow, workflowVersion, reportCount}) =>
        ({dashboardVersion, workflow, workflowVersion, reportCount})), [
        {dashboardVersion: null, workflow: "person-lookup", workflowVersion: null, reportCount: 1},
      ]);
    } finally { historical.close(); }
    ArchiveDatabase.upgradeStopped(path);
    ArchiveDatabase.upgradeStopped(path);
    const upgraded = new ArchiveDatabase(path);
    try {
      assert.equal(upgraded.schemaVersion, 2);
      assert.deepEqual(upgraded.readPublishedReport(oldReport.content.runId), oldReport);
      const currentReport = sealArchiveReport({ ...oldReport.content, schemaVersion: 2,
        runId: id(99503), transferId: id(99504), title: "Current report",
        runtimeVersion: { state: "stamped", dashboard: { major: 1, minor: 0 }, workflow: { major: 1, minor: 2 } } });
      upgraded.capture(currentReport);
      upgraded.verify(currentReport.content.runId, currentReport.digest);
      upgraded.publish(currentReport.content.runId, currentReport.digest);
      assert.deepEqual(upgraded.query({ workflow: "person-lookup", limit: 5,
        dashboardVersion: { major: 1, minor: 0 }, workflowVersion: { major: 1, minor: 2 } }).items, [currentReport]);
      assert.deepEqual(upgraded.query({ workflow: "person-lookup", limit: 5, versionState: "unrecorded" }).items, [oldReport]);
      assert.deepEqual(upgraded.groups({ workflow: "person-lookup" }).map(({dashboardVersion, workflowVersion, reportCount}) =>
        ({dashboardVersion, workflowVersion, reportCount})), [
        {dashboardVersion: {major:1, minor:0}, workflowVersion: {major:1, minor:2}, reportCount:1},
        {dashboardVersion: null, workflowVersion: null, reportCount:1},
      ]);
    } finally { upgraded.close(); }
    const indexed = new DatabaseSync(path, { readOnly: true });
    try {
      const detail = indexed.prepare("EXPLAIN QUERY PLAN SELECT run_id FROM archive_records WHERE workflow=? AND state='published' AND json_extract(report_json,'$.content.runtimeVersion.dashboard.major')=? AND json_extract(report_json,'$.content.runtimeVersion.dashboard.minor')=? ORDER BY completed_at,run_id LIMIT 5").all("person-lookup", 1, 0);
      assert.ok(detail.some(row => String(row.detail).includes("archive_records_dashboard_runtime_version_idx")));
    } finally { indexed.close(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("requires a paired backup and stopped upgrade before indexing an existing archive", async () => {
  const f = foundationFixture({ registeredRuntimeVersion: true });
  const path = join(f.root, "archive.sqlite");
  try {
    new ArchiveDatabase(path).close();
    removeRuntimeIndexes(path);
    f.db.close();
    const input = { stateRoot: f.root, processLockRoot: join(f.root, "locks"), environmentFile: join(f.root, ".env"), plan: false };
    await assert.rejects(() => upgradeStorage(input, f.clock), /backup-required/);
    const beforeBackup = new ArchiveDatabase(path, { readOnly: true });
    try { assert.equal(beforeBackup.schemaVersion, 1); } finally { beforeBackup.close(); }
    await backupStoppedAuthority(f.root, f.clock);
    assert.equal((await upgradeStorage({ ...input, plan: true }, f.clock)).state, "planned");
    const afterPlan = new ArchiveDatabase(path, { readOnly: true });
    try { assert.equal(afterPlan.schemaVersion, 1); } finally { afterPlan.close(); }
    assert.equal((await upgradeStorage(input, f.clock)).state, "converted");
    const upgraded = new ArchiveDatabase(path, { readOnly: true });
    try { assert.equal(upgraded.schemaVersion, 2); } finally { upgraded.close(); }
    assert.equal((await upgradeStorage(input, f.clock)).state, "already-upgraded");
  } finally { f.dispose(); }
});

it("upgrades archive indexes during the authority 54 to 55 stopped conversion", async () => {
  const f = storageRecoveryFixture(54);
  const path = join(f.root, "archive.sqlite");
  try {
    const authority = new DatabaseSync(f.path);
    try { authority.prepare("INSERT INTO run_search_publication VALUES ('current', ?, ?)").run(
      JSON.stringify({ state: "published", sourceGeneration: 7, afterRun: null, rowCount: 0 }), NOW); }
    finally { authority.close(); }
    new ArchiveDatabase(path).close();
    removeRuntimeIndexes(path);
    await f.backup();
    assert.equal((await f.run()).state, "converted");
    const archive = new ArchiveDatabase(path, { readOnly: true });
    try { assert.equal(archive.schemaVersion, 2); } finally { archive.close(); }
  } finally { f.dispose(); }
});
