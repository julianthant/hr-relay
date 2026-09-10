import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTransactionHistory } from "../../src/infra/sqlite/transaction-history.js";
import { exportTransactions } from "../../src/server/storage/transaction-export.js";
import { describe, it } from "vitest";
import { historyWorld, historicalWorld, HISTORY_NOW } from "./transaction-history-fixture.js";
import { fixtureUuid } from "./fixtures/ledger-projection-fixtures.js";
import { createRunLifecycleStorage } from "../../src/core/run-lifecycle-storage.js";
import { captureArchiveReport } from "../../src/services/archive/report-capture.js";
import { transferArchiveReport } from "../../src/services/archive/archive-transfer.js";

const range = { from: "2026-07-01", to: "2026-09-09" };
describe("retained archive transaction history", () => {
  for (const stop of ["captured", "verified", "cleaned", "published"] as const) {
    it(`keeps exact transactions through ${stop} interruption, restart, replay and explicit deletion`, () => {
      const w = historyWorld();
      try {
        const fixture = w.commit(801);
        w.commit(802, { instance: "test" });
        const runId = fixture.commit.transaction.runId;
        const run = w.database.authority.runs.get(runId); assert.ok(run);
        w.database.authority.runs.transition({ runId, expectedVersion: run.version,
          lifecycle: { state: "terminal", outcome: "cancelled", endedAt: HISTORY_NOW }, now: HISTORY_NOW });
        const before = w.history.query(range);
        const exportBefore = exportTransactions(w.history, { ...range, output: join(w.root, "before.json") });
        assert.equal(before.rows.length, 2);
        let storage = createRunLifecycleStorage(w.database);
        const snapshot = storage.capture(runId);
        const report = captureArchiveReport({ snapshot, transferId: fixtureUuid("history-transfer"), capturedAt: HISTORY_NOW, sections: [], files: [] });
        assert.throws(() => transferArchiveReport(storage, report, snapshot.run.version, step => {
          if (step === stop) throw new Error("injected-history-transfer");
        }), /injected-history-transfer/u);
        assert.equal(w.database.authority.deletedRuns.get(runId), undefined);
        assert.deepEqual(w.history.query(range), before);
        w.reopen(); storage = createRunLifecycleStorage(w.database);
        assert.deepEqual(w.history.query(range), before);
        transferArchiveReport(storage, report, snapshot.run.version);
        transferArchiveReport(storage, report, snapshot.run.version);
        assert.ok(storage.readReport(runId));
        const exportAfter = exportTransactions(w.history, { ...range, output: join(w.root, "after.json") });
        assert.equal(exportAfter.sourceDigest, exportBefore.sourceDigest);
        assert.deepEqual(readFileSync(exportAfter.output), readFileSync(exportBefore.output));
        assert.equal(w.database.authority.runs.get(runId), undefined);
        assert.deepEqual(w.history.query(range), before);
        assert.deepEqual(w.history.foldActivityRange(range.from, range.to).systems,
          [{ system: "ucpath", entries: 2, prod: 1, test: 1 }]);
        assert.equal(w.history.query({ ...range, system: "kuali" }).rows.length, 0);
        const request = { commandId: fixtureUuid("history-delete"), runId, archiveFingerprint: report.digest };
        assert.equal(storage.deleteArchive(request).state, "deleted");
        const after = w.history.query(range);
        assert.deepEqual(after.rows, before.rows.filter(row => row.runId !== runId));
        assert.deepEqual(w.history.foldActivityRange(range.from, range.to).systems,
          [{ system: "ucpath", entries: 1, prod: 0, test: 1 }]);
        w.reopen(); storage = createRunLifecycleStorage(w.database);
        storage.deleteArchive(request);
        assert.deepEqual(w.history.query(range), after);
        assert.throws(() => transferArchiveReport(storage, report, snapshot.run.version), /deleted/u);
      } finally { w.dispose(); }
    });
  }
});


it("retains converted operation provenance and confirmed-day filtering across transfer", async () => {
  const w = historicalWorld({ files: true });
  try {
    await w.backup(); await w.upgrade();
    const db = w.open();
    try {
      const history = createTransactionHistory(db.authority), before = history.query(range);
      const fixture = w.fixtures[0]; assert.ok(fixture);
      const runId = fixture.commit.transaction.runId;
      const run = db.authority.runs.get(runId); assert.ok(run);
      db.authority.runs.transition({ runId, expectedVersion: run.version,
        lifecycle: { state: "terminal", outcome: "cancelled", endedAt: HISTORY_NOW }, now: HISTORY_NOW });
      const storage = createRunLifecycleStorage(db), snapshot = storage.capture(runId);
      const report = captureArchiveReport({ snapshot, transferId: fixtureUuid("converted-history-transfer"), capturedAt: HISTORY_NOW, sections: [], files: [] });
      transferArchiveReport(storage, report, snapshot.run.version);
      assert.deepEqual(history.query(range), before);
      const date = before.rows.find(row => row.runId === runId)?.localDate; assert.ok(date);
      assert.equal(history.query({ from: date, to: date }).rows.length, 1);
      assert.ok(history.query(range).rows.every(row => row.sourceDigest !== null));
      storage.deleteArchive({ commandId: fixtureUuid("converted-history-delete"), runId, archiveFingerprint: report.digest });
      assert.deepEqual(history.query(range).rows, before.rows.filter(row => row.runId !== runId));
    } finally { db.close(); }
  } finally { w.dispose(); }
});

it("excludes a tombstoned owner before interrupted archive deletion settles", () => {
  const w = historyWorld();
  try {
    const fixture = w.commit(803), runId = fixture.commit.transaction.runId;
    const run = w.database.authority.runs.get(runId); assert.ok(run);
    w.database.authority.runs.transition({ runId, expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: HISTORY_NOW }, now: HISTORY_NOW });
    let storage = createRunLifecycleStorage(w.database);
    const snapshot = storage.capture(runId);
    const report = captureArchiveReport({ snapshot, transferId: fixtureUuid("delete-history-transfer"), capturedAt: HISTORY_NOW, sections: [], files: [] });
    transferArchiveReport(storage, report, snapshot.run.version);
    assert.equal(w.history.query(range).rows.length, 1);
    w.database.settleArchivedDeletion = () => { throw new Error("injected-history-delete"); };
    const request = { commandId: fixtureUuid("interrupted-history-delete"), runId, archiveFingerprint: report.digest };
    assert.throws(() => storage.deleteArchive(request), /injected-history-delete/u);
    assert.ok(w.database.lifecycleArchive(true).read(runId));
    assert.ok(w.database.authority.deletedRuns.get(runId));
    assert.equal(w.history.query(range).rows.length, 0);
    w.reopen(); storage = createRunLifecycleStorage(w.database);
    assert.equal(w.history.query(range).rows.length, 0);
    storage.deleteArchive(request);
    assert.equal(w.history.query(range).rows.length, 0);
  } finally { w.dispose(); }
});

it("refuses a missing retained report instead of returning smaller totals", () => {
  const w = historyWorld();
  try {
    const fixture = w.commit(804), runId = fixture.commit.transaction.runId;
    const run = w.database.authority.runs.get(runId); assert.ok(run);
    w.database.authority.runs.transition({ runId, expectedVersion: run.version,
      lifecycle: { state: "terminal", outcome: "cancelled", endedAt: HISTORY_NOW }, now: HISTORY_NOW });
    const storage = createRunLifecycleStorage(w.database), snapshot = storage.capture(runId);
    const report = captureArchiveReport({ snapshot, transferId: fixtureUuid("missing-history-transfer"), capturedAt: HISTORY_NOW, sections: [], files: [] });
    transferArchiveReport(storage, report, snapshot.run.version);
    assert.equal(w.history.query(range).rows.length, 1);
    using raw = new DatabaseSync(join(w.root, "archive.sqlite"));
    raw.exec("DROP TRIGGER archive_records_delete_receipt; DELETE FROM archive_records");
    assert.throws(() => w.history.query(range), /archive-unverified/u);
  } finally { w.dispose(); }
});
