import { createRunLifecycleStorage } from "./helpers/lifecycle-storage.js";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createTransactionHistory } from "../../src/infra/sqlite/transaction-history.js";
import { exportTransactions } from "../../src/server/storage/transaction-export.js";
import { describe, it, vi } from "vitest";
import { historyWorld, historicalWorld, HISTORY_NOW } from "../unit/transaction-history-fixture.js";
import { fixtureUuid } from "../fixtures/ledger-projection-fixtures.js";
import { captureArchiveReport } from "../../src/backend/storage/archive/report-capture.js";
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

it("bounds cold range/run evidence reads before decoding unrelated live and archived history",()=>{
  const w=historyWorld();
  try {
    const archivedIds:string[]=[];
    for(let index=1000;index<1120;index++) {
      const f=w.commit(index,{confirmedAt:index===1000?"2026-09-08T18:00:00.000Z":"2026-08-01T18:00:00.000Z"});
      const runId=f.commit.transaction.runId;
      if(index<1040) {
        const run=w.database.authority.runs.get(runId);assert.ok(run);
        w.database.authority.runs.transition({runId,expectedVersion:run.version,lifecycle:{state:"terminal",outcome:"cancelled",endedAt:HISTORY_NOW},now:HISTORY_NOW});
        const storage=createRunLifecycleStorage(w.database),snapshot=storage.capture(runId);
        const report=captureArchiveReport({snapshot,transferId:fixtureUuid(`bounded-${String(index)}`),capturedAt:HISTORY_NOW,sections:[],files:[]});
        transferArchiveReport(storage,report,snapshot.run.version);archivedIds.push(runId);
      }
    }
    w.reopen();
    // Observe returned raw evidence rows, not SQLite's internal page/row visits. Startup
    // admission remains separate; the cold query has no previously opened archive reader.
    const observed:{sql:string;rows:number}[]=[];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- call restores the database receiver.
    const original=DatabaseSync.prototype.prepare;
    const spy=vi.spyOn(DatabaseSync.prototype,"prepare").mockImplementation(function(this:DatabaseSync,sql:string){
      const statement=original.call(this,sql);
      if(/SELECT(?: \*|[\s\S]*record_json)[\s\S]*FROM (?:timeline_events|timeline_operation_sources|archive_records)/u.test(sql)) {
        const get=statement.get.bind(statement),all=statement.all.bind(statement);
        statement.get=(...args)=>{const row=Reflect.apply(get,statement,args) as ReturnType<typeof get>;observed.push({sql,rows:row===undefined?0:1});return row;};
        statement.all=(...args)=>{const rows=Reflect.apply(all,statement,args) as ReturnType<typeof all>;observed.push({sql,rows:rows.length});return rows;};
      }
      return statement;
    });
    try {
      const selected=w.history.query({from:"2026-09-08",to:"2026-09-08"});assert.equal(selected.rows.length,1);
      assert.equal(observed.filter(row=>row.sql.includes("FROM archive_records")).reduce((n,row)=>n+row.rows,0),2);
      assert.ok(observed.every(row=>row.rows<=1));
      const cold=observed.map(row=>({...row}));
      observed.length=0;
      assert.equal(w.history.query({from:"0001-01-01",to:"9999-12-31",runId:archivedIds[1]}).rows.length,1);
      assert.equal(observed.filter(row=>row.sql.includes("FROM archive_records")).reduce((n,row)=>n+row.rows,0),2);
      const runSelection=observed.map(row=>({...row}));
      w.commit(1120,{confirmedAt:"2026-09-08T18:00:00.000Z"});observed.length=0;
      assert.equal(w.history.query({from:"2026-09-08",to:"2026-09-08"}).rows.length,2);
      assert.ok(observed.every(row=>row.rows<=1));
      const postMutation=observed.map(row=>({...row}));
      // Negative control: the same observer catches a deliberately widened archive read.
      using rawArchive=new DatabaseSync(join(w.root,"archive.sqlite"),{readOnly:true});
      observed.length=0;rawArchive.prepare("SELECT * FROM archive_records").all();
      assert.equal(observed.reduce((n,row)=>n+row.rows,0),40);
      using raw=new DatabaseSync(w.path,{readOnly:true});
      const rangePlan=raw.prepare("EXPLAIN QUERY PLAN SELECT record_key FROM transaction_selection WHERE confirmed_at>=? AND confirmed_at<? ORDER BY confirmed_at,record_key LIMIT 10001").all("2026-09-08","2026-09-09");
      assert.match(JSON.stringify(rangePlan),/SEARCH.*transaction_selection_range_idx/u);
      const runPlan=raw.prepare("EXPLAIN QUERY PLAN SELECT record_key FROM transaction_selection WHERE run_id=? ORDER BY confirmed_at,record_key LIMIT 10001").all(archivedIds[0]??"");
      assert.match(JSON.stringify(runPlan),/SEARCH.*transaction_selection_run_idx/u);
      process.stdout.write(`P2_QUERY_PROOF ${JSON.stringify({kind:"transaction-range-run",historyConfirmations:120,archivedSources:40,cold,runSelection,postMutation,widenedArchiveRows:observed.reduce((n,row)=>n+row.rows,0),rangePlan,runPlan})}\n`);
    } finally {spy.mockRestore();}
  } finally {w.dispose();}
});
