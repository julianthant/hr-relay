import { default as assert_m0,default as assert_m1 } from "node:assert/strict";
import { lstatSync as lstatSync_m0,readFileSync as readFileSync_m0,readFileSync as readFileSync_m1,symlinkSync as symlinkSync_m0,writeFileSync as writeFileSync_m0 } from "node:fs";
import { join as join_m1 } from "node:path";
import { afterEach as afterEach_m0,describe as describe_m0,it as it_m0,it as it_m1 } from "vitest";
import { exportTransactions as exportTransactions_m0,exportTransactions as exportTransactions_m1,parseTransactionExportArgs as parseTransactionExportArgs_m0 } from "../../../../src/backend/storage/maintenance/transaction-export.js";
import { fixtureUuid as fixtureUuid_m1 } from "../../../support/fixtures/ledger-projection-fixtures.js";
import { testRunService as testRunService_m1 } from "../../../support/fixtures/run-lifecycle-fixtures.js";
import { historyClock as historyClock_m1,historyWorld as historyWorld_m0,historyWorld as historyWorld_m1 } from "../../../support/helpers/storage/transaction-history-fixture.js";


{

const cleanup: (() => void)[] = [];
const _afterEachFixture0 = () => { for (const dispose of cleanup.splice(0)) dispose(); };
const range = { from: "2026-07-01", to: "2026-09-09" };
describe_m0("explicit transaction export", () => {
afterEach_m0(_afterEachFixture0);

  it_m0("requires a complete valid explicit selection and rejects duplicate and unknown options", () => {
    for (const args of [[], ["--from", range.from], ["--from", range.from, "--from", range.from], ["--unknown", "value"], ["--output"]]) assert_m0.throws(() => parseTransactionExportArgs_m0(args));
    assert_m0.throws(() => parseTransactionExportArgs_m0(["--from", range.to, "--to", range.from, "--output", "report.json"]));
    assert_m0.deepEqual(parseTransactionExportArgs_m0(["--help"]), { kind: "help" });
    assert_m0.deepEqual(parseTransactionExportArgs_m0(["--from", range.from, "--to", range.to, "--output", "report.json", "--system", "ucpath"]),
      { kind: "export", request: { ...range, output: "report.json", system: "ucpath" } });
  });
  it_m0("pins one database snapshot and produces deterministic private-file public presentation", () => {
    const w = historyWorld_m0(); cleanup.push(() => w.dispose()); w.commit(301);
    const snapshot = w.history.query(range); w.commit(302);
    const pinned = { ...w.history, query: () => snapshot };
    const first = exportTransactions_m0(pinned, { ...range, output: `${w.root}/first.json` });
    const second = exportTransactions_m0(pinned, { ...range, output: `${w.root}/second.json` });
    assert_m0.equal(first.transactions, 1); assert_m0.equal(first.sourceDigest, second.sourceDigest);
    assert_m0.deepEqual(readFileSync_m0(first.output), readFileSync_m0(second.output));
    assert_m0.equal(lstatSync_m0(first.output).mode & 0o777, 0o600);
    const text = readFileSync_m0(first.output, "utf8");
    assert_m0.equal(text.includes('"bindingProof"'), false); assert_m0.equal(text.includes('"idempotencyKey"'), false);
    assert_m0.equal(exportTransactions_m0(w.history, { ...range, system: "kuali", output: `${w.root}/filtered.json` }).transactions, 0);
  });
  it_m0("refuses existing output and symlinks without changing either owner", () => {
    const w = historyWorld_m0(); cleanup.push(() => w.dispose()); w.commit(303);
    const output = `${w.root}/owned.json`; writeFileSync_m0(output, "other-owner");
    assert_m0.throws(() => exportTransactions_m0(w.history, { ...range, output }), /EEXIST/u);
    assert_m0.equal(readFileSync_m0(output, "utf8"), "other-owner");
    const link = `${w.root}/link.json`; symlinkSync_m0(output, link);
    assert_m0.throws(() => exportTransactions_m0(w.history, { ...range, output: link }), /EEXIST/u);
    assert_m0.equal(lstatSync_m0(link).isSymbolicLink(), true); assert_m0.equal(readFileSync_m0(output, "utf8"), "other-owner");
  });
});
}

{


const range = { from: "2026-07-01", to: "2026-09-09" };

for (const stop of ["before-delete", "after-delete"] as const) {
  it_m1(`keeps exact transactions through ${stop} rollback, restart, deletion and replay`, () => {
    const w = historyWorld_m1({ terminalize: true });
    try {
      const fixture = w.commit(801);
      w.commit(802, { instance: "test" });
      const runId = fixture.commit.transaction.runId;
      const run = w.database.authority.runs.get(runId); assert_m1.ok(run);
      const proof = w.database.authority.writeIntents.get(fixture.commit.transaction.writeIntentId); assert_m1.ok(proof);
      const before = w.history.query(range);
      const exported = exportTransactions_m1(w.history, { ...range, output: join_m1(w.root, "before.json") });
      assert_m1.equal(before.rows.length, 2);
      const request = { commandId: fixtureUuid_m1(`history-delete-${stop}`), runId, expectedVersion: run.version };
      assert_m1.throws(() => w.database.withAuthorityTransaction(() => {
        if (stop === "after-delete") assert_m1.equal(testRunService_m1(w.database, historyClock_m1).delete(request).state, "deleted");
        throw new Error("injected-history-delete");
      }), /injected-history-delete/u);
      assert_m1.equal(w.database.authority.deletedRuns.get(runId), undefined);
      assert_m1.deepEqual(w.database.authority.runs.get(runId), run);
      assert_m1.deepEqual(w.history.query(range), before);
      w.reopen();
      assert_m1.deepEqual(w.history.query(range), before);
      assert_m1.equal(testRunService_m1(w.database, historyClock_m1).delete(request).state, "deleted");
      assert_m1.equal(w.database.authority.runs.get(runId), undefined);
      assert_m1.ok(w.database.authority.deletedRuns.get(runId));
      const after = w.history.query(range);
      assert_m1.equal(after.rows.length, 2);
      assert_m1.deepEqual(w.database.authority.writeIntents.get(fixture.commit.transaction.writeIntentId), proof);
      assert_m1.deepEqual(after.rows.map(row => row.ledger), before.rows.map(row => row.ledger));
      assert_m1.deepEqual(after.rows.map(row => row.checkpoint), before.rows.map(row => row.checkpoint));
      assert_m1.deepEqual(w.history.foldActivityRange(range.from, range.to).systems,
        [{ system: "ucpath", entries: 2, prod: 1, test: 1 }]);
      assert_m1.equal(w.history.query({ ...range, system: "kuali" }).rows.length, 0);
      const exportAfter = exportTransactions_m1(w.history, { ...range, output: join_m1(w.root, "after.json") });
      assert_m1.notEqual(exportAfter.sourceDigest, exported.sourceDigest);
      assert_m1.equal(exportAfter.transactions, exported.transactions);
      assert_m1.notDeepEqual(readFileSync_m1(exportAfter.output), readFileSync_m1(exported.output));
      const bytes = readFileSync_m1(exportAfter.output);
      w.reopen();
      assert_m1.equal(testRunService_m1(w.database, historyClock_m1).delete(request).state, "applied-already");
      assert_m1.deepEqual(w.history.query(range), after);
      const replay = exportTransactions_m1(w.history, { ...range, output: join_m1(w.root, "replay.json") });
      assert_m1.deepEqual(readFileSync_m1(replay.output), bytes);
    } finally { w.dispose(); }
  });
}
}
