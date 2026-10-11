import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { exportTransactions } from "../../../../../../src/backend/storage/maintenance/transaction-export.js";
import { it, vi } from "vitest";
import { historyWorld } from "../../../../../support/helpers/storage/transaction-history-fixture.js";
import { fixtureUuid } from "../../../../../support/fixtures/ledger-projection-fixtures.js";
import { testRunService } from "../../../../../support/fixtures/run-lifecycle-fixtures.js";
import { historyClock } from "../../../../../support/helpers/storage/transaction-history-fixture.js";

const range = { from: "2026-07-01", to: "2026-09-09" };

for (const stop of ["before-delete", "after-delete"] as const) {
  it(`keeps exact transactions through ${stop} rollback, restart, deletion and replay`, () => {
    const w = historyWorld({ terminalize: true });
    try {
      const fixture = w.commit(801);
      w.commit(802, { instance: "test" });
      const runId = fixture.commit.transaction.runId;
      const run = w.database.authority.runs.get(runId); assert.ok(run);
      const proof = w.database.authority.writeIntents.get(fixture.commit.transaction.writeIntentId); assert.ok(proof);
      const before = w.history.query(range);
      const exported = exportTransactions(w.history, { ...range, output: join(w.root, "before.json") });
      assert.equal(before.rows.length, 2);
      const request = { commandId: fixtureUuid(`history-delete-${stop}`), runId, expectedVersion: run.version };
      assert.throws(() => w.database.withAuthorityTransaction(() => {
        if (stop === "after-delete") assert.equal(testRunService(w.database, historyClock).delete(request).state, "deleted");
        throw new Error("injected-history-delete");
      }), /injected-history-delete/u);
      assert.equal(w.database.authority.deletedRuns.get(runId), undefined);
      assert.deepEqual(w.database.authority.runs.get(runId), run);
      assert.deepEqual(w.history.query(range), before);
      w.reopen();
      assert.deepEqual(w.history.query(range), before);
      assert.equal(testRunService(w.database, historyClock).delete(request).state, "deleted");
      assert.equal(w.database.authority.runs.get(runId), undefined);
      assert.ok(w.database.authority.deletedRuns.get(runId));
      const after = w.history.query(range);
      assert.equal(after.rows.length, 2);
      assert.deepEqual(w.database.authority.writeIntents.get(fixture.commit.transaction.writeIntentId), proof);
      assert.deepEqual(after.rows.map(row => row.ledger), before.rows.map(row => row.ledger));
      assert.deepEqual(after.rows.map(row => row.checkpoint), before.rows.map(row => row.checkpoint));
      assert.deepEqual(w.history.foldActivityRange(range.from, range.to).systems,
        [{ system: "ucpath", entries: 2, prod: 1, test: 1 }]);
      assert.equal(w.history.query({ ...range, system: "kuali" }).rows.length, 0);
      const exportAfter = exportTransactions(w.history, { ...range, output: join(w.root, "after.json") });
      assert.notEqual(exportAfter.sourceDigest, exported.sourceDigest);
      assert.equal(exportAfter.transactions, exported.transactions);
      assert.notDeepEqual(readFileSync(exportAfter.output), readFileSync(exported.output));
      const bytes = readFileSync(exportAfter.output);
      w.reopen();
      assert.equal(testRunService(w.database, historyClock).delete(request).state, "applied-already");
      assert.deepEqual(w.history.query(range), after);
      const replay = exportTransactions(w.history, { ...range, output: join(w.root, "replay.json") });
      assert.deepEqual(readFileSync(replay.output), bytes);
    } finally { w.dispose(); }
  });
}

it("refuses missing retained confirmation publication instead of returning smaller totals", () => {
  const w = historyWorld({ terminalize: true });
  try {
    const fixture = w.commit(804), runId = fixture.commit.transaction.runId;
    const run = w.database.authority.runs.get(runId); assert.ok(run);
    assert.equal(testRunService(w.database, historyClock).delete({ commandId: fixtureUuid("missing-history-delete"),
      runId, expectedVersion: run.version }).state, "deleted");
    assert.equal(w.history.query(range).rows.length, 1);
    using raw = new DatabaseSync(w.path);
    const triggers = raw.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND tbl_name='write_intents'").all();
    try {
      for (const trigger of triggers) raw.exec(`DROP TRIGGER "${String(trigger.name)}"`);
      assert.equal(raw.prepare("UPDATE write_intents SET publication_json=NULL WHERE id=?").run(fixture.commit.transaction.writeIntentId).changes, 1);
    } finally { for (const trigger of triggers) raw.exec(String(trigger.sql)); }
    assert.throws(() => w.history.query(range), /run-search-index-rebuild-required/u);
  } finally { w.dispose(); }
});

it("bounds cold range/run selected evidence independently of unrelated current and deleted history", () => {
  const w = historyWorld({ terminalize: true });
  try {
    const deletedIds: string[] = [];
    for (let index = 1000; index < 1120; index++) {
      const fixture = w.commit(index, { confirmedAt: index === 1000 ? "2026-09-08T18:00:00.000Z" : "2026-08-01T18:00:00.000Z" });
      if (index < 1040) {
        const run = w.database.authority.runs.get(fixture.commit.transaction.runId); assert.ok(run);
        assert.equal(testRunService(w.database, historyClock).delete({ commandId: fixtureUuid(`bounded-delete-${index}`),
          runId: run.envelope.runId, expectedVersion: run.version }).state, "deleted");
        deletedIds.push(run.envelope.runId);
      }
    }
    w.reopen();
    const observed: Array<{ sql: string; rows: number }> = [];
    // eslint-disable-next-line @typescript-eslint/unbound-method -- restores the native receiver.
    const original = DatabaseSync.prototype.prepare;
    const spy = vi.spyOn(DatabaseSync.prototype, "prepare").mockImplementation(function(this: DatabaseSync, sql: string) {
      const statement = original.call(this, sql);
      if (sql.includes("WITH sources AS")) {
        const all = statement.all.bind(statement);
        statement.all = (...args) => { const rows = Reflect.apply(all, statement, args) as ReturnType<typeof all>; observed.push({ sql, rows: rows.length }); return rows; };
      }
      return statement;
    });
    try {
      assert.equal(w.history.query({ from: "2026-09-08", to: "2026-09-08" }).rows.length, 1);
      assert.equal(observed.length, 1);
      assert.ok(observed.every(row => row.rows <= 1));
      observed.length = 0;
      assert.equal(w.history.query({ from: "0001-01-01", to: "9999-12-31", runId: deletedIds[1] }).rows.length, 1);
      assert.equal(observed.length, 1);
      assert.ok(observed.every(row => row.rows <= 1));
      w.commit(1120, { confirmedAt: "2026-09-08T18:00:00.000Z" }); observed.length = 0;
      assert.equal(w.history.query({ from: "2026-09-08", to: "2026-09-08" }).rows.length, 2);
      assert.equal(observed.length, 1);
      assert.ok(observed.every(row => row.rows <= 2));
      observed.length = 0;
      assert.equal(w.history.query({ from: "0001-01-01", to: "9999-12-31" }).rows.length, 121);
      assert.equal(observed[0]?.rows, 121);
      using raw = new DatabaseSync(w.path, { readOnly: true });
      const rangePlan = raw.prepare("EXPLAIN QUERY PLAN SELECT id FROM timeline_events WHERE retention_class='confirmed-operation' AND confirmed_at>=? AND confirmed_at<? ORDER BY confirmed_at,id LIMIT 10001").all("2026-09-08", "2026-09-09");
      assert.match(JSON.stringify(rangePlan), /SEARCH.*timeline_retention_idx/u);
      const runPlan = raw.prepare("EXPLAIN QUERY PLAN SELECT id FROM timeline_events WHERE retention_class='confirmed-operation' AND run_id=? ORDER BY confirmed_at,id LIMIT 10001").all(deletedIds[0] ?? "");
      assert.match(JSON.stringify(runPlan), /SEARCH.*timeline_run_transactions_idx/u);
    } finally { spy.mockRestore(); }
  } finally { w.dispose(); }
});
